// O QUE AS DUAS TELAS DA SAÚDE DA VENDA PRECISAM CARREGAR.
//
// `saude_config` e `saude_faixas` são lidas por duas telas diferentes — as
// taxas, no Financeiro, e as faixas de desconto, no Comercial. Elas gravam a
// MESMA linha de `saude_config`, então carregar em dois lugares com dois
// `select` escritos à mão é como a divergência começa: basta uma delas deixar
// de trazer uma coluna para o `upsert` daquela tela gravar o valor padrão em
// cima do que estava salvo.
//
// Um carregador só, usado pelas duas.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export type DadosSaudeVenda = {
  empresaId: string
  config: any | null
  faixas: any[]
  role: string
}

export async function carregarSaudeVenda(): Promise<DadosSaudeVenda> {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const profile = await perfilDaSessao(sb, user.id, 'empresa_id, role')
  const empresaId = profile?.empresa_id ?? ''

  const [{ data: config }, { data: faixas }] = await Promise.all([
    // `single` com empresa sem linha devolve erro e `data` nulo — e o nulo é
    // justamente o que o componente espera para cair no CONFIG_PADRAO. Fica
    // como estava: trocar por `maybeSingle` aqui seria mudança de
    // comportamento numa mudança que é de menu.
    sb.from('saude_config').select('*').eq('empresa_id', empresaId).single(),
    sb.from('saude_faixas').select('*').eq('empresa_id', empresaId).order('ordem'),
  ])

  return {
    empresaId,
    config,
    faixas: faixas ?? [],
    role: profile?.role ?? 'vendedor',
  }
}
