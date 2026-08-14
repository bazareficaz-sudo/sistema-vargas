'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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

interface Empresa { nome: string | null; cnpj: string | null; telefone: string | null }

interface Props {
  fornecedores: Fornecedor[]
  empresa: Empresa | null
  empresaId: string
  userId: string
  pedidoExistente: PedidoDB | null
  itensExistentes: unknown[]
}

type ItemHistorico = {
  produtoId: string | null; nome: string; sku: string | null
  quantidade: number; custoAnterior: number; custo: number; subtotal: number
}
type EntradaHistorico = {
  id: string; origem: 'manual' | 'xml'
  numero: string | null; numeroNf: string | null; serie: string | null
  data: string | null; valorProdutos: number; valorFrete: number; valorDesconto: number
  valorOutros: number; valorTotal: number; status: string; observacoes: string | null
  itens: ItemHistorico[]
}
type HistoricoFornecedor = {
  resumo: {
    totalCompras: number; canceladas: number; manuais: number; porXml: number
    valorTotal: number
    primeiraCompra: string | null; ultimaCompra: string | null; produtosDistintos: number
  }
  entradas: EntradaHistorico[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const brl = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const today = new Date().toISOString().slice(0, 10)
const dataBr = (d: string | null) => d ? new Date(d).toLocaleDateString('pt-BR') : '—'

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

// Nomes que o operador reconhece. O banco guarda o código técnico.
const ROTULO_MOV: Record<string, string> = {
  venda: 'Venda', devolucao: 'Devolução',
  entrada_compra: 'Entrada (compra)', entrada_nfe: 'Entrada (NF-e)',
  ajuste_entrada: 'Ajuste (entrada)', ajuste_saida: 'Ajuste (saída)',
  venda_marketplace: 'Venda marketplace',
  transferencia_enviada: 'Transferência enviada',
  transferencia_recebida: 'Transferência recebida',
}

export default function NovoPedidoClient({ fornecedores, empresa, empresaId, userId, pedidoExistente, itensExistentes }: Props) {
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

  // Envio por WhatsApp (Z-API) e impressão
  const [waAberto, setWaAberto] = useState(false)
  const [waTelefone, setWaTelefone] = useState('')
  const [waIncluirPrecos, setWaIncluirPrecos] = useState(true)
  const [waEnviando, setWaEnviando] = useState(false)
  const [waResultado, setWaResultado] = useState<{ ok: boolean; msg: string } | null>(null)
  const [impressaoAberta, setImpressaoAberta] = useState(false)
  const [imprimirComCusto, setImprimirComCusto] = useState(true)

  // Histórico de compras do fornecedor (aba "Histórico do fornecedor")
  const [historico, setHistorico] = useState<HistoricoFornecedor | null>(null)
  const [histLoading, setHistLoading] = useState(false)
  const [histErro, setHistErro] = useState('')
  const [entradasAbertas, setEntradasAbertas] = useState<Set<string>>(new Set())

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

  // Só busca o histórico quando a aba é aberta — quem está montando o pedido
  // pelo caminho normal nunca paga por essa consulta.
  useEffect(() => {
    if (histTab !== 'historico' || !fornecedorId) return
    let cancelado = false
    setHistLoading(true)
    setHistErro('')
    fetch(`/api/pedidos-compra/historico-fornecedor?fornecedor_id=${fornecedorId}`)
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || `Erro ${r.status} ao carregar o histórico`)
        return d
      })
      .then(d => { if (!cancelado) { setHistorico(d); setEntradasAbertas(new Set()) } })
      .catch(e => { if (!cancelado) { setHistorico(null); setHistErro(e?.message ?? 'Erro ao carregar o histórico') } })
      .finally(() => { if (!cancelado) setHistLoading(false) })
    return () => { cancelado = true }
  }, [histTab, fornecedorId])

  function alternarEntrada(id: string) {
    setEntradasAbertas(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

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

  // Histórico de movimentação do produto, consultado sem sair do pedido.
  // Sair da tela no meio de uma compra custa o carrinho montado — por isso
  // painel aqui, e não link para a tela de Movimentação de Estoque.
  const [histProduto, setHistProduto] = useState<ProdutoForn | null>(null)
  const [histLinhas, setHistLinhas] = useState<any[] | null>(null)

  async function abrirHistorico(p: ProdutoForn) {
    setHistProduto(p); setHistLinhas(null)
    const sb = createClient()
    const { data } = await sb.from('estoque_movimentacoes')
      .select('created_at, tipo, quantidade, estoque_anterior, estoque_novo, motivo, usuario')
      .eq('produto_id', p.id).order('created_at', { ascending: false }).limit(60)
    setHistLinhas(data ?? [])
  }

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

  // ── WhatsApp (Z-API) ────────────────────────────────────────────────────────
  //
  // Antes isto abria o WhatsApp Web num link wa.me: saía do sistema, dependia
  // de o navegador ter sessão aberta, e a mensagem não ficava registrada em
  // lugar nenhum. Agora passa pela mesma rota que o resto do sistema usa
  // (/api/whatsapp/enviar), que envia pela Z-API e grava em
  // whatsapp_mensagens — o envio fica com histórico e status como qualquer
  // outro do sistema.

  const fornecedorAtual = fornecedores.find(f => f.id === fornecedorId) ?? null
  const nomeFornecedor = fornecedorAtual
    ? (fornecedorAtual.nome_fantasia || fornecedorAtual.razao_social)
    : ''

  function montarMensagem(incluirPrecos: boolean): string {
    const lista = itens.map(i => incluirPrecos
      ? `• ${i.nome} — ${i.quantidade} ${i.unidade} x ${brl(i.custo_unitario)} = ${brl(i.total)}`
      : `• ${i.nome} — ${i.quantidade} ${i.unidade}`,
    ).join('\n')

    const cabecalho = `Olá, *${nomeFornecedor}*!\n\n`
      + (empresa?.nome ? `Aqui é da *${empresa.nome}*.\n\n` : '')

    // Sem preço a mensagem vira pedido de cotação; com preço, é pedido firme.
    // Trocar só a lista e manter o mesmo fecho deixaria o texto sem sentido.
    const corpo = incluirPrecos
      ? `Segue nosso pedido de compra no valor total de *${brl(totalGeral)}*.\n\n*Itens:*\n${lista}\n\nPor favor, confirme disponibilidade e prazo de entrega.`
      : `Gostaríamos de cotar os itens abaixo.\n\n*Itens:*\n${lista}\n\nPor favor, envie preço unitário, disponibilidade e prazo de entrega.`

    const rodape = [
      previsaoEntrega ? `\n\nPrevisão de entrega desejada: ${dataBr(previsaoEntrega)}` : '',
      condicaoPagamento ? `\nCondição de pagamento: ${condicaoPagamento}` : '',
      observacoes ? `\n\n_${observacoes}_` : '',
    ].join('')

    return cabecalho + corpo + rodape
  }

  function abrirWhatsApp() {
    if (!fornecedorId) { setWaResultado({ ok: false, msg: 'Selecione um fornecedor antes.' }); setWaAberto(true); return }
    if (itens.length === 0) { setWaResultado({ ok: false, msg: 'O pedido não tem itens.' }); setWaAberto(true); return }
    // O telefone do cadastro é só o ponto de partida: boa parte dos
    // fornecedores está sem telefone preenchido, então o campo é editável.
    setWaTelefone(fornecedorAtual?.telefone ?? '')
    setWaResultado(null)
    setWaAberto(true)
  }

  async function enviarWhatsApp() {
    const telefone = waTelefone.replace(/\D/g, '')
    if (telefone.length < 10) {
      setWaResultado({ ok: false, msg: 'Telefone incompleto. Informe DDD + número.' })
      return
    }
    setWaEnviando(true); setWaResultado(null)
    try {
      const res = await fetch('/api/whatsapp/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telefone,
          mensagem: montarMensagem(waIncluirPrecos),
          tipo: waIncluirPrecos ? 'pedido_compra' : 'cotacao_compra',
          referencia_tipo: 'pedido_compra',
          referencia_id: pedidoId,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.error) throw new Error(d.error || `Erro ${res.status} ao enviar`)
      setWaResultado({ ok: true, msg: 'Mensagem enviada ao fornecedor.' })
    } catch (e: any) {
      setWaResultado({ ok: false, msg: e?.message ?? 'Erro ao enviar' })
    } finally {
      setWaEnviando(false)
    }
  }

  // ── Impressão ───────────────────────────────────────────────────────────────
  //
  // O documento é montado numa janela separada em vez de imprimir a tela: esta
  // é um painel de trabalho em tela cheia, com barras e botões que não fazem
  // sentido no papel.

  function escapar(t: unknown) {
    return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function imprimir(comCusto: boolean) {
    const linhas = itens.map((i, n) => comCusto
      ? `<tr><td>${n + 1}</td><td>${escapar(i.sku)}</td><td>${escapar(i.nome)}</td><td class="c">${i.quantidade} ${escapar(i.unidade)}</td><td class="r">${brl(i.custo_unitario)}</td><td class="r">${i.desconto > 0 ? i.desconto + '%' : '—'}</td><td class="r">${brl(i.total)}</td></tr>`
      : `<tr><td>${n + 1}</td><td>${escapar(i.sku)}</td><td>${escapar(i.nome)}</td><td class="c">${i.quantidade} ${escapar(i.unidade)}</td></tr>`,
    ).join('')

    const cabecalhoTabela = comCusto
      ? '<tr><th>#</th><th>SKU</th><th>Produto</th><th class="c">Qtd</th><th class="r">Custo un.</th><th class="r">Desc.</th><th class="r">Total</th></tr>'
      : '<tr><th>#</th><th>SKU</th><th>Produto</th><th class="c">Qtd</th></tr>'

    const blocoTotais = comCusto
      ? `<table class="totais">
           <tr><td>Subtotal dos itens</td><td class="r">${brl(subtotal)}</td></tr>
           ${descontoGeral > 0 ? `<tr><td>Desconto geral</td><td class="r">- ${brl(descontoGeral)}</td></tr>` : ''}
           ${frete > 0 ? `<tr><td>Frete</td><td class="r">${brl(frete)}</td></tr>` : ''}
           ${outrasDespesas > 0 ? `<tr><td>Outras despesas</td><td class="r">${brl(outrasDespesas)}</td></tr>` : ''}
           <tr class="tot"><td>TOTAL</td><td class="r">${brl(totalGeral)}</td></tr>
         </table>`
      : `<p class="aviso">Documento sem valores — serve para conferência de recebimento ou para pedir cotação.</p>`

    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Pedido de compra${pedidoId ? ' ' + pedidoId.slice(-6).toUpperCase() : ''}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Arial, sans-serif; color: #111; margin: 24px; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .sub { color: #666; font-size: 11px; margin: 0; }
  .caixa { border: 1px solid #ddd; border-radius: 6px; padding: 10px 12px; margin: 14px 0; }
  .grade { display: flex; gap: 24px; flex-wrap: wrap; }
  .grade > div { min-width: 150px; }
  .rot { color: #666; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { padding: 5px 6px; border-bottom: 1px solid #eee; text-align: left; }
  th { background: #f6f6f6; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
  .r { text-align: right; } .c { text-align: center; }
  .totais { width: 280px; margin-left: auto; margin-top: 10px; }
  .totais td { border: none; padding: 3px 6px; }
  .tot td { border-top: 2px solid #111; font-weight: 700; font-size: 14px; padding-top: 6px; }
  .aviso { margin-top: 12px; color: #666; font-style: italic; }
  .assin { margin-top: 44px; display: flex; gap: 40px; }
  .assin > div { flex: 1; border-top: 1px solid #999; padding-top: 4px; text-align: center; color: #666; font-size: 10px; }
  @media print { body { margin: 12mm; } }
</style></head><body>
  <h1>PEDIDO DE COMPRA${pedidoId ? ' &middot; ' + pedidoId.slice(-6).toUpperCase() : ''}</h1>
  <p class="sub">${escapar(empresa?.nome)}${empresa?.cnpj ? ' &middot; CNPJ ' + escapar(empresa.cnpj) : ''}${empresa?.telefone ? ' &middot; ' + escapar(empresa.telefone) : ''}</p>

  <div class="caixa grade">
    <div><div class="rot">Fornecedor</div>${escapar(nomeFornecedor) || '—'}</div>
    <div><div class="rot">Data do pedido</div>${dataBr(dataPedido)}</div>
    <div><div class="rot">Previsão de entrega</div>${previsaoEntrega ? dataBr(previsaoEntrega) : '—'}</div>
    <div><div class="rot">Condição de pagamento</div>${escapar(condicaoPagamento) || '—'}</div>
    <div><div class="rot">Situação</div>${escapar(STATUS_OPTS.find(o => o.value === status)?.label ?? status)}</div>
  </div>

  <table><thead>${cabecalhoTabela}</thead><tbody>${linhas}</tbody></table>
  ${blocoTotais}
  ${observacoes ? `<div class="caixa"><div class="rot">Observações</div>${escapar(observacoes)}</div>` : ''}

  <div class="assin"><div>Responsável pelo pedido</div><div>Recebido por / data</div></div>
</body></html>`

    const janela = window.open('', '_blank', 'width=900,height=700')
    if (!janela) {
      setWaResultado({ ok: false, msg: 'O navegador bloqueou a janela de impressão. Libere pop-ups para este site.' })
      return
    }
    janela.document.write(html)
    janela.document.close()
    // Sem esperar o conteúdo assentar, o Chrome às vezes abre o diálogo de
    // impressão com a página ainda em branco.
    setTimeout(() => { try { janela.focus(); janela.print() } catch { /* janela fechada antes */ } }, 350)
    setImpressaoAberta(false)
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
          <button onClick={() => setImpressaoAberta(true)} disabled={itens.length === 0}
            className="px-3 py-1.5 text-xs bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-600 border border-slate-300 rounded-lg font-medium">
            🖨 Imprimir
          </button>
          <button onClick={abrirWhatsApp}
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
            !fornecedorId ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
                <span className="text-5xl mb-3">📜</span>
                <p className="text-sm">Selecione um fornecedor para ver o histórico de compras</p>
              </div>
            ) : histErro ? (
              <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
                <span className="text-4xl mb-2">⚠️</span>
                <p className="text-sm font-semibold text-red-600">Não foi possível carregar o histórico</p>
                <p className="text-xs text-slate-500 mt-1 max-w-md">{histErro}</p>
              </div>
            ) : histLoading ? (
              <div className="flex-1 flex items-center justify-center text-slate-400">
                <div className="text-center">
                  <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-sm">Carregando histórico...</p>
                </div>
              </div>
            ) : !historico || historico.entradas.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
                <span className="text-4xl mb-2">📭</span>
                <p className="text-sm">Nenhuma compra registrada deste fornecedor</p>
                <p className="text-xs mt-1 text-slate-400">O histórico aparece a partir das entradas de mercadoria lançadas</p>
              </div>
            ) : (
              <div className="flex-1 overflow-auto">
                {/* Resumo */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-slate-200 border-b border-slate-200">
                  {[
                    {
                      label: 'Compras',
                      valor: String(historico.resumo.totalCompras),
                      // Mostrar a divisão evita a dúvida de "por que a conta
                      // não bate com a tela de Entradas": são duas origens.
                      nota: historico.resumo.manuais > 0 && historico.resumo.porXml > 0
                        ? `${historico.resumo.manuais} manual · ${historico.resumo.porXml} XML`
                        : historico.resumo.porXml > 0 ? 'todas por XML' : 'todas manuais',
                    },
                    { label: 'Total comprado', valor: brl(historico.resumo.valorTotal) },
                    { label: 'Produtos distintos', valor: String(historico.resumo.produtosDistintos) },
                    { label: 'Primeira compra', valor: dataBr(historico.resumo.primeiraCompra) },
                    { label: 'Última compra', valor: dataBr(historico.resumo.ultimaCompra) },
                  ].map(c => (
                    <div key={c.label} className="bg-white px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{c.label}</p>
                      <p className="text-sm font-bold text-slate-800 mt-0.5">{c.valor}</p>
                      {'nota' in c && c.nota && <p className="text-[10px] text-slate-400 mt-0.5">{c.nota}</p>}
                    </div>
                  ))}
                </div>

                {historico.resumo.canceladas > 0 && (
                  <div className="bg-slate-50 border-b border-slate-200 px-4 py-1.5 text-[11px] text-slate-500">
                    {historico.resumo.canceladas === 1
                      ? '1 entrada cancelada aparece na lista, mas não entra nos totais acima.'
                      : `${historico.resumo.canceladas} entradas canceladas aparecem na lista, mas não entram nos totais acima.`}
                  </div>
                )}

                {/* Compras */}
                <div className="divide-y divide-slate-100">
                  {historico.entradas.map(e => {
                    const aberta = entradasAbertas.has(e.id)
                    const cancelada = e.status === 'cancelada'
                    return (
                      <div key={e.id} className={cancelada ? 'bg-slate-50/60' : ''}>
                        <button
                          onClick={() => alternarEntrada(e.id)}
                          className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 text-left transition-colors">
                          <span className={`text-slate-400 text-xs transition-transform ${aberta ? 'rotate-90' : ''}`}>▶</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <p className={`text-sm font-semibold truncate ${cancelada ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                                {e.numeroNf ? `NF ${e.numeroNf}${e.serie ? `-${e.serie}` : ''}` : (e.numero ?? 'Entrada')}
                              </p>
                              <span
                                title={e.origem === 'xml' ? 'Importada do XML da nota' : 'Lançada manualmente'}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${e.origem === 'xml' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>
                                {e.origem === 'xml' ? 'XML' : 'manual'}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400">
                              {dataBr(e.data)} · {e.itens.length} {e.itens.length === 1 ? 'item' : 'itens'}
                              {cancelada && ' · cancelada'}
                              {e.status === 'aguardando_precos' && ' · preços não fechados'}
                            </p>
                          </div>
                          <span className={`text-sm font-bold shrink-0 ${cancelada ? 'text-slate-400' : 'text-slate-800'}`}>
                            {brl(e.valorTotal)}
                          </span>
                        </button>

                        {aberta && (
                          <div className="px-4 pb-3">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-slate-400">
                                  <th className="text-left font-semibold py-1">SKU</th>
                                  <th className="text-left font-semibold py-1">Produto</th>
                                  <th className="text-right font-semibold py-1">Qtd</th>
                                  <th className="text-right font-semibold py-1">Custo unit.</th>
                                  <th className="text-right font-semibold py-1">Variação</th>
                                  <th className="text-right font-semibold py-1">Subtotal</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50">
                                {e.itens.map((i, idx) => {
                                  // Só há variação para comparar quando existia custo antes.
                                  const varPct = i.custoAnterior > 0
                                    ? ((i.custo - i.custoAnterior) / i.custoAnterior) * 100
                                    : null
                                  return (
                                    <tr key={`${e.id}-${idx}`}>
                                      <td className="py-1 text-slate-400 font-mono text-[11px]">{i.sku || '—'}</td>
                                      <td className="py-1 text-slate-700">{i.nome}</td>
                                      <td className="py-1 text-right text-slate-600">{i.quantidade}</td>
                                      <td className="py-1 text-right text-slate-700 font-medium">{brl(i.custo)}</td>
                                      <td className={`py-1 text-right font-medium ${
                                        varPct === null ? 'text-slate-300'
                                        : varPct > 0.5 ? 'text-red-600'
                                        : varPct < -0.5 ? 'text-emerald-600'
                                        : 'text-slate-400'
                                      }`}>
                                        {varPct === null ? '—'
                                          : `${varPct > 0 ? '▲' : varPct < 0 ? '▼' : ''} ${Math.abs(varPct).toFixed(1)}%`}
                                      </td>
                                      <td className="py-1 text-right text-slate-700">{brl(i.subtotal)}</td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>

                            {(e.valorFrete > 0 || e.valorDesconto > 0 || e.valorOutros > 0) && (
                              <p className="text-[11px] text-slate-400 mt-1.5">
                                Produtos {brl(e.valorProdutos)}
                                {e.valorFrete > 0 && ` · frete ${brl(e.valorFrete)}`}
                                {e.valorOutros > 0 && ` · outras despesas ${brl(e.valorOutros)}`}
                                {e.valorDesconto > 0 && ` · desconto ${brl(e.valorDesconto)}`}
                              </p>
                            )}
                            {e.observacoes && (
                              <p className="text-[11px] text-slate-500 mt-1 italic">{e.observacoes}</p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
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
                              <button onClick={e => { e.stopPropagation(); abrirHistorico(p) }}
                                title="Ver a movimentação deste produto — entradas, vendas e ajustes"
                                className="ml-1 text-xs text-slate-400 hover:text-blue-600 px-1.5 py-1 rounded-lg hover:bg-slate-100">
                                📊
                              </button>
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
                        {/* Sempre visível, e com aparência de botão. Antes era
                            um ✕ cinza-claro que só aparecia no hover: quem usa
                            no celular não tem hover, e mesmo no mouse ninguém
                            achava. É o mesmo padrão que já tinha escondido o
                            menu do celular. */}
                        <button onClick={() => removerItem(item.produto_id)}
                          title="Tirar este produto do pedido"
                          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md border border-slate-200 text-slate-400 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors text-xs">
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
            <button onClick={abrirWhatsApp} disabled={!fornecedorId}
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

      {/* ── Enviar por WhatsApp (Z-API) ──────────────────────────────────── */}
      {waAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Enviar pedido por WhatsApp</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Enviado pelo número da empresa, com registro no histórico de mensagens.
                </p>
              </div>
              <button onClick={() => setWaAberto(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>

            <div className="p-5 space-y-3 overflow-auto">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fornecedor</label>
                <p className="text-sm text-slate-800">{nomeFornecedor || '—'}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Telefone (com DDD)
                </label>
                <input
                  value={waTelefone}
                  onChange={e => setWaTelefone(e.target.value)}
                  placeholder="21 99999-9999"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
                {!fornecedorAtual?.telefone && (
                  <p className="text-[11px] text-amber-700 mt-1">
                    Este fornecedor não tem telefone no cadastro — digite acima.
                  </p>
                )}
              </div>

              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={waIncluirPrecos}
                  onChange={e => setWaIncluirPrecos(e.target.checked)} className="mt-0.5 rounded" />
                <span className="text-sm text-slate-700">
                  Incluir preços
                  <span className="block text-[11px] text-slate-500">
                    {waIncluirPrecos
                      ? 'Pedido firme: vai com valor unitário e total.'
                      : 'Pedido de cotação: só os itens e quantidades, pedindo preço ao fornecedor.'}
                  </span>
                </span>
              </label>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Mensagem</label>
                <pre className="text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap font-sans max-h-52 overflow-auto">
{montarMensagem(waIncluirPrecos)}
                </pre>
              </div>

              {waResultado && (
                <p className={`text-xs ${waResultado.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                  {waResultado.ok ? '✓ ' : '⚠ '}{waResultado.msg}
                </p>
              )}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 flex items-center gap-2 shrink-0">
              <p className="text-[11px] text-slate-500 flex-1">
                Precisa do WhatsApp conectado em Integrações.
              </p>
              <button onClick={() => setWaAberto(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                Fechar
              </button>
              <button onClick={enviarWhatsApp} disabled={waEnviando || itens.length === 0}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-semibold rounded-lg">
                {waEnviando ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Imprimir ─────────────────────────────────────────────────────── */}
      {impressaoAberta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Imprimir pedido</h3>
              <button onClick={() => setImpressaoAberta(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>

            <div className="p-5 space-y-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={imprimirComCusto}
                  onChange={e => setImprimirComCusto(e.target.checked)} className="mt-0.5 rounded" />
                <span className="text-sm text-slate-700">
                  Incluir preço de custo
                  <span className="block text-[11px] text-slate-500">
                    {imprimirComCusto
                      ? 'Sai com custo unitário, desconto e totais — via interna.'
                      : 'Sai só com produto e quantidade — bom para conferir recebimento ou pedir cotação sem mostrar quanto você paga.'}
                  </span>
                </span>
              </label>

              <p className="text-[11px] text-slate-500">
                Abre numa janela nova com a caixa de impressão. Se nada aparecer, libere pop-ups para este site.
              </p>
            </div>

            <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
              <button onClick={() => setImpressaoAberta(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                Cancelar
              </button>
              <button onClick={() => imprimir(imprimirComCusto)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold rounded-lg">
                🖨 Imprimir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Histórico de movimentação do produto — consultado sem sair do pedido */}
      {histProduto && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setHistProduto(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Movimentação do produto</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {histProduto.nome}
                  <span className="text-slate-400"> · SKU {histProduto.sku || '—'} · estoque atual {histProduto.estoque}</span>
                </p>
              </div>
              <button onClick={() => setHistProduto(null)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>

            <div className="overflow-auto flex-1">
              {histLinhas === null ? (
                <p className="text-sm text-slate-400 text-center py-10">Carregando...</p>
              ) : histLinhas.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm text-slate-500">Nenhuma movimentação registrada para este produto.</p>
                  <p className="text-xs text-slate-400 mt-1">
                    O registro de movimentação começou a valer a partir da implantação do módulo —
                    compras e vendas anteriores podem não aparecer aqui.
                  </p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2 text-[11px] font-semibold text-slate-500">Quando</th>
                      <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500">Tipo</th>
                      <th className="text-right px-3 py-2 text-[11px] font-semibold text-slate-500">Qtd</th>
                      <th className="text-right px-3 py-2 text-[11px] font-semibold text-slate-500">Saldo depois</th>
                      <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500">Origem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {histLinhas.map((m: any, i: number) => {
                      // Entrada e saída pelo sinal, não só pela cor — quem
                      // imprime em preto e branco também precisa distinguir.
                      const entra = ['entrada_compra','entrada_nfe','devolucao','ajuste_entrada','transferencia_recebida'].includes(m.tipo)
                      return (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">
                            {new Date(m.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-700">{ROTULO_MOV[m.tipo] ?? m.tipo}</td>
                          <td className={`px-3 py-2 text-right text-sm font-medium ${entra ? 'text-emerald-700' : 'text-red-600'}`}>
                            {entra ? '+' : '−'}{Math.abs(Number(m.quantidade ?? 0))}
                          </td>
                          <td className="px-3 py-2 text-right text-sm text-slate-600">{m.estoque_novo ?? '—'}</td>
                          <td className="px-3 py-2 text-xs text-slate-400">
                            {m.motivo || '—'}{m.usuario ? ` · ${m.usuario}` : ''}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                {histLinhas?.length ? `Últimas ${histLinhas.length} movimentações` : ''}
              </span>
              <button onClick={() => setHistProduto(null)}
                className="text-xs px-3 py-1.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

  )
}
