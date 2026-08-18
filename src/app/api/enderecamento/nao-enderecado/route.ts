import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

export const dynamic = 'force-dynamic'

// Produtos com estoque no depósito mas total endereçado menor que o saldo
// (inclui zero endereçado). É o alerta central da adoção gradual — depois
// que o endereçamento está ligado, estoque sem localização é um problema
// operacional, não um estado neutro.

export async function GET(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { searchParams } = new URL(req.url)
  const depositoId = searchParams.get('depositoId')
  if (!depositoId) return NextResponse.json({ ok: false, erro: 'Escolha o depósito.' }, { status: 400 })

  const { data: deposito } = await sb.from('depositos').select('id').eq('id', depositoId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!deposito) return NextResponse.json({ ok: false, erro: 'Depósito inválido.' }, { status: 400 })

  const [{ data: saldos }, { data: enderecados }] = await Promise.all([
    sb.from('produto_estoque').select('produto_id, quantidade, produtos(nome, sku)').eq('deposito_id', depositoId).gt('quantidade', 0),
    sb.from('produto_enderecos').select('produto_id, quantidade').eq('deposito_id', depositoId),
  ])

  const enderecadoPorProduto = new Map<string, number>()
  for (const l of enderecados ?? []) {
    enderecadoPorProduto.set(l.produto_id, (enderecadoPorProduto.get(l.produto_id) ?? 0) + Number(l.quantidade ?? 0))
  }

  const lista = (saldos ?? [])
    .map((s: any) => {
      const enderecado = enderecadoPorProduto.get(s.produto_id) ?? 0
      const total = Number(s.quantidade ?? 0)
      return { produtoId: s.produto_id, produto: s.produtos, estoqueTotal: total, enderecado, naoEnderecado: Math.max(0, total - enderecado) }
    })
    .filter(x => x.naoEnderecado > 0)
    .sort((a, b) => b.naoEnderecado - a.naoEnderecado)

  return NextResponse.json({
    ok: true, produtos: lista,
    totalProdutosSemEndereco: lista.filter(x => x.enderecado === 0).length,
    totalUnidadesNaoEnderecadas: lista.reduce((s, x) => s + x.naoEnderecado, 0),
  })
}
