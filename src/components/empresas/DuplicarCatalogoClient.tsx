'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Duplica produtos da empresa ativa para a empresa parceira — pra que ela
// tenha catálogo PRÓPRIO (vender, receber XML, transferir estoque) em vez
// de depender do cadastro da outra.
//
// O que fica de fora do produto clonado, de propósito, e por quê, está
// documentado em src/lib/produtos/clonarParaEmpresa.ts — aqui a tela só
// mostra o resultado, não decide regra fiscal nenhuma.

type Categoria = { id: string; nome: string; pai_id: string | null }
type ProdutoBusca = { id: string; nome: string; sku: string | null; categoria: string | null }

type ResultadoLote = { clonados: number; jaExistiam: number; falhas: number; erros: { produtoId: string; erro: string }[]; restantes: number; concluido: boolean }

export default function DuplicarCatalogoClient({ parceriaId, empresaId, empresaParceiraNome, categorias }: {
  parceriaId: string
  empresaId: string
  empresaParceiraNome: string
  categorias: Categoria[]
}) {
  const [categoriaFiltro, setCategoriaFiltro] = useState('')
  const [subcategoriaFiltro, setSubcategoriaFiltro] = useState('')
  const [tagFiltro, setTagFiltro] = useState('')
  const [buscaFiltro, setBuscaFiltro] = useState('')

  const categoriasTopo = categorias.filter(c => !c.pai_id)
  const subcategoriasDaEscolhida = categorias.filter(c => {
    const pai = categorias.find(p => p.nome === categoriaFiltro && !p.pai_id)
    return pai && c.pai_id === pai.id
  })
  function mudarCategoria(nome: string) { setCategoriaFiltro(nome); setSubcategoriaFiltro('') }

  const [contando, setContando] = useState(false)
  const [elegiveis, setElegiveis] = useState<number | null>(null)

  async function contarElegiveis() {
    setContando(true); setElegiveis(null)
    const sb = createClient()
    let q = sb.from('produtos').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('ativo', true).neq('tipo', 'kit')
    if (categoriaFiltro) q = q.eq('categoria', categoriaFiltro)
    if (subcategoriaFiltro) q = q.eq('subcategoria', subcategoriaFiltro)
    if (tagFiltro.trim()) q = q.contains('tags', [tagFiltro.trim()])
    if (buscaFiltro.trim()) q = q.or(`nome.ilike.%${buscaFiltro.trim()}%,sku.ilike.%${buscaFiltro.trim()}%`)
    const { count } = await q
    setElegiveis(count ?? 0)
    setContando(false)
  }

  // ── Seleção manual (alternativa a "duplicar tudo com o filtro") ──
  const [buscaManual, setBuscaManual] = useState('')
  const [buscandoManual, setBuscandoManual] = useState(false)
  const [resultadosManual, setResultadosManual] = useState<ProdutoBusca[]>([])
  const [selecionados, setSelecionados] = useState<Map<string, ProdutoBusca>>(new Map())

  const timerBusca = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  function buscarManual(termo: string) {
    setBuscaManual(termo)
    clearTimeout(timerBusca.current)
    if (termo.trim().length < 2) { setResultadosManual([]); return }
    setBuscandoManual(true)
    timerBusca.current = setTimeout(async () => {
      const sb = createClient()
      const { data } = await sb.from('produtos')
        .select('id, nome, sku, categoria').eq('empresa_id', empresaId).eq('ativo', true).neq('tipo', 'kit')
        .or(`nome.ilike.%${termo.trim()}%,sku.ilike.%${termo.trim()}%`).limit(30)
      setResultadosManual(data ?? [])
      setBuscandoManual(false)
    }, 350)
  }
  function alternarSelecao(p: ProdutoBusca) {
    setSelecionados(prev => {
      const n = new Map(prev)
      if (n.has(p.id)) n.delete(p.id); else n.set(p.id, p)
      return n
    })
  }

  // ── Execução ──────────────────────────────────────────────────
  const [rodando, setRodando] = useState(false)
  const [progresso, setProgresso] = useState<{ clonados: number; jaExistiam: number; falhas: number; erros: { produtoId: string; erro: string }[] } | null>(null)
  const [erroGeral, setErroGeral] = useState('')

  async function chamarLote(corpo: Record<string, unknown>): Promise<ResultadoLote> {
    const resp = await fetch(`/api/empresas/parcerias/${parceriaId}/clonar-produtos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
    })
    const d = await resp.json()
    if (!d.ok) throw new Error(d.erro ?? 'Falha ao duplicar.')
    return d
  }

  async function duplicarComFiltro() {
    setRodando(true); setErroGeral(''); setProgresso({ clonados: 0, jaExistiam: 0, falhas: 0, erros: [] })
    try {
      let concluido = false
      while (!concluido) {
        const r = await chamarLote({ categoria: categoriaFiltro || undefined, subcategoria: subcategoriaFiltro || undefined, tag: tagFiltro || undefined, busca: buscaFiltro || undefined })
        setProgresso(prev => ({
          clonados: (prev?.clonados ?? 0) + r.clonados, jaExistiam: (prev?.jaExistiam ?? 0) + r.jaExistiam, falhas: (prev?.falhas ?? 0) + r.falhas,
          erros: [...(prev?.erros ?? []), ...r.erros].slice(0, 30),
        }))
        concluido = r.concluido
        // Sem produtos pendentes desde o começo — evita loop eterno se o
        // filtro não achar nada pra clonar.
        if (r.clonados === 0 && r.jaExistiam === 0 && r.falhas === 0 && !r.concluido) break
      }
    } catch (e) {
      setErroGeral(e instanceof Error ? e.message : 'Falha de rede.')
    } finally {
      setRodando(false)
    }
  }

  async function duplicarSelecionados() {
    if (selecionados.size === 0) return
    setRodando(true); setErroGeral(''); setProgresso(null)
    try {
      const r = await chamarLote({ produtoIds: [...selecionados.keys()] })
      setProgresso({ clonados: r.clonados, jaExistiam: r.jaExistiam, falhas: r.falhas, erros: r.erros })
      setSelecionados(new Map())
      setResultadosManual([])
      setBuscaManual('')
    } catch (e) {
      setErroGeral(e instanceof Error ? e.message : 'Falha de rede.')
    } finally {
      setRodando(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 pb-28">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Duplicar catálogo — {empresaParceiraNome}</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Cria o produto na {empresaParceiraNome}, já vinculado ao seu. Estoque nasce zerado — quem põe estoque lá é a
          Transferência de Estoque ou uma entrada de verdade. Campos fiscais de regime (CSOSN/CST, PIS/COFINS) são
          recalculados para o regime tributário da {empresaParceiraNome}, nunca copiados do seu.
        </p>
      </div>

      {erroGeral && <div className="px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{erroGeral}</div>}

      {/* ── Duplicar por filtro ─────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <p className="text-sm font-medium text-gray-700">Duplicar por categoria, tag ou busca</p>
        <div className="flex flex-wrap gap-2">
          <select value={categoriaFiltro} onChange={e => mudarCategoria(e.target.value)}
            className="border border-gray-300 rounded-lg px-2.5 py-2 text-xs">
            <option value="">Todas as categorias</option>
            {categoriasTopo.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
          </select>
          {subcategoriasDaEscolhida.length > 0 && (
            <select value={subcategoriaFiltro} onChange={e => setSubcategoriaFiltro(e.target.value)}
              className="border border-gray-300 rounded-lg px-2.5 py-2 text-xs">
              <option value="">Todas as subcategorias</option>
              {subcategoriasDaEscolhida.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
            </select>
          )}
          <input value={tagFiltro} onChange={e => setTagFiltro(e.target.value)} placeholder="Tag exata..."
            className="w-32 border border-gray-300 rounded-lg px-2.5 py-2 text-xs" />
          <input value={buscaFiltro} onChange={e => setBuscaFiltro(e.target.value)} placeholder="Nome ou SKU..."
            className="flex-1 min-w-[160px] border border-gray-300 rounded-lg px-2.5 py-2 text-xs" />
        </div>

        <div className="flex items-center gap-3">
          <button onClick={contarElegiveis} disabled={contando}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-xs font-medium hover:bg-gray-50 disabled:opacity-50">
            {contando ? 'Contando...' : 'Contar produtos com este filtro'}
          </button>
          {elegiveis !== null && <span className="text-xs text-gray-500">{elegiveis} produto(s) ativo(s) encontrados (sem filtro = catálogo inteiro).</span>}
        </div>

        <button onClick={duplicarComFiltro} disabled={rodando}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
          {rodando ? 'Duplicando...' : (categoriaFiltro || subcategoriaFiltro || tagFiltro || buscaFiltro) ? 'Duplicar produtos com este filtro' : 'Duplicar o catálogo inteiro'}
        </button>
        <p className="text-[11px] text-gray-400">
          Sem categoria/tag/busca escolhida, isto processa TODOS os produtos ativos (exceto kits). Roda em lotes —
          pode levar alguns minutos num catálogo grande; a página mostra o progresso conforme avança.
        </p>
      </div>

      {/* ── Duplicar produtos específicos ────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <p className="text-sm font-medium text-gray-700">Ou escolher produtos específicos</p>
        <input value={buscaManual} onChange={e => buscarManual(e.target.value)} placeholder="Buscar por nome ou SKU..."
          className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        {buscandoManual && <p className="text-xs text-gray-400">Buscando...</p>}
        {resultadosManual.length > 0 && (
          <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {resultadosManual.map(p => (
              <button key={p.id} onClick={() => alternarSelecao(p)}
                className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 ${selecionados.has(p.id) ? 'bg-emerald-50' : ''}`}>
                <span className="text-sm text-gray-700 truncate">{p.nome} <span className="text-gray-400 text-xs">{p.sku ?? ''}</span></span>
                <span className="text-xs text-gray-500 shrink-0 ml-2">{selecionados.has(p.id) ? '✓ selecionado' : '+ selecionar'}</span>
              </button>
            ))}
          </div>
        )}
        {selecionados.size > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">{selecionados.size} produto(s) selecionado(s)</span>
            <button onClick={duplicarSelecionados} disabled={rodando}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 disabled:opacity-50">
              {rodando ? 'Duplicando...' : `Duplicar ${selecionados.size} selecionado(s)`}
            </button>
          </div>
        )}
      </div>

      {/* ── Progresso / resultado ────────────────────────────────── */}
      {progresso && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-sm font-medium text-gray-800 mb-2">
            {progresso.clonados} criado(s){progresso.jaExistiam > 0 && `, ${progresso.jaExistiam} já existiam`}{progresso.falhas > 0 && `, ${progresso.falhas} com problema`}
          </p>
          {progresso.erros.length > 0 && (
            <div className="space-y-0.5">
              {progresso.erros.map((e, i) => <p key={i} className="text-xs text-red-600">✕ {e.erro}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
