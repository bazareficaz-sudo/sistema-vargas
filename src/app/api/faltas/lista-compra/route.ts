import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { carregarListaCompra } from '@/lib/faltas/listaCompra'

export const dynamic = 'force-dynamic'

// Lista de compra para o painel "Faltas" do Pedido ao Fornecedor: faltas
// do balcão que ainda precisam ser compradas + produtos abaixo do mínimo,
// uma linha por produto, com o fornecedor resolvido. Quem filtra por
// fornecedor é a tela — o comprador quer ver as do fornecedor do pedido e
// também as outras, para aproveitar a compra.
export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const perfil = await perfilDaSessao(sb, user.id)
  const empresaId = perfil?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  try {
    const linhas = await carregarListaCompra(sb, empresaId)
    return NextResponse.json({ ok: true, linhas })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Erro ao montar a lista' }, { status: 500 })
  }
}
