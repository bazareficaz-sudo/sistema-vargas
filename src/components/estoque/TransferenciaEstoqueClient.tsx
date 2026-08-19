'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

// Transferência de estoque — entre depósitos da mesma empresa, ou entre
// empresas do mesmo grupo (com parceria ativa e produto vinculado).
//
// A busca de produto é sempre AO VIVO (nunca pré-carrega o catálogo, que
// passa de 14 mil linhas) — mesmo padrão de NovaEntradaClient e
// AnunciosClient. Duas formas de montar a lista de itens, que convergem no
// mesmo lugar (o Map `selecionados`):
//   1. Buscar por nome/SKU, categoria, subcategoria ou tag.
//   2. Escolher uma entrada e partir dos itens dela.
// Não existe rastreamento de lote neste sistema — "a partir de uma
// entrada" é um atalho de PREENCHIMENTO (usa a quantidade recebida como
// sugestão), não uma reserva daquelas unidades específicas. A quantidade
// real transferível é sempre o saldo ATUAL no depósito de origem.

type Deposito = { id: string; nome: string; principal: boolean }
type Categoria = { id: string; nome: string; pai_id: string | null }
type EmpresaParceira = { id: string; nome: string; parceriaId: string; depositos: Deposito[] }
type EntradaResumo = { id: string; origem: 'manual' | 'xml'; numero: string; data: string | null; fornecedor: string | null }

