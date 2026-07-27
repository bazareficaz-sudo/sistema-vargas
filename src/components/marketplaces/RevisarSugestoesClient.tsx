'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

type Candidato = {
  tipo: 'anuncio' | 'variacao'; id: string; canalId: string; canalNome: string; plataforma: string
  titulo: string; chave: string; produtoId: string; produtoNome: string; produtoSku: string | null
  metodo: 'sku' | 'ean'; score: number
}
type Resumo = { totalCandidatos: number; altaConfianca: number; revisarComAtencao: number; limiarAltaConfianca: number }
type Canal = { id: string; nome: string; plataforma: string }

const PAGE_SIZE = 50

function chaveItem(c: Candidato) { return `${c.tipo}:${c.id}` }

export default function RevisarSugestoesClient() {
  const [page, setPage] = useState(1)
  const [canalId, setCanalId] = useState('')
  const [confianca, setConfianca] = useState('')
  const [ordem, setOrdem] = useState<'asc' | 'desc'>('asc')

  const [itens, setItens] = useState<Candidato[]>([])
  const [canais, setCanais] = useState<Canal[]>([])
  const [total, setTotal] = useState(0)
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [mensagem, setMensagem] = useState('')
  const [aplicando, setAplicando] = useState(false)

  const [selecionados, setSelecionados] = useState<Map<string, Candidato>>(new Map())

  function avisar(msg: string) { setMensagem(msg); setTimeout(() => setMensagem(''), 5000) }

  const carregar = useCallback(async () => {
    setCarregando(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), ordem })
    if (canalId) params.set('canalId', canalId)
    if (confianca) params.set('confianca', confianca)
    const res = await fetch(`/api/marketplaces/mapa-anuncios/sugestoes?${params}`)
    const data = await res.json()
    setCarregando(false)
    if (!data.ok) { avisar(data.erro ?? 'Erro ao carregar sugestões'); return }
    setItens(data.itens)
    setCanais(data.canais)
    setTotal(data.total)
    setResumo(data.resumo)

    // pré-seleção: alta confiança já vem marcada, sem sobrescrever escolha manual prévia
    setSelecionados(prev => {
      const novo = new Map(prev)
      for (const c of data.itens as Candidato[]) {
        const k = chaveItem(c)
        if (!novo.has(k) && c.score >= data.resumo.limiarAltaConfianca) novo.set(k, c)
      }
      return novo
    })
  }, [page, canalId, confianca, ordem])

  useEffect(() => { carregar() }, [carregar])

  function alternar(c: Candidato) {
    setSelecionados(prev => {
      const novo = new Map(prev)
      const k = chaveItem(c)
      if (novo.has(k)) novo.delete(k); else novo.set(k, c)
      return novo
    })
  }

  function marcarPagina(marcar: boolean) {
    setSelecionados(prev => {
      const novo = new Map(prev)
      for (const c of itens) {
        const k = chaveItem(c)
        if (marcar) novo.set(k, c); else novo.delete(k)
      }
      return novo
    })
  }

  async function aplicarSelecionados() {
    if (selecionados.size === 0) return
    setAplicando(true)
    const itensBody = [...selecionados.values()].map(c => ({ tipo: c.tipo, id: c.id, produtoId: c.produtoId }))
    const res = await fetch('/api/marketplaces/mapa-anuncios/sugestoes/aplicar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itens: itensBody }),
    })
    const data = await res.json()
    setAplicando(false)
    if (!data.ok) { avisar(data.erro ?? 'Erro ao aplicar'); return }
    avisar(`${data.aplicados} vínculo(s) aplicado(s) com sucesso.`)
    setSelecionados(new Map())
    await carregar()
  }

  const selecionadosNestaPagina = itens.filter(c => selecionados.has(chaveItem(c))).length

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 pb-28">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Revisar sugestões de mapeamento</h1>
          <p className="text-sm text-gray-500">Candidatos por SKU/EAN exato — confira o título antes de aplicar, SKU sozinho pode coincidir por acaso.</p>
        </div>
        <Link href="/dashboard/mapa-anuncios" className="text-sm text-blue-600 hover:underline">← Voltar ao Mapa de Anúncios</Link>
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

      <div className="flex flex-wrap items-center gap-2">
        <select value={canalId} onChange={e => { setCanalId(e.target.value); setPage(1) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Todos os canais</option>
          {canais.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select value={confianca} onChange={e => { setConfianca(e.target.value); setPage(1) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Todas as confianças</option>
          <option value="alta">🟢 Alta confiança</option>
          <option value="atencao">🟡 Revisar com atenção</option>
        </select>
        <select value={ordem} onChange={e => { setOrdem(e.target.value as 'asc' | 'desc'); setPage(1) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="asc">Score: mais arriscado primeiro</option>
          <option value="desc">Score: mais confiável primeiro</option>
        </select>
        <div className="flex-1" />
        <button onClick={() => marcarPagina(true)} className="text-xs text-blue-600 hover:underline">Marcar página</button>
        <button onClick={() => marcarPagina(false)} className="text-xs text-gray-500 hover:underline">Desmarcar página</button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {carregando ? (
          <div className="p-8 text-center text-sm text-gray-400">Carregando…</div>
        ) : itens.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">Nenhuma sugestão pendente com esses filtros.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="w-10 px-4 py-2"></th>
                <th className="text-left px-2 py-2">Canal</th>
                <th className="text-left px-2 py-2">Anúncio</th>
                <th className="text-center px-2 py-2">→</th>
                <th className="text-left px-2 py-2">Produto sugerido</th>
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
                    <td className="px-4 py-2.5">
                      <input type="checkbox" checked={marcado} onChange={() => alternar(c)} className="w-4 h-4" />
                    </td>
                    <td className="px-2 py-2.5 text-xs text-gray-500">{c.canalNome}</td>
                    <td className="px-2 py-2.5">
                      <p className="text-gray-800 truncate max-w-xs">{c.titulo || '(sem título)'}</p>
                      <p className="text-xs text-gray-400">{c.metodo === 'sku' ? 'SKU' : 'EAN'} {c.chave}</p>
                    </td>
                    <td className="text-center text-gray-300">→</td>
                    <td className="px-2 py-2.5">
                      <p className="text-gray-800 truncate max-w-xs">{c.produtoNome}</p>
                      <p className="text-xs text-gray-400">SKU {c.produtoSku ?? '—'}</p>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${
                        alta ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-amber-50 text-amber-600 border-amber-200'
                      }`}>
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
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40">← Anterior</button>
          <span className="text-gray-500">Página {page} de {Math.ceil(total / PAGE_SIZE)} ({total} itens)</span>
          <button disabled={page >= Math.ceil(total / PAGE_SIZE)} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40">Próxima →</button>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between shadow-lg">
        <p className="text-sm text-gray-600">
          <strong>{selecionados.size}</strong> selecionado(s) no total {selecionadosNestaPagina < selecionados.size && `(${selecionadosNestaPagina} nesta página)`}
        </p>
        <button onClick={aplicarSelecionados} disabled={selecionados.size === 0 || aplicando}
          className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40">
          {aplicando ? 'Aplicando…' : `Aplicar ${selecionados.size} selecionado(s)`}
        </button>
      </div>
    </div>
  )
}
