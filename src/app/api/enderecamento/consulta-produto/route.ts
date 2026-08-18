import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

export const dynamic = 'force-dynamic'

// "Onde está este produto?" — busca por nome/SKU/EAN/código interno (o
// mesmo tipo de campo que um leitor USB já preenche em qualquer input de
// texto, mesmo padrão do campo de EAN no PDV) e devolve o breakdown
// completo por endereço, em todos os depósitos da empresa.

export async function GET(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { searchParams } = new URL(req.url)
  const busca = (searchParams.get('busca') || '').trim()
  if (!busca) return NextResponse.json({ ok: false, erro: 'Informe nome, SKU, EAN ou código interno.' }, { status: 400 })

  const { data: produtos } = await sb.from('produtos')
    .select('id, nome, sku, ean')
    .eq('empresa_id', guarda.empresaId).eq('ativo', true)
    .or(`nome.ilike.%${busca}%,sku.ilike.%${busca}%,ean.eq.${busca}`)
    .limit(10)

  if (!produtos || produtos.length === 0) return NextResponse.json({ ok: true, produtos: [] })

  const produtoIds = produtos.map(p => p.id)
  const [{ data: linhas }, { data: saldosDeposito }] = await Promise.all([
    sb.from('produto_enderecos')
      .select('produto_id, deposito_id, endereco_id, quantidade, papel, enderecos(codigo_legivel, tipo, status), depositos(nome)')
      .eq('empresa_id', guarda.empresaId).in('produto_id', produtoIds).gt('quantidade', 0),
    sb.from('produto_estoque')
      .select('produto_id, deposito_id, quantidade, depositos(nome)')
      .eq('empresa_id', guarda.empresaId).in('produto_id', produtoIds),
  ])

  const resultado = produtos.map(p => {
    const enderecosDoProduto = (linhas ?? []).filter((l: any) => l.produto_id === p.id)
    const totalEnderecado = enderecosDoProduto.reduce((s: number, l: any) => s + Number(l.quantidade ?? 0), 0)
    const totalDeposito = (saldosDeposito ?? [])
      .filter((s: any) => s.produto_id === p.id)
      .reduce((s: number, l: any) => s + Number(l.quantidade ?? 0), 0)
    return {
      produto: p,
      estoqueTotal: totalDeposito,
      enderecado: totalEnderecado,
      naoEnderecado: Math.max(0, totalDeposito - totalEnderecado),
      enderecoPrincipal: enderecosDoProduto.find((l: any) => l.papel === 'picking') ?? null,
      enderecos: enderecosDoProduto,
    }
  })

  return NextResponse.json({ ok: true, produtos: resultado })
}
