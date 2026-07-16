'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AnunciosLandingClient({ canais }: { canais: { id: string; nome: string }[] }) {
  const router = useRouter()
  const [canalId, setCanalId] = useState('')

  return (
    <div>
      <h1 className="text-gray-900 text-xl font-semibold">Anúncios — Marketplace</h1>
      <p className="text-gray-500 text-sm mt-0.5 mb-5">Importe, mapeie e sincronize seus anúncios</p>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <label className="block text-xs font-medium text-gray-600 mb-1">Canal</label>
        <select value={canalId}
          onChange={e => { setCanalId(e.target.value); if (e.target.value) router.push(`/dashboard/marketplaces/${e.target.value}/anuncios`) }}
          className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
          <option value="">Selecione um canal...</option>
          {canais.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl py-20 flex flex-col items-center justify-center text-gray-400">
        <span className="text-4xl mb-3">🏪</span>
        <p className="text-sm">Selecione um canal para ver os anúncios</p>
      </div>
    </div>
  )
}
