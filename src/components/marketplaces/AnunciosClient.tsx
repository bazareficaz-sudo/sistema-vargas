'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AnuncioDetalheModal from './AnuncioDetalheModal'
import MapearAnuncioModal from './MapearAnuncioModal'
import { fmt, temDivergencia } from './utils'

const STATUS_CORES: Record<string, string> = {
  rascunho: 'bg-gray-100 text-gray-600',
  ativo:    'bg-green-100 text-green-700',
  pausado:  'bg-yellow-100 text-yellow-700',
  encerrado:'bg-red-100 text-red-600',
  erro:     'bg-red-100 text-red-700',
}
const STATUS_LABELS: Record<string, string> = {
  rascunho: 'Rascunho', ativo: 'Ativo', pausado: 'Pausado', encerrado: 'Encerrado', erro: 'Erro',
}

const FACETAS: { key: string; label: string }[] = [
  { key: 'mapeado', label: 'Mapeado' },
  { key: 'nao_mapeado', label: 'Não mapeado' },
  { key: 'sem_sku', label: 'Sem SKU' },
  { key: 'sem_estoque', label: 'Sem estoque' },
  { key: 'com_variacao', label: 'Com variações' },
  { key: 'divergente', label: 'Divergente' },
]

export default function AnunciosClient({ canal, anuncios: anunciosIniciais, produtos, empresaId, qInicial, statusInicial, operador }: {
  canal: any; anuncios: any[]; produtos: any[]; empresaId: string; qInicial: string; statusInicial: string; operador: string
}) {
  const router = useRouter()
  const [anuncios, setAnuncios] = useState(anunciosIniciais)
  const [q, setQ] = useState(qInicial)
  const [statusFiltro, setStatusFiltro] = useState(statusInicial)
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<any | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [buscaProd, setBuscaProd] = useState('')
  const [sincronizando, setSincronizando] = useState(false)
  const [resumoSync, setResumoSync] = useState('')
  const [facetas, setFacetas] = useState<Set<string>>(new Set())
  const [detalheAberto, setDetalheAberto] = useState<any | null>(null)
  const [mapeandoAberto, setMapeandoAberto] = useState<any | null>(null)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [previewMassa, setPreviewMassa] = useState<{ encontrados: any[]; naoEncontrados: any[] } | null>(null)
  const [aplicandoMassa, setAplicandoMassa] = useState(false)

  function toggleSelecionado(id: string) {
    setSelecionados(prev => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id); else novo.add(id)
      return novo
    })
  }

  async function prepararMapeamentoMassa() {
    const sb = createClient()
    const alvos = filtrados.filter(a => selecionados.has(a.id) && a.sku_canal)
    const skus = [...new Set(alvos.map(a => a.sku_canal))]
    const { data: candidatos } = skus.length > 0
      ? await sb.from('produtos').select('id, nome, sku, preco_venda, estoque').eq('empresa_id', empresaId).eq('ativo', true).in('sku', skus)
      : { data: [] as any[] }

    const encontrados: any[] = []
    const naoEncontrados: any[] = []
    for (const a of filtrados.filter(a => selecionados.has(a.id))) {
      const match = a.sku_canal ? candidatos?.find(c => c.sku === a.sku_canal) : null
      if (match) encontrados.push({ anuncio: a, produto: match })
      else naoEncontrados.push(a)
    }
    setPreviewMassa({ encontrados, naoEncontrados })
  }

  async function confirmarMapeamentoMassa() {
    if (!previewMassa) return
    setAplicandoMassa(true)
    const sb = createClient()
    for (const { anuncio, produto } of previewMassa.encontrados) {
      await sb.from('marketplace_anuncios').update({ produto_id: produto.id }).eq('id', anuncio.id)
    }
    if (previewMassa.encontrados.length > 0) {
      await sb.from('marketplace_mapeamentos').upsert(
        previewMassa.encontrados.map(({ anuncio, produto }) => ({
          empresa_id: empresaId, canal_id: canal.id, nivel: 'anuncio', chave: anuncio.sku_canal,
          anuncio_id: anuncio.id, produto_id: produto.id,
          produto_nome_snapshot: produto.nome, produto_sku_snapshot: produto.sku,
          metodo: 'automatico_sku', operador, updated_at: new Date().toISOString(),
        })),
        { onConflict: 'empresa_id,canal_id,nivel,chave' }
      )
    }
    setAnuncios(prev => prev.map(a => {
      const match = previewMassa.encontrados.find((e: any) => e.anuncio.id === a.id)
      return match ? { ...a, produto_id: match.produto.id, produtos: match.produto } : a
    }))
    setSelecionados(new Set())
    setPreviewMassa(null)
    setAplicandoMassa(false)
  }

  function alternarFaceta(key: string) {
    setFacetas(prev => {
      const novo = new Set(prev)
      if (novo.has(key)) novo.delete(key); else novo.add(key)
      return novo
    })
  }

  const formVazio = {
    produto_id: '', titulo: '', descricao: '', preco_venda: '',
    preco_promocional: '', promo_inicio: '', promo_fim: '',
    estoque_reservado: '0', id_externo: '', url_anuncio: '', sku_canal: '', status: 'rascunho',
  }
  const [form, setForm] = useState(formVazio)

  function f(k: string, v: any) { setForm(p => ({ ...p, [k]: v })) }

  function abrirNovo() {
    setEditando(null); setForm(formVazio); setBuscaProd(''); setModal(true)
  }

  function abrirEditar(a: any) {
    setEditando(a)
    setForm({
      produto_id: a.produto_id ?? '',
      titulo: a.titulo,
      descricao: a.descricao ?? '',
      preco_venda: String(a.preco_venda),
      preco_promocional: String(a.preco_promocional ?? ''),
      promo_inicio: a.promo_inicio ?? '',
      promo_fim: a.promo_fim ?? '',
      estoque_reservado: String(a.estoque_reservado ?? 0),
      id_externo: a.id_externo ?? '',
      url_anuncio: a.url_anuncio ?? '',
      sku_canal: a.sku_canal ?? '',
      status: a.status,
    })
    setBuscaProd(a.produtos?.nome ?? '')
    setModal(true)
  }

  function selecionarProduto(p: any) {
    const precoSugerido = (p.preco_venda * (1 + (canal.markup_canal ?? 0) / 100)).toFixed(2)
    f('produto_id', p.id)
    f('titulo', p.nome)
    f('preco_venda', precoSugerido)
    f('sku_canal', p.sku ?? '')
    setBuscaProd(p.nome)
  }

  async function salvar() {
    if (!form.titulo.trim()) { setErro('Título obrigatório.'); return }
    if (!form.preco_venda || parseFloat(form.preco_venda) <= 0) { setErro('Preço de venda obrigatório.'); return }
    setSalvando(true); setErro('')
    const sb = createClient()
    const payload = {
      empresa_id: empresaId,
      canal_id: canal.id,
      produto_id: form.produto_id || null,
      titulo: form.titulo.trim(),
      descricao: form.descricao || null,
      preco_venda: parseFloat(form.preco_venda),
      preco_promocional: form.preco_promocional ? parseFloat(form.preco_promocional) : null,
      promo_inicio: form.promo_inicio || null,
      promo_fim: form.promo_fim || null,
      estoque_reservado: parseInt(form.estoque_reservado) || 0,
      id_externo: form.id_externo || null,
      url_anuncio: form.url_anuncio || null,
      sku_canal: form.sku_canal || null,
      status: form.status,
    }

    if (editando) {
      const { data, error } = await sb.from('marketplace_anuncios').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editando.id).select('*, produtos(id,nome,sku,preco_venda,estoque)').single()
      if (error) { setErro(error.message); setSalvando(false); return }
      setAnuncios(prev => prev.map(a => a.id === editando.id ? data : a))
    } else {
      const { data, error } = await sb.from('marketplace_anuncios').insert(payload).select('*, produtos(id,nome,sku,preco_venda,estoque)').single()
      if (error) { setErro(error.message); setSalvando(false); return }
      setAnuncios(prev => [data, ...prev])
    }
    setSalvando(false)
    setModal(false)
    router.refresh()
  }

  async function sincronizar() {
    setSincronizando(true); setResumoSync(''); setErro('')
    try {
      const resp = await fetch('/api/marketplace/shopee/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canalId: canal.id }),
      })
      const data = await resp.json()
      if (!data.ok) { setErro(data.erro ?? 'Erro ao sincronizar'); return }
      setResumoSync(
        `Encontrados: ${data.totalFound} · Sincronizados: ${data.upserted} · Falharam: ${data.failedCount}` +
        (data.truncated ? ' · Catálogo maior que o limite — sincronize novamente para continuar' : '') +
        ' · dados importados serão sobrescritos a cada sincronização'
      )
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao sincronizar')
    } finally {
      setSincronizando(false)
      router.refresh()
    }
  }

  async function excluir(id: string) {
    if (!confirm('Excluir este anúncio?')) return
    const sb = createClient()
    await sb.from('marketplace_anuncios').delete().eq('id', id)
    setAnuncios(prev => prev.filter(a => a.id !== id))
  }

  async function alterarStatus(id: string, novoStatus: string) {
    const sb = createClient()
    await sb.from('marketplace_anuncios').update({ status: novoStatus }).eq('id', id)
    setAnuncios(prev => prev.map(a => a.id === id ? { ...a, status: novoStatus } : a))
  }

  const filtrados = anuncios.filter(a => {
    const matchQ = !q || a.titulo.toLowerCase().includes(q.toLowerCase())
    const matchS = !statusFiltro || a.status === statusFiltro
    if (!matchQ || !matchS) return false

    for (const faceta of facetas) {
      if (faceta === 'mapeado' && !a.produto_id) return false
      if (faceta === 'nao_mapeado' && a.produto_id) return false
      if (faceta === 'sem_sku' && a.sku_canal) return false
      if (faceta === 'sem_estoque' && (a.estoque_externo ?? null) !== 0) return false
      if (faceta === 'com_variacao' && !a.tem_variacao) return false
      if (faceta === 'divergente' && !temDivergencia(a)) return false
    }
    return true
  })

  // Busca produto ao vivo no banco (não filtra a lista inicial, que é só um
  // fallback pequeno) — evita não achar produtos fora de uma janela limitada
  // e permite localizar por qualquer palavra do nome/SKU, não só um trecho
  // contíguo exato.
  const [produtosFiltrados, setProdutosFiltrados] = useState<any[]>([])
  useEffect(() => {
    if (!modal) { setProdutosFiltrados([]); return }
    const termo = buscaProd.trim()
    if (termo.length < 2) { setProdutosFiltrados([]); return }
    let ativo = true
    const timer = setTimeout(async () => {
      const sb = createClient()
      const palavras = termo.toLowerCase().split(/\s+/).map(p => p.replace(/[,()%]/g, '')).filter(Boolean)
      let query = sb.from('produtos')
        .select('id, nome, sku, preco_venda, preco_custo, estoque, ativo')
        .eq('empresa_id', empresaId).eq('ativo', true).order('nome').limit(8)
      for (const palavra of palavras) {
        query = query.or(`nome.ilike.%${palavra}%,sku.ilike.%${palavra}%`)
      }
      const { data } = await query
      if (ativo) setProdutosFiltrados(data ?? [])
    }, 250)
    return () => { ativo = false; clearTimeout(timer) }
  }, [buscaProd, modal, empresaId])

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <a href="/dashboard/marketplaces" className="hover:text-gray-600">marketplaces</a><span>›</span>
        <a href={`/dashboard/marketplaces/${canal.id}`} className="hover:text-gray-600">{canal.nome}</a><span>›</span>
        <span className="text-gray-600 font-medium">anúncios</span>
      </div>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Anúncios — {canal.nome}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{anuncios.length} anúncio(s) cadastrados</p>
        </div>
        <div className="flex gap-2">
          {canal.plataforma === 'shopee' && (
            <button onClick={sincronizar} disabled={sincronizando}
              className="px-4 py-2 border border-blue-300 text-blue-600 text-sm font-medium rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors">
              {sincronizando ? 'Sincronizando...' : '↺ Sincronizar agora'}
            </button>
          )}
          <button onClick={abrirNovo}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
            + Novo anúncio
          </button>
        </div>
      </div>

      {resumoSync && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 text-xs px-4 py-2.5 rounded-lg mb-4">{resumoSync}</div>
      )}
      {erro && !modal && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-2.5 rounded-lg mb-4">{erro}</div>
      )}

      {/* Filtros */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por título..."
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 w-64 bg-white" />
        <div className="flex gap-1">
          {[['', 'Todos'], ['ativo', 'Ativos'], ['pausado', 'Pausados'], ['rascunho', 'Rascunhos'], ['encerrado', 'Encerrados']].map(([s, l]) => (
            <button key={s} onClick={() => setStatusFiltro(s)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${statusFiltro === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <span className="text-xs text-gray-400 mr-1">Filtrar:</span>
        {FACETAS.map(fac => (
          <button key={fac.key} onClick={() => alternarFaceta(fac.key)}
            className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${facetas.has(fac.key) ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
            {fac.label}
          </button>
        ))}
        {facetas.size > 0 && (
          <button onClick={() => setFacetas(new Set())} className="text-xs text-gray-400 hover:text-gray-600 ml-1">✕ limpar</button>
        )}
      </div>

      {selecionados.size > 0 && (
        <div className="flex items-center gap-3 bg-purple-50 border border-purple-200 rounded-xl px-4 py-2.5 mb-4">
          <span className="text-sm text-purple-700 font-medium">{selecionados.size} selecionado(s)</span>
          <button onClick={prepararMapeamentoMassa}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded-lg">
            Mapear selecionados por SKU
          </button>
          <button onClick={() => setSelecionados(new Set())} className="text-xs text-purple-400 hover:text-purple-600 ml-auto">✕ limpar seleção</button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 w-10">
                <input type="checkbox"
                  checked={filtrados.length > 0 && filtrados.every(a => selecionados.has(a.id))}
                  onChange={e => setSelecionados(e.target.checked ? new Set(filtrados.map(a => a.id)) : new Set())}
                  className="w-4 h-4 accent-purple-600" />
              </th>
              <th className="px-4 py-3 w-16"></th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Título / Produto</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">SKU canal</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">Estoque</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Preço venda</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Preço promo</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">Status</th>
              <th className="px-4 py-3 w-28"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtrados.map(a => (
              <tr key={a.id} className={`group hover:bg-gray-50 transition-colors ${temDivergencia(a) ? 'border-l-2 border-amber-300' : ''}`}>
                <td className="px-4 py-3">
                  <input type="checkbox" checked={selecionados.has(a.id)} onChange={() => toggleSelecionado(a.id)}
                    className="w-4 h-4 accent-purple-600" />
                </td>
                <td className="px-4 py-3">
                  {a.imagens?.[0] ? (
                    <img src={a.imagens[0]} alt="" className="w-14 h-14 rounded-lg object-contain bg-gray-50 border border-gray-200" />
                  ) : (
                    <div className="w-14 h-14 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300">📷</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900 truncate max-w-xs">{a.titulo}</p>
                  {a.produtos && <p className="text-xs text-gray-400">{a.produtos.sku} · Preço base: {fmt(a.produtos.preco_venda)}</p>}
                  {(a.marca_externa || a.categoria_externa) && (
                    <p className="text-xs text-gray-400">
                      {a.marca_externa}{a.marca_externa && a.categoria_externa && ' · '}{a.categoria_externa && `Categoria ${a.categoria_externa}`}
                    </p>
                  )}
                  <div className="flex gap-1 flex-wrap mt-0.5">
                    {a.tem_variacao && <span className="text-xs text-purple-600 bg-purple-50 border border-purple-100 px-1.5 py-0.5 rounded-full">Com variações</span>}
                    {!a.produtos && <span className="text-xs text-gray-500 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded-full">Não vinculado</span>}
                    {temDivergencia(a) && <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">⚠ Diverge do produto</span>}
                  </div>
                  {a.id_externo && <p className="text-xs text-gray-400 font-mono">ID: {a.id_externo}</p>}
                  {a.url_anuncio && (
                    <a href={a.url_anuncio} target="_blank" rel="noreferrer"
                      className="text-xs text-blue-500 hover:underline">Ver no marketplace ↗</a>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500 font-mono">{a.sku_canal || '—'}</td>
                <td className="px-4 py-3 text-right">
                  <p className="text-gray-900 font-mono text-sm">{a.estoque_reservado ?? 0}</p>
                  {a.produtos && <p className="text-xs text-gray-400">estoque: {a.produtos.estoque ?? 0}</p>}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(a.preco_venda)}</td>
                <td className="px-4 py-3 text-right">
                  {a.preco_promocional ? (
                    <div>
                      <p className="text-green-600 font-semibold">{fmt(a.preco_promocional)}</p>
                      {a.promo_fim && <p className="text-xs text-gray-400">até {new Date(a.promo_fim + 'T00:00:00').toLocaleDateString('pt-BR')}</p>}
                    </div>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-center">
                  <select value={a.status} onChange={e => alterarStatus(a.id, e.target.value)}
                    className={`text-xs font-medium px-2 py-0.5 rounded-full border-0 cursor-pointer focus:outline-none ${STATUS_CORES[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setMapeandoAberto(a)}
                      className={`text-xs font-medium ${!a.produtos ? 'text-purple-600 hover:text-purple-800' : 'text-gray-500 hover:text-gray-700'}`}>
                      Mapear
                    </button>
                    <button onClick={() => setDetalheAberto(a)} className="text-xs text-gray-600 hover:text-gray-900 font-medium">Detalhes</button>
                    <button onClick={() => abrirEditar(a)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Editar</button>
                    <button onClick={() => excluir(a.id)} className="text-xs text-red-500 hover:text-red-700">Excluir</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr><td colSpan={9} className="py-12 text-center text-gray-400">
                {anuncios.length === 0 ? 'Nenhum anúncio cadastrado.' : 'Nenhum anúncio encontrado para os filtros aplicados.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal anúncio */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h2 className="text-lg font-semibold text-gray-900">{editando ? 'Editar Anúncio' : 'Novo Anúncio'}</h2>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              {/* Produto */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Produto vinculado <span className="text-gray-400">(opcional)</span></label>
                <div className="relative">
                  <input value={buscaProd} onChange={e => { setBuscaProd(e.target.value); if (form.produto_id) f('produto_id', '') }}
                    placeholder="Buscar produto do sistema..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  {produtosFiltrados.length > 0 && !form.produto_id && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-10 overflow-hidden">
                      {produtosFiltrados.map(p => (
                        <button key={p.id} onClick={() => selecionarProduto(p)}
                          className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-gray-100 last:border-0">
                          <p className="text-sm font-medium text-gray-900">{p.nome}</p>
                          <p className="text-xs text-gray-400">{p.sku} · Venda: {fmt(p.preco_venda)} · Estoque: {p.estoque}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {form.produto_id && (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-green-600 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">✓ {buscaProd}</span>
                    <button onClick={() => { f('produto_id', ''); setBuscaProd('') }} className="text-xs text-gray-400 hover:text-gray-600">remover</button>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Título do anúncio *</label>
                <input value={form.titulo} onChange={e => f('titulo', e.target.value)}
                  placeholder="Título que aparecerá no marketplace"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Descrição</label>
                <textarea value={form.descricao} onChange={e => f('descricao', e.target.value)} rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none" />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Preço de venda (R$) *</label>
                  <input type="number" step="0.01" value={form.preco_venda} onChange={e => f('preco_venda', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Preço promocional</label>
                  <input type="number" step="0.01" value={form.preco_promocional} onChange={e => f('preco_promocional', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Estoque reservado</label>
                  <input type="number" value={form.estoque_reservado} onChange={e => f('estoque_reservado', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>

              {form.preco_promocional && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Início promoção</label>
                    <input type="date" value={form.promo_inicio} onChange={e => f('promo_inicio', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Fim promoção</label>
                    <input type="date" value={form.promo_fim} onChange={e => f('promo_fim', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">SKU no canal</label>
                  <input value={form.sku_canal} onChange={e => f('sku_canal', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">ID externo</label>
                  <input value={form.id_externo} onChange={e => f('id_externo', e.target.value)}
                    placeholder="ID do anúncio na plataforma"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                  <select value={form.status} onChange={e => f('status', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                    {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">URL do anúncio</label>
                <input type="url" value={form.url_anuncio} onChange={e => f('url_anuncio', e.target.value)}
                  placeholder="https://..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>

              {erro && <p className="text-sm text-red-600">{erro}</p>}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setModal(false)} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={salvar} disabled={salvando}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {salvando ? 'Salvando...' : editando ? 'Salvar alterações' : 'Criar anúncio'}
              </button>
            </div>
          </div>
        </div>
      )}

      {detalheAberto && (
        <AnuncioDetalheModal
          anuncio={detalheAberto}
          canal={canal}
          onClose={() => setDetalheAberto(null)}
          onAtualizado={(anuncioAtualizado) => {
            setAnuncios(prev => prev.map(a => a.id === anuncioAtualizado.id ? anuncioAtualizado : a))
            setDetalheAberto(anuncioAtualizado)
          }}
        />
      )}

      {mapeandoAberto && (
        <MapearAnuncioModal
          anuncio={mapeandoAberto}
          canal={canal}
          empresaId={empresaId}
          operador={operador}
          onClose={() => setMapeandoAberto(null)}
          onAtualizado={(anuncioAtualizado) => {
            setAnuncios(prev => prev.map(a => a.id === anuncioAtualizado.id ? anuncioAtualizado : a))
            setMapeandoAberto(anuncioAtualizado)
          }}
        />
      )}

      {previewMassa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPreviewMassa(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[80vh] overflow-y-auto flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h2 className="text-lg font-semibold text-gray-900">Mapear em massa por SKU</h2>
              <button onClick={() => setPreviewMassa(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-sm text-gray-600">
                <span className="text-emerald-600 font-medium">{previewMassa.encontrados.length} encontrado(s)</span>
                {' · '}
                <span className="text-gray-400">{previewMassa.naoEncontrados.length} sem produto com SKU correspondente</span>
              </p>
              {previewMassa.encontrados.length > 0 && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  {previewMassa.encontrados.map(({ anuncio, produto }: any) => (
                    <div key={anuncio.id} className="px-4 py-2.5 border-b border-gray-100 last:border-0 flex items-center justify-between text-sm">
                      <span className="text-gray-700 truncate max-w-[45%]">{anuncio.titulo}</span>
                      <span className="text-gray-400">→</span>
                      <span className="text-emerald-700 font-medium truncate max-w-[45%]">{produto.nome}</span>
                    </div>
                  ))}
                </div>
              )}
              {previewMassa.naoEncontrados.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Sem correspondência (não serão alterados):</p>
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    {previewMassa.naoEncontrados.map((a: any) => (
                      <div key={a.id} className="px-4 py-2 border-b border-gray-100 last:border-0 text-xs text-gray-500">{a.titulo} — SKU: {a.sku_canal || '—'}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setPreviewMassa(null)} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={confirmarMapeamentoMassa} disabled={aplicandoMassa || previewMassa.encontrados.length === 0}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {aplicandoMassa ? 'Aplicando...' : `Confirmar mapeamento (${previewMassa.encontrados.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
