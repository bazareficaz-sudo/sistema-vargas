import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { MODELO_FORTE, perguntarJSON } from '@/lib/ia/claude'
import { LIMITE_RESPOSTA_AVALIACAO } from '@/lib/shopee/atendimentoRegras'

// Sugestão de resposta para uma AVALIAÇÃO da Shopee. Diferente da pergunta do
// ML: a resposta é pública e quem mais lê são os PRÓXIMOS compradores. Nota
// alta: agradecer curto. Nota baixa: reconhecer, sem discutir, sem prometer
// reembolso. A pessoa revisa e envia.

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })
  const { nota, texto, produto } = await req.json().catch(() => ({})) as { nota?: number; texto?: string; produto?: string }

  const prompt = `Você escreve a resposta PÚBLICA de uma loja de ferragens e materiais de construção a uma avaliação de produto na Shopee.

REGRAS (obrigatórias):
- Português do Brasil, cordial, curto (no máximo 300 caracteres). Revise a concordância.
- Quem mais lê a resposta são os próximos compradores.
- Nota 4 ou 5: agradeça de forma calorosa e específica ao que a pessoa disse; convide a voltar à loja.
- Nota 1 a 3: agradeça o retorno, reconheça o problema sem discutir com o cliente, sem culpar transportadora ou cliente e sem assumir culpa que não é clara; diga que a loja está à disposição pelo chat da Shopee. Não ofereça reembolso, troca ou desconto — isso é decisão da loja: se fizer sentido, deixe entre [colchetes], ex.: "[oferecer troca?]".
- Só afirme o que está escrito nos dados. Proibido: telefone, e-mail, link, WhatsApp, redes sociais.

PRODUTO: ${JSON.stringify(produto ?? 'não informado')}
NOTA: ${Number(nota ?? 0)} de 5
AVALIAÇÃO DO CLIENTE: ${JSON.stringify(String(texto ?? '').slice(0, 1500) || '(sem texto, só a nota)')}

Responda só com JSON: {"resposta": "..."}`

  try {
    const r = await perguntarJSON(prompt, MODELO_FORTE)
    const resposta = String(r?.resposta ?? '').trim().slice(0, LIMITE_RESPOSTA_AVALIACAO)
    if (!resposta) return NextResponse.json({ ok: false, erro: 'A IA não sugeriu nada. Escreva a resposta.' }, { status: 400 })
    return NextResponse.json({ ok: true, resposta })
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'IA indisponível' }, { status: 400 })
  }
}
