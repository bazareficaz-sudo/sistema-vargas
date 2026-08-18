'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

type Deposito = { id: string; nome: string; principal: boolean }
type Endereco = { id: string; codigo_interno: string; codigo_legivel: string; status: string; zona: string | null; corredor: string | null }

const COR_STATUS: Record<string, string> = {
  ativo: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  inativo: 'border-slate-200 bg-slate-50 text-slate-400',
  bloqueado: 'border-red-300 bg-red-50 text-red-700',
  temp_bloqueado: 'border-amber-300 bg-amber-50 text-amber-700',
  em_inventario: 'border-blue-300 bg-blue-50 text-blue-700',
  cheio: 'border-orange-300 bg-orange-50 text-orange-700',
  reservado: 'border-violet-300 bg-violet-50 text-violet-700',
}

export default function MapaDepositoClient({ depositos, depositoIdInicial }: {
  depositos: Deposito[]; depositoIdInicial: string
}) {
  const [depositoId, setDepositoId] = useState(depositoIdInicial || depositos.find(d => d.principal)?.id || depositos[0]?.id || '')
  const [enderecos, setEnderecos] = useState<Endereco[]>([])
  const [ocupados, setOcupados] = useState<Set<string>>(new Set())

  const carregar = useCallback(async () => {
    if (!depositoId) return
    const [r1, r2] = await Promise.all([
      fetch(`/api/enderecamento/enderecos?depositoId=${depositoId}`).then(r => r.json()).catch(() => null),
      fetch(`/api/enderecamento/produtos?depositoId=${depositoId}`).then(r => r.json()).catch(() => null),
    ])
    setEnderecos(r1?.ok ? r1.enderecos : [])
    setOcupados(new Set((r2?.ok ? r2.linhas : []).map((l: any) => l.endereco_id)))
  }, [depositoId])

  useEffect(() => { carregar() }, [carregar])

  const porZona = new Map<string, Map<string, Endereco[]>>()
  for (const e of enderecos) {
    const zona = e.zona || 'Sem zona'
    const corredor = e.corredor || 'Sem corredor'
    if (!porZona.has(zona)) porZona.set(zona, new Map())
    const porCorredor = porZona.get(zona)!
    if (!porCorredor.has(corredor)) porCorredor.set(corredor, [])
    porCorredor.get(corredor)!.push(e)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-slate-900 text-xl font-bold">Mapa do Depósito</h1>
          <p className="text-slate-500 text-sm mt-0.5">Verde ocupado (borda), cor pelo status. Clique para consultar.</p>
        </div>
        {depositos.length > 0 && (
          <select value={depositoId} onChange={e => setDepositoId(e.target.value)}
            className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-sm shadow-sm">
            {depositos.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
        )}
      </div>

      {enderecos.length === 0 && (
        <div className="bg-white border border-slate-100 rounded-2xl p-10 text-center shadow-sm">
          <p className="text-4xl mb-3">🗺️</p>
          <p className="text-slate-500">Nenhum endereço cadastrado neste depósito ainda.</p>
        </div>
      )}

      {[...porZona.entries()].map(([zona, porCorredor]) => (
        <div key={zona} className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
          <p className="text-sm font-bold text-slate-800 mb-3">Zona {zona}</p>
          <div className="space-y-3">
            {[...porCorredor.entries()].map(([corredor, lista]) => (
              <div key={corredor}>
                <p className="text-xs text-slate-400 mb-1.5">Corredor {corredor}</p>
                <div className="flex flex-wrap gap-1.5">
                  {lista.map(e => (
                    <Link key={e.id} href={`/dashboard/enderecamento/consulta-endereco?codigo=${e.codigo_interno}`}
                      className={`px-2.5 py-1.5 rounded-lg border-2 text-xs font-mono font-medium hover:opacity-75 transition-opacity ${COR_STATUS[e.status] ?? 'border-slate-200 bg-slate-50'} ${ocupados.has(e.id) ? 'ring-2 ring-offset-1 ring-slate-300' : ''}`}
                      title={ocupados.has(e.id) ? 'Ocupado' : 'Vazio'}>
                      {e.codigo_legivel}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
