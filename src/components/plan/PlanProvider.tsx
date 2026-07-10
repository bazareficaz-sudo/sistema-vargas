'use client'

import { PlanContext } from '@/contexts/PlanContext'
import type { PlanData } from '@/lib/plans/types'

// Bridge: server layout loads PlanData, passes it here to provide via React Context
export default function PlanProvider({ data, children }: { data: PlanData; children: React.ReactNode }) {
  return <PlanContext.Provider value={data}>{children}</PlanContext.Provider>
}
