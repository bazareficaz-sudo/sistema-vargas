'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ── Types ────────────────────────────────────────────────────────────────────

type Status = 'rascunho' | 'em_cotacao' | 'aguardando_aprovacao' | 'enviado' | 'parcialmente_recebido' | 'recebido' | 'cancelado'
type Filtro = 'fornecedor' | 'abaixo_min' | 'zerado' | 'todos'

interface ProdutoForn {
  id: string; nome: string; sku: string; ean: string; categoria: string; marca: string
  estoque: number; estoque_minimo: number
  preco_venda: number; preco_custo: number; unidade: string; ativo: boolean
  compradoDoFornecedor: boolean; ultimoCusto: number; ultimaCompra: string | null
  ultimaQtd: number; custoMedio: number; menorCusto: number; maiorCusto: number
  qtdSugerida: number
}

interface ItemPedido {
  produto_id: string; nome: string; sku: string; unidade: string
  quantidade: number; custo_unitario: number; desconto: number; total: number
  ultimoCusto: number; custoMedio: number; preco_venda: number; observacao: string
}

interface Fornecedor { id: string; nome_fantasia: string; razao_social: string; email?: string; telefone?: string }

interface PedidoDB {
  id: string; fornecedor_id: string | null; status: Status; data_pedido: string
  previsao_entrega: string | null; condicao_pagamento: string | null; observacoes: string | null
  frete: number; outras_despesas: number; desconto_geral: number
}

