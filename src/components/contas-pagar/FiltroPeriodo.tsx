'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

// Período do relatório. Os atalhos existem porque "mês passado" é a pergunta
// que o gestor realmente faz — montar isso digitando duas datas toda vez é
// atrito sem motivo.

function iso(d: Date) { return d.toISOString().split('T')[0] }

export default function FiltroPeriodo({ de, ate }: { de: string; ate: string }) {
  const router = useRouter()
  const [d1, setD1] = useState(de)
  const [d2, setD2] = useState(ate)

  function ir(a: string, b: string) {
    setD1(a); setD2(b)
    router.push(`/dashboard/contas-pagar/relatorio?de=${a}&ate=${b}`)
  }

  function atalho(tipo: 'mes' | 'anterior' | 'ano' | '90') {
    const h = new Date()
    if (tipo === 'mes') return ir(iso(new Date(h.getFullYear(), h.getMonth(), 1)), iso(h))
    if (tipo === 'anterior') return ir(
      iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)),
      iso(new Date(h.getFullYear(), h.getMonth(), 0)),
    )
    if (tipo === 'ano') return ir(iso(new Date(h.getFullYear(), 0, 1)), iso(h))
    return ir(iso(new Date(h.getTime() - 90 * 86400000)), iso(h))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1">
        {([['mes','Este mês'],['anterior','Mês passado'],['90','90 dias'],['ano','Este ano']] as const).map(([k, l]) => (
          <button key={k} onClick={() => atalho(k)}
            className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 bg-white">
            {l}
          </button>
        ))}
      </div>
      <input type="date" value={d1} onChange={e => setD1(e.target.value)}
        className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:border-blue-500" />
      <span className="text-xs text-gray-400">até</span>
      <input type="date" value={d2} onChange={e => setD2(e.target.value)}
        className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:border-blue-500" />
      <button onClick={() => ir(d1, d2)}
        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
        Aplicar
      </button>
    </div>
  )
}
