export type SubscriptionStatus =
  | 'trial'
  | 'active'
  | 'pending'
  | 'expired'
  | 'suspended'
  | 'cancelled'
  | 'blocked'

export interface PlanLimits {
  max_empresas: number
  max_usuarios: number
  max_produtos: number
  max_clientes: number
  max_fornecedores: number
  max_depositos: number
  max_canais: number
  max_vendas_mes: number
  max_nfce_mes: number
  max_nfe_mes: number
  max_whatsapp_mes: number
  storage_mb: number
  permite_api: boolean
  permite_pdv_offline: boolean
  permite_suporte_prioritario: boolean
}

export interface PlanData {
  planId: string
  planNome: string
  planCodigo: string
  planCor: string
  subscriptionId: string
  subscriptionStatus: SubscriptionStatus
  trialFim: string | null
  diasRestantes: number | null
  modulos: string[]
  limites: PlanLimits
  isSystemAdmin: boolean
  empresaId: string
}

export const DEFAULT_LIMITS: PlanLimits = {
  max_empresas: 1,
  max_usuarios: 3,
  max_produtos: 5000,
  max_clientes: 1000,
  max_fornecedores: 200,
  max_depositos: 1,
  max_canais: 0,
  max_vendas_mes: -1,
  max_nfce_mes: 500,
  max_nfe_mes: 0,
  max_whatsapp_mes: 0,
  storage_mb: 1000,
  permite_api: false,
  permite_pdv_offline: false,
  permite_suporte_prioritario: false,
}

export const STATUS_BLOQUEADO: SubscriptionStatus[] = ['expired', 'suspended', 'cancelled', 'blocked']
export const STATUS_AVISO: SubscriptionStatus[] = ['pending', 'trial']

export function isAcessoBloqueado(status: SubscriptionStatus): boolean {
  return STATUS_BLOQUEADO.includes(status)
}
