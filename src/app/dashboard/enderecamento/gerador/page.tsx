import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import GeradorEnderecosClient from '@/components/enderecamento/GeradorEnderecosClient'

export const dynamic = 'force-dynamic'

export default async function GeradorEnderecosPage({ searchParams }: { searchParams: Promise<{ depositoId?: string }> }) {
  const { depositoId } = await searchParams
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const perfil = await perfilDaSessao(sb, user!.id)
  const empresaId = perfil?.empresa_id ?? ''

  const { data: depositos } = await sb.from('depositos')
    .select('id, nome, principal').eq('empresa_id', empresaId).eq('ativo', true).order('nome')
  const { data: tipos } = await sb.from('endereco_tipos')
    .select('codigo, nome').eq('empresa_id', empresaId).eq('ativo', true).order('ordem')

  return <GeradorEnderecosClient depositos={depositos ?? []} tipos={tipos ?? []} depositoIdInicial={depositoId ?? ''} />
}
