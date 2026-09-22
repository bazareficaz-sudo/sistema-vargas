import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auth/permissoes'
import { contextoCaixa } from '@/lib/caixa/contextoCaixa'
import { buscarOuCriarTesouraria } from '@/lib/caixa/tesourariaServidor'
import { validarNovoMovimento } from '@/lib/caixa/movimento'

const LIMITE_PADRAO = 50
const LIMITE_MAXIMO = 200

// Extrato do Caixa da Empresa — mais recente primeiro, paginado por cursor
// (`antes`, o created_at do último item da página anterior).
export async function GET(req: Request) {
  const sb = await createClient()
  const guarda = await contextoCaixa(sb)
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const url = new URL(req.url)
  const antes = url.searchParams.get('antes')
  const limite = Math.min(Math.max(Number(url.searchParams.get('limite')) || LIMITE_PADRAO, 1), LIMITE_MAXIMO)

  const caixa = await buscarOuCriarTesouraria(sb, guarda.empresaId, guarda.userId)

  let query = sb.from('caixa_movimento').select('*')
    .eq('caixa_id', caixa.id).order('created_at', { ascending: false }).limit(limite)
  if (antes) query = query.lt('created_at', antes)

  const { data: movimentos, error } = await query
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, caixa, movimentos: movimentos ?? [] })
}

// Lança um movimento manual: aporte, retirada de sócio, depósito no banco
// ou ajuste de contagem. É a única forma de escrever no ledger nesta fase —
// nunca UPDATE, nunca do navegador direto no Supabase.
export async function POST(req: Request) {
  const payload = await req.json().catch(() => ({}))

  const sb = await createClient()
  const guarda = await contextoCaixa(sb)
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const validado = validarNovoMovimento(payload)
  if (!validado.ok) return NextResponse.json({ ok: false, erro: validado.erro }, { status: 400 })

  const caixa = await buscarOuCriarTesouraria(sb, guarda.empresaId, guarda.userId)

  const { data: movimento, error } = await sb.from('caixa_movimento').insert({
    caixa_id: caixa.id,
    empresa_id: guarda.empresaId,
    usuario_id: guarda.userId,
    ...validado.movimento,
  }).select('*').single()
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: 'caixa_movimento_lancado', tabela: 'caixa_movimento',
    valorNovo: { id: movimento.id, natureza: movimento.natureza, tipo: movimento.tipo, valor: movimento.valor },
  })

  return NextResponse.json({ ok: true, movimento })
}
