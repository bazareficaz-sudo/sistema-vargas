'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

type Deposito = { id: string; nome: string; principal: boolean }
type Dashboard = {
  enderecosAtivos: number; enderecosOcupados: number; enderecosVazios: number; enderecosBloqueados: number
  produtosSemEndereco: number; estoqueNaoEnderecado: number
}

const ACOES = [
  { href: '/dashboard/enderecamento/enderecos', label: 'Endereços', icon: '🗂️' },
  { href: '/dashboard/enderecamento/gerador', label: 'Gerador em Lote', icon: '⚙️' },
  { href: '/dashboard/enderecamento/etiquetas', label: 'Etiquetas', icon: '🏷️' },
  { href: '/dashboard/enderecamento/consulta-produto', label: 'Consultar Produto', icon: '🔍' },
  { href: '/dashboard/enderecamento/consulta-endereco', label: 'Consultar Endereço', icon: '📍' },
  { href: '/dashboard/enderecamento/transferencia', label: 'Transferência Interna', icon: '🔀' },
  { href: '/dashboard/enderecamento/mapa', label: 'Mapa do Depósito', icon: '🗺️' },
  { href: '/dashboard/enderecamento/sem-endereco', label: 'Produtos sem Endereço', icon: '⚠️' },
  { href: '/dashboard/enderecamento/config', label: 'Configurar Depósito', icon: '🛠️' },
]

export default function EnderecamentoDashboardClient({ depositos }: { depositos: Deposito[] }) {
  const [depositoId, setDepositoId] = useState(depositos.find(d => d.principal)?.id ?? depositos[0]?.id ?? '')
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [carregando, setCarregando] = useState(false)

  const carregar = useCallback(async () => {
    if (!depositoId) return
    setCarregando(true)
    const r = await fetch(`/api/enderecamento/dashboard?depositoId=${depositoId}`).then(r => r.json()).catch(() => null)
    setDash(r?.ok ? r : null)
    setCarregando(false)
  }, [depositoId])

  useEffect(() => { carregar() }, [carregar])

  const cards = dash ? [
    { label: 'Endereços ativos', valor: dash.enderecosAtivos, cor: 'text-slate-900' },
    { label: 'Ocupados', valor: dash.enderecosOcupados, cor: 'text-emerald-600' },
    { label: 'Vazios', valor: dash.enderecosVazios, cor: 'text-slate-500' },
    { label: 'Bloqueados', valor: dash.enderecosBloqueados, cor: 'text-red-600' },
    { label: 'Produtos sem endereço', valor: dash.produtosSemEndereco, cor: 'text-amber-600' },
    { label: 'Unidades não endereçadas', valor: dash.estoqueNaoEnderecado, cor: 'text-amber-600' },
  ] : []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-slate-900 text-xl font-bold">Endereçamento de Estoque</h1>
          <p className="text-slate-500 text-sm mt-0.5">Onde cada produto está guardado, por depósito.</p>
        </div>
        {depositos.length > 0 && (
          <select value={depositoId} onChange={e => setDepositoId(e.target.value)}
            className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-sm shadow-sm">
            {depositos.map(d => <option key={d.id} value={d.id}>{d.nome}{d.principal ? ' (principal)' : ''}</option>)}
          </select>
        )}
      </div>

      {depositos.length === 0 && (
        <div className="bg-white border border-slate-100 rounded-2xl p-10 text-center shadow-sm">
          <p className="text-4xl mb-3">🏭</p>
          <p className="text-slate-500">Nenhum depósito cadastrado ainda.</p>
        </div>
      )}

      {depositos.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {cards.map(c => (
              <div key={c.label} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
                <p className="text-slate-400 text-xs font-medium">{c.label}</p>
                <p className={`text-2xl font-bold mt-1 ${c.cor}`}>{carregando ? '…' : c.valor}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {ACOES.map(a => (
              <Link key={a.href} href={depositoId ? `${a.href}?depositoId=${depositoId}` : a.href}
                className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:border-blue-300 hover:shadow transition-all flex items-center gap-3">
                <span className="text-2xl">{a.icon}</span>
                <span className="text-sm font-medium text-slate-700">{a.label}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
