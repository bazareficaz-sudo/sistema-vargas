import { createClient } from '@/lib/supabase/server'
import VendedoresClient from '@/components/vendedores/VendedoresClient'

export const dynamic = 'force-dynamic'

export default async function VendedoresPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, role, tenant_id')
    .eq('id', user!.id)
    .single()

  const empresaAtualId = profile?.empresa_id ?? ''

  const { data: vendedores } = await supabase
    .from('vendedores')
    .select(`
      id, codigo, matricula, nome, apelido, cpf, rg,
      telefone, whatsapp, email,
      data_nascimento, data_admissao, data_desligamento,
      status, ativo, participa_comissao, tipo_remuneracao, obs_comissao,
      permite_todas_empresas, permite_login, obs,
      tenant_id, empresa_id, user_id,
      identificador_externo,
      created_at, updated_at,
      vendedor_empresas(
        empresa_id,
        empresa_principal,
        pode_vender,
        ativo,
        empresas(id, nome, nome_fantasia)
      )
    `)
    .eq('empresa_id', empresaAtualId)
    .order('nome')

  const { data: empresas } = await supabase
    .from('empresas')
    .select('id, nome, nome_fantasia')
    .order('nome')

  const total = vendedores?.length ?? 0
  const ativos = (vendedores ?? []).filter(v => v.status === 'ativo').length
  const comissionados = (vendedores ?? []).filter(v => v.participa_comissao).length

  return (
    <VendedoresClient
      vendedores={(vendedores ?? []) as any[]}
      empresas={(empresas ?? []) as any[]}
      empresaAtualId={empresaAtualId}
      total={total}
      ativos={ativos}
      comissionados={comissionados}
      role={profile?.role ?? 'gerente'}
    />
  )
}
