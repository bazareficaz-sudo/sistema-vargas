'use client'

import { useState, useEffect, useCallback } from 'react'

export type ItemEntradaParaGuardar = {
  produtoId: string
  produtoNome: string
  sku: string | null
  quantidadeRecebida: number
}

type SugestaoEndereco = { id: string; codigoLegivel: string; quantidadeAtual: number }
type Endereco = { id: string; codigo_legivel: string }

/**
 * Painel pós-entrada: "onde guardar o que acabou de chegar". Reaproveita o
 * endereço que o produto já usa no depósito quando existe só um, com
 * confirmação explícita (nunca aplica sozinho). Quem não resolver aqui
 * continua "não endereçado" e aparece em Produtos sem Endereço, como hoje —
 * fechar este painel sem confirmar tudo não perde nada, só adia.
 */
export default function ConfirmarEnderecoEntradaModal({ depositoId, itens, onFechar }: {
  depositoId: string
  itens: ItemEntradaParaGuardar[]
  onFechar: () => void
}) {
  const [sugestoes, setSugestoes] = useState<Map<string, SugestaoEndereco | null>>(new Map())
  const [carregandoSugestoes, setCarregandoSugestoes] = useState(true)
  const [pendentes, setPendentes] = useState<ItemEntradaParaGuardar[]>(itens)
  const [salvandoId, setSalvandoId] = useState<string | null>(null)
  const [erroPorItem, setErroPorItem] = useState<Record<string, string>>({})
  const [confirmandoTodos, setConfirmandoTodos] = useState(false)
  const [progressoTodos, setProgressoTodos] = useState({ feito: 0, total: 0 })

  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [buscaEndereco, setBuscaEndereco] = useState('')
  const [candidatos, setCandidatos] = useState<Endereco[]>([])

  useEffect(() => {
    let cancelado = false
    setCarregandoSugestoes(true)
    fetch('/api/enderecamento/sugestao-entrada', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositoId, produtoIds: itens.map(i => i.produtoId) }),
    }).then(r => r.json()).then(r => {
      if (cancelado) return
      const mapa = new Map<string, SugestaoEndereco | null>(Object.entries(r?.sugestoes ?? {}))
      setSugestoes(mapa)
    }).catch(() => null).finally(() => { if (!cancelado) setCarregandoSugestoes(false) })
    return () => { cancelado = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositoId])

  useEffect(() => {
    if (!editandoId || !buscaEndereco) { setCandidatos([]); return }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/enderecamento/enderecos?depositoId=${depositoId}&status=ativo&busca=${encodeURIComponent(buscaEndereco)}`).then(r => r.json()).catch(() => null)
      setCandidatos(r?.ok ? r.enderecos.slice(0, 8) : [])
    }, 250)
    return () => clearTimeout(t)
  }, [buscaEndereco, editandoId, depositoId])

  const resolverItem = useCallback((produtoId: string) => {
    setPendentes(prev => {
      const restante = prev.filter(i => i.produtoId !== produtoId)
      if (restante.length === 0) onFechar()
      return restante
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onFechar])

  async function confirmarNoEndereco(item: ItemEntradaParaGuardar, enderecoId: string) {
    setSalvandoId(item.produtoId)
    setErroPorItem(prev => { const p = { ...prev }; delete p[item.produtoId]; return p })
    const r = await fetch('/api/enderecamento/produtos/adicionar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        depositoId, enderecoId, produtoId: item.produtoId, quantidadeRecebida: item.quantidadeRecebida,
        motivo: 'Guardado após entrada de mercadoria',
      }),
    }).then(r => r.json()).catch(() => ({ ok: false }))
    setSalvandoId(null)
    if (!r.ok) { setErroPorItem(prev => ({ ...prev, [item.produtoId]: r.erro ?? 'Erro ao guardar.' })); return }
    if (editandoId === item.produtoId) { setEditandoId(null); setBuscaEndereco(''); setCandidatos([]) }
    resolverItem(item.produtoId)
  }

  function guardarDepois(item: ItemEntradaParaGuardar) {
    resolverItem(item.produtoId)
  }

  async function confirmarTodosSugeridos() {
    const comSugestao = pendentes.filter(i => sugestoes.get(i.produtoId))
    setConfirmandoTodos(true)
    setProgressoTodos({ feito: 0, total: comSugestao.length })
    for (const item of comSugestao) {
      const sugestao = sugestoes.get(item.produtoId)
      if (!sugestao) continue
      await confirmarNoEndereco(item, sugestao.id)
      setProgressoTodos(p => ({ ...p, feito: p.feito + 1 }))
    }
    setConfirmandoTodos(false)
  }

  const totalComSugestao = pendentes.filter(i => sugestoes.get(i.produtoId)).length

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Guardar o que chegou</h2>
            <p className="text-xs text-slate-500 mt-0.5">Onde a mercadoria recebida vai ficar no depósito.</p>
          </div>
          <button onClick={onFechar} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>

        {totalComSugestao > 1 && (
          <div className="px-5 pt-4">
            <button onClick={confirmarTodosSugeridos} disabled={confirmandoTodos}
              className="w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl">
              {confirmandoTodos
                ? `Confirmando... ${progressoTodos.feito}/${progressoTodos.total}`
                : `Confirmar todos os sugeridos (${totalComSugestao})`}
            </button>
          </div>
        )}

        <div className="p-5 space-y-3">
          {carregandoSugestoes && <p className="text-center text-slate-400 py-6 text-sm">Carregando sugestões...</p>}

          {!carregandoSugestoes && pendentes.map(item => {
            const sugestao = sugestoes.get(item.produtoId)
            const editando = editandoId === item.produtoId
            const salvando = salvandoId === item.produtoId
            return (
              <div key={item.produtoId} className="border border-slate-200 rounded-xl p-3">
                <p className="text-sm font-medium text-slate-800">{item.produtoNome}</p>
                <p className="text-xs text-slate-400 font-mono mb-2">{item.sku} — chegaram {item.quantidadeRecebida}</p>

                {sugestao && !editando && (
                  <p className="text-sm text-slate-600 mb-2">
                    Endereço atual: <span className="font-mono font-medium text-slate-800">{sugestao.codigoLegivel}</span>, com {sugestao.quantidadeAtual} unidade(s).
                    {' '}Guardar aqui? Ficará com {sugestao.quantidadeAtual + item.quantidadeRecebida}.
                  </p>
                )}
                {!sugestao && !editando && (
                  <p className="text-sm text-slate-500 mb-2">Sem endereço conhecido pra este produto neste depósito.</p>
                )}

                {editando && (
                  <div className="relative mb-2">
                    <input value={buscaEndereco} onChange={e => setBuscaEndereco(e.target.value)} autoFocus
                      placeholder="Buscar endereço..." className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono" />
                    {candidatos.length > 0 && (
                      <div className="absolute z-10 bg-white border border-slate-200 rounded-lg shadow-lg mt-1 w-full max-h-40 overflow-y-auto">
                        {candidatos.map(c => (
                          <button key={c.id} onClick={() => confirmarNoEndereco(item, c.id)}
                            className="block w-full text-left px-3 py-2 text-sm font-mono hover:bg-slate-50 border-b border-slate-50 last:border-0">
                            {c.codigo_legivel}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {erroPorItem[item.produtoId] && <p className="text-xs text-red-600 mb-2">{erroPorItem[item.produtoId]}</p>}

                <div className="flex gap-2 justify-end">
                  {editando ? (
                    <button onClick={() => { setEditandoId(null); setBuscaEndereco(''); setCandidatos([]) }}
                      className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700">Cancelar</button>
                  ) : (
                    <>
                      <button onClick={() => guardarDepois(item)} disabled={salvando}
                        className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50">Guardar depois</button>
                      <button onClick={() => { setEditandoId(item.produtoId); setBuscaEndereco('') }} disabled={salvando}
                        className="px-3 py-1.5 text-xs border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 disabled:opacity-50">
                        Escolher outro
                      </button>
                      {sugestao && (
                        <button onClick={() => confirmarNoEndereco(item, sugestao.id)} disabled={salvando}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg">
                          {salvando ? 'Salvando...' : 'Confirmar'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}

          {!carregandoSugestoes && pendentes.length === 0 && (
            <p className="text-center text-slate-400 py-6 text-sm">Tudo guardado.</p>
          )}
        </div>
      </div>
    </div>
  )
}
