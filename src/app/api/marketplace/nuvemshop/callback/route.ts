import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { trocarCodigoPorToken } from '@/lib/nuvemshop/client'
import { getLoja } from '@/lib/nuvemshop/catalog'
import { textoLocalizado } from '@/lib/nuvemshop/types'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  if (!code) {
    return NextResponse.redirect(new URL('/dashboard/marketplaces?erro=cancelado', req.url))
  }

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.redirect(new URL('/dashboard/marketplaces?erro=sem-empresa', req.url))

  let accessToken: string
  let storeId: string
  try {
    const token = await trocarCodigoPorToken(code)
    accessToken = token.accessToken
    storeId = token.storeId
  } catch (e: any) {
    console.error('Nuvemshop token error:', e?.message ?? e)
    return NextResponse.redirect(new URL('/dashboard/marketplaces?erro=token-invalido', req.url))
  }

  let nome = `Nuvemshop ${storeId}`
  let markup = '0'
  try {
    const decoded = JSON.parse(Buffer.from(state ?? '', 'base64url').toString())
    if (decoded.nome) nome = decoded.nome
    if (decoded.markup) markup = decoded.markup
  } catch { /* state ausente ou corrompido não impede conectar */ }

  // Nome real da loja é melhor que o id, mas falhar aqui não pode impedir a
  // conexão — o canal já é utilizável sem esse detalhe.
  try {
    const loja = await getLoja({ id: '', empresaId, storeId, accessToken })
    const nomeLoja = textoLocalizado(loja?.name)
    if (nomeLoja && nome.startsWith('Nuvemshop ')) nome = nomeLoja
  } catch { /* segue com o nome que veio do formulário */ }

  // Reconectar a mesma loja atualiza o token em vez de criar canal duplicado —
  // sem isso, cada nova autorização geraria um canal novo com os mesmos
  // anúncios.
  const { data: existente } = await sb.from('marketplace_canais')
    .select('id')
    .eq('empresa_id', empresaId).eq('plataforma', 'nuvemshop').eq('seller_id', storeId)
    .maybeSingle()

  if (existente) {
    await sb.from('marketplace_canais').update({
      access_token: accessToken,
      ativo: true,
      updated_at: new Date().toISOString(),
    }).eq('id', existente.id)
    return NextResponse.redirect(new URL('/dashboard/marketplaces?sucesso=nuvemshop-reconectado', req.url))
  }

  await sb.from('marketplace_canais').insert({
    empresa_id: empresaId,
    nome,
    plataforma: 'nuvemshop',
    // O store_id da Nuvemshop ocupa a coluna seller_id — mesma função que o
    // shop_id da Shopee e o user_id do Mercado Livre.
    seller_id: storeId,
    access_token: accessToken,
    // Token da Nuvemshop não expira; não há refresh_token nem validade.
    refresh_token: null,
    token_expira_em: null,
    markup_canal: parseFloat(markup) || 0,
    sincronizar_estoque: true,
    sincronizar_preco: true,
    ativo: true,
  })

  return NextResponse.redirect(new URL('/dashboard/marketplaces?sucesso=nuvemshop', req.url))
}
