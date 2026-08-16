import { createClient } from '@/lib/supabase/server'
import EmpresasClient from '@/components/empresas/EmpresasClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function EmpresasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id, 'empresa_id, role, tenant_id')

  const empresaAtualId = profile?.empresa_id ?? ''
  const tenantId = profile?.tenant_id ?? ''

  // Sem filtro por tenant_id aqui, essa consulta trazia TODAS as empresas
  // já cadastradas no sistema — de qualquer cliente SaaS, não só do grupo
  // empresarial de quem está logado. Um tenant chegou a ver e poder editar
  // a empresa de outro cliente nesta tela por causa disso.
  const { data: empresas } = await supabase
    .from('empresas')
    // As duas tabelas de config vêm com `*` de propósito: o wizard hidrata o
    // formulário a partir delas e, ao salvar, grava TODOS os campos do form.
    // Uma coluna de fora da lista chegava como undefined, virava '' no form e
    // era salva como null — apagando configuração que o usuário nunca tocou
    // (foi o que aconteceu com empresa_fiscal_id/empresa_estoque_id: só
    // editar o CSC zerava a empresa emissora do documento fiscal). Com `*`,
    // adicionar coluna nova não reintroduz esse bug.
    .select(`
      id, nome, razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal, cnae,
      regime_tributario, status, empresa_principal,
      cep, logradouro, numero, complemento, bairro, cidade, uf, ibge, pais,
      telefone, whatsapp, email, email_financeiro, email_fiscal, site,
      responsavel_legal, cpf_responsavel, contador, email_contador, telefone_contador,
      logo_url, cor_primaria, created_at, updated_at,
      grupo_id,
      grupos_empresariais(id, nome),
      empresa_config_fiscal!empresa_config_fiscal_empresa_id_fkey(*),
      empresa_config_comercial(id, limite_desconto, permite_estoque_negativo),
      empresa_config_estoque!empresa_config_estoque_empresa_id_fkey(*),
      empresa_compartilhamento_dados(compartilhar_produtos, compartilhar_clientes, compartilhar_fornecedores, compartilhar_marcas, compartilhar_categorias, compartilhar_tabelas_preco)
    `)
    .eq('tenant_id', tenantId)
    .order('empresa_principal', { ascending: false })
    .order('nome')

  // nfe_config não tem FK declarada pra empresas (não dá pra embutir no
  // select acima) — busca separada e mescla na mão, mesmo padrão já usado
  // pra vendedor_empresas em dashboard/vendedores/page.tsx.
  const empresaIds = (empresas ?? []).map(e => e.id)
  const { data: nfeConfigs } = empresaIds.length > 0
    ? await supabase.from('nfe_config').select('empresa_id, ativo, ambiente, credenciais, cnpj, provider').in('empresa_id', empresaIds)
    : { data: [] as any[] }
  const nfeConfigPorEmpresa = new Map((nfeConfigs ?? []).map(c => [c.empresa_id, c]))
  const empresasComNfeConfig = (empresas ?? []).map(e => ({ ...e, nfe_config: nfeConfigPorEmpresa.get(e.id) ?? null }))

  const { data: grupos } = await supabase
    .from('grupos_empresariais')
    .select('id, nome')
    .eq('tenant_id', tenantId)
    .eq('ativo', true)
    .order('nome')

  const { data: depositos } = empresaIds.length > 0
    ? await supabase.from('depositos').select('id, nome, empresa_id')
        .in('empresa_id', empresaIds).eq('ativo', true).order('nome')
    : { data: [] as any[] }

  const depositosPorEmpresa = new Set((depositos ?? []).map(d => d.empresa_id))

  return (
    <EmpresasClient
      empresas={empresasComNfeConfig as any[]}
      grupos={grupos ?? []}
      empresaAtualId={empresaAtualId}
      tenantId={tenantId}
      depositosPorEmpresa={[...depositosPorEmpresa]}
      depositos={depositos ?? []}
      role={profile?.role ?? 'gerente'}
    />
  )
}
