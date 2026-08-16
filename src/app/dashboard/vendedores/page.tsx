import { createClient } from '@/lib/supabase/server'
import VendedoresClient from '@/components/vendedores/VendedoresClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function VendedoresPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const profile = await perfilDaSessao(supabase, user!.id, 'empresa_id, role, tenant_id')

  const empresaAtualId = profile?.empresa_id ?? ''

  // Sem embed aninhado aqui de propósito — o mesmo tipo de relacionamento
  // (via FK) já se mostrou não confiável no PostgREST desta base em outro
  // ponto do sistema (venda_itens -> vendas), fazendo a consulta inteira
  // falhar em silêncio e a tela mostrar "0 encontrado" sem nenhum aviso.
  // Aqui buscamos as tabelas separadas e montamos o vínculo manualmente.
  const { data: vendedores, error: erroVendedores } = await supabase
    .from('vendedores')
    .select(`
      id, codigo, matricula, nome, apelido, cpf, rg,
      telefone, whatsapp, email,
      data_nascimento, data_admissao, data_desligamento,
      status, ativo, participa_comissao, tipo_remuneracao, obs_comissao,
      permite_todas_empresas, permite_login, obs,
      tenant_id, empresa_id, user_id,
      identificador_externo,
      created_at, updated_at
    `)
    .eq('empresa_id', empresaAtualId)
    .order('nome')

  // Sem filtro de tenant_id aqui, essa consulta trazia as empresas de
  // QUALQUER cliente do sistema pro vínculo multi-empresa do vendedor —
  // não só as do próprio grupo empresarial de quem está logado.
  const { data: empresas } = await supabase
    .from('empresas')
    .select('id, nome, nome_fantasia')
    .eq('tenant_id', profile?.tenant_id ?? '')
    .order('nome')

  const vendedorIds = (vendedores ?? []).map(v => v.id)
  let vendedorEmpresasPorVendedor: Record<string, any[]> = {}
  if (vendedorIds.length > 0) {
    const { data: vinculos } = await supabase
      .from('vendedor_empresas')
      .select('vendedor_id, empresa_id, empresa_principal, pode_vender, ativo')
      .in('vendedor_id', vendedorIds)
    const empresasMap = new Map((empresas ?? []).map(e => [e.id, e]))
    for (const v of vinculos ?? []) {
      const entry = { empresa_id: v.empresa_id, empresa_principal: v.empresa_principal, pode_vender: v.pode_vender, ativo: v.ativo, empresas: empresasMap.get(v.empresa_id) ?? null }
      ;(vendedorEmpresasPorVendedor[v.vendedor_id] ??= []).push(entry)
    }
  }

  const vendedoresCompletos = (vendedores ?? []).map(v => ({ ...v, vendedor_empresas: vendedorEmpresasPorVendedor[v.id] ?? [] }))

  const total = vendedoresCompletos.length
  const ativos = vendedoresCompletos.filter(v => v.status === 'ativo').length
  const comissionados = vendedoresCompletos.filter(v => v.participa_comissao).length

  return (
    <VendedoresClient
      vendedores={vendedoresCompletos as any[]}
      empresas={(empresas ?? []) as any[]}
      empresaAtualId={empresaAtualId}
      total={total}
      ativos={ativos}
      comissionados={comissionados}
      role={profile?.role ?? 'gerente'}
      erroCarregamento={erroVendedores?.message}
    />
  )
}
