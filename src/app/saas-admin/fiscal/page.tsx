import { createClient } from '@/lib/supabase/server'
import FiscalAdminClient from '@/components/saas-admin/FiscalAdminClient'

export const dynamic = 'force-dynamic'

export default async function FiscalAdminPage() {
  const supabase = await createClient()

  const [{ data: config }, { data: empresas }, { data: configsNfe }] = await Promise.all([
    supabase.from('sistema_config_fiscal').select('id, provider_padrao').maybeSingle(),
    supabase.from('empresas').select('id, nome, cnpj').order('nome').limit(1000),
    supabase.from('nfe_config').select('empresa_id, provider, ativo'),
  ])

  const providerPorEmpresa = new Map((configsNfe ?? []).map(c => [c.empresa_id, c]))
  const linhas = (empresas ?? []).map(e => ({
    empresa_id: e.id,
    empresa_nome: e.nome,
    cnpj: e.cnpj,
    provider: providerPorEmpresa.get(e.id)?.provider ?? null,
    configurado: providerPorEmpresa.get(e.id)?.ativo ?? false,
  }))

  return (
    <FiscalAdminClient
      providerPadraoInicial={config?.provider_padrao ?? 'focusnfe'}
      configId={config?.id ?? null}
      empresas={linhas}
    />
  )
}
