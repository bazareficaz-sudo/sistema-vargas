'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

type Candidato = {
  produtoIdA: string; nomeA: string; skuA: string | null
  produtoIdB: string; nomeB: string; skuB: string | null
  metodo: 'sku' | 'ean'; score: number
}
type Resumo = { totalCandidatos: number; altaConfianca: number; revisarComAtencao: number; limiarAltaConfianca: number }
type ProdutoBusca = { id: string; nome: string; sku: string | null; ean: string | null }

const PAGE_SIZE = 50

function chaveItem(c: Candidato) { return `${c.produtoIdA}:${c.produtoIdB}` }

export default function RevisarVinculosClient({ parceriaId, empresaParceiraNome, minhaEmpresaEhA }: {
  parceriaId: string; empresaId: string; empresaParceiraId: string; empresaParceiraNome: string; minhaEmpresaEhA: boolean
}) {
  const [page, setPage] = useState(1)
  const [ordem, setOrdem] = useState<'asc' | 'desc'>('asc')
  const [itens, setItens] = useState<Candidato[]>([])
  const [total, setTotal] = useState(0)
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [mensagem, setMensagem] = useState('')
  const [aplicando, setAplicando] = useState(false)
  const [selecionados, setSelecionados] = useState<Map<string, Candidato>>(new Map())

  // vínculo manual
  const [buscaA, setBuscaA] = useState('')
  const [buscaB, setBuscaB] = useState('')
  const [resultadosA, setResultadosA] = useState<ProdutoBusca[]>([])
  const [resultadosB, setResultadosB] = useState<ProdutoBusca[]>([])
  const [escolhidoA, setEscolhidoA] = useState<ProdutoBusca | null>(null)
  const [escolhidoB, setEscolhidoB] = useState<ProdutoBusca | null>(null)

  function avisar(msg: string) { setMensagem(msg); setTimeout(() => setMensagem(''), 5000) }

  const rotuloMeu = minhaEmpresaEhA ? 'Meu produto' : `Produto (${empresaParceiraNome})`
  const rotuloParceiro = minhaEmpresaEhA ? `Produto (${empresaParceiraNome})` : 'Meu produto'

  const carregar = useCallback(async () => {
    setCarregando(true)
    const res = await fetch(`/api/empresas/parcerias/${parceriaId}/sugestoes-vinculo?page=${page}&pageSize=${PAGE_SIZE}&ordem=${ordem}`)
    const data = await res.json()
    setCarregando(false)
    if (!data.ok) { avisar(data.erro ?? 'Erro ao carregar sugestões'); return }
    setItens(data.itens); setTotal(data.total); setResumo(data.resumo)
    setSelecionados(prev => {
      const novo = new Map(prev)
      for (const c of data.itens as Candidato[]) {
        const k = chaveItem(c)
        if (!novo.has(k) && c.score >= data.resumo.limiarAltaConfianca) novo.set(k, c)
      }
      return novo
    })
  }, [parceriaId, page, ordem])

  useEffect(() => { carregar() }, [carregar])

  function alternar(c: Candidato) {
    setSelecionados(prev => {
      const novo = new Map(prev)
      const k = chaveItem(c)
      if (novo.has(k)) novo.delete(k); else novo.set(k, c)
      return novo
    })
  }

  async function aplicarSelecionados() {
    if (selecionados.size === 0) return
    setAplicando(true)
    const itensBody = [...selecionados.values()].map(c => ({ produtoIdA: c.produtoIdA, produtoIdB: c.produtoIdB, metodo: c.metodo === 'ean' ? 'automatico_ean' : 'automatico_sku' }))
    const res = await fetch(`/api/empresas/parcerias/${parceriaId}/vinculos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itens: itensBody }),
    })
    const data = await res.json()
    setAplicando(false)
    if (!data.ok) { avisar(data.erro ?? 'Erro ao aplicar'); return }
    avisar(`${data.aplicados} vínculo(s) criado(s).`)
    setSelecionados(new Map())
    await carregar()
  }

  function buscarProduto(lado: 'a' | 'b', termo: string) {
    if (lado === 'a') setBuscaA(termo); else setBuscaB(termo)
    if (termo.trim().length < 2) { lado === 'a' ? setResultadosA([]) : setResultadosB([]); return }
    fetch(`/api/empresas/parcerias/${parceriaId}/buscar-produto?lado=${lado}&q=${encodeURIComponent(termo)}`)
      .then(r => r.json())
      .then(data => { if (data.ok) (lado === 'a' ? setResultadosA : setResultadosB)(data.resultados) })
  }

  async function vincularManual() {
    if (!escolhidoA || !escolhidoB) return
    const res = await fetch(`/api/empresas/parcerias/${parceriaId}/vinculos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itens: [{ produtoIdA: escolhidoA.id, produtoIdB: escolhidoB.id, metodo: 'manual' }] }),
    })
    const data = await res.json()
    if (!data.ok) { avisar(data.erro ?? 'Erro ao vincular'); return }
    avisar('Produtos vinculados com sucesso.')
    setEscolhidoA(null); setEscolhidoB(null); setBuscaA(''); setBuscaB('')
    await carregar()
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 pb-28">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Vínculos de produto — {empresaParceiraNome}</h1>
          <p className="text-sm text-gray-500">Candidatos por SKU/EAN exato — confira o nome antes de vincular, SKU sozinho pode coincidir por acaso.</p>
        </div>
        <Link href="/dashboard/empresas/parcerias" className="text-sm text-blue-600 hover:underline">← Voltar às parcerias</Link>
      </div>

      {mensagem && <div className="px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg">{mensagem}</div>}

      {resumo && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500">Total de candidatos</p>
            <p className="text-2xl font-semibold text-gray-900">{resumo.totalCandidatos}</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <p className="text-xs text-emerald-700">🟢 Alta confiança</p>
            <p className="text-2xl font-semibold text-emerald-700">{resumo.altaConfianca}</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-xs text-amber-700">🟡 Revisar com atenção</p>
            <p className="text-2xl font-semibold text-amber-700">{resumo.revisarComAtencao}</p>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <p className="text-sm font-medium text-gray-700">Vincular manualmente</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="relative">
            <p className="text-xs text-gray-500 mb-1">{rotuloMeu}</p>
            {escolhidoA ? (
              <div className="flex items-center justify-between border border-blue-200 bg-blue-50 rounded-lg px-3 py-2 text-sm">
                <span>{escolhidoA.nome}</span>
                <button onClick={() => setEscolhidoA(null)} className="text-blue-600 text-xs">trocar</button>
              </div>
            ) : (
              <>
                <input value={buscaA} onChange={e => buscarProduto('a', e.target.value)} placeholder="Buscar por nome, SKU ou EAN..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                {resultadosA.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    {resultadosA.map(p => (
                      <button key={p.id} onClick={() => { setEscolhidoA(p); setResultadosA([]) }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b border-gray-50 last:border-0">
                        {p.nome} <span className="text-xs text-gray-400">{p.sku ?? '—'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="relative">
            <p className="text-xs text-gray-500 mb-1">{rotuloParceiro}</p>
            {escolhidoB ? (
              <div className="flex items-center justify-between border border-blue-200 bg-blue-50 rounded-lg px-3 py-2 text-sm">
                <span>{escolhidoB.nome}</span>
                <button onClick={() => setEscolhidoB(null)} className="text-blue-600 text-xs">trocar</button>
              </div>
            ) : (
              <>
                <input value={buscaB} onChange={e => buscarProduto('b', e.target.value)} placeholder="Buscar por nome, SKU ou EAN..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                {resultadosB.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    {resultadosB.map(p => (
                      <button key={p.id} onClick={() => { setEscolhidoB(p); setResultadosB([]) }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b border-gray-50 last:border-0">
                        {p.nome} <span className="text-xs text-gray-400">{p.sku ?? '—'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex justify-end">
          <button onClick={vincularManual} disabled={!escolhidoA || !escolhidoB}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-900 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
            Vincular estes dois
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <select value={ordem} onChange={e => { setOrdem(e.target.value as 'asc' | 'desc'); setPage(1) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="asc">Score: mais arriscado primeiro</option>
          <option value="desc">Score: mais confiável primeiro</option>
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {carregando ? (
          <div className="p-8 text-center text-sm text-gray-400">Carregando…</div>
        ) : itens.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">Nenhuma sugestão de vínculo pendente.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="w-10 px-4 py-2"></th>
                <th className="text-left px-2 py-2">{rotuloMeu}</th>
                <th className="text-center px-2 py-2">→</th>
                <th className="text-left px-2 py-2">{rotuloParceiro}</th>
                <th className="text-left px-2 py-2">Confiança</th>
              </tr>
            </thead>
            <tbody>
              {itens.map(c => {
                const k = chaveItem(c)
                const marcado = selecionados.has(k)
                const alta = c.score >= (resumo?.limiarAltaConfianca ?? 50)
                return (
                  <tr key={k} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2.5"><input type="checkbox" checked={marcado} onChange={() => alternar(c)} className="w-4 h-4" /></td>
                    <td className="px-2 py-2.5">
                      <p className="text-gray-800 truncate max-w-xs">{c.nomeA}</p>
                      <p className="text-xs text-gray-400">SKU {c.skuA ?? '—'}</p>
                    </td>
                    <td className="text-center text-gray-300">→</td>
                    <td className="px-2 py-2.5">
                      <p className="text-gray-800 truncate max-w-xs">{c.nomeB}</p>
                      <p className="text-xs text-gray-400">SKU {c.skuB ?? '—'}</p>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${alta ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
                        {alta ? '🟢' : '🟡'} {c.score}%
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40">← Anterior</button>
          <span className="text-gray-500">Página {page} de {Math.ceil(total / PAGE_SIZE)} ({total} itens)</span>
          <button disabled={page >= Math.ceil(total / PAGE_SIZE)} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40">Próxima →</button>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between shadow-lg">
        <p className="text-sm text-gray-600"><strong>{selecionados.size}</strong> selecionado(s)</p>
        <button onClick={aplicarSelecionados} disabled={selecionados.size === 0 || aplicando}
          className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40">
          {aplicando ? 'Vinculando…' : `Vincular ${selecionados.size} selecionado(s)`}
        </button>
      </div>
    </div>
  )
}
