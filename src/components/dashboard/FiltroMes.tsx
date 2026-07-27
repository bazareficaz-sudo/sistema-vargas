'use client'

import { useRouter } from 'next/navigation'

// Select com os últimos 12 meses — mesmo padrão de filtro via searchParams
// já usado em src/app/dashboard/contas-pagar/page.tsx (status/q).
export default function FiltroMes({ mesSelecionado }: { mesSelecionado: string }) {
  const router = useRouter()

  const opcoes: { valor: string; label: string }[] = []
  const hoje = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
    const valor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    opcoes.push({ valor, label: label.charAt(0).toUpperCase() + label.slice(1) })
  }

  return (
    <select
      value={mesSelecionado}
      onChange={e => router.push(`/dashboard?mes=${e.target.value}`)}
      className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-600 font-medium"
    >
      {opcoes.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
    </select>
  )
}
