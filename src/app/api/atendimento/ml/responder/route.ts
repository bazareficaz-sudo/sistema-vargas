import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { canaisDeAtendimento, mensagemNaReclamacao, responderConversa, responderPergunta } from '@/lib/mercadolivre/atendimento'
import { avisoDeContato, LIMITE_MENSAGEM_POS_VENDA, LIMITE_RESPOSTA_PERGUNTA } from '@/lib/mercadolivre/atendimentoRegras'

// Envia a resposta escrita na tela de Atendimento para o Mercado Livre:
// pergunta, mensagem na reclamação ou mensagem pós-venda. Só o que a pessoa
// escreveu e mandou — nada sai sozinho.

type Corpo = {
  tipo?: 'pergunta' | 'reclamacao' | 'conversa'
  canalId?: string; id?: string | number; compradorId?: string
  texto?: string
  /** A pessoa viu o aviso de dado de contato e quis mandar mesmo assim. */
  forcar?: boolean
}

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { tipo, canalId, id, compradorId, texto: bruto, forcar } = await req.json().catch(() => ({})) as Corpo
  const texto = String(bruto ?? '').trim()
  if (!tipo || !canalId || !id || !texto) return NextResponse.json({ ok: false, erro: 'Escreva a resposta.' }, { status: 400 })
  const limite = tipo === 'conversa' ? LIMITE_MENSAGEM_POS_VENDA : LIMITE_RESPOSTA_PERGUNTA
  if (texto.length > limite) return NextResponse.json({ ok: false, erro: `O Mercado Livre aceita até ${limite} caracteres.` }, { status: 400 })
  const aviso = avisoDeContato(texto)
  if (aviso && !forcar) return NextResponse.json({ ok: false, aviso: `A resposta ${aviso} — o Mercado Livre proíbe dado de contato fora da plataforma.` }, { status: 400 })

  const [canal] = await canaisDeAtendimento(sb, guarda.empresaId, canalId)
  if (!canal) return NextResponse.json({ ok: false, erro: 'Conta do Mercado Livre não encontrada ou desconectada.' }, { status: 404 })

  try {
    if (tipo === 'pergunta') await responderPergunta(canal, Number(id), texto)
    else if (tipo === 'reclamacao') await mensagemNaReclamacao(canal, Number(id), texto)
    else {
      if (!compradorId) return NextResponse.json({ ok: false, erro: 'Comprador não identificado na conversa.' }, { status: 400 })
      await responderConversa(canal, String(id), compradorId, texto)
    }
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'O Mercado Livre recusou.' }, { status: 400 })
  }

  await sb.from('marketplace_sync_log').insert({
    canal_id: canal.id, tipo: `atendimento_${tipo}`, status: 'ok',
    mensagem: `Resposta enviada (${tipo} ${id})`, detalhes: { tamanho: texto.length },
  })
  return NextResponse.json({ ok: true })
}
