'use client'

import { useState } from 'react'
import { usePlan } from '@/contexts/PlanContext'
import { useLS } from '@/hooks/useLS'
import { createClient } from '@/lib/supabase/client'

function fmtHora(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function SupportModeBanner() {
  const plan = usePlan()
  const [encerrando, setEncerrando] = useState(false)
  const [dispensados, setDispensados] = useLS<string[]>('suporte_avisos_dispensados', [])

  const suporte = plan.suporte
  if (!suporte) return null

  if (suporte.tipo === 'ativa') {
    async function encerrar() {
      setEncerrando(true)
      await fetch('/api/suporte/encerrar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: suporte!.sessionId }),
      })
      const supabase = createClient()
      await supabase.auth.signOut()
      window.location.href = '/login'
    }
    return (
      <div className="bg-purple-700 text-white text-sm px-4 py-2 flex items-center justify-between">
        <span>🛟 Modo suporte — atendendo <strong>{suporte.empresaNome}</strong>
          {suporte.expiraEm && <> até {fmtHora(suporte.expiraEm)}</>}
        </span>
        <button onClick={encerrar} disabled={encerrando}
          className="ml-4 px-3 py-1 bg-white text-purple-700 rounded-lg text-xs font-bold hover:bg-purple-50 disabled:opacity-60">
          {encerrando ? 'Encerrando...' : 'Encerrar suporte'}
        </button>
      </div>
    )
  }

  // encerrada_recente — aviso dispensável pro cliente real
  if (dispensados.includes(suporte.sessionId)) return null
  return (
    <div className="bg-purple-100 text-purple-800 text-sm px-4 py-2 flex items-center justify-between border-b border-purple-200">
      <span>
        🛟 O suporte da plataforma acessou sua conta
        {suporte.encerradoEm && <> em {fmtHora(suporte.encerradoEm)}</>} pra te ajudar. Motivo: {suporte.motivo}
      </span>
      <button onClick={() => setDispensados([...dispensados, suporte.sessionId])}
        className="ml-4 px-3 py-1 bg-purple-700 text-white rounded-lg text-xs font-bold hover:bg-purple-800">
        Entendi
      </button>
    </div>
  )
}