interface Props {
  fornecedores: Fornecedor[]
  empresaId: string
  userId: string
  pedidoExistente: PedidoDB | null
  itensExistentes: unknown[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const brl = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const today = new Date().toISOString().slice(0, 10)

const FILTROS: { key: Filtro; label: string }[] = [
  { key: 'fornecedor', label: '📦 Deste fornecedor' },
  { key: 'abaixo_min', label: '🟡 Abaixo do mínimo' },
  { key: 'zerado',    label: '🔴 Estoque zerado' },
  { key: 'todos',     label: '🔍 Todos os produtos' },
]

const STATUS_OPTS: { value: Status; label: string }[] = [
  { value: 'rascunho', label: 'Rascunho' },
  { value: 'em_cotacao', label: 'Em cotação' },
  { value: 'aguardando_aprovacao', label: 'Aguardando aprovação' },
  { value: 'enviado', label: 'Enviado ao fornecedor' },
  { value: 'parcialmente_recebido', label: 'Parcialmente recebido' },
  { value: 'recebido', label: 'Recebido' },
  { value: 'cancelado', label: 'Cancelado' },
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function NovoPedidoClient({ fornecedores, empresaId, userId, pedidoExistente, itensExistentes }: Props) {
  const router = useRouter()

  // Pedido header
  const [pedidoId, setPedidoId] = useState<string | null>(pedidoExistente?.id ?? null)
  const [fornecedorId, setFornecedorId] = useState(pedidoExistente?.fornecedor_id ?? '')
  const [status, setStatus] = useState<Status>(pedidoExistente?.status ?? 'rascunho')
  const [dataPedido, setDataPedido] = useState(pedidoExistente?.data_pedido ?? today)
  const [previsaoEntrega, setPrevisaoEntrega] = useState(pedidoExistente?.previsao_entrega ?? '')
  const [condicaoPagamento, setCondicaoPagamento] = useState(pedidoExistente?.condicao_pagamento ?? '')
  const [observacoes, setObservacoes] = useState(pedidoExistente?.observacoes ?? '')
  const [frete, setFrete] = useState(Number(pedidoExistente?.frete ?? 0))
  const [outrasDespesas, setOutrasDespesas] = useState(Number(pedidoExistente?.outras_despesas ?? 0))
  const [descontoGeral, setDescontoGeral] = useState(Number(pedidoExistente?.desconto_geral ?? 0))

  // Products list
  const [produtos, setProdutos] = useState<ProdutoForn[]>([])
  const [loadingProdutos, setLoadingProdutos] = useState(false)
  const [erroProdutos, setErroProdutos] = useState('')
  const [limiteExtras, setLimiteExtras] = useState(false)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('fornecedor')
  const [navIdx, setNavIdx] = useState(0)

  // Cart
  const [itens, setItens] = useState<ItemPedido[]>(() => {
    return (itensExistentes as Array<Record<string, unknown>>).map(i => {
      const prod = i.produtos as Record<string, unknown> | null
      return {
        produto_id: i.produto_id as string,
        nome: (prod?.nome as string) ?? '',
        sku: (prod?.sku as string) ?? '',
        unidade: (prod?.unidade as string) ?? 'UN',
        quantidade: Number(i.quantidade),
        custo_unitario: Number(i.custo_unitario),
        desconto: Number(i.desconto ?? 0),
        total: Number(i.total),
        ultimoCusto: Number(i.ultimo_custo_ref ?? 0),
        custoMedio: Number(i.custo_medio_ref ?? 0),
        preco_venda: Number((prod?.preco_venda as number) ?? 0),
        observacao: (i.observacao as string) ?? '',
      }
    })
  })

  // Modal
  const [modalProduto, setModalProduto] = useState<ProdutoForn | null>(null)
  const [modalQtd, setModalQtd] = useState('')
  const [modalCusto, setModalCusto] = useState('')
  const [modalDesconto, setModalDesconto] = useState('0')
  const [modalObs, setModalObs] = useState('')

  // UI
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [histTab, setHistTab] = useState<'produtos' | 'historico'>('produtos')

  const buscaRef = useRef<HTMLInputElement>(null)
  const modalQtdRef = useRef<HTMLInputElement>(null)
  const modalCustoRef = useRef<HTMLInputElement>(null)

  // ── Filter products ─────────────────────────────────────────────────────────

  const produtosFiltrados = produtos.filter(p => {
    if (busca) {
      const q = busca.toLowerCase()
      const match = p.nome.toLowerCase().includes(q)
        || (p.sku ?? '').toLowerCase().includes(q)
        || (p.ean ?? '').toLowerCase().includes(q)
        || (p.categoria ?? '').toLowerCase().includes(q)
      if (!match) return false
    }
    if (filtro === 'fornecedor') return p.compradoDoFornecedor
    if (filtro === 'abaixo_min') return p.estoque < p.estoque_minimo
    if (filtro === 'zerado') return p.estoque <= 0
    return true
  })

  // ── Load products when supplier changes ─────────────────────────────────────

  // Limpa a busca ao trocar de fornecedor — sem isso o termo antigo continuaria
  // valendo e a lista viria filtrada por algo que o operador não vê mais.
  useEffect(() => { setBusca('') }, [fornecedorId])

  // A busca vai ao banco, não filtra só o que já está na tela: o catálogo tem
  // mais de 14 mil produtos e a rota devolve no máximo 300 por vez. Filtrar
  // localmente fazia produto existente parecer inexistente.
  useEffect(() => {
    if (!fornecedorId) { setProdutos([]); setErroProdutos(''); return }

    const termo = busca.trim()
    const atrasar = termo ? 350 : 0   // deixa de disparar a cada tecla
    let cancelado = false

    const t = setTimeout(() => {
      setLoadingProdutos(true)
      setNavIdx(0)
      const url = `/api/pedidos-compra/produtos-fornecedor?fornecedor_id=${fornecedorId}`
        + (termo ? `&busca=${encodeURIComponent(termo)}` : '')
      fetch(url)
        .then(async r => {
          const d = await r.json().catch(() => ({}))
          if (!r.ok) throw new Error(d.error || `Erro ${r.status} ao carregar produtos`)
          return d
        })
        .then(d => {
          if (cancelado) return
          setProdutos(d.produtos ?? [])
          setLimiteExtras(Boolean(d.limiteExtras))
          setErroProdutos('')
        })
        .catch(e => {
          if (cancelado) return
          setProdutos([])
          setErroProdutos(e?.message ?? 'Erro ao carregar produtos')
        })
        .finally(() => { if (!cancelado) setLoadingProdutos(false) })
    }, atrasar)

    return () => { cancelado = true; clearTimeout(t) }
  }, [fornecedorId, busca])

  // ── Auto-focus search ───────────────────────────────────────────────────────

  useEffect(() => { buscaRef.current?.focus() }, [])

  // ── Global keyboard shortcuts ───────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (modalProduto) return
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); salvar() }
      if (e.ctrlKey && e.key === 'f') { e.preventDefault(); buscaRef.current?.focus() }
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); finalizar() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── Modal: setup when opens ─────────────────────────────────────────────────

