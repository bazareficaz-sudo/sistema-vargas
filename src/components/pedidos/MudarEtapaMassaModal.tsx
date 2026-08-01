'use client'

import { useMemo, useState } from 'react'
import { ETAPAS, ETAPA_INFO, transicaoPermitida, type Etapa } from '@/lib/pedidos/etapas'

// Mudança de etapa em massa.
//
// A tela mostra, ANTES de confirmar, quantos pedidos aceitam a etapa
// escolhida e quantos não — com o motivo. Só assim marcar 40 pedidos como
// "embalado" não vira uma aposta sobre o que aconteceu com os 3 que
// estavam cancelados.

type Alvo = { fonte: 'venda' | 'marketplace'; id: string; numero: string; etapa: Etapa }

export default function MudarEtapaMassaModal({ alvos, onFechar, onAplicado }: {
  alvos: Alvo[]
  onFechar: () => void
  onAplicado: (etapa: Etapa, aplicados: { fonte: string; id: string }[]) => void
}) {
  const [etapa, setEtapa] = useState<Etapa | null>(null)
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [resultado, setResultado] = useState<{ aplicados: any[]; recusados: any[] } | null>(null)
  const [erro, setErro] = useState('')

  // Prévia: o mesmo julgamento que o servidor vai fazer, feito aqui antes
  // de gastar a ida e volta.
  const previa = useMemo(() => {
    if (!etapa) return null
    const ok: Alvo[] = []; const nao: { alvo: Alvo; motivo: string }[] = []
    for (const a of alvos) {
      const p = transicaoPermitida(a.etapa, etapa)
      if (p.ok) ok.push(a); else nao.push({ alvo: a, motivo: p.motivo ?? '' })
    }
    return { ok, nao }
  }, [etapa, alvos])

  async function aplicar() {
    if (!etapa || !previa || previa.ok.length === 0) return
    setSalvando(true); setErro('')
    try {
      const d = await fetch('/api/pedidos/etapa/massa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itens: previa.ok.map(a => ({ fonte: a.fonte, id: a.id })),
          etapa, observacao,
        }),
      }).then(r => r.json())
      if (!d.ok) { setErro(d.erro ?? 'Não foi possível mudar as etapas'); return }
      setResultado({ aplicados: d.aplicados, recusados: d.recusados })
      onAplicado(etapa, d.aplicados)
    } catch {
      setErro('Falha de conexão')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Mudar etapa de {alvos.length} pedido(s)</h2>
        </div>

        {resultado ? (
          <div className="p-5 space-y-3">
            <p className="text-sm text-gray-900">
              {resultado.aplicados.length} pedido(s) agora em <strong>{ETAPA_INFO[etapa!].label}</strong>.
            </p>
            {resultado.recusados.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs font-medium text-amber-800 mb-1">{resultado.recusados.length} não mudaram:</p>
                <ul className="text-xs text-amber-700 space-y-0.5">
                  {resultado.recusados.slice(0, 10).map((r, i) => (
                    <li key={i}>{alvos.find(a => a.id === r.id)?.numero ?? r.id} — {r.motivo}</li>
                  ))}
                  {resultado.recusados.length > 10 && <li>e mais {resultado.recusados.length - 10}...</li>}
                </ul>
              </div>
            )}
            <button onClick={onFechar} className="w-full px-4 py-2 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-800">
              Fechar
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">Nova etapa</p>
              <div className="flex flex-wrap gap-1.5">
                {ETAPAS.map(e => (
                  <button key={e.valor} onClick={() => setEtapa(e.valor)} title={e.ajuda}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      etapa === e.valor ? 'border-blue-400 bg-blue-50 text-blue-800 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}>
                    {e.icone} {e.label}
                  </button>
                ))}
              </div>
            </div>

            {previa && (
              <div className="text-sm">
                <p className="text-gray-900">
                  <strong>{previa.ok.length}</strong> pedido(s) vão mudar para {ETAPA_INFO[etapa!].label}.
                </p>
                {previa.nao.length > 0 && (
                  <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-xs font-medium text-gray-600 mb-1">{previa.nao.length} ficam como estão:</p>
                    <ul className="text-xs text-gray-500 space-y-0.5">
                      {previa.nao.slice(0, 6).map((r, i) => <li key={i}>{r.alvo.numero} — {r.motivo}</li>)}
                      {previa.nao.length > 6 && <li>e mais {previa.nao.length - 6}...</li>}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Observação (opcional)</label>
              <input value={observacao} onChange={e => setObservacao(e.target.value)}
                placeholder="Fica na linha do tempo de cada pedido"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
            </div>

            {erro && <p className="text-xs text-red-600">{erro}</p>}

            <div className="flex gap-2">
              <button onClick={onFechar} className="flex-1 px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={aplicar} disabled={!etapa || salvando || (previa?.ok.length ?? 0) === 0}
                className="flex-1 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
                {salvando ? 'Aplicando...' : `Aplicar em ${previa?.ok.length ?? 0}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
