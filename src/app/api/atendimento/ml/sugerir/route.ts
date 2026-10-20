import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { perguntarJSON } from '@/lib/ia/claude'
import { LIMITE_MENSAGEM_POS_VENDA, LIMITE_RESPOSTA_PERGUNTA } from '@/lib/mercadolivre/atendimentoRegras'

// Sugestão de resposta escrita pela IA, a partir do CADASTRO do produto
// (nome, marca, medidas, peso, estoque, descrição). A pessoa revisa e envia —
// a sugestão nunca sai sozinha. O que o cadastro não diz, a IA não inventa:
// marca entre [colchetes] para a pessoa completar.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Corpo = {
  tipo?: 'pergunta' | 'reclamacao' | 'conversa'
  pergunta?: string
  historico?: { de: string; texto: string }[]
  produtoId?: string | null
  anuncio?: { titulo?: string; preco?: number | null; estoque?: number | null } | null
  motivo?: string
}

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })
  const c = await req.json().catch(() => ({})) as Corpo
  const tipo = c.tipo ?? 'pergunta'
  const pergunta = String(c.pergunta ?? '').slice(0, 2000)
  if (!pergunta.trim() && !(c.historico ?? []).length) return NextResponse.json({ ok: false, erro: 'Nada para responder.' }, { status: 400 })

  let produto: Record<string, unknown> | null = null
  if (c.produtoId && UUID.test(c.produtoId)) {
    const { data } = await sb.from('produtos')
      .select('nome, marca, unidade, estoque, peso_kg, comprimento_cm, largura_cm, altura_cm, descricao_marketplace')
      .eq('empresa_id', guarda.empresaId).eq('id', c.produtoId).maybeSingle()
    produto = data ?? null
  }

  const limite = tipo === 'conversa' ? LIMITE_MENSAGEM_POS_VENDA : Math.min(LIMITE_RESPOSTA_PERGUNTA, 600)
  const contexto = tipo === 'pergunta' ? 'uma PERGUNTA de um interessado num anúncio, antes da compra'
    : tipo === 'reclamacao' ? `uma RECLAMAÇÃO de um comprador (motivo: ${c.motivo ?? 'não informado'})`
    : 'uma MENSAGEM de um comprador depois da venda'

  const prompt = `Você escreve a resposta de uma loja de ferragens e materiais de construção no Mercado Livre para ${contexto}.

REGRAS (obrigatórias):
- Português do Brasil, cordial e direto. Comece com "Olá!" e termine agradecendo. No máximo ${limite} caracteres.
- Use SÓ os dados abaixo. Se a resposta depende de algo que os dados não dizem, NÃO invente: escreva o trecho entre [colchetes] para a loja completar, ex.: "[confirmar a voltagem]".
- Proibido: telefone, e-mail, link, WhatsApp, redes sociais, pedir para comprar fora do Mercado Livre.
- Não prometa prazo de entrega nem desconto. Não cite o estoque exato; diga só se tem ou não tem.
- Não decida pela loja: desconto, preço para quantidade, troca, devolução, reserva ou prazo são decisão do dono — escreva entre [colchetes], ex.: "[dizer se faz preço para 4 unidades]".
- Reclamação: reconheça o problema, peça desculpas sem assumir culpa que não é clara e diga o próximo passo; não ofereça reembolso por conta própria.

ANÚNCIO: ${JSON.stringify(c.anuncio ?? {})}
PRODUTO NO CADASTRO: ${JSON.stringify(produto ?? 'sem cadastro ligado')}
${pergunta.trim() ? `TEXTO DO CLIENTE: ${JSON.stringify(pergunta)}` : ''}
${(c.historico ?? []).length ? `CONVERSA ATÉ AGORA: ${JSON.stringify((c.historico ?? []).slice(-10))}` : ''}

Responda só com JSON: {"resposta": "..."}`

  try {
    const r = await perguntarJSON(prompt)
    const resposta = String(r?.resposta ?? '').trim().slice(0, limite)
    if (!resposta) return NextResponse.json({ ok: false, erro: 'A IA não sugeriu nada. Escreva a resposta.' }, { status: 400 })
    return NextResponse.json({ ok: true, resposta })
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'IA indisponível' }, { status: 400 })
  }
}
