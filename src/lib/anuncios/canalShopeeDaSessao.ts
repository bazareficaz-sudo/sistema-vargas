import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// Canal Shopee da empresa do usuário logado — a checagem de sessão, empresa
// e conexão das rotas da publicação em lote.
export async function canalShopeeDaSessao(canalId: unknown): Promise<
  | { ok: true; sb: any; empresaId: string; canalRow: any }
  | { ok: false; erro: string; status: number }
> {
  if (!canalId) return { ok: false, erro: 'canalId ausente', status: 400 }
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { ok: false, erro: 'Não autenticado', status: 401 }
  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return { ok: false, erro: 'Empresa não identificada', status: 400 }
  const { data: canalRow } = await sb.from('marketplace_canais')
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em')
    .eq('id', String(canalId)).eq('empresa_id', empresaId).eq('plataforma', 'shopee').maybeSingle()
  if (!canalRow) return { ok: false, erro: 'Canal Shopee não encontrado', status: 404 }
  if (!canalRow.access_token) return { ok: false, erro: 'Canal não conectado — refaça a autorização em Configurar.', status: 400 }
  return { ok: true, sb, empresaId, canalRow }
}
