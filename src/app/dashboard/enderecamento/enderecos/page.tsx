import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import EnderecosClient from '@/components/enderecamento/EnderecosClient'

export const dynamic = 'force-dynamic'

export default async function EnderecosPage({ searchParams }: { searchParams: Promise<{ depositoId?: string }> }) {
  const { depositoId } = await searchParams
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const perfil = await perfilDaSessao(sb, user!.id)
  const empresaId = perfil?.empresa_id ?? ''

  const { data: depositos } = await sb.from('depositos')
    .select('id, nome, principal').eq('empresa_id', empresaId).eq('ativo', true).order('nome')

  const { data: tipos } = await sb.from('endereco_tipos')
    .select('codigo, nome, cor').eq('empresa_id', empresaId).eq('ativo', true).order('ordem')

  return <EnderecosClient depositos={depositos ?? []} tipos={tipos ?? []} depositoIdInicial={depositoId ?? ''} />
}
