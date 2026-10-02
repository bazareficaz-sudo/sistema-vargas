import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { COLUNAS_CANAL, montarCanal } from './canal'
import type { TiktokChannel } from './types'

// Canal TikTok da empresa do usuário logado — a checagem de sessão, empresa
// e conexão que toda rota de criação de anúncio repete.
export async function canalTiktokDaSessao(canalId: unknown): Promise<
  | { ok: true; sb: any; empresaId: string; canal: TiktokChannel }
  | { ok: false; erro: string; status: number }
> {
  if (!canalId) return { ok: false, erro: 'canalId ausente', status: 400 }
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { ok: false, erro: 'Não autenticado', status: 401 }

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return { ok: false, erro: 'Empresa não identificada', status: 400 }

  const { data: canalRow } = await sb
    .from('marketplace_canais')
    .select(COLUNAS_CANAL)
    .eq('id', String(canalId)).eq('empresa_id', empresaId).eq('plataforma', 'tiktok')
    .maybeSingle()
  if (!canalRow) return { ok: false, erro: 'Canal TikTok Shop não encontrado', status: 404 }
  if (!canalRow.access_token) return { ok: false, erro: 'Canal não conectado — refaça a autorização em Configurar.', status: 400 }
  return { ok: true, sb, empresaId, canal: montarCanal(canalRow) }
}
