import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

export const dynamic = 'force-dynamic'

// "O que existe neste endereço?" — busca reversa por código (digitado ou
// lido por leitor USB) e devolve os produtos ali + histórico recente.

export async function GET(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { searchParams } = new URL(req.url)
  const codigo = (searchParams.get('codigo') || '').trim()
  if (!codigo) return NextResponse.json({ ok: false, erro: 'Informe o código do endereço.' }, { status: 400 })

  const { data: endereco } = await sb.from('enderecos')
    .select('*, depositos(nome)')
    .eq('empresa_id', guarda.empresaId)
    .or(`codigo_interno.eq.${codigo},codigo_legivel.eq.${codigo}`)
    .maybeSingle()
  if (!endereco) return NextResponse.json({ ok: false, erro: 'Endereço não encontrado.' }, { status: 404 })

  const [{ data: linhas }, { data: historico }] = await Promise.all([
    sb.from('produto_enderecos')
      .select('produto_id, quantidade, papel, produtos(nome, sku, ean)')
      .eq('endereco_id', endereco.id).gt('quantidade', 0),
    sb.from('endereco_movimentacoes')
      .select('*')
      .or(`endereco_origem_id.eq.${endereco.id},endereco_destino_id.eq.${endereco.id}`)
      .order('created_at', { ascending: false }).limit(30),
  ])

  return NextResponse.json({ ok: true, endereco, produtos: linhas ?? [], historico: historico ?? [] })
}
