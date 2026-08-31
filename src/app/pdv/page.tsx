import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PDVClient from '@/components/pdv/PDVClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function PDVPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const profile = await perfilDaSessao(sb, user.id, 'empresa_id, role, empresas(nome)')

  const empresaId = profile?.empresa_id ?? ''
  const empresaNome = (profile?.empresas as unknown as { nome: string } | null)?.nome ?? ''
  const operadorNome = user.email ?? ''

  const [{ data: clientes }, { data: saudeConfig }, { data: saudeFaixas }, { data: configEstoque }] = await Promise.all([
    sb.from('clientes')
      .select('id, nome, cpf_cnpj, telefone, limite_credito, saldo_credito, saldo_devedor, bloqueado_fiado, permite_fiado')
      // Sem isto o balconista pode escolher um cadastro morto. O gatilho do
      // banco redireciona o lançamento, mas ele não deveria nem aparecer.
      .eq('empresa_id', empresaId).eq('ativo', true).is('mesclado_em', null).order('nome'),
    sb.from('saude_config').select('*').eq('empresa_id', empresaId).single(),
    sb.from('saude_faixas').select('*').eq('empresa_id', empresaId).order('ordem'),
    sb.from('empresa_config_estoque').select('empresa_estoque_id').eq('empresa_id', empresaId).maybeSingle(),
  ])

  // Empresa que realmente vai fornecer o catálogo e receber a baixa de
  // estoque desta venda — só diverge de empresaId quando configurado em
  // Empresas → Estoque ("Empresa que debita o estoque das vendas do PDV").
  // A venda em si (vendas.empresa_id) continua sempre sendo a loja onde
  // foi feita, independente disso.
  const empresaEstoqueId = configEstoque?.empresa_estoque_id || empresaId
  let empresaEstoqueNome = empresaNome
  if (empresaEstoqueId !== empresaId) {
    const { data: empresaEstoque } = await sb.from('empresas').select('nome, nome_fantasia').eq('id', empresaEstoqueId).maybeSingle()
    empresaEstoqueNome = empresaEstoque?.nome_fantasia ?? empresaEstoque?.nome ?? empresaEstoqueNome
  }

  return (
    <PDVClient
      empresaId={empresaId}
      empresaNome={empresaNome}
      empresaEstoqueId={empresaEstoqueId}
      empresaEstoqueNome={empresaEstoqueNome}
      operadorNome={operadorNome}
      clientes={clientes ?? []}
      saudeConfig={saudeConfig}
      saudeFaixas={saudeFaixas}
    />
  )
}
