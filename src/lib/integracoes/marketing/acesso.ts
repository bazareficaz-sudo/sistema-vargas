import { createAdminClient } from '@/lib/supabase/admin'

// Atalho para o Vargas Marketing (sistema separado, outro login).
//
// A empresa "tem o serviço" quando existe um código de conexão ativo — o
// mesmo gerado em Configurações → Integrações → Vargas Marketing. Sem código
// ativo (nunca gerou, cancelou ou venceu), o atalho não aparece.
export const VARGAS_MARKETING_URL = (process.env.VARGAS_MARKETING_URL || 'https://vargas-marketing.vercel.app').replace(/\/+$/, '')

export async function urlVargasMarketing(empresaId: string): Promise<string | null> {
  if (!empresaId) return null
  const { data, error } = await createAdminClient().from('integracao_marketing_tokens')
    .select('id')
    .eq('empresa_id', empresaId)
    .is('revogado_em', null)
    .gt('expira_em', new Date().toISOString())
    .limit(1)
  // Falha na consulta só esconde o atalho; nunca derruba o painel.
  if (error || !data?.length) return null
  return `${VARGAS_MARKETING_URL}/app`
}
