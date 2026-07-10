'use client'

import { useModulo } from '@/contexts/PlanContext'
import Link from 'next/link'

interface Props {
  modulo: string
  children: React.ReactNode
  fallback?: React.ReactNode
}

// Wrap any page/section that requires a specific module to be in the plan
export default function PlanGuard({ modulo, children, fallback }: Props) {
  const temAcesso = useModulo(modulo)
  if (temAcesso) return <>{children}</>
  return fallback ? <>{fallback}</> : <BloqueioUpgrade modulo={modulo} />
}

export function BloqueioUpgrade({ modulo }: { modulo: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-3xl mb-4">🔒</div>
      <h2 className="text-xl font-bold text-slate-800 mb-2">Recurso não disponível</h2>
      <p className="text-slate-500 text-sm max-w-md mb-6">
        O módulo <strong>{modulo}</strong> não está incluído no seu plano atual.
        Faça upgrade para desbloquear este e outros recursos avançados.
      </p>
      <div className="flex gap-3">
        <Link href="/upgrade"
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold">
          Ver planos disponíveis →
        </Link>
        <Link href="/dashboard"
          className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-medium">
          Voltar ao dashboard
        </Link>
      </div>
    </div>
  )
}
