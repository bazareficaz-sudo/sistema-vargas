import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import EntradasXmlClient from '@/components/entradas-xml/EntradasXmlClient'

export const dynamic = 'force-dynamic'

export default async function EntradasXmlPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const [entradasRes, depositosRes, configRes] = await Promise.all([
    sb.from('nfe_entradas')
      .select('id, chave_acesso, numero, serie, nome_fornecedor, cnpj_fornecedor, data_emissao, valor_total, status, origem, operador_nome, created_at')
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false })
      .limit(200),
    sb.from('depositos')
      .select('id, nome, principal')
      .eq('empresa_id', empresaId)
      .eq('ativo', true)
      .order('principal', { ascending: false }),
    sb.from('nfe_config')
      .select('*')
      .eq('empresa_id', empresaId)
      .maybeSingle(),
  ])

  return (
    <EntradasXmlClient
      empresaId={empresaId}
      operador={user.email ?? ''}
      entradasIniciais={entradasRes.error ? [] : (entradasRes.data ?? [])}
      depositos={depositosRes.error ? [] : (depositosRes.data ?? [])}
      configSefaz={configRes.data ?? null}
    />
  )
}
