import { createClient } from '@/lib/supabase/server'
import VendasClient from '@/components/vendas/VendasClient'

export default async function VendasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id

  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const fimHoje = new Date(hoje)
  fimHoje.setHours(23, 59, 59, 999)

  const [{ data: vendas, count, error: erroVendas }, { data: saudeConfig }, { data: saudeFaixas }] = await Promise.all([
    supabase
      .from('vendas')
      .select('id, numero, total, subtotal, desconto, status, forma_pagamento, pagamentos, tipo_operacao, created_at, cliente_id, operador_nome, canal, clientes(nome, telefone, cpf_cnpj)', { count: 'exact' })
      .eq('empresa_id', empresaId)
      .gte('created_at', hoje.toISOString())
      .lte('created_at', fimHoje.toISOString())
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('saude_config').select('*').eq('empresa_id', empresaId).single(),
    supabase.from('saude_faixas').select('*').eq('empresa_id', empresaId).order('ordem'),
  ])

  return (
    <VendasClient
      empresaId={empresaId ?? ''}
      vendasIniciais={(vendas ?? []) as any}
      totalInicial={count ?? 0}
      saudeConfig={saudeConfig ?? null}
      saudeFaixas={saudeFaixas ?? []}
      erroInicial={erroVendas?.message ?? null}
    />
  )
}
