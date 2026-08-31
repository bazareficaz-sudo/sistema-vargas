'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function BuscaCliente({ empresaId, clienteId, clienteNome, onChange }: {
  empresaId: string
  clienteId: string | null
  clienteNome: string
  onChange: (clienteId: string | null, clienteNome: string) => void
}) {
  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<{ id: string; nome: string; cpf_cnpj: string | null; telefone: string | null }[]>([])

  useEffect(() => {
    if (busca.trim().length < 2) { setResultados([]); return }
    const t = setTimeout(async () => {
      const sb = createClient()
      const { data } = await sb.from('clientes').select('id, nome, cpf_cnpj, telefone')
        .eq('empresa_id', empresaId)
        .is('mesclado_em', null)
        .or(`nome.ilike.%${busca}%,cpf_cnpj.ilike.%${busca}%,telefone.ilike.%${busca}%`)
        .limit(10)
      setResultados(data ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [busca, empresaId])

  return (
    <div>
      {clienteId && (
        <div className="flex items-center gap-2 mb-1.5">
          <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 text-sm px-2.5 py-1 rounded-full border border-blue-200">
            {clienteNome}
            <button type="button" onClick={() => onChange(null, '')} className="text-blue-400 hover:text-blue-600">✕</button>
          </span>
        </div>
      )}
      {!clienteId && (
        <>
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar cliente por nome, CPF ou telefone..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          />
          {resultados.length > 0 && (
            <div className="mt-1.5 border border-gray-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
              {resultados.map(c => (
                <button key={c.id} type="button"
                  onClick={() => { onChange(c.id, c.nome); setBusca(''); setResultados([]) }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0">
                  <span className="text-gray-900">{c.nome}</span>
                  <span className="text-xs text-gray-400 ml-1.5">{c.cpf_cnpj} {c.telefone && `· ${c.telefone}`}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
