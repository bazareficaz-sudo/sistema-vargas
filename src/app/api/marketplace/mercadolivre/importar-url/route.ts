import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buscarAnuncioPorUrl } from '@/lib/mercadolivre/item'
import { refreshAccessTokenIfNeeded } from '@/lib/mercadolivre/client'
import type { MLChannel } from '@/lib/mercadolivre/types'

export async function POST(req: Request) {
  const { url, canalId } = await req.json()
  if (!url) return NextResponse.json({ ok: false, erro: 'URL ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  // A leitura de anúncio exige token desde que o ML fechou o acesso anônimo
  // (ver comentário em src/lib/mercadolivre/item.ts) — o token serve só como
  // credencial de leitura, não importa de qual conta da empresa ele é.
  const { data: canaisRows } = await sb.from('marketplace_canais')
    .select('id, nome, empresa_id, seller_id, access_token, refresh_token, token_expira_em')
    .eq('empresa_id', empresaId).eq('plataforma', 'mercadolivre')
    .not('access_token', 'is', null)

  if (!canaisRows?.length) {
    return NextResponse.json({
      ok: false,
      erro: 'Nenhuma conta do Mercado Livre conectada. O Mercado Livre passou a exigir login para ler anúncios — conecte uma conta em Marketplaces para usar a importação.',
    }, { status: 400 })
  }

  // Nem toda autorização do ML consegue ler anúncio de OUTRO vendedor (o
  // mesmo token lê os próprios anúncios e recebe 403 access_denied nos de
  // terceiros — confirmado em produção). Então tenta o canal pedido
  // primeiro e, se ele for negado, tenta os outros da mesma empresa antes
  // de desistir.
  const ordenados = canalId
    ? [...canaisRows].sort((a, b) => (a.id === canalId ? -1 : b.id === canalId ? 1 : 0))
    : canaisRows

  let ultimoErro = 'Erro ao importar anúncio'
  for (const row of ordenados) {
    const canal: MLChannel = {
      id: row.id, empresaId: row.empresa_id, sellerId: row.seller_id,
      accessToken: row.access_token, refreshToken: row.refresh_token, tokenExpiraEm: row.token_expira_em,
    }
    try {
      const canalValido = await refreshAccessTokenIfNeeded(sb, canal)
      const dados = await buscarAnuncioPorUrl(url, canalValido.accessToken)
      return NextResponse.json({ ok: true, dados })
    } catch (e: any) {
      ultimoErro = e?.message ?? ultimoErro
      // Só vale tentar outra conta quando o ML negou o acesso; erro de URL
      // inválida ou anúncio inativo vai dar o mesmo em qualquer conta.
      if (!/access_denied|forbidden|403/i.test(ultimoErro)) break
    }
  }

  if (/access_denied|forbidden|403/i.test(ultimoErro)) {
    return NextResponse.json({
      ok: false,
      erro: 'O Mercado Livre negou a leitura deste anúncio com as contas conectadas desta empresa. Isso acontece com anúncios de outros vendedores quando a autorização da conta não permite essa leitura — tente reconectar a conta em Marketplaces, ou importe a partir de um anúncio da própria conta.',
    }, { status: 400 })
  }
  return NextResponse.json({ ok: false, erro: ultimoErro }, { status: 400 })
}
