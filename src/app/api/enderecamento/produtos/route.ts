import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

export const dynamic = 'force-dynamic'

// Lê as linhas de produto_enderecos por produto OU por endereço — alimenta
// tanto "onde está esse produto" quanto "o que tem neste endereço".

export async function GET(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { searchParams } = new URL(req.url)
  const produtoId = searchParams.get('produtoId')
  const enderecoId = searchParams.get('enderecoId')
  const depositoId = searchParams.get('depositoId')

  if (!produtoId && !enderecoId && !depositoId) {
    return NextResponse.json({ ok: false, erro: 'Informe produtoId, enderecoId ou depositoId.' }, { status: 400 })
  }

  let q = sb.from('produto_enderecos')
    .select('id, produto_id, endereco_id, deposito_id, quantidade, quantidade_reservada, papel, ultima_movimentacao, enderecos(codigo_legivel, tipo, status), produtos(nome, sku, ean)')
    .eq('empresa_id', guarda.empresaId).gt('quantidade', 0)
  if (produtoId) q = q.eq('produto_id', produtoId)
  if (enderecoId) q = q.eq('endereco_id', enderecoId)
  if (depositoId) q = q.eq('deposito_id', depositoId)

  const { data, error } = await q
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, linhas: data ?? [] })
}
