'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { criarClienteSemCache } from '@/lib/monitor-vendas/clienteSemCache'
import { buscarTudo } from '@/lib/supabase/paginar'
import { carregarVendasUnificadas } from '@/lib/monitor-vendas/carregarVendas'
import { inicioDoDia, inicioDeDiasAtras } from '@/lib/datas'
import {
  construirIndiceProdutos, calcularLucroVenda, estoqueDoProduto, custoDoItem, markupItem,
  corMarkup, corMargem, situacaoEstoque, sugestaoDeCompra,
  type Venda, type ProdutoCache, type ItemVendido, type KitComponente, type IndiceProdutos, type CorBadge,
} from '@/lib/monitor-vendas/calculos'
import { inserirNoInventarioMonitor } from '@/lib/monitor-vendas/inventarioMonitor'
import FaltaModal, { type AlvoFalta, type FaltaResumo } from './FaltaModal'

// Monitor de Vendas — acompanhamento quase em tempo real, pensado tanto para
// uma tela normal do painel quanto para ficar ligado numa TV do balcão.
//
// As vendas vêm de duas fontes já unificadas em `Venda` (ver
// `lib/monitor-vendas/carregarVendas.ts`): PDV/app (itens embutidos em JSONB)
// e marketplace (Shopee/ML/Nuvemshop, itens numa tabela própria). Daqui pra
// baixo não existe mais distinção — os cálculos de lucro/estoque tratam as
// duas fontes exatamente igual.

type KitItemBruto = { kit_id: string; produto_id: string; quantidade: number; controla_estoque: boolean | null }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const TEXTO_COR: Record<CorBadge, string> = {
  verde: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  laranja: 'text-orange-600 bg-orange-50 border-orange-200',
  vermelho: 'text-red-600 bg-red-50 border-red-200',
}

type Periodo = 'hoje' | 'ontem' | '7dias' | 'personalizado'

function intervaloDoPeriodo(periodo: Periodo, inicioCustom: string, fimCustom: string): { inicio: Date; fim: Date } {
  const agora = new Date()
  if (periodo === 'hoje') return { inicio: inicioDoDia(agora), fim: agora }
  if (periodo === 'ontem') return { inicio: inicioDeDiasAtras(1, agora), fim: inicioDoDia(agora) }
  if (periodo === '7dias') return { inicio: inicioDeDiasAtras(7, agora), fim: agora }
  // Personalizado: os inputs <input type="date"> vêm em AAAA-MM-DD, sem fuso —
  // ancora explicitamente em -03:00 (Brasil não tem mais horário de verão).
  const inicio = inicioCustom ? new Date(`${inicioCustom}T00:00:00-03:00`) : inicioDoDia(agora)
  const fim = fimCustom ? new Date(`${fimCustom}T23:59:59-03:00`) : agora
  return { inicio, fim }
}

