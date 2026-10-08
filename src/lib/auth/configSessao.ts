// Regras de encerramento automático da sessão do painel web, por empresa
// (tabela empresa_config_sessao). Quem aplica é o SessaoVigia, no navegador;
// quem edita é o gestor, em Gestão → Sessão e Segurança.
//
// Empresa sem linha na tabela — ou banco sem a migração aplicada — cai no
// PADRAO, que é o comportamento de antes desta configuração existir.

import type { SupabaseClient } from '@supabase/supabase-js'

export type ConfigSessao = {
  inatividadeAtiva: boolean
  inatividadeMin: number
  viradaDiaAtiva: boolean
}

export const INATIVIDADE_MIN_MINIMO = 5
export const INATIVIDADE_MIN_MAXIMO = 720

export const CONFIG_SESSAO_PADRAO: ConfigSessao = {
  inatividadeAtiva: true,
  inatividadeMin: 30,
  viradaDiaAtiva: true,
}

export function minutosValidos(min: unknown): min is number {
  return typeof min === 'number' && Number.isInteger(min)
    && min >= INATIVIDADE_MIN_MINIMO && min <= INATIVIDADE_MIN_MAXIMO
}

// "45 min", "1 h", "1 h 30 min" — usado na tela de configuração e no aviso
// do login, para os dois falarem a mesma língua.
export function descreverMinutos(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export async function carregarConfigSessao(supabase: SupabaseClient, empresaId: string): Promise<ConfigSessao> {
  if (!empresaId) return CONFIG_SESSAO_PADRAO
  const { data, error } = await supabase
    .from('empresa_config_sessao')
    .select('logout_inatividade_ativo, logout_inatividade_min, logout_virada_dia_ativo')
    .eq('empresa_id', empresaId)
    .maybeSingle()
  if (error || !data) return CONFIG_SESSAO_PADRAO
  return {
    inatividadeAtiva: data.logout_inatividade_ativo !== false,
    inatividadeMin: minutosValidos(data.logout_inatividade_min)
      ? data.logout_inatividade_min
      : CONFIG_SESSAO_PADRAO.inatividadeMin,
    viradaDiaAtiva: data.logout_virada_dia_ativo !== false,
  }
}