type ItemSelecionado = {
  produtoId: string
  nome: string
  sku: string | null
  unidade: string
  estoqueOrigem: number
  modo: 'qtd' | 'pct' | 'tudo'
  valorDigitado: string   // o que está no input — quantidade ou percentual, conforme o modo
  quantidade: number      // sempre recalculada a partir de modo+valorDigitado+estoqueOrigem
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function calcularQuantidade(modo: ItemSelecionado['modo'], valorDigitado: string, estoqueOrigem: number): number {
  if (modo === 'tudo') return estoqueOrigem
  const v = parseFloat(valorDigitado.replace(',', '.')) || 0
  if (modo === 'pct') return Math.max(0, Math.min(estoqueOrigem, Math.floor(estoqueOrigem * v / 100)))
  return Math.max(0, Math.min(estoqueOrigem, v))
}

export default function TransferenciaEstoqueClient({ empresaId, depositosProprios, categorias, empresasParceiras, entradas }: {
  empresaId: string
  depositosProprios: Deposito[]
  categorias: Categoria[]
  empresasParceiras: EmpresaParceira[]
  entradas: EntradaResumo[]
}) {
  const router = useRouter()

  // ── Origem e destino ────────────────────────────────────────
  const [depositoOrigemId, setDepositoOrigemId] = useState(
    depositosProprios.find(d => d.principal)?.id ?? depositosProprios[0]?.id ?? ''
  )
  const [modoDestino, setModoDestino] = useState<'mesma_empresa' | 'outra_empresa'>('mesma_empresa')
  const [empresaDestinoId, setEmpresaDestinoId] = useState('')
  const [depositoDestinoId, setDepositoDestinoId] = useState('')

  const depositosDestinoDisponiveis = useMemo(() => {
    if (modoDestino === 'mesma_empresa') return depositosProprios.filter(d => d.id !== depositoOrigemId)
    return empresasParceiras.find(e => e.id === empresaDestinoId)?.depositos ?? []
  }, [modoDestino, depositoOrigemId, empresaDestinoId, empresasParceiras, depositosProprios])

  useEffect(() => { setDepositoDestinoId('') }, [modoDestino, empresaDestinoId])

  const empresaDestinoEfetiva = modoDestino === 'mesma_empresa' ? empresaId : empresaDestinoId
  const parceriaAtiva = empresasParceiras.find(e => e.id === empresaDestinoId)

  // ── Seleção de produtos ─────────────────────────────────────
  const [aba, setAba] = useState<'buscar' | 'entrada'>('buscar')
  const [busca, setBusca] = useState('')
  const [categoriaFiltro, setCategoriaFiltro] = useState('')
  const [subcategoriaFiltro, setSubcategoriaFiltro] = useState('')
  const [tagFiltro, setTagFiltro] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [resultados, setResultados] = useState<{ id: string; nome: string; sku: string | null; unidade: string; estoqueOrigem: number }[]>([])

  const categoriasTopo = categorias.filter(c => !c.pai_id)
  const subcategoriasDaEscolhida = categorias.filter(c => {
    const pai = categorias.find(p => p.nome === categoriaFiltro && !p.pai_id)
    return pai && c.pai_id === pai.id
  })
  function mudarCategoriaFiltro(nome: string) {
    setCategoriaFiltro(nome)
    setSubcategoriaFiltro('')
  }

  const [selecionados, setSelecionados] = useState<Map<string, ItemSelecionado>>(new Map())

  // Busca ao vivo — debounce, e só dispara se algum filtro estiver preenchido
  // (sem isso, abrir a aba já dispararia uma busca "tudo" contra 14 mil linhas).
  useEffect(() => {
    if (aba !== 'buscar') return
    if (!depositoOrigemId) return
    if (!busca.trim() && !categoriaFiltro && !tagFiltro) { setResultados([]); return }

    let vivo = true
    setBuscando(true)
    const timer = setTimeout(async () => {
      const sb = createClient()
      let q = sb.from('produtos')
        .select('id, nome, sku, unidade')
        .eq('empresa_id', empresaId).eq('ativo', true).neq('tipo', 'kit')
        .limit(60)
      if (busca.trim()) q = q.or(`nome.ilike.%${busca.trim()}%,sku.ilike.%${busca.trim()}%`)
      if (categoriaFiltro) q = q.eq('categoria', categoriaFiltro)
      if (subcategoriaFiltro) q = q.eq('subcategoria', subcategoriaFiltro)
      if (tagFiltro.trim()) q = q.contains('tags', [tagFiltro.trim()])

      const { data: produtos } = await q
      if (!vivo) return
      if (!produtos || produtos.length === 0) { setResultados([]); setBuscando(false); return }

      const ids = produtos.map(p => p.id)
      const { data: saldos } = await sb.from('produto_estoque')
        .select('produto_id, quantidade').eq('deposito_id', depositoOrigemId).in('produto_id', ids)
      const saldoPorProduto = new Map((saldos ?? []).map(s => [s.produto_id, Number(s.quantidade)]))

      if (!vivo) return
      setResultados(
        produtos
          .map(p => ({ id: p.id, nome: p.nome, sku: p.sku, unidade: p.unidade ?? 'un', estoqueOrigem: saldoPorProduto.get(p.id) ?? 0 }))
          .filter(p => p.estoqueOrigem > 0)
          .sort((a, b) => b.estoqueOrigem - a.estoqueOrigem)
      )
      setBuscando(false)
    }, 350)
    return () => { vivo = false; clearTimeout(timer) }
  }, [aba, busca, categoriaFiltro, subcategoriaFiltro, tagFiltro, depositoOrigemId, empresaId])

  function adicionarProduto(p: { id: string; nome: string; sku: string | null; unidade: string; estoqueOrigem: number }) {
    if (p.estoqueOrigem <= 0) return
    setSelecionados(prev => {
      const n = new Map(prev)
      if (!n.has(p.id)) {
        n.set(p.id, {
          produtoId: p.id, nome: p.nome, sku: p.sku, unidade: p.unidade, estoqueOrigem: p.estoqueOrigem,
          modo: 'tudo', valorDigitado: '', quantidade: p.estoqueOrigem,
        })
      }
      return n
    })
  }

  function removerItem(produtoId: string) {
    setSelecionados(prev => { const n = new Map(prev); n.delete(produtoId); return n })
  }

  function atualizarItem(produtoId: string, campo: Partial<Pick<ItemSelecionado, 'modo' | 'valorDigitado'>>) {
    setSelecionados(prev => {
      const n = new Map(prev)
      const atual = n.get(produtoId)
      if (!atual) return prev
      const atualizado = { ...atual, ...campo }
      atualizado.quantidade = calcularQuantidade(atualizado.modo, atualizado.valorDigitado, atualizado.estoqueOrigem)
      n.set(produtoId, atualizado)
      return n
    })
  }

  // ── Aplicar em massa ────────────────────────────────────────
  const [modoMassa, setModoMassa] = useState<'qtd' | 'pct' | 'tudo'>('tudo')
  const [valorMassa, setValorMassa] = useState('')
  function aplicarEmMassa() {
    setSelecionados(prev => {
      const n = new Map(prev)
      for (const [id, item] of n) {
        n.set(id, { ...item, modo: modoMassa, valorDigitado: valorMassa, quantidade: calcularQuantidade(modoMassa, valorMassa, item.estoqueOrigem) })
      }
      return n
    })
  }

  // ── A partir de uma entrada ─────────────────────────────────
  const [buscaEntrada, setBuscaEntrada] = useState('')
  const [entradaEscolhida, setEntradaEscolhida] = useState<EntradaResumo | null>(null)
  const [carregandoItensEntrada, setCarregandoItensEntrada] = useState(false)

  const entradasFiltradas = entradas.filter(e =>
    !buscaEntrada.trim() ||
    e.numero.toLowerCase().includes(buscaEntrada.toLowerCase()) ||
    (e.fornecedor ?? '').toLowerCase().includes(buscaEntrada.toLowerCase())
  )

  async function escolherEntrada(e: EntradaResumo) {
    if (!depositoOrigemId) return
    setEntradaEscolhida(e)
    setCarregandoItensEntrada(true)
    const sb = createClient()

    type ItemBruto = { produtoId: string | null; nome: string; sku: string | null; quantidade: number }
    let itensBrutos: ItemBruto[] = []
    if (e.origem === 'manual') {
      const { data } = await sb.from('entrada_itens')
        .select('produto_id, nome_produto, sku, quantidade').eq('entrada_id', e.id)
      itensBrutos = (data ?? []).map(i => ({ produtoId: i.produto_id, nome: i.nome_produto, sku: i.sku, quantidade: Number(i.quantidade) }))
    } else {
      const { data } = await sb.from('nfe_itens')
        .select('produto_id, produto_nome, descricao_xml, produto_sku, quantidade_entrada').eq('entrada_id', e.id)
      itensBrutos = (data ?? []).map(i => ({
        produtoId: i.produto_id, nome: i.produto_nome || i.descricao_xml, sku: i.produto_sku, quantidade: Number(i.quantidade_entrada),
      }))
    }

    const comProduto = itensBrutos.filter(i => i.produtoId)
    const ids = comProduto.map(i => i.produtoId as string)
    const { data: saldos } = ids.length
      ? await sb.from('produto_estoque').select('produto_id, quantidade').eq('deposito_id', depositoOrigemId).in('produto_id', ids)
      : { data: [] as { produto_id: string; quantidade: number }[] }
    const { data: prods } = ids.length
      ? await sb.from('produtos').select('id, unidade').in('id', ids)
      : { data: [] as { id: string; unidade: string | null }[] }
    const saldoPorProduto = new Map((saldos ?? []).map(s => [s.produto_id, Number(s.quantidade)]))
    const unidadePorProduto = new Map((prods ?? []).map(p => [p.id, p.unidade ?? 'un']))

    setSelecionados(prev => {
      const n = new Map(prev)
      for (const item of comProduto) {
        const id = item.produtoId as string
        const estoqueOrigem = saldoPorProduto.get(id) ?? 0
        if (estoqueOrigem <= 0) continue
        // Sugestão: a quantidade recebida nesta entrada, nunca mais do que
        // existe hoje no depósito — de novo, isto não é reserva de lote.
        const sugestao = Math.min(item.quantidade, estoqueOrigem)
        n.set(id, {
          produtoId: id, nome: item.nome, sku: item.sku, unidade: unidadePorProduto.get(id) ?? 'un',
          estoqueOrigem, modo: 'qtd', valorDigitado: String(sugestao), quantidade: sugestao,
        })
      }
      return n
    })
    setCarregandoItensEntrada(false)
  }

  // ── Vínculo de produto (entre empresas) ──────────────────────
  const [vinculados, setVinculados] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (modoDestino !== 'outra_empresa' || !parceriaAtiva || selecionados.size === 0) { setVinculados(new Set()); return }
    let vivo = true
    const sb = createClient()
    const ids = [...selecionados.keys()]
    sb.from('produto_vinculos')
      .select('produto_id_a, produto_id_b')
      .eq('parceria_id', parceriaAtiva.parceriaId)
      .or(`produto_id_a.in.(${ids.join(',')}),produto_id_b.in.(${ids.join(',')})`)
      .then(({ data }: any) => {
        if (!vivo) return
        const s = new Set<string>()
        for (const v of data ?? []) { if (ids.includes(v.produto_id_a)) s.add(v.produto_id_a); if (ids.includes(v.produto_id_b)) s.add(v.produto_id_b) }
        setVinculados(s)
      })
    return () => { vivo = false }
  }, [modoDestino, parceriaAtiva, selecionados])

  // ── Confirmar ────────────────────────────────────────────────
  const [observacao, setObservacao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<{ resultados: { produtoId: string; produtoNome: string; ok: boolean; erro?: string; quantidadeTransferida?: number }[]; transferidos: number; falhas: number } | null>(null)
  const [erroGeral, setErroGeral] = useState('')

  const itensValidos = [...selecionados.values()].filter(i => i.quantidade > 0)
  const bloqueadosPorVinculo = modoDestino === 'outra_empresa'
    ? itensValidos.filter(i => !vinculados.has(i.produtoId))
    : []
  const prontoParaEnviar =
    depositoOrigemId && depositoDestinoId && itensValidos.length > 0 &&
    (modoDestino === 'mesma_empresa' || (empresaDestinoId && bloqueadosPorVinculo.length === 0))

  async function confirmar() {
    setEnviando(true); setErroGeral(''); setResultado(null)
    try {
      const resp = await fetch('/api/estoque/transferencia', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          depositoOrigemId,
          empresaDestinoId: modoDestino === 'outra_empresa' ? empresaDestinoId : undefined,
          depositoDestinoId,
          itens: itensValidos.map(i => ({ produtoId: i.produtoId, quantidade: i.quantidade, percentual: i.modo === 'pct' ? parseFloat(i.valorDigitado) || null : null })),
          observacao: observacao || undefined,
          entradaId: entradaEscolhida?.id,
          entradaOrigem: entradaEscolhida?.origem,
        }),
      })
      // Resposta que não é JSON (timeout da função, erro 5xx da plataforma)
      // fazia o .json() estourar e cair no catch como "falha de rede", sem
      // dizer o que aconteceu de verdade. Aqui o motivo real aparece.
      const bruto = await resp.text()
      let d: any = null
      try { d = JSON.parse(bruto) } catch {
        setErroGeral(
          resp.status === 504 || resp.status === 408
            ? 'A transferência demorou demais e foi interrompida pelo servidor. Tente com menos produtos por vez.'
            : `O servidor respondeu ${resp.status} sem detalhe. ${bruto.slice(0, 200)}`
        )
        return
      }
      if (!d.ok) { setErroGeral(d.erro ?? 'Não foi possível transferir.'); return }
      setResultado(d)
      setSelecionados(new Map())
      setEntradaEscolhida(null)
      setObservacao('')
      router.refresh()
    } catch (e: any) {
      setErroGeral(`Não foi possível falar com o servidor: ${e?.message ?? 'erro desconhecido'}`)
    } finally {
      setEnviando(false)
    }
  }

  const totalUnidades = itensValidos.reduce((s, i) => s + i.quantidade, 0)

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <span className="text-gray-600 font-medium">transferência de estoque</span>
      </div>

      <h1 className="text-gray-900 text-xl font-semibold mb-1">Transferência de Estoque</h1>
      <p className="text-gray-500 text-sm mb-6">
        Entre depósitos da sua empresa, ou para outra empresa do grupo.
      </p>

      {depositosProprios.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-8 text-sm text-amber-800">
          Nenhum depósito ativo nesta empresa. Cadastre um em Estoque → Depósitos.
        </div>
      )}

      {depositosProprios.length > 0 && (
        <>
          {/* ── Origem / Destino ──────────────────────────────── */}
          <div className="grid md:grid-cols-2 gap-4 mb-5">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500 mb-2">De onde sai</p>
              <select value={depositoOrigemId} onChange={e => setDepositoOrigemId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                {depositosProprios.map(d => <option key={d.id} value={d.id}>{d.nome}{d.principal ? ' (principal)' : ''}</option>)}
              </select>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500 mb-2">Para onde vai</p>
              <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden mb-2 w-full">
                <button onClick={() => setModoDestino('mesma_empresa')}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium ${modoDestino === 'mesma_empresa' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                  Mesma empresa
                </button>
                <button onClick={() => setModoDestino('outra_empresa')} disabled={empresasParceiras.length === 0}
                  title={empresasParceiras.length === 0 ? 'Nenhuma empresa parceira com depósito disponível' : undefined}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed ${modoDestino === 'outra_empresa' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                  Outra empresa do grupo
                </button>
              </div>

              {modoDestino === 'outra_empresa' && (
                <select value={empresaDestinoId} onChange={e => setEmpresaDestinoId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2">
                  <option value="">Escolha a empresa...</option>
                  {empresasParceiras.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              )}

              <select value={depositoDestinoId} onChange={e => setDepositoDestinoId(e.target.value)}
                disabled={depositosDestinoDisponiveis.length === 0}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm disabled:opacity-50 disabled:bg-slate-50">
                <option value="">{depositosDestinoDisponiveis.length === 0 ? 'Nenhum depósito disponível' : 'Escolha o depósito...'}</option>
                {depositosDestinoDisponiveis.map(d => <option key={d.id} value={d.id}>{d.nome}{d.principal ? ' (principal)' : ''}</option>)}
              </select>
            </div>
          </div>

          {depositoOrigemId && depositoDestinoId && (
            <>
              {/* ── Seleção de produtos ─────────────────────────── */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 mb-5">
                <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden mb-3">
                  <button onClick={() => setAba('buscar')}
                    className={`px-3 py-1.5 text-xs font-medium ${aba === 'buscar' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                    Buscar produtos
                  </button>
                  <button onClick={() => setAba('entrada')}
                    className={`px-3 py-1.5 text-xs font-medium ${aba === 'entrada' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                    A partir de uma entrada
                  </button>
                </div>

                {aba === 'buscar' ? (
                  <div>
                    <div className="flex flex-wrap gap-2 mb-3">
                      <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Nome ou SKU..."
                        className="flex-1 min-w-[180px] border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                      <select value={categoriaFiltro} onChange={e => mudarCategoriaFiltro(e.target.value)}
                        className="border border-slate-300 rounded-lg px-2.5 py-2 text-xs">
                        <option value="">Todas as categorias</option>
                        {categoriasTopo.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                      </select>
                      {subcategoriasDaEscolhida.length > 0 && (
                        <select value={subcategoriaFiltro} onChange={e => setSubcategoriaFiltro(e.target.value)}
                          className="border border-slate-300 rounded-lg px-2.5 py-2 text-xs">
                          <option value="">Todas as subcategorias</option>
                          {subcategoriasDaEscolhida.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                        </select>
                      )}
                      <input value={tagFiltro} onChange={e => setTagFiltro(e.target.value)} placeholder="Tag exata..."
                        className="w-32 border border-slate-300 rounded-lg px-2.5 py-2 text-xs" />
                    </div>

                    {buscando && <p className="text-xs text-slate-400">Buscando...</p>}
                    {!buscando && resultados.length === 0 && (busca || categoriaFiltro || tagFiltro) && (
                      <p className="text-xs text-slate-400">Nenhum produto com estoque neste depósito para estes filtros.</p>
                    )}
                    {!buscando && resultados.length > 0 && (
                      <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                        {resultados.map(p => (
                          <button key={p.id} onClick={() => adicionarProduto(p)} disabled={selecionados.has(p.id)}
                            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-40 disabled:cursor-default">
                            <span className="text-sm text-slate-700 truncate">{p.nome} <span className="text-slate-400 text-xs">{p.sku ?? ''}</span></span>
                            <span className="text-xs text-slate-500 shrink-0 ml-2">{p.estoqueOrigem} {p.unidade} · {selecionados.has(p.id) ? 'adicionado' : '+ adicionar'}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <input value={buscaEntrada} onChange={e => setBuscaEntrada(e.target.value)} placeholder="Buscar por número ou fornecedor..."
                      className="w-full max-w-sm border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3" />
                    <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                      {entradasFiltradas.length === 0 && <p className="text-xs text-slate-400 px-3 py-4">Nenhuma entrada encontrada.</p>}
                      {entradasFiltradas.map(e => (
                        <button key={`${e.origem}-${e.id}`} onClick={() => escolherEntrada(e)}
                          className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50 ${entradaEscolhida?.id === e.id ? 'bg-slate-50' : ''}`}>
                          <span className="text-sm text-slate-700">
                            #{e.numero} <span className="text-slate-400 text-xs">{e.origem === 'xml' ? 'XML' : 'manual'} · {e.fornecedor ?? 'sem fornecedor'}</span>
                          </span>
                          <span className="text-xs text-slate-400 shrink-0 ml-2">{e.data ? new Date(e.data).toLocaleDateString('pt-BR') : '—'}</span>
                        </button>
                      ))}
                    </div>
                    {carregandoItensEntrada && <p className="text-xs text-slate-400 mt-2">Carregando itens...</p>}
                    <p className="text-[11px] text-slate-400 mt-2">
                      A quantidade sugerida é a que veio nesta entrada, limitada ao que existe hoje no depósito — o sistema não guarda lote, só o saldo atual.
                    </p>
                  </div>
                )}
              </div>

              {/* ── Itens selecionados ──────────────────────────── */}
              {selecionados.size > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden mb-5">
                  <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                    <span className="text-xs text-slate-500">Aplicar a todos:</span>
                    <select value={modoMassa} onChange={e => setModoMassa(e.target.value as 'qtd' | 'pct' | 'tudo')}
                      className="border border-slate-300 rounded-lg px-2 py-1 text-xs">
                      <option value="tudo">Tudo</option>
                      <option value="pct">% do estoque</option>
                      <option value="qtd">Quantidade</option>
                    </select>
                    {modoMassa !== 'tudo' && (
                      <input value={valorMassa} onChange={e => setValorMassa(e.target.value)} placeholder={modoMassa === 'pct' ? '%' : 'qtd'}
                        className="w-20 border border-slate-300 rounded-lg px-2 py-1 text-xs" />
                    )}
                    <button onClick={aplicarEmMassa} className="px-2.5 py-1 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700">
                      Aplicar
                    </button>
                    <span className="ml-auto text-xs text-slate-500">{selecionados.size} produto(s) · {totalUnidades} unidade(s) no total</span>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {[...selecionados.values()].map(item => {
                      const semVinculo = modoDestino === 'outra_empresa' && !vinculados.has(item.produtoId)
                      return (
                        <div key={item.produtoId} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm ${semVinculo ? 'bg-red-50' : ''}`}>
                          <div className="min-w-[180px] flex-1">
                            <div className="font-medium text-slate-800">{item.nome}</div>
                            <div className="text-[11px] text-slate-400">{item.sku ?? '—'} · estoque no depósito: {item.estoqueOrigem} {item.unidade}</div>
                            {semVinculo && (
                              <div className="text-[11px] text-red-600 mt-0.5">
                                Sem produto vinculado na empresa destino —{' '}
                                <Link href="/dashboard/empresas/parcerias" className="underline">vincule em Empresas → Parcerias</Link>.
                              </div>
                            )}
                          </div>
                          <select value={item.modo} onChange={e => atualizarItem(item.produtoId, { modo: e.target.value as ItemSelecionado['modo'] })}
                            className="border border-slate-300 rounded-lg px-2 py-1 text-xs">
                            <option value="tudo">Tudo</option>
                            <option value="pct">%</option>
                            <option value="qtd">Quantidade</option>
                          </select>
                          {item.modo !== 'tudo' && (
                            <input value={item.valorDigitado} onChange={e => atualizarItem(item.produtoId, { valorDigitado: e.target.value })}
                              placeholder={item.modo === 'pct' ? '%' : 'qtd'}
                              className="w-20 border border-slate-300 rounded-lg px-2 py-1 text-xs text-right" />
                          )}
                          <span className="w-24 text-right text-sm font-semibold text-slate-800">
                            {item.quantidade} {item.unidade}
                          </span>
                          <button onClick={() => removerItem(item.produtoId)} className="text-slate-300 hover:text-red-500 text-xs">✕</button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ── Confirmar ─────────────────────────────────── */}
              {selecionados.size > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Observação (opcional)</label>
                  <input value={observacao} onChange={e => setObservacao(e.target.value)} placeholder="Motivo da transferência..."
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3" />

                  {bloqueadosPorVinculo.length > 0 && (
                    <p className="text-xs text-red-600 mb-2">
                      {bloqueadosPorVinculo.length} produto(s) sem vínculo com a empresa destino — remova-os ou vincule antes de confirmar.
                    </p>
                  )}
                  {erroGeral && <p className="text-sm text-red-600 mb-2">{erroGeral}</p>}

                  <button onClick={confirmar} disabled={!prontoParaEnviar || enviando}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                    {enviando ? 'Transferindo...' : `Transferir ${itensValidos.length} produto(s) · ${totalUnidades} unidade(s)`}
                  </button>
                </div>
              )}
            </>
          )}

          {resultado && (
            <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-medium text-slate-800 mb-2">
                {resultado.transferidos} transferido(s){resultado.falhas > 0 && `, ${resultado.falhas} com problema`}
              </p>
              <div className="space-y-1">
                {resultado.resultados.map((r, i) => (
                  <p key={i} className={`text-xs ${r.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                    {r.ok ? '✓' : '✕'} {r.produtoNome} {r.ok ? `— ${r.quantidadeTransferida} un.` : `— ${r.erro}`}
                  </p>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
