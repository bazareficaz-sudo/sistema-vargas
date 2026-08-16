import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { notificarMovimentoProduto } from '@/lib/produtos/monitoramento'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// Disparado pelo PDV (client-side) depois de uma venda/devolução manual —
// server-side pra não expor o token do Z-API no navegador. A checagem de
// "monitorar" acontece aqui, não confia no que o cliente mandou.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(supabase, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 400 })

  const { produtoId, tipo, quantidade, estoqueAnterior, estoqueNovo, quem, origem } = await request.json()
  if (!produtoId || !tipo || quantidade == null || estoqueNovo == null)
    return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 })

  const { data: produto } = await supabase.from('produtos').select('nome, monitorar').eq('id', produtoId).eq('empresa_id', empresaId).single()
  if (!produto?.monitorar) return NextResponse.json({ ok: true, ignorado: true })

  await notificarMovimentoProduto(supabase, empresaId, {
    produtoId,
    produtoNome: produto.nome,
    tipo: tipo === 'devolucao' ? 'devolucao' : 'venda',
    quantidade,
    estoqueAnterior: estoqueAnterior ?? estoqueNovo,
    estoqueNovo,
    quem: quem ?? null,
    origem: origem || 'PDV',
  })

  return NextResponse.json({ ok: true })
}
