import { createClient } from '@/lib/supabase/server'
import EmpresasClient from '@/components/empresas/EmpresasClient'

export const dynamic = 'force-dynamic'

export default async function EmpresasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, role, tenant_id')
    .eq('id', user!.id)
    .single()

  const empresaAtualId = profile?.empresa_id ?? ''

  const { data: empresas } = await supabase
    .from('empresas')
    .select(`
      id, nome, razao_social, nome_fantasia, cnpj, inscricao_estadual,
      regime_tributario, status, empresa_principal, cidade, uf,
      telefone, email, logo_url, cor_primaria, created_at, updated_at,
      grupo_id,
      grupos_empresariais(id, nome),
      empresa_config_fiscal(ambiente, certificado_validade, serie_nfe, proximo_nfe),
      empresa_config_comercial(id, limite_desconto, permite_estoque_negativo),
      empresa_config_estoque(id, baixar_estoque_em, tipo_custo)
    `)
    .order('empresa_principal', { ascending: false })
    .order('nome')

  const { data: grupos } = await supabase
    .from('grupos_empresariais')
    .select('id, nome')
    .eq('ativo', true)
    .order('nome')

  const { data: depositos } = await supabase
    .from('depositos')
    .select('empresa_id')

  const depositosPorEmpresa = new Set((depositos ?? []).map(d => d.empresa_id))

  return (
    <EmpresasClient
      empresas={(empresas ?? []) as any[]}
      grupos={grupos ?? []}
      empresaAtualId={empresaAtualId}
      depositosPorEmpresa={[...depositosPorEmpresa]}
      role={profile?.role ?? 'gerente'}
    />
  )
}