  useEffect(() => {
    if (!modalProduto) return
    const emCarrinho = itens.find(i => i.produto_id === modalProduto.id)
    setModalQtd(emCarrinho ? String(emCarrinho.quantidade) : '')
    setModalCusto(String(emCarrinho?.custo_unitario ?? (modalProduto.ultimoCusto || modalProduto.preco_custo || '')))
    setModalDesconto(String(emCarrinho?.desconto ?? 0))
    setModalObs(emCarrinho?.observacao ?? '')
    setTimeout(() => modalQtdRef.current?.focus(), 60)
  }, [modalProduto])

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function abrirModal(p: ProdutoForn) { setModalProduto(p) }

  function confirmarModal() {
    if (!modalProduto) return
    const qtd = parseFloat(modalQtd) || 0
    const custo = parseFloat(modalCusto) || 0
    const desc = parseFloat(modalDesconto) || 0
    if (qtd <= 0) { setModalProduto(null); return }
    const total = qtd * custo * (1 - desc / 100)
    const item: ItemPedido = {
      produto_id: modalProduto.id,
      nome: modalProduto.nome,
      sku: modalProduto.sku ?? '',
      unidade: modalProduto.unidade ?? 'UN',
      quantidade: qtd,
      custo_unitario: custo,
      desconto: desc,
      total,
      ultimoCusto: modalProduto.ultimoCusto,
      custoMedio: modalProduto.custoMedio,
      preco_venda: Number(modalProduto.preco_venda ?? 0),
      observacao: modalObs,
    }
    setItens(prev => {
      const idx = prev.findIndex(i => i.produto_id === modalProduto.id)
      if (idx >= 0) { const n = [...prev]; n[idx] = item; return n }
      return [...prev, item]
    })
    setModalProduto(null)
    setTimeout(() => buscaRef.current?.focus(), 60)
  }

  function removerItem(produto_id: string) {
    setItens(prev => prev.filter(i => i.produto_id !== produto_id))
  }

  function editarItemQtd(produto_id: string, qtd: number) {
    setItens(prev => prev.map(i => i.produto_id === produto_id
      ? { ...i, quantidade: qtd, total: qtd * i.custo_unitario * (1 - i.desconto / 100) }
      : i
    ))
  }

  function sugerirPedido() {
    const jaNoCarrinho = new Set(itens.map(i => i.produto_id))
    const sugestoes = produtos
      .filter(p => p.compradoDoFornecedor && p.qtdSugerida > 0 && !jaNoCarrinho.has(p.id))
    if (sugestoes.length === 0) {
      // A sugestão só existe onde há sinal: produto abaixo do estoque mínimo,
      // ou produto zerado que já foi comprado deste fornecedor antes. Sem isso
      // não há o que sugerir — e vale dizer por quê, porque a causa mais comum
      // é estoque mínimo não cadastrado.
      alert(
        'Nenhuma sugestão para este fornecedor.\n\n'
        + 'A sugestão vem de duas fontes: produto abaixo do estoque mínimo, ou produto '
        + 'zerado que você já comprou deste fornecedor antes.\n\n'
        + 'Se a lista veio vazia, provavelmente os produtos ainda não têm estoque mínimo '
        + 'cadastrado e não há compra anterior registrada deste fornecedor.',
      )
      return
    }
    const custo_ = (p: ProdutoForn) => p.ultimoCusto || p.preco_custo || 0
    setItens(prev => [
      ...prev,
      ...sugestoes.map(p => ({
        produto_id: p.id, nome: p.nome, sku: p.sku ?? '',
        unidade: p.unidade ?? 'UN', quantidade: p.qtdSugerida,
        custo_unitario: custo_(p), desconto: 0,
        total: p.qtdSugerida * custo_(p),
        ultimoCusto: p.ultimoCusto, custoMedio: p.custoMedio,
        preco_venda: Number(p.preco_venda ?? 0), observacao: '',
      })),
    ])
  }

  // ── Totals ──────────────────────────────────────────────────────────────────

  const subtotal = itens.reduce((s, i) => s + i.total, 0)
  const totalGeral = subtotal - descontoGeral + frete + outrasDespesas

  // ── Save ────────────────────────────────────────────────────────────────────

