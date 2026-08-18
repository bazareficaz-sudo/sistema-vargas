'use client'

import { useState, useEffect, useCallback } from 'react'

type Deposito = { id: string; nome: string; principal: boolean }
type Item = { produtoId: string; produto: { nome: string; sku: string | null } | null; estoqueTotal: number; enderecado: number; naoEnderecado: number }
type Endereco = { id: string; codigo_legivel: string }

export default function ProdutosSemEnderecoClient({ depositos, depositoIdInicial }: {
  depositos: Deposito[]; depositoIdInicial: string
}) {
  const [depositoId, setDepositoId] = useState(depositoIdInicial || depositos.find(d => d.principal)?.id || depositos[0]?.id || '')
  const [itens, setItens] = useState<Item[]>([])
  const [resumo, setResumo] = useState({ totalProdutosSemEndereco: 0, totalUnidadesNaoEnderecadas: 0 })
  const [carregando, setCarregando] = useState(false)

  const [alvo, setAlvo] = useState<Item | null>(null)
  const [buscaEndereco, setBuscaEndereco] = useState('')
  const [candidatos, setCandidatos] = useState<Endereco[]>([])
  const [enderecoEscolhido, setEnderecoEscolhido] = useState<Endereco | null>(null)
  const [quantidade, setQuantidade] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState('')

  const carregar = useCallback(async () => {
    if (!depositoId) return
    setCarregando(true)
    const r = await fetch(`/api/enderecamento/nao-enderecado?depositoId=${depositoId}`).then(r => r.json()).catch(() => null)
    setItens(r?.ok ? r.produtos : [])
    if (r?.ok) setResumo({ totalProdutosSemEndereco: r.totalProdutosSemEndereco, totalUnidadesNaoEnderecadas: r.totalUnidadesNaoEnderecadas })
    setCarregando(false)
  }, [depositoId])

  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    if (!alvo || !buscaEndereco) { setCandidatos([]); return }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/enderecamento/enderecos?depositoId=${depositoId}&status=ativo&busca=${encodeURIComponent(buscaEndereco)}`).then(r => r.json()).catch(() => null)
      setCandidatos(r?.ok ? r.enderecos.slice(0, 8) : [])
    }, 250)
    return () => clearTimeout(t)
  }, [buscaEndereco, alvo, depositoId])

  function abrirModal(item: Item) {
    setAlvo(item); setBuscaEndereco(''); setCandidatos([]); setEnderecoEscolhido(null)
    setQuantidade(String(item.naoEnderecado)); setErroModal('')
  }

  async function confirmar() {
    if (!alvo || !enderecoEscolhido || !quantidade) return
    setSalvando(true); setErroModal('')
    const r = await fetch('/api/enderecamento/produtos/ajustar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositoId, enderecoId: enderecoEscolhido.id, produtoId: alvo.produtoId, novaQuantidade: Number(quantidade) }),
    }).then(r => r.json()).catch(() => ({ ok: false }))
    setSalvando(false)
    if (!r.ok) { setErroModal(r.erro ?? 'Erro ao endereçar.'); return }
    setAlvo(null)
    carregar()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-slate-900 text-xl font-bold">Produtos sem Endereço</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {resumo.totalProdutosSemEndereco} produto(s) totalmente sem endereço · {resumo.totalUnidadesNaoEnderecadas} unidade(s) não endereçadas ao todo.
          </p>
        </div>
        {depositos.length > 0 && (
          <select value={depositoId} onChange={e => setDepositoId(e.target.value)}
            className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-sm shadow-sm">
            {depositos.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
        )}
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Produto</th>
              <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500 uppercase">Estoque total</th>
              <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500 uppercase">Endereçado</th>
              <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500 uppercase">Não endereçado</th>
              <th className="text-right px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {carregando && <tr><td colSpan={5} className="py-8 text-center text-slate-400">Carregando...</td></tr>}
            {!carregando && itens.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-slate-400">Tudo endereçado — nada pendente aqui.</td></tr>}
            {itens.map(it => (
              <tr key={it.produtoId} className="hover:bg-slate-50/50">
                <td className="px-4 py-2.5">
                  <p className="text-slate-800 font-medium">{it.produto?.nome}</p>
                  <p className="text-xs text-slate-400 font-mono">{it.produto?.sku}</p>
                </td>
                <td className="px-3 py-2.5 text-right text-slate-600">{it.estoqueTotal}</td>
                <td className="px-3 py-2.5 text-right text-slate-600">{it.enderecado}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-amber-600">{it.naoEnderecado}</td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => abrirModal(it)} className="text-xs text-blue-600 hover:underline">Endereçar agora</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {alvo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setAlvo(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900 mb-1">Endereçar produto</h2>
            <p className="text-sm text-slate-500 mb-4">{alvo.produto?.nome} — {alvo.naoEnderecado} unidade(s) sem endereço</p>

            <div className="relative mb-3">
              <label className="block text-xs font-medium text-slate-600 mb-1">Endereço</label>
              <input value={buscaEndereco} onChange={e => { setBuscaEndereco(e.target.value); setEnderecoEscolhido(null) }}
                placeholder="Código do endereço..." className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono" />
              {candidatos.length > 0 && !enderecoEscolhido && (
                <div className="absolute z-10 bg-white border border-slate-200 rounded-lg shadow-lg mt-1 w-full max-h-40 overflow-y-auto">
                  {candidatos.map(c => (
                    <button key={c.id} onClick={() => { setEnderecoEscolhido(c); setBuscaEndereco(c.codigo_legivel); setCandidatos([]) }}
                      className="block w-full text-left px-3 py-2 text-sm font-mono hover:bg-slate-50 border-b border-slate-50 last:border-0">
                      {c.codigo_legivel}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-600 mb-1">Quantidade</label>
              <input type="number" min={1} max={alvo.naoEnderecado} value={quantidade} onChange={e => setQuantidade(e.target.value)}
                className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>

            {erroModal && <p className="text-sm text-red-600 mb-3">{erroModal}</p>}

            <div className="flex gap-2 justify-end">
              <button onClick={() => setAlvo(null)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">Cancelar</button>
              <button onClick={confirmar} disabled={salvando || !enderecoEscolhido || !quantidade}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                {salvando ? 'Salvando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
