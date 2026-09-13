// Acesso de servidor ao Caixa da Empresa (tesouraria). Compartilhado pelas
// rotas de /api/caixa/tesouraria — não é lógica pura porque fala com o
// banco; a parte pura (validação, saldo, estorno) fica em `movimento.ts`.

import type { createClient } from '@/lib/supabase/server'

type SupabaseServidor = Awaited<ReturnType<typeof createClient>>

export type LinhaCaixa = {
  id: string
  empresa_id: string
  tipo: 'pdv' | 'tesouraria' | 'banco'
  nome: string
  ativo: boolean
  created_at: string
}

/**
 * Busca a tesouraria da empresa; cria na primeira visita, se ainda não
 * existir. Não retroage: o saldo começa em zero, do primeiro movimento
 * lançado daqui pra frente — nunca de um valor inventado a partir de dados
 * antigos (seção K.7 da auditoria).
 */
export async function buscarOuCriarTesouraria(sb: SupabaseServidor, empresaId: string, userId: string): Promise<LinhaCaixa> {
  const { data: existente } = await sb.from('caixa').select('*')
    .eq('empresa_id', empresaId).eq('tipo', 'tesouraria').maybeSingle()
  if (existente) return existente

  const { data: criado, error } = await sb.from('caixa')
    .insert({ empresa_id: empresaId, tipo: 'tesouraria', nome: 'Caixa da Empresa', created_by: userId })
    .select('*').single()
  if (!error) return criado

  // Duas requisições concorrentes na primeira visita: a segunda esbarra no
  // índice único (idx_caixa_tesouraria_unica) — a linha já existe, não é erro.
  const { data: corrida } = await sb.from('caixa').select('*')
    .eq('empresa_id', empresaId).eq('tipo', 'tesouraria').maybeSingle()
  if (corrida) return corrida
  throw error
}
