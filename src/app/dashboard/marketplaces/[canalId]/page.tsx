import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import CanalConfigClient from '@/components/marketplaces/CanalConfigClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function CanalConfigPage({ params }: { params: Promise<{ canalId: string }> }) {
  const { canalId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id, 'empresa_id, tenant_id')
  const empresaId = profile?.empresa_id ?? ''

  const { data: canal } = await supabase
    .from('marketplace_canais')
    .select('*')
    .eq('id', canalId)
    .eq('empresa_id', empresaId)
    .single()

  if (!canal) notFound()

  const { data: logs } = await supabase
    .from('marketplace_sync_log')
    .select('*')
    .eq('canal_id', canalId)
    .order('created_at', { ascending: false })
    .limit(20)

  const { data: regras } = await supabase
    .from('marketplace_regras_preco')
    .select('id, nome')
    .eq('canal_id', canalId)
    .eq('ativo', true)
    .order('nome')

  // Empresas do grupo (mesmo tenant) — as que podem emitir a nota do canal.
  // Mesmo filtro da tela Empresas: sem ele viriam empresas de outros clientes.
  const [{ data: empresasGrupo }, { data: configFiscal }] = await Promise.all([
    supabase.from('empresas')
      .select('id, nome, nome_fantasia, cnpj, uf, regime_tributario')
      .eq('tenant_id', profile?.tenant_id ?? '')
      .order('empresa_principal', { ascending: false })
      .order('nome'),
    supabase.from('empresa_config_fiscal').select('empresa_fiscal_id').eq('empresa_id', empresaId).maybeSingle(),
  ])
  const emissorPadraoId = configFiscal?.empresa_fiscal_id || empresaId

  return <CanalConfigClient canal={canal} logs={logs ?? []} regras={regras ?? []} empresaId={empresaId}
    empresasGrupo={empresasGrupo ?? []} emissorPadraoId={emissorPadraoId} />
}
