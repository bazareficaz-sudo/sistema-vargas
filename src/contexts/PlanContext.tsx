'use client'

import { createContext, useContext } from 'react'
import type { PlanData, PlanLimits } from '@/lib/plans/types'
import { DEFAULT_LIMITS } from '@/lib/plans/types'

const DEFAULT_PLAN: PlanData = {
  planId: '',
  planNome: '',
  planCodigo: '',
  planCor: '#3b82f6',
  subscriptionId: '',
  subscriptionStatus: 'trial',
  trialFim: null,
  diasRestantes: null,
  modulos: [],
  limites: DEFAULT_LIMITS,
  isSystemAdmin: false,
  empresaId: '',
}

export const PlanContext = createContext<PlanData>(DEFAULT_PLAN)

// Main hook to access plan data
export function usePlan(): PlanData {
  return useContext(PlanContext)
}

// Returns true if the current user can access a given module
export function useModulo(modulo: string): boolean {
  const plan = usePlan()
  if (plan.isSystemAdmin) return true
  if (plan.subscriptionStatus === 'expired' || plan.subscriptionStatus === 'blocked' || plan.subscriptionStatus === 'suspended') return false
  if (plan.modulos.includes('*')) return true
  return plan.modulos.includes(modulo)
}

// Returns whether a limit is respected and what the values are
export function useLimite(campo: keyof PlanLimits): { limite: number; permitido: (atual: number) => boolean } {
  const plan = usePlan()
  const limite = plan.limites[campo] as number
  return {
    limite,
    permitido: (atual: number) => plan.isSystemAdmin || limite === -1 || atual < limite,
  }
}
