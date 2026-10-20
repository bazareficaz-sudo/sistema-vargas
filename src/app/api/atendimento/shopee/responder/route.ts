import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { lojasDeAtendimento, responderAvaliacao } from '@/lib/shopee/atendimento'
import { LIMITE_RESPOSTA_AVALIACAO } from '@/lib/shopee/atendimentoRegras'
import { avisoDeContato } from '@/lib/mercadolivre/atendimentoRegras'

// Responde uma avaliação de produto na Shopee com o texto que a pessoa
// escreveu na tela de Atendimento. A resposta fica pública no anúncio.

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { canalId, commentId, texto: bruto, forcar } = await req.json().catch(() => ({})) as { canalId?: string; commentId?: number; texto?: string; forcar?: boolean }
  const texto = String(bruto ?? '').trim()
  if (!canalId || !commentId || !texto) return NextResponse.json({ ok: false, erro: 'Escreva a resposta.' }, { status: 400 })
  if (texto.length > LIMITE_RESPOSTA_AVALIACAO) return NextResponse.json({ ok: false, erro: `Até ${LIMITE_RESPOSTA_AVALIACAO} caracteres.` }, { status: 400 })
  // A Shopee também proíbe levar o comprador para fora da plataforma.
  const aviso = avisoDeContato(texto)
  if (aviso && !forcar) return NextResponse.json({ ok: false, aviso: `A resposta ${aviso} — a Shopee proíbe dado de contato fora da plataforma.` }, { status: 400 })

  const [loja] = await lojasDeAtendimento(sb, guarda.empresaId, canalId)
  if (!loja) return NextResponse.json({ ok: false, erro: 'Loja Shopee não encontrada ou desconectada.' }, { status: 404 })
  try {
    await responderAvaliacao(loja, Number(commentId), texto)
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'A Shopee recusou.' }, { status: 400 })
  }
  await sb.from('marketplace_sync_log').insert({
    canal_id: loja.id, tipo: 'atendimento_avaliacao', status: 'ok',
    mensagem: `Avaliação ${commentId} respondida`, detalhes: { tamanho: texto.length },
  })
  return NextResponse.json({ ok: true })
}