export default function MonitorVendasClient({
  vendasIniciais, produtosIniciais, kitItensIniciais, faltasIniciais, empresaId, operador, limiteVendas,
}: {
  vendasIniciais: Venda[]
  produtosIniciais: ProdutoCache[]
  kitItensIniciais: KitItemBruto[]
  faltasIniciais: FaltaResumo[]
  empresaId: string
  operador: string
  limiteVendas: number
}) {
  const sb = criarClienteSemCache()

  const [vendas, setVendas] = useState(vendasIniciais)
  const [produtos, setProdutos] = useState(produtosIniciais)
  const [kitItensBrutos, setKitItensBrutos] = useState(kitItensIniciais)
  const [faltas, setFaltas] = useState(faltasIniciais)
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState(new Date())
  const [atualizando, setAtualizando] = useState(false)

  const [telaCheia, setTelaCheia] = useState(false)
  const [aba, setAba] = useState<'venda' | 'produto'>('venda')

  // ── Filtros ──────────────────────────────────────────────────────────────
  const [periodo, setPeriodo] = useState<Periodo>('hoje')
  const [inicioCustom, setInicioCustom] = useState('')
  const [fimCustom, setFimCustom] = useState('')
  const canaisDisponiveis = useMemo(
    () => [...new Set(vendasIniciais.map(v => v.canal))].sort(),
    [vendasIniciais],
  )
  const [canaisSelecionados, setCanaisSelecionados] = useState<Set<string>>(new Set(canaisDisponiveis))
  const [vendedorBusca, setVendedorBusca] = useState('')
  const [produtoBusca, setProdutoBusca] = useState('')
  const [somenteEstoqueBaixo, setSomenteEstoqueBaixo] = useState(false)
  const [somenteCustoZero, setSomenteCustoZero] = useState(false)

  const [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const [modalFalta, setModalFalta] = useState<AlvoFalta | null>(null)
  const [ordenacaoProduto, setOrdenacaoProduto] = useState<'tempo' | 'quantidade' | 'valor'>('quantidade')

  // ── Índices derivados do catálogo ───────────────────────────────────────
  const indice: IndiceProdutos = useMemo(() => construirIndiceProdutos(produtos), [produtos])
  const componentesPorKit = useMemo(() => {
    const mapa = new Map<string, KitComponente[]>()
    for (const k of kitItensBrutos) {
      const lista = mapa.get(k.kit_id) ?? []
      lista.push({ produtoId: k.produto_id, quantidade: Number(k.quantidade) || 1, controlaEstoque: k.controla_estoque !== false })
      mapa.set(k.kit_id, lista)
    }
    return mapa
  }, [kitItensBrutos])
  const catalogoCarregado = produtos.length > 0

  const faltasPendentesPorProduto = useMemo(() => {
    const mapa = new Map<string, { quantidade: number; ids: string[] }>()
    for (const f of faltas) {
      const chave = f.produto_id ?? `nome:${f.produto_nome.trim().toLowerCase()}`
      const atual = mapa.get(chave) ?? { quantidade: 0, ids: [] }
      atual.quantidade += Number(f.quantidade_solicitada ?? 0)
      atual.ids.push(f.id)
      mapa.set(chave, atual)
    }
    return mapa
  }, [faltas])

  function chaveProduto(produtoId: string | null, nome: string) {
    return produtoId ?? `nome:${nome.trim().toLowerCase()}`
  }

  // ── Filtragem em memória (as vendas já vieram do banco; período/canal/
  //     vendedor/produto/flags combinam aqui, sem ida nenhuma ao servidor) ──
  const { inicio, fim } = useMemo(
    () => intervaloDoPeriodo(periodo, inicioCustom, fimCustom),
    [periodo, inicioCustom, fimCustom],
  )

  const vendasComCalculo = useMemo(() => {
    return vendas.map(v => {
      const itens = Array.isArray(v.itens) ? v.itens : []
      const calc = calcularLucroVenda(Number(v.total) || 0, Number(v.desconto_total) || 0, itens, indice, componentesPorKit)
      const temEstoqueBaixo = itens.some(it => {
        const produto = it.produto_id ? indice.porId.get(it.produto_id) : undefined
        const achou = !!produto || !!indice.porNome.get(it.produto_nome.trim().toLowerCase())
        const p = produto ?? indice.porNome.get(it.produto_nome.trim().toLowerCase())
        const estoqueAtual = p ? estoqueDoProduto(p, componentesPorKit, indice) : 0
        const sit = situacaoEstoque(achou, estoqueAtual, p?.estoqueMinimo ?? 0)
        return sit === 'baixo' || sit === 'zerado'
      })
      return { venda: v, itens, ...calc, temEstoqueBaixo }
    })
  }, [vendas, indice, componentesPorKit])

  const filtradas = useMemo(() => {
    const t0 = inicio.getTime()
    const t1 = fim.getTime()
    const vendedorAlvo = vendedorBusca.trim().toLowerCase()
    const produtoAlvo = produtoBusca.trim().toLowerCase()
    return vendasComCalculo.filter(vc => {
      const t = new Date(vc.venda.created_at).getTime()
      if (t < t0 || t > t1) return false
      const canal = vc.venda.canal
      if (canaisSelecionados.size > 0 && !canaisSelecionados.has(canal)) return false
      if (vendedorAlvo && !(vc.venda.vendedor_nome ?? '').toLowerCase().includes(vendedorAlvo)) return false
      if (produtoAlvo && !vc.itens.some(it => it.produto_nome.toLowerCase().includes(produtoAlvo))) return false
      if (somenteEstoqueBaixo && !vc.temEstoqueBaixo) return false
      if (somenteCustoZero && !vc.temItemSemCusto) return false
      return true
    })
  }, [vendasComCalculo, inicio, fim, canaisSelecionados, vendedorBusca, produtoBusca, somenteEstoqueBaixo, somenteCustoZero])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalVendas = filtradas.length
    const totalVendido = filtradas.reduce((s, v) => s + (Number(v.venda.total) || 0), 0)
    const custoTotal = filtradas.reduce((s, v) => s + v.custoTotal, 0)
    const descontos = filtradas.reduce((s, v) => s + (Number(v.venda.desconto_total) || 0), 0)
    const lucroReal = filtradas.reduce((s, v) => s + v.lucro, 0)
    const margemReal = totalVendido > 0 ? (lucroReal / totalVendido) * 100 : 0
    const ticketMedio = totalVendas > 0 ? totalVendido / totalVendas : 0

    const porProdutoQtd = new Map<string, { nome: string; qtd: number }>()
    const porVendedor = new Map<string, number>()
    for (const vc of filtradas) {
      const vendedor = vc.venda.vendedor_nome || 'Sem vendedor'
      porVendedor.set(vendedor, (porVendedor.get(vendedor) ?? 0) + (Number(vc.venda.total) || 0))
      for (const it of vc.itens) {
        const chave = chaveProduto(it.produto_id, it.produto_nome)
        const atual = porProdutoQtd.get(chave) ?? { nome: it.produto_nome, qtd: 0 }
        atual.qtd += Number(it.quantidade) || 0
        porProdutoQtd.set(chave, atual)
      }
    }
    let produtoDestaque: { nome: string; qtd: number } | null = null
    for (const p of porProdutoQtd.values()) if (!produtoDestaque || p.qtd > produtoDestaque.qtd) produtoDestaque = p
    let vendedorDestaque: { nome: string; total: number } | null = null
    for (const [nome, total] of porVendedor) if (!vendedorDestaque || total > vendedorDestaque.total) vendedorDestaque = { nome, total }

    return { totalVendas, totalVendido, custoTotal, descontos, lucroReal, margemReal, ticketMedio, produtoDestaque, vendedorDestaque }
  }, [filtradas])

  // ── Consolidação "Por Produto" ──────────────────────────────────────────
  type LinhaProduto = {
    chave: string; nome: string; sku: string | null; produtoId: string | null
    qtd: number; totalVendido: number; custoTotal: number; lucro: number
    estoqueAtual: number; estoqueMinimo: number; achouNoCadastro: boolean
    ultimaVenda: string
  }
  const porProduto = useMemo<LinhaProduto[]>(() => {
    const mapa = new Map<string, LinhaProduto>()
    for (const vc of filtradas) {
      for (const it of vc.itens) {
        const chave = chaveProduto(it.produto_id, it.produto_nome)
        const { custo, produto } = custoDoItem(it, indice, componentesPorKit)
        const qtd = Number(it.quantidade) || 0
        let linha = mapa.get(chave)
        if (!linha) {
          linha = {
            chave, nome: it.produto_nome, sku: it.produto_sku, produtoId: it.produto_id,
            qtd: 0, totalVendido: 0, custoTotal: 0, lucro: 0,
            estoqueAtual: produto ? estoqueDoProduto(produto, componentesPorKit, indice) : 0,
            estoqueMinimo: produto?.estoqueMinimo ?? 0,
            achouNoCadastro: !!produto,
            ultimaVenda: vc.venda.created_at,
          }
          mapa.set(chave, linha)
        }
        linha.qtd += qtd
        linha.totalVendido += Number(it.subtotal) || 0
        linha.custoTotal += custo * qtd
        // `filtradas` já vem da mais recente para a mais antiga (ordem de
        // `vendas`), então a primeira vez que a chave aparece já é a venda
        // mais recente — mas o max() abaixo é defensivo contra isso mudar.
        if (vc.venda.created_at > linha.ultimaVenda) linha.ultimaVenda = vc.venda.created_at
      }
    }
    for (const linha of mapa.values()) linha.lucro = linha.totalVendido - linha.custoTotal
    const linhas = [...mapa.values()]
    if (ordenacaoProduto === 'tempo') return linhas.sort((a, b) => b.ultimaVenda.localeCompare(a.ultimaVenda))
    if (ordenacaoProduto === 'valor') return linhas.sort((a, b) => b.totalVendido - a.totalVendido)
    return linhas.sort((a, b) => b.qtd - a.qtd)
  }, [filtradas, indice, componentesPorKit, ordenacaoProduto])

  // ── Carregar dados de novo (auto-refresh + botão manual) ────────────────
  async function carregarDados() {
    setAtualizando(true)
    try {
      const [novasVendas, novosProdutos, novasFaltas] = await Promise.all([
        carregarVendasUnificadas(sb, empresaId, limiteVendas),
        buscarTudo<any>(
          (de, ate) => sb.from('produtos')
            .select('id, nome, sku, ean, categoria, marca, unidade, preco_custo, estoque, estoque_minimo, tipo, ativo')
            .eq('empresa_id', empresaId)
            .order('id', { ascending: true })
            .range(de, ate) as any,
          { rotulo: 'monitor-vendas/produtos (refresh)' },
        ),
        sb.from('faltas')
          .select('id, produto_id, produto_nome, quantidade_solicitada, status')
          .eq('empresa_id', empresaId)
          .in('status', ['pendente', 'em_analise', 'em_compra', 'pedido', 'recebido', 'notificado', 'comprado'])
          .order('created_at', { ascending: false })
          .limit(1000),
      ])
      setVendas(novasVendas)
      setProdutos(novosProdutos.map(p => ({
        id: p.id, nome: p.nome, sku: p.sku ?? null,
        ean: p.ean ?? null, categoria: p.categoria ?? null, marca: p.marca ?? null, unidade: p.unidade ?? 'UN',
        custo: Number(p.preco_custo ?? 0),
        estoque: Number(p.estoque ?? 0), estoqueMinimo: Number(p.estoque_minimo ?? 0),
        tipo: p.tipo ?? 'simples', ativo: p.ativo !== false,
      })))
      const kitIds = novosProdutos.filter(p => p.tipo === 'kit').map(p => p.id)
      if (kitIds.length > 0) {
        const novosKitItens = await buscarTudo<KitItemBruto>(
          (de, ate) => sb.from('kit_itens')
            .select('kit_id, produto_id, quantidade, controla_estoque')
            .in('kit_id', kitIds)
            .order('id', { ascending: true })
            .range(de, ate) as any,
          { rotulo: 'monitor-vendas/kit_itens (refresh)' },
        )
        setKitItensBrutos(novosKitItens)
      } else {
        setKitItensBrutos([])
      }
      setFaltas(novasFaltas.data ?? [])
      setUltimaAtualizacao(new Date())
    } finally {
      setAtualizando(false)
    }
  }

  useEffect(() => {
    const id = setInterval(() => { carregarDados() }, 60_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, limiteVendas])

  function alternarExpandida(id: string) {
    setExpandidas(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function alternarCanal(canal: string) {
    setCanaisSelecionados(prev => {
      const n = new Set(prev)
      if (n.has(canal)) n.delete(canal); else n.add(canal)
      return n
    })
  }

  function abrirFalta(alvo: AlvoFalta) { setModalFalta(alvo) }
  function faltaSalva(falta: FaltaResumo) {
    setFaltas(prev => [falta, ...prev])
    setModalFalta(null)
  }

  const conteudo = (
    <div className="space-y-4">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-slate-900 text-xl font-bold">📡 Monitor de Vendas</h1>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-white">
            {kpis.totalVendas}
          </span>
        </div>
        <span className="text-xs text-slate-400">
          Atualizado às {ultimaAtualizacao.toLocaleTimeString('pt-BR')}
        </span>
        <button onClick={carregarDados} disabled={atualizando}
          title="Atualizar agora"
          className="text-slate-500 hover:text-slate-800 disabled:opacity-50">
          <span className={atualizando ? 'inline-block animate-spin' : 'inline-block'}>🔄</span>
        </button>
        <button onClick={() => setTelaCheia(f => !f)}
          className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-white hover:bg-slate-700">
          {telaCheia ? '✕ Sair do modo monitor' : '⛶ Modo monitor (TV)'}
        </button>
      </div>

      {/* ── Filtros ─────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-wrap items-center gap-2">
        <select value={periodo} onChange={e => setPeriodo(e.target.value as Periodo)}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs">
          <option value="hoje">Hoje</option>
          <option value="ontem">Ontem</option>
          <option value="7dias">Últimos 7 dias</option>
          <option value="personalizado">Personalizado</option>
        </select>
        {periodo === 'personalizado' && (
          <>
            <input type="date" value={inicioCustom} onChange={e => setInicioCustom(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
            <span className="text-slate-400 text-xs">até</span>
            <input type="date" value={fimCustom} onChange={e => setFimCustom(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
          </>
        )}

        <div className="flex items-center gap-1 border-l border-slate-200 pl-2">
          {canaisDisponiveis.map(c => (
            <button key={c} onClick={() => alternarCanal(c)}
              className={`px-2 py-1 rounded-md text-[11px] font-medium border ${
                canaisSelecionados.has(c) ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'
              }`}>
              {c}
            </button>
          ))}
        </div>

        <input value={vendedorBusca} onChange={e => setVendedorBusca(e.target.value)}
          placeholder="Vendedor..."
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs w-28" />
        <input value={produtoBusca} onChange={e => setProdutoBusca(e.target.value)}
          placeholder="Produto..."
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs w-36" />

        <label className="flex items-center gap-1.5 text-[11px] text-slate-600 border-l border-slate-200 pl-2">
          <input type="checkbox" checked={somenteEstoqueBaixo} onChange={e => setSomenteEstoqueBaixo(e.target.checked)} />
          Só estoque baixo
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <input type="checkbox" checked={somenteCustoZero} onChange={e => setSomenteCustoZero(e.target.checked)} />
          Só custo zero
        </label>
      </div>

      {!catalogoCarregado && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Catálogo de produtos ainda não carregado — os números de custo/lucro abaixo não são confiáveis ainda.
        </div>
      )}

      {/* ── KPIs linha 1 ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Total de Vendas" valor={String(kpis.totalVendas)} carregando={!catalogoCarregado} />
        <Kpi label="Total Vendido" valor={brl(kpis.totalVendido)} carregando={!catalogoCarregado} />
        <Kpi label="Custo Total" valor={brl(kpis.custoTotal)} carregando={!catalogoCarregado} />
        <Kpi label="Taxas/Descontos" valor={brl(kpis.descontos)} carregando={!catalogoCarregado} />
        <Kpi label="Lucro Real" valor={brl(kpis.lucroReal)} carregando={!catalogoCarregado}
          cor={kpis.lucroReal < 0 ? 'vermelho' : 'verde'} />
        <Kpi label="Margem Real" valor={pct(kpis.margemReal)} carregando={!catalogoCarregado}
          cor={corMargem(kpis.margemReal)} />
      </div>

      {/* ── KPIs linha 2 ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Kpi label="Ticket Médio" valor={brl(kpis.ticketMedio)} carregando={!catalogoCarregado} />
        <Kpi label="Produto Mais Vendido"
          valor={kpis.produtoDestaque ? `${kpis.produtoDestaque.nome} (${kpis.produtoDestaque.qtd})` : '—'}
          carregando={!catalogoCarregado} pequeno />
        <Kpi label="Vendedor Destaque"
          valor={kpis.vendedorDestaque ? `${kpis.vendedorDestaque.nome} — ${brl(kpis.vendedorDestaque.total)}` : '—'}
          carregando={!catalogoCarregado} pequeno />
      </div>

      {/* ── Abas ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <button onClick={() => setAba('venda')}
          className={`px-4 py-2 text-sm border-b-2 ${aba === 'venda' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500'}`}>
          Por Venda
        </button>
        <button onClick={() => setAba('produto')}
          className={`px-4 py-2 text-sm border-b-2 ${aba === 'produto' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500'}`}>
          Por Produto
        </button>
        {aba === 'produto' && (
          <div className="ml-auto flex items-center gap-1.5 pb-1.5 text-[11px]">
            <span className="text-slate-400">Ordenar por</span>
            {(['tempo', 'quantidade', 'valor'] as const).map(opcao => (
              <button key={opcao} onClick={() => setOrdenacaoProduto(opcao)}
                className={`px-2 py-1 rounded-md font-medium border ${
                  ordenacaoProduto === opcao ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'
                }`}>
                {opcao === 'tempo' ? 'Mais recente' : opcao === 'quantidade' ? 'Quantidade' : 'Valor'}
              </button>
            ))}
          </div>
        )}
      </div>

      {aba === 'venda' ? (
        filtradas.length === 0 ? (
          <EstadoVazio texto="Nenhuma venda no período." />
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="w-6"></th>
                  <th className="text-left px-3 py-2 font-medium">Hora</th>
                  <th className="text-left px-3 py-2 font-medium">Canal</th>
                  <th className="text-left px-3 py-2 font-medium">Cliente</th>
                  <th className="text-left px-3 py-2 font-medium">Vendedor</th>
                  <th className="text-right px-3 py-2 font-medium">Total</th>
                  <th className="text-right px-3 py-2 font-medium">Custo</th>
                  <th className="text-right px-3 py-2 font-medium">Lucro</th>
                  <th className="text-right px-3 py-2 font-medium">Margem</th>
                  <th className="text-center px-3 py-2 font-medium">Status</th>
                  <th className="text-right px-3 py-2 font-medium">Itens</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map(vc => {
                  const v = vc.venda
                  const aberta = expandidas.has(v.id)
                  const corLucro = vc.lucro < 0 ? 'text-red-600' : 'text-emerald-600'
                  return (
                    <Fragment key={v.id}>
                      <tr
                        onClick={() => alternarExpandida(v.id)}
                        className="border-t border-slate-100 hover:bg-slate-50/70 cursor-pointer">
                        <td className="pl-3 text-slate-300">{aberta ? '▾' : '▸'}</td>
                        <td className="px-3 py-2 text-slate-500">{hora(v.created_at)}</td>
                        <td className="px-3 py-2"><BadgeCanal canal={v.canal} nome={v.canalNome} /></td>
                        <td className="px-3 py-2 text-slate-700">{v.cliente_nome ?? <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-2 text-slate-600">{v.vendedor_nome ?? '—'}</td>
                        <td className="px-3 py-2 text-right font-medium text-slate-800">{brl(Number(v.total) || 0)}</td>
                        <td className="px-3 py-2 text-right text-slate-500">{brl(vc.custoTotal)}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${corLucro}`}>
                          {brl(vc.lucro)}{vc.temItemSemCusto && <span title="Algum item sem custo cadastrado — lucro não confiável" className="ml-1">⚠</span>}
                        </td>
                        <td className={`px-3 py-2 text-right ${TEXTO_COR[corMargem(vc.margem)].split(' ')[0]}`}>{pct(vc.margem)}</td>
                        <td className="px-3 py-2 text-center">{v.status === 'concluida' ? '✓' : '○'}</td>
                        <td className="px-3 py-2 text-right text-slate-500">{vc.itens.length}</td>
                        <td className="px-3 py-2 text-center text-slate-300"
                          title="Ver detalhe completo da venda"
                          onClick={e => { e.stopPropagation(); alternarExpandida(v.id) }}>🔍</td>
                      </tr>
                      {aberta && (
                        <tr>
                          <td colSpan={12} className="bg-slate-50/60 p-0">
                            <ItensDaVenda
                              venda={v} itens={vc.itens} indice={indice} componentesPorKit={componentesPorKit}
                              faltasPendentesPorProduto={faltasPendentesPorProduto}
                              onFalta={abrirFalta} chaveProduto={chaveProduto} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        porProduto.length === 0 ? (
          <EstadoVazio texto="Nenhum item no período." />
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Produto</th>
                  <th className="text-right px-3 py-2 font-medium">Qtd Vendida</th>
                  <th className="text-right px-3 py-2 font-medium">Total Vendido</th>
                  <th className="text-right px-3 py-2 font-medium">Custo Total</th>
                  <th className="text-right px-3 py-2 font-medium">Lucro</th>
                  <th className="text-right px-3 py-2 font-medium">Estoque Atual</th>
                  <th className="text-right px-3 py-2 font-medium">Estoque Mínimo</th>
                  <th className="text-right px-3 py-2 font-medium">Sugestão de Compra</th>
                  <th className="w-24"></th>
                  <th className="w-32"></th>
                </tr>
              </thead>
              <tbody>
                {porProduto.map(p => {
                  const sit = situacaoEstoque(p.achouNoCadastro, p.estoqueAtual, p.estoqueMinimo)
                  const fundo = sit === 'zerado' ? 'bg-red-50' : sit === 'baixo' ? 'bg-amber-50' : ''
                  const sugestao = sugestaoDeCompra(p.estoqueAtual, p.estoqueMinimo, p.qtd)
                  const chave = chaveProduto(p.produtoId, p.nome)
                  const produtoCache = p.produtoId ? indice.porId.get(p.produtoId) : undefined
                  return (
                    <tr key={p.chave} className={`border-t border-slate-100 ${fundo}`}>
                      <td className="px-3 py-2">
                        <div className="text-slate-800 font-medium">{p.nome}</div>
                        {p.sku && <div className="text-[11px] text-slate-400">{p.sku}</div>}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{p.qtd}</td>
                      <td className="px-3 py-2 text-right">{brl(p.totalVendido)}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{brl(p.custoTotal)}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${p.lucro < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{brl(p.lucro)}</td>
                      <td className="px-3 py-2 text-right"><BadgeEstoque situacao={sit} valor={p.estoqueAtual} /></td>
                      <td className="px-3 py-2 text-right text-slate-500">{p.estoqueMinimo}</td>
                      <td className="px-3 py-2 text-right font-medium">{sugestao === 0 ? <span className="text-emerald-600">OK</span> : sugestao}</td>
                      <td className="px-3 py-2 text-center">
                        <BotaoFalta chave={chave} pendente={faltasPendentesPorProduto.get(chave)}
                          onClick={() => abrirFalta({ produtoId: p.produtoId, produtoNome: p.nome, produtoSku: p.sku, quantidadeSugerida: sugestao || p.qtd })} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <BotaoConferirEstoque produto={produtoCache} sb={sb} empresaId={empresaId} operador={operador} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      <p className="text-[11px] text-slate-400 text-center pt-2">Atualização automática a cada 1 minuto.</p>
    </div>
  )

  return (
    <>
      {telaCheia ? (
        <div className="fixed inset-0 z-50 bg-white overflow-auto p-6">{conteudo}</div>
      ) : conteudo}
      {modalFalta && (
        <FaltaModal
          alvo={modalFalta}
          empresaId={empresaId}
          operador={operador}
          faltasPendentes={faltasPendentesPorProduto.get(chaveProduto(modalFalta.produtoId, modalFalta.produtoNome))}
          onFechar={() => setModalFalta(null)}
          onSalvo={faltaSalva}
        />
      )}
    </>
  )
}

// ── Peças ──────────────────────────────────────────────────────────────────

function Kpi({ label, valor, cor, carregando, pequeno }: {
  label: string; valor: string; cor?: CorBadge; carregando?: boolean; pequeno?: boolean
}) {
  const classeCor = cor ? TEXTO_COR[cor].split(' ')[0] : 'text-slate-800'
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`mt-1 font-semibold ${pequeno ? 'text-sm' : 'text-lg'} ${classeCor} truncate`}>
        {carregando ? '...' : valor}
      </div>
    </div>
  )
}

function EstadoVazio({ texto }: { texto: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl px-6 py-12 text-center text-slate-400 text-sm">
      {texto}
    </div>
  )
}

const COR_GRUPO_CANAL: Record<string, string> = {
  PDV: 'bg-blue-50 text-blue-700 border-blue-200',
  APP: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  Marketplace: 'bg-orange-50 text-orange-700 border-orange-200',
}

/** Mostra o rótulo específico ("Shopee Ouro"), colorido pelo grupo (PDV/APP/Marketplace). */
function BadgeCanal({ canal, nome }: { canal: string; nome: string }) {
  const cor = COR_GRUPO_CANAL[canal] ?? 'bg-slate-50 text-slate-600 border-slate-200'
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium border ${cor}`}>{nome}</span>
}

function BadgeEstoque({ situacao, valor }: { situacao: 'zerado' | 'baixo' | 'ok' | 'nao_vinculado'; valor: number }) {
  if (situacao === 'nao_vinculado') return <span className="text-orange-600 text-[11px]">⚠ Não vinculado</span>
  if (situacao === 'zerado') return <span className="text-red-600 font-semibold">{valor}</span>
  if (situacao === 'baixo') return <span className="text-amber-600 font-medium">⚠ {valor}</span>
  return <span className="text-slate-700">{valor}</span>
}

function BotaoFalta({ chave, pendente, onClick }: {
  chave: string; pendente: { quantidade: number; ids: string[] } | undefined; onClick: () => void
}) {
  return (
    <button onClick={onClick}
      title={pendente ? `${pendente.quantidade} unidade(s) já em falta pendente` : 'Registrar falta'}
      className={`px-2 py-1 rounded-md text-[11px] font-medium border ${
        pendente ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
      }`}>
      {pendente ? `Falta (${pendente.quantidade})` : 'Falta'}
    </button>
  )
}

/**
 * "Conferir estoque" — manda o produto para o inventário MONITOR DE VENDA
 * (cria o inventário na primeira vez, reaproveita nas próximas). Estado é
 * local ao botão de propósito: cada linha da tabela tem sua própria viagem
 * ao banco, sem afetar as outras.
 */
function BotaoConferirEstoque({ produto, sb, empresaId, operador }: {
  produto: ProdutoCache | undefined; sb: any; empresaId: string; operador: string
}) {
  const [estado, setEstado] = useState<'ocioso' | 'enviando' | 'ok' | 'ja_estava' | 'erro'>('ocioso')

  async function clicar() {
    if (!produto || estado === 'enviando') return
    setEstado('enviando')
    const r = await inserirNoInventarioMonitor(sb, empresaId, operador, {
      id: produto.id, nome: produto.nome, sku: produto.sku, ean: produto.ean,
      categoria: produto.categoria, marca: produto.marca, unidade: produto.unidade,
      custo: produto.custo, estoque: produto.estoque,
    })
    if (!r.ok) { setEstado('erro'); return }
    setEstado(r.jaEstavaNaLista ? 'ja_estava' : 'ok')
  }

  if (!produto) {
    return <span className="text-[11px] text-slate-300" title="Produto não está no cadastro — não dá para conferir">—</span>
  }
  if (estado === 'ok' || estado === 'ja_estava') {
    return (
      <span className="text-[11px] text-emerald-600" title={estado === 'ja_estava' ? 'Já estava na lista do MONITOR DE VENDA' : 'Inserido no MONITOR DE VENDA'}>
        ✓ {estado === 'ja_estava' ? 'já na lista' : 'inserido'}
      </span>
    )
  }
  return (
    <button onClick={clicar} disabled={estado === 'enviando'}
      title="Colocar este produto na lista de conferência MONITOR DE VENDA"
      className="px-2 py-1 rounded-md text-[11px] font-medium border bg-white text-slate-500 border-slate-200 hover:bg-slate-50 disabled:opacity-50">
      {estado === 'enviando' ? 'Enviando...' : estado === 'erro' ? 'Tentar de novo' : 'Conferir estoque'}
    </button>
  )
}

function ItensDaVenda({ venda, itens, indice, componentesPorKit, faltasPendentesPorProduto, onFalta, chaveProduto }: {
  venda: Venda
  itens: ItemVendido[]
  indice: IndiceProdutos
  componentesPorKit: Map<string, KitComponente[]>
  faltasPendentesPorProduto: Map<string, { quantidade: number; ids: string[] }>
  onFalta: (alvo: AlvoFalta) => void
  chaveProduto: (produtoId: string | null, nome: string) => string
}) {
  return (
    <div className="divide-y divide-slate-100">
      {itens.map((it, i) => {
        const { custo, semCusto, produto } = custoDoItem(it, indice, componentesPorKit)
        const markup = markupItem(Number(it.preco_unitario) || 0, custo)
        const achou = !!produto
        const estoqueAtual = produto ? estoqueDoProduto(produto, componentesPorKit, indice) : 0
        const sit = situacaoEstoque(achou, estoqueAtual, produto?.estoqueMinimo ?? 0)
        const chave = chaveProduto(it.produto_id, it.produto_nome)
        const pendente = faltasPendentesPorProduto.get(chave)
        const eKit = produto?.tipo === 'kit'
        return (
          <div key={i} className="px-6 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <div className="min-w-[180px]">
              <span className="text-slate-700 font-medium">{it.produto_nome}</span>
              {eKit && <span className="text-slate-400"> (kit)</span>}
              {it.produto_sku && <span className="text-slate-400 ml-1">{it.produto_sku}</span>}
            </div>
            <span className="text-slate-500">{it.quantidade} un</span>
            <span className="text-slate-600">subtotal {brl(Number(it.subtotal) || 0)}</span>
            <span className="text-slate-500">custo {brl(custo * (Number(it.quantidade) || 0))}</span>
            <span className={`px-1.5 py-0.5 rounded border text-[11px] ${TEXTO_COR[corMarkup(markup)]}`}>
              {semCusto ? 'Custo 0' : `${markup!.toFixed(0)}% markup`}
            </span>
            <BadgeEstoque situacao={sit} valor={estoqueAtual} />
            <button onClick={() => onFalta({
              produtoId: it.produto_id, produtoNome: it.produto_nome, produtoSku: it.produto_sku,
              quantidadeSugerida: Number(it.quantidade) || 1,
              vendaOrigem: { id: venda.id, hora: dataHora(venda.created_at), cliente: venda.cliente_nome },
            })}
              title={pendente ? `${pendente.quantidade} unidade(s) já em falta pendente` : 'Registrar falta'}
              className={`ml-auto px-2 py-0.5 rounded-md text-[11px] font-medium border ${
                pendente ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
              }`}>
              {pendente ? `Falta (${pendente.quantidade})` : 'Falta'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
