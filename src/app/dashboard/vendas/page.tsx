import { createClient } from '@/lib/supabase/server'
import VendasClient from '@/components/vendas/VendasClient'

export default async function VendasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id, empresas(nome, nome_fantasia)').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id
  const empresaNome = (profile?.empresas as unknown as { nome: string; nome_fantasia: string | null } | null)
  const nomePropria = empresaNome?.nome_fantasia ?? empresaNome?.nome ?? ''

  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const fimHoje = new Date(hoje)
  fimHoje.setHours(23, 59, 59, 999)

  const [{ data: vendas, count, error: erroVendas }, { data: saudeConfig }, { data: saudeFaixas }, { data: configEstoque }, { data: configFiscal }] = await Promise.all([
    supabase
      .from('vendas')
      .select('id, numero, total, subtotal, desconto, status, forma_pagamento, pagamentos, tipo_operacao, created_at, cliente_id, operador_nome, canal, clientes(nome, telefone, cpf_cnpj), nfce_status, nfce_numero, nfce_chave, nfce_motivo_rejeicao, nfce_url_pdf', { count: 'exact' })
      .eq('empresa_id', empresaId)
      .gte('created_at', hoje.toISOString())
      .lte('created_at', fimHoje.toISOString())
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('saude_config').select('*').eq('empresa_id', empresaId).single(),
    supabase.from('saude_faixas').select('*').eq('empresa_id', empresaId).order('ordem'),
    supabase.from('empresa_config_estoque').select('empresa_estoque_id').eq('empresa_id', empresaId).maybeSingle(),
    supabase.from('empresa_config_fiscal').select('empresa_fiscal_id').eq('empresa_id', empresaId).maybeSingle(),
  ])

  // Mesmo padrão de resolução usado no PDV interno (src/app/pdv/page.tsx) —
  // só diverge da própria empresa quando configurado em Empresas → Estoque/Fiscal.
  const empresaEstoqueId = configEstoque?.empresa_estoque_id || empresaId
  const empresaFiscalId = configFiscal?.empresa_fiscal_id || empresaId
  let empresaEstoqueNome = nomePropria
  let empresaFiscalNome = nomePropria
  if (empresaEstoqueId !== empresaId) {
    const { data: e } = await supabase.from('empresas').select('nome, nome_fantasia').eq('id', empresaEstoqueId).maybeSingle()
    empresaEstoqueNome = e?.nome_fantasia ?? e?.nome ?? empresaEstoqueNome
  }
  if (empresaFiscalId !== empresaId) {
    const { data: e } = await supabase.from('empresas').select('nome, nome_fantasia').eq('id', empresaFiscalId).maybeSingle()
    empresaFiscalNome = e?.nome_fantasia ?? e?.nome ?? empresaFiscalNome
  }

  return (
    <VendasClient
      empresaId={empresaId ?? ''}
      vendasIniciais={(vendas ?? []) as any}
      totalInicial={count ?? 0}
      empresaEstoqueNome={empresaEstoqueNome}
      empresaFiscalNome={empresaFiscalNome}
      saudeConfig={saudeConfig ?? null}
      saudeFaixas={saudeFaixas ?? []}
      erroInicial={erroVendas?.message ?? null}
    />
  )
}
