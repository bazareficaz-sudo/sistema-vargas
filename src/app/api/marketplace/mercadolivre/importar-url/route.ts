import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { lerAnuncioPorUrl, type CanalParaLeitura } from '@/lib/mercadolivre/lerPorUrl'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export async function POST(req: Request) {
  const { url, canalId } = await req.json()
  if (!url) return NextResponse.json({ ok: false, erro: 'URL ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  // A leitura de anúncio exige token desde que o ML fechou o acesso anônimo
  // (ver comentário em src/lib/mercadolivre/item.ts) — o token serve só como
  // credencial de leitura, não importa de qual conta da empresa ele é.
  const { data: canaisRows } = await sb.from('marketplace_canais')
    .select('id, empresa_id, seller_id, access_token, refresh_token, token_expira_em')
    .eq('empresa_id', empresaId).eq('plataforma', 'mercadolivre')
    .not('access_token', 'is', null)

  // A escolha de conta e o tratamento da negativa moram em `lerPorUrl.ts`:
  // a captura de rascunho por link precisa do mesmo comportamento, e duas
  // cópias divergiriam na primeira vez que alguém consertasse uma só.
  const leitura = await lerAnuncioPorUrl(sb, (canaisRows ?? []) as CanalParaLeitura[], url, canalId)
  if (!leitura.ok) {
    return NextResponse.json({ ok: false, erro: leitura.erro }, { status: 400 })
  }
  return NextResponse.json({ ok: true, dados: leitura.dados })
}