  const salvar = useCallback(async (st: Status = status) => {
    setSaving('saving')
    try {
      const res = await fetch('/api/pedidos-compra/salvar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pedido: {
            id: pedidoId,
            empresa_id: empresaId,
            fornecedor_id: fornecedorId || null,
            status: st,
            data_pedido: dataPedido,
            previsao_entrega: previsaoEntrega || null,
            condicao_pagamento: condicaoPagamento || null,
            observacoes: observacoes || null,
            subtotal,
            desconto_geral: descontoGeral,
            frete,
            outras_despesas: outrasDespesas,
            total: totalGeral,
          },
          itens,
        }),
      })
      const d = await res.json()
      if (d.id && !pedidoId) setPedidoId(d.id)
      setSaving('saved')
      setTimeout(() => setSaving('idle'), 2000)
    } catch {
      setSaving('error')
    }
  }, [pedidoId, empresaId, fornecedorId, status, dataPedido, previsaoEntrega, condicaoPagamento, observacoes, subtotal, descontoGeral, frete, outrasDespesas, totalGeral, itens])

  async function finalizar() {
    await salvar('enviado')
    router.push('/dashboard/pedidos-compra')
  }

  // ── WhatsApp ────────────────────────────────────────────────────────────────

  function enviarWhatsApp() {
    const forn = fornecedores.find(f => f.id === fornecedorId)
    if (!forn) { alert('Selecione um fornecedor.'); return }
    const lista = itens.map(i => `• ${i.nome} — ${i.quantidade} ${i.unidade} × ${brl(i.custo_unitario)}`).join('\n')
    const msg = `Olá, *${forn.nome_fantasia || forn.razao_social}*! 👋\n\nSegue nosso pedido de compra no valor total de *${brl(totalGeral)}*.\n\n*Produtos:*\n${lista}\n\nPor favor, confirme disponibilidade, valores e prazo de entrega.\n\n_${observacoes || ''}_`
    const phone = forn.telefone?.replace(/\D/g, '')
    const url = `https://wa.me/${phone ? '55' + phone : ''}?text=${encodeURIComponent(msg)}`
    window.open(url, '_blank')
  }

  // ── Save indicator ──────────────────────────────────────────────────────────

  const savingLabel = saving === 'saving' ? '⏳ Salvando...'
    : saving === 'saved' ? '✓ Salvo'
    : saving === 'error' ? '✗ Erro ao salvar'
    : ''

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    // Acima do menu lateral e da barra do topo, que ficam em z-40 — em 30 a
    // tela nascia por baixo deles.
    <div className="fixed inset-0 bg-slate-100 flex flex-col" style={{ zIndex: 50 }}>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-3 shrink-0 shadow-sm">
        <button onClick={() => router.push('/dashboard/pedidos-compra')}
          className="text-slate-500 hover:text-slate-800 text-sm flex items-center gap-1 shrink-0">
          ← Voltar
        </button>
        <div className="w-px h-5 bg-slate-200" />
        <span className="font-semibold text-slate-800 text-sm">
          {pedidoId ? `Pedido #${pedidoId.slice(-6).toUpperCase()}` : 'Novo Pedido de Compra'}
        </span>
        <select value={status} onChange={e => setStatus(e.target.value as Status)}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-600">
          {STATUS_OPTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          {savingLabel && (
            <span className={`text-xs ${saving === 'saved' ? 'text-emerald-600' : saving === 'error' ? 'text-red-500' : 'text-slate-400'}`}>
              {savingLabel}
            </span>
          )}
          <button onClick={enviarWhatsApp}
            className="px-3 py-1.5 text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg font-medium">
            💬 WhatsApp
          </button>
          <button onClick={() => salvar()}
            className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium">
            💾 Salvar <span className="text-slate-400 ml-1">Ctrl+S</span>
          </button>
          <button onClick={finalizar} disabled={itens.length === 0}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg font-semibold">
            ✓ Finalizar <span className="opacity-60 ml-1">Ctrl+↵</span>
          </button>
        </div>
      </div>

      {/* ── Main layout ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT PANEL ──────────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

          {/* Order header fields */}
          <div className="bg-white border-b border-slate-100 px-4 py-3 grid grid-cols-5 gap-3 shrink-0">
            <div className="col-span-2">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Fornecedor *</label>
              <select value={fornecedorId} onChange={e => setFornecedorId(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                <option value="">Selecione o fornecedor...</option>
                {fornecedores.map(f => (
                  <option key={f.id} value={f.id}>{f.nome_fantasia || f.razao_social}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Data do pedido</label>
              <input type="date" value={dataPedido} onChange={e => setDataPedido(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Prev. entrega</label>
              <input type="date" value={previsaoEntrega} onChange={e => setPrevisaoEntrega(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Cond. pagamento</label>
              <input value={condicaoPagamento} onChange={e => setCondicaoPagamento(e.target.value)}
                placeholder="Ex: 30/60 dias"
                className="mt-1 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-5">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Observações</label>
              <input value={observacoes} onChange={e => setObservacoes(e.target.value)}
                placeholder="Observações do pedido..."
                className="mt-1 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-white border-b border-slate-100 px-4 flex items-center gap-4 shrink-0">
            <button onClick={() => setHistTab('produtos')}
              className={`py-2.5 text-xs font-semibold border-b-2 transition-colors ${histTab === 'produtos' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              Produtos
            </button>
            <button onClick={() => setHistTab('historico')}
              className={`py-2.5 text-xs font-semibold border-b-2 transition-colors ${histTab === 'historico' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              Histórico do fornecedor
            </button>
          </div>

          {histTab === 'historico' ? (
            <div className="flex-1 flex items-center justify-center text-slate-300 flex-col">
              <span className="text-4xl mb-2">📜</span>
              <p className="text-sm">Histórico de compras em desenvolvimento</p>
            </div>
          ) : (
            <>
              {/* Search + filters bar */}
              <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-3 shrink-0">
                <div className="relative flex-1 max-w-sm">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">🔍</span>
                  <input
                    ref={buscaRef}
                    value={busca}
                    onChange={e => { setBusca(e.target.value); setNavIdx(0) }}
                    placeholder="Buscar por nome, SKU, EAN... (Ctrl+F)"
                    className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    onKeyDown={e => {
                      if (e.key === 'ArrowDown') { e.preventDefault(); setNavIdx(i => Math.min(i + 1, produtosFiltrados.length - 1)) }
                      if (e.key === 'ArrowUp') { e.preventDefault(); setNavIdx(i => Math.max(i - 1, 0)) }
                      if (e.key === 'Enter' && produtosFiltrados[navIdx]) { e.preventDefault(); abrirModal(produtosFiltrados[navIdx]) }
                    }}
                  />
                </div>
                <div className="flex gap-1">
                  {FILTROS.map(f => (
                    <button key={f.key} onClick={() => { setFiltro(f.key); setNavIdx(0) }}
                      className={`px-2.5 py-1.5 text-[11px] rounded-lg font-medium transition-colors whitespace-nowrap ${filtro === f.key ? 'bg-blue-600 text-white' : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200'}`}>
                      {f.label}
                    </button>
                  ))}
                </div>
                {fornecedorId && (
                  <button onClick={sugerirPedido}
                    className="ml-auto px-3 py-1.5 text-xs bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg font-semibold whitespace-nowrap">
                    ✨ Sugerir pedido
                  </button>
                )}
              </div>

              {/* Catálogo grande demais para caber de uma vez — diz isso em vez
                  de deixar o operador concluir que o produto não existe. */}
              {limiteExtras && !erroProdutos && (
                <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 text-[11px] text-amber-800 shrink-0">
                  Mostrando os primeiros 300 produtos do catálogo{busca ? ' que combinam com a busca' : ''}.
                  {busca ? ' Refine a busca para chegar ao item certo.' : ' Digite na busca para procurar em todo o catálogo.'}
                </div>
              )}

              {/* Product table */}
              <div className="flex-1 overflow-auto">
                {!fornecedorId ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-300">
                    <span className="text-5xl mb-3">🏪</span>
                    <p className="text-sm">Selecione um fornecedor para ver os produtos</p>
                    <p className="text-xs mt-1">Os produtos comprados anteriormente aparecerão com histórico de preços</p>
                  </div>
                ) : erroProdutos ? (
                  // Antes uma falha de consulta virava lista vazia sem aviso, e a
                  // tela parecia dizer "este fornecedor não tem produto".
                  <div className="flex flex-col items-center justify-center h-full px-6 text-center">
                    <span className="text-4xl mb-2">⚠️</span>
                    <p className="text-sm font-semibold text-red-600">Não foi possível carregar os produtos</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-md">{erroProdutos}</p>
                    <button onClick={() => setBusca(b => b)} className="mt-3 text-xs text-blue-600 hover:underline">
                      Tentar de novo
                    </button>
                  </div>
                ) : loadingProdutos ? (
                  <div className="flex items-center justify-center h-full text-slate-400">
                    <div className="text-center">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      <p className="text-sm">Carregando produtos...</p>
                    </div>
                  </div>
                ) : produtosFiltrados.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-300">
                    <span className="text-4xl mb-2">📦</span>
                    <p className="text-sm">Nenhum produto encontrado</p>
                    <button onClick={() => { setFiltro('todos'); setBusca('') }} className="mt-2 text-xs text-blue-500 hover:underline">
                      Ver todos os produtos
                    </button>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                      <tr>
                        <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500">SKU</th>
                        <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500">Produto</th>
                        <th className="text-right px-3 py-2 text-[11px] font-semibold text-slate-500">Estoque</th>
                        <th className="text-right px-3 py-2 text-[11px] font-semibold text-slate-500">Mín</th>
                        <th className="text-right px-3 py-2 text-[11px] font-semibold text-slate-500">Último custo</th>
                        <th className="text-right px-3 py-2 text-[11px] font-semibold text-slate-500">Custo médio</th>
                        <th className="text-right px-3 py-2 text-[11px] font-semibold text-slate-500">Última compra</th>
                        <th className="text-right px-3 py-2 text-[11px] font-semibold text-slate-500">Qtd sugerida</th>
                        <th className="px-3 py-2 w-28"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {produtosFiltrados.map((p, idx) => {
                        const noCarrinho = itens.find(i => i.produto_id === p.id)
                        const isNav = idx === navIdx
                        const estoqueZero = p.estoque <= 0
                        const estoqueBaixo = !estoqueZero && p.estoque < p.estoque_minimo

                        return (
                          <tr
                            key={p.id}
                            onClick={() => abrirModal(p)}
                            className={`border-b border-slate-100 cursor-pointer transition-colors
                              ${isNav ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : ''}
                              ${noCarrinho ? 'bg-emerald-50 hover:bg-emerald-50' : isNav ? '' : 'hover:bg-slate-50'}
                            `}
                          >
                            <td className="px-3 py-2 font-mono text-xs text-slate-400">{p.sku || '—'}</td>
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-800 text-sm leading-tight">{p.nome}</div>
                              {p.categoria && <div className="text-xs text-slate-400">{p.categoria}</div>}
                              {!p.compradoDoFornecedor && <span className="text-[10px] text-slate-400 italic">sem histórico</span>}
                            </td>
                            <td className={`px-3 py-2 text-right text-sm font-semibold ${estoqueZero ? 'text-red-600' : estoqueBaixo ? 'text-amber-600' : 'text-slate-700'}`}>
                              {p.estoque}
                              {estoqueZero && <span className="ml-1 text-xs">🔴</span>}
                              {estoqueBaixo && <span className="ml-1 text-xs">🟡</span>}
                            </td>
                            <td className="px-3 py-2 text-right text-sm text-slate-500">{p.estoque_minimo || '—'}</td>
                            <td className="px-3 py-2 text-right text-sm text-slate-700 font-medium">
                              {p.ultimoCusto ? brl(p.ultimoCusto) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right text-xs text-slate-500">
                              {p.custoMedio ? brl(p.custoMedio) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right text-xs text-slate-400">
                              {p.ultimaCompra ? new Date(p.ultimaCompra).toLocaleDateString('pt-BR') : '—'}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {p.qtdSugerida > 0
                                ? <span className="text-sm font-bold text-blue-600">{p.qtdSugerida}</span>
                                : <span className="text-xs text-slate-300">—</span>
                              }
                            </td>
                            <td className="px-3 py-2 text-right">
                              {noCarrinho ? (
                                <span className="inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">
                                  ✓ {noCarrinho.quantidade} {noCarrinho.unidade}
                                </span>
                              ) : (
                                <button onClick={e => { e.stopPropagation(); abrirModal(p) }}
                                  className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 px-2.5 py-1 rounded-lg font-medium">
                                  + Adicionar
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Bottom keyboard hint */}
              <div className="bg-white border-t border-slate-100 px-4 py-1.5 flex gap-4 text-[10px] text-slate-400 shrink-0">
                <span>↑↓ Navegar</span>
                <span>↵ Adicionar</span>
                <span>ESC Fechar modal</span>
                <span>Ctrl+S Salvar</span>
                <span>Ctrl+↵ Finalizar</span>
                <span>Ctrl+F Buscar</span>
                <span className="ml-auto">{produtosFiltrados.length} produto(s)</span>
              </div>
            </>
          )}
        </div>

        {/* ── RIGHT PANEL: Cart ────────────────────────────────────────────── */}
        <div className="w-80 bg-white border-l border-slate-200 flex flex-col shrink-0">
          {/* Cart header */}
          <div className="px-4 py-3 border-b border-slate-100 shrink-0">
            <h3 className="font-bold text-slate-800 text-sm">🛒 Itens do pedido</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {itens.length} produto(s) · {itens.reduce((s, i) => s + i.quantidade, 0)} unidades
            </p>
          </div>

          {/* Cart items */}
          <div className="flex-1 overflow-auto">
            {itens.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-200 text-xs gap-1">
                <span className="text-4xl">🛒</span>
                <p>Nenhum item adicionado</p>
                <p className="text-center px-4 text-[10px] text-slate-300">Clique em um produto ou pressione ↵ na lista</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {itens.map(item => {
                  const custoSubiu = item.ultimoCusto > 0 && item.custo_unitario > item.ultimoCusto * 1.03
                  const margem = item.preco_venda > 0 ? ((item.preco_venda - item.custo_unitario) / item.preco_venda) * 100 : null
                  const margemBaixa = margem !== null && margem < 15

                  return (
                    <div key={item.produto_id} className="px-3 py-2.5 group">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-800 leading-tight">{item.nome}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">{item.sku && `${item.sku} · `}{item.unidade}</p>
                          {custoSubiu && (
                            <p className="text-[10px] text-amber-600 font-medium mt-0.5">
                              ⚠ Custo acima do anterior ({brl(item.ultimoCusto)})
                            </p>
                          )}
                          {margemBaixa && (
                            <p className="text-[10px] text-red-500 font-medium">
                              ⚠ Margem baixa ({margem?.toFixed(0)}%)
                            </p>
                          )}
                        </div>
                        <button onClick={() => removerItem(item.produto_id)}
                          className="text-slate-200 hover:text-red-500 transition-colors text-sm opacity-0 group-hover:opacity-100 shrink-0">
                          ✕
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <input
                          type="number"
                          value={item.quantidade}
                          onChange={e => editarItemQtd(item.produto_id, Number(e.target.value) || 0)}
                          className="w-16 text-right border border-slate-200 rounded px-1.5 py-0.5 text-xs"
                          min="0"
                        />
                        <span className="text-xs text-slate-400">×</span>
                        <span className="text-xs text-slate-600">{brl(item.custo_unitario)}</span>
                        <span className="ml-auto text-xs font-bold text-slate-800">{brl(item.total)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="border-t border-slate-200 px-3 py-3 space-y-2 bg-slate-50 shrink-0">
            <div className="flex justify-between text-xs text-slate-600">
              <span>Subtotal</span>
              <span className="font-medium">{brl(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>Desconto (R$)</span>
              <input type="number" value={descontoGeral || ''} onChange={e => setDescontoGeral(Number(e.target.value) || 0)}
                placeholder="0,00" className="w-24 text-right border border-slate-200 rounded px-1.5 py-0.5 text-xs bg-white" />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>Frete</span>
              <input type="number" value={frete || ''} onChange={e => setFrete(Number(e.target.value) || 0)}
                placeholder="0,00" className="w-24 text-right border border-slate-200 rounded px-1.5 py-0.5 text-xs bg-white" />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>Outras despesas</span>
              <input type="number" value={outrasDespesas || ''} onChange={e => setOutrasDespesas(Number(e.target.value) || 0)}
                placeholder="0,00" className="w-24 text-right border border-slate-200 rounded px-1.5 py-0.5 text-xs bg-white" />
            </div>
            <div className="flex justify-between text-sm font-bold text-slate-800 pt-2 border-t border-slate-300">
              <span>Total geral</span>
              <span>{brl(totalGeral)}</span>
            </div>
          </div>

          {/* Cart actions */}
          <div className="px-3 py-3 space-y-2 border-t border-slate-200 shrink-0">
            <button onClick={() => salvar()}
              className="w-full py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700 font-medium">
              💾 Salvar rascunho
            </button>
            <button onClick={finalizar} disabled={itens.length === 0}
              className="w-full py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl font-semibold">
              ✓ Finalizar pedido
            </button>
            <button onClick={enviarWhatsApp} disabled={!fornecedorId}
              className="w-full py-2 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl font-medium">
              💬 Enviar por WhatsApp
            </button>
          </div>
        </div>
      </div>

      {/* ── Quick Add Modal ──────────────────────────────────────────────────── */}
      {modalProduto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setModalProduto(null) }}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-[500px] p-6"
            onKeyDown={e => {
              if (e.key === 'Escape') { e.stopPropagation(); setModalProduto(null) }
              if (e.key === 'Enter') {
                e.preventDefault()
                if (document.activeElement === modalQtdRef.current) {
                  modalCustoRef.current?.focus()
                } else {
                  confirmarModal()
                }
              }
            }}
          >
            {/* Modal header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-slate-800 text-base leading-tight">{modalProduto.nome}</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {modalProduto.sku && `SKU: ${modalProduto.sku}`}
                  {modalProduto.categoria && ` · ${modalProduto.categoria}`}
                </p>
              </div>
              <button onClick={() => setModalProduto(null)} className="text-slate-300 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>

            {/* Info grid */}
            <div className="grid grid-cols-3 gap-2 mb-5 p-3 bg-slate-50 rounded-xl">
              {[
                { label: 'Estoque atual', value: `${modalProduto.estoque} ${modalProduto.unidade}`, alert: modalProduto.estoque <= 0 ? 'red' : modalProduto.estoque < modalProduto.estoque_minimo ? 'amber' : null },
                { label: 'Est. mínimo', value: modalProduto.estoque_minimo || '—' },
                { label: 'Qtd sugerida', value: modalProduto.qtdSugerida || '—', highlight: true },
                { label: 'Último custo', value: modalProduto.ultimoCusto ? brl(modalProduto.ultimoCusto) : '—' },
                { label: 'Custo médio', value: modalProduto.custoMedio ? brl(modalProduto.custoMedio) : '—' },
                { label: 'Última compra', value: modalProduto.ultimaCompra ? new Date(modalProduto.ultimaCompra).toLocaleDateString('pt-BR') : '—' },
              ].map((info, i) => (
                <div key={i} className="text-center">
                  <p className="text-[10px] text-slate-400 font-medium">{info.label}</p>
                  <p className={`text-sm font-bold mt-0.5 ${
                    (info as { alert?: string | null }).alert === 'red' ? 'text-red-600'
                    : (info as { alert?: string | null }).alert === 'amber' ? 'text-amber-600'
                    : (info as { highlight?: boolean }).highlight ? 'text-blue-600'
                    : 'text-slate-700'
                  }`}>
                    {String(info.value)}
                  </p>
                </div>
              ))}
            </div>

            {/* Form fields */}
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">Quantidade * <span className="text-slate-400 font-normal">(cursor aqui ao abrir)</span></label>
                <input
                  ref={modalQtdRef}
                  type="number"
                  value={modalQtd}
                  onChange={e => setModalQtd(e.target.value)}
                  placeholder={modalProduto.qtdSugerida ? `Sugerido: ${modalProduto.qtdSugerida}` : modalProduto.ultimaQtd ? `Anterior: ${modalProduto.ultimaQtd}` : 'Informe a quantidade'}
                  className="mt-1 w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-base font-bold focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600">Custo unitário *</label>
                {parseFloat(modalCusto) > modalProduto.ultimoCusto * 1.05 && modalProduto.ultimoCusto > 0 && (
                  <p className="text-[11px] text-amber-600 font-medium mt-0.5">
                    ⚠ Custo {(((parseFloat(modalCusto) / modalProduto.ultimoCusto) - 1) * 100).toFixed(1)}% acima do último ({brl(modalProduto.ultimoCusto)})
                  </p>
                )}
                <input
                  ref={modalCustoRef}
                  type="number"
                  step="0.01"
                  value={modalCusto}
                  onChange={e => setModalCusto(e.target.value)}
                  className="mt-1 w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600">Desconto (%)</label>
                  <input type="number" min="0" max="100" value={modalDesconto} onChange={e => setModalDesconto(e.target.value)}
                    className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600">Total do item</label>
                  <div className="mt-1 w-full border border-slate-100 bg-slate-50 rounded-xl px-3 py-2 text-sm font-bold text-slate-700">
                    {brl((parseFloat(modalQtd) || 0) * (parseFloat(modalCusto) || 0) * (1 - (parseFloat(modalDesconto) || 0) / 100))}
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600">Observação do item</label>
                <input value={modalObs} onChange={e => setModalObs(e.target.value)}
                  placeholder="Opcional..."
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            {/* Modal actions */}
            <div className="flex gap-2 mt-5">
              <button onClick={() => setModalProduto(null)}
                className="flex-1 py-2.5 text-sm border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 font-medium">
                ESC Cancelar
              </button>
              <button onClick={confirmarModal}
                className="flex-2 flex-1 py-2.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold">
                ↵ {itens.find(i => i.produto_id === modalProduto.id) ? 'Atualizar item' : 'Adicionar ao pedido'}
              </button>
            </div>
            <p className="text-center text-[10px] text-slate-400 mt-2">Pressione ↵ para avançar entre campos · ESC para fechar</p>
          </div>
        </div>
      )}
    </div>
  )
}
