import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import PublicarLoteClient from '@/components/publicarLote/PublicarLoteClient'

export const dynamic = 'force-dynamic'

// PUBLICAÇÃO EM LOTE — chega da Prontidão com os produtos escolhidos
// (?canal=tiktok|shopee&ids=a,b,c).
const MAX_PRODUTOS = 50

export default async function PublicarLotePage({ searchParams }: { searchParams: Promise<{ canal?: string; ids?: string }> }) {
  const { ids = '', canal } = await searchParams
  const plataforma = canal === 'shopee' ? 'shopee' : 'tiktok'
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const profile = await perfilDaSessao(sb, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const lista = ids.split(',').map(x => x.trim()).filter(x => /^[0-9a-f-]{36}$/i.test(x)).slice(0, MAX_PRODUTOS)
  const [{ data: canais }, { data: produtos }] = await Promise.all([
    sb.from('marketplace_canais').select('id, nome').eq('empresa_id', empresaId).eq('plataforma', plataforma)
      .not('access_token', 'is', null).order('nome'),
    lista.length
      ? sb.from('produtos').select('id, nome, sku').eq('empresa_id', empresaId).in('id', lista)
      : Promise.resolve({ data: [] as any[] }),
  ])
  // Mantém a ordem em que vieram da Prontidão.
  const porId = new Map((produtos ?? []).map((p: any) => [p.id, p]))
  const ordenados = lista.map(id => porId.get(id)).filter(Boolean) as { id: string; nome: string; sku: string | null }[]

  return <PublicarLoteClient key={plataforma} plataforma={plataforma} canais={canais ?? []} produtos={ordenados} />
}
