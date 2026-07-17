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
      empresa_config_fiscal(ambiente, certificado_validade, certificado_ref, serie_nfe, proximo_nfe, serie_nfce, proximo_nfce, csc_nfce, id_csc_nfce, cfop_venda_dentro, cfop_venda_fora, cfop_compra, natureza_operacao, observacoes),
      empresa_config_comercial(id, limite_desconto, permite_estoque_negativo),
      empresa_config_estoque(id, permite_multiplos_depositos, reservar_em_orcamento, reservar_em_pedido, baixar_estoque_em, tipo_custo, controlar_lote, deposito_devolucao_id)
    `)
    .order('empresa_principal', { ascending: false })
    .order('nome')

  // nfe_config não tem FK declarada pra empresas (não dá pra embutir no
  // select acima) — busca separada e mescla na mão, mesmo padrão já usado
  // pra vendedor_empresas em dashboard/vendedores/page.tsx.
  const empresaIds = (empresas ?? []).map(e => e.id)
  const { data: nfeConfigs } = empresaIds.length > 0
    ? await supabase.from('nfe_config').select('empresa_id, ativo, ambiente, credenciais, cnpj').in('empresa_id', empresaIds)
    : { data: [] as any[] }
  const nfeConfigPorEmpresa = new Map((nfeConfigs ?? []).map(c => [c.empresa_id, c]))
  const empresasComNfeConfig = (empresas ?? []).map(e => ({ ...e, nfe_config: nfeConfigPorEmpresa.get(e.id) ?? null }))

  const { data: grupos } = await supabase
    .from('grupos_empresariais')
    .select('id, nome')
    .eq('ativo', true)
    .order('nome')

  const { data: depositos } = await supabase
    .from('depositos')
    .select('id, nome, empresa_id')
    .eq('ativo', true)
    .order('nome')

  const depositosPorEmpresa = new Set((depositos ?? []).map(d => d.empresa_id))

  return (
    <EmpresasClient
      empresas={empresasComNfeConfig as any[]}
      grupos={grupos ?? []}
      empresaAtualId={empresaAtualId}
      depositosPorEmpresa={[...depositosPorEmpresa]}
      depositos={depositos ?? []}
      role={profile?.role ?? 'gerente'}
    />
  )
}
