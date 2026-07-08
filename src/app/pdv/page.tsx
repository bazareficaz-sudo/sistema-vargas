import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PDVClient from '@/components/pdv/PDVClient'

export const dynamic = 'force-dynamic'

export default async function PDVPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await sb
    .from('profiles')
    .select('empresa_id, role, empresas(nome)')
    .eq('id', user.id)
    .single()

  const empresaId = profile?.empresa_id ?? ''
  const empresaNome = (profile?.empresas as unknown as { nome: string } | null)?.nome ?? ''
  const operadorNome = user.email ?? ''

  const [{ data: clientes }, { data: saudeConfig }, { data: saudeFaixas }] = await Promise.all([
    sb.from('clientes')
      .select('id, nome, cpf_cnpj, telefone, limite_credito, saldo_credito, saldo_devedor, bloqueado_fiado, permite_fiado')
      .eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
    sb.from('saude_config').select('*').eq('empresa_id', empresaId).single(),
    sb.from('saude_faixas').select('*').eq('empresa_id', empresaId).order('ordem'),
  ])

  return (
    <PDVClient
      empresaId={empresaId}
      empresaNome={empresaNome}
      operadorNome={operadorNome}
      clientes={clientes ?? []}
      saudeConfig={saudeConfig}
      saudeFaixas={saudeFaixas}
    />
  )
}
