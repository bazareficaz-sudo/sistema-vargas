import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import type { ConfigGetulio, Destinatario } from './tipos'

// A Central do Getúlio mostra dinheiro (contas, estoque a custo, vendas por
// canal) e configura para quem isso vai no WhatsApp — é coisa de quem
// administra a empresa.
export async function guardaGetulio() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  return { sb, guarda }
}

/**
 * Configuração da empresa. Sem linha ainda, devolve a padrão — com o número
 * do gestor que já existe no cadastro do WhatsApp como primeiro destinatário.
 */
export async function lerConfig(sb: any, empresaId: string): Promise<ConfigGetulio & { existe: boolean }> {
  const { data } = await sb.from('getulio_config').select('*').eq('empresa_id', empresaId).maybeSingle()
  if (data) return { ...data, existe: true }
  const { data: wpp } = await sb.from('whatsapp_config').select('numero_gestor').eq('empresa_id', empresaId).maybeSingle()
  const destinatarios: Destinatario[] = wpp?.numero_gestor ? [{ nome: '', numero: String(wpp.numero_gestor) }] : []
  return {
    empresa_id: empresaId, ativo: false, horario_resumo: '07:30', destinatarios,
    vigias_desligados: [], responder_whatsapp: false, ultima_varredura: null, ultimo_resumo_dia: null, existe: false,
  }
}
