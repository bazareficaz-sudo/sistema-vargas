'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Produto = {
  id: string; nome: string; sku: string; ean: string | null
  preco_venda: number; preco_custo: number; estoque: number; unidade: string
  marca: string | null
}
type ItemVenda = {
  id: string; produto_id: string; nome: string; sku: string
  quantidade: number; preco_unitario: number; desconto: number; total: number
  estoque_disponivel: number; unidade: string
  tipo: 'venda' | 'devolucao'
}
type Cliente = {
  id: string; nome: string; cpf_cnpj: string | null; telefone: string | null
  limite_credito: number; saldo_credito: number; saldo_devedor: number
  bloqueado_fiado: boolean; permite_fiado: boolean
}
type FormaPag = { tipo: string; valor: number }

const FORMAS = [
  { id: 'dinheiro', label: 'Dinheiro', tecla: '1', icon: '💵' },
  { id: 'debito',   label: 'Débito',   tecla: '2', icon: '💳' },
  { id: 'credito',  label: 'Crédito',  tecla: '3', icon: '💳' },
  { id: 'pix',      label: 'PIX',      tecla: '4', icon: '📱' },
  { id: 'carteira', label: 'Carteira', tecla: '5', icon: '👛' },
  { id: 'fiado',    label: 'Fiado',    tecla: '6', icon: '📒' },
]

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function uid() { return Math.random().toString(36).slice(2) }

export default function PDVClient({ empresaId, empresaNome, operadorNome, clientes }: {
  empresaId: string; empresaNome: string; operadorNome: string; clientes: Cliente[]
}) {
  const router = useRouter()
  const sb = createClient()

  const [itens, setItens] = useState<ItemVenda[]>([])
  const [busca, setBusca] = useState('')
  const [qtdInput, setQtdInput] = useState('1')
  const [sugestoes, setSugestoes] = useState<Produto[]>([])
  const [buscando, setBuscando] = useState(false)
  const [itemSelecionado, setItemSelecionado] = useState<ItemVenda | null>(null)
  const [sugestaoIdx, setSugestaoIdx] = useState(-1)
  const [modoDevol, setModoDevol] = useState(false) // toggle rápido devolução

  const [produtoPendente, setProdutoPendente] = useState<Produto | null>(null)

  const [clienteSelecionado, setClienteSelecionado] = useState<Cliente | null>(null)
  const [modalCliente, setModalCliente] = useState(false)
  const [buscaCliente, setBuscaCliente] = useState('')
  const [abrirPagAposCliente, setAbrirPagAposCliente] = useState(false)

  const [modalDesc, setModalDesc] = useState(false)
  const [descontoGlobal, setDescontoGlobal] = useState(0)
  const [descontoInput, setDescontoInput] = useState('0')

  const [modalObs, setModalObs] = useState(false)
  const [obs, setObs] = useState('')

  const [entrega, setEntrega] = useState(false)
  const [modalEntrega, setModalEntrega] = useState(false)
  const [endEntrega, setEndEntrega] = useState({ logradouro: '', numero: '', bairro: '', cidade: '', obs: '' })

  const [modalPag, setModalPag] = useState(false)
  const [formas, setFormas] = useState<FormaPag[]>([{ tipo: 'dinheiro', valor: 0 }])
  const [salvando, setSalvando] = useState(false)
  const [formaIdx, setFormaIdx] = useState(0)

  const [modalOrc, setModalOrc] = useState(false)
  const [obsOrc, setObsOrc] = useState('')
  const [validadeOrc, setValidadeOrc] = useState('')
  const [salvandoOrc, setSalvandoOrc] = useState(false)
  const [orcSalvo, setOrcSalvo] = useState<{ numero: number } | null>(null)

  // Modais de devolução
  const [modalTroca, setModalTroca] = useState(false)
  const [modalCredito, setModalCredito] = useState(false)

  // Fiado
  const [fiadoParcelas, setFiadoParcelas]   = useState('1')
  const [fiadoPrimVenc, setFiadoPrimVenc]   = useState('')
  const [fiadoIntervalo, setFiadoIntervalo] = useState('30')
  const [fiadoObs, setFiadoObs]             = useState('')
  const [errFiado, setErrFiado]             = useState('')

  const buscaRef = useRef<HTMLInputElement>(null)
  const qtdRef = useRef<HTMLInputElement>(null)
  const sugestaoListRef = useRef<HTMLDivElement>(null)
  const valorRefs = useRef<(HTMLInputElement | null)[]>([])

  // ── Cálculos separando venda / devolução ─────────────────────
  const itensVenda    = itens.filter(i => i.tipo === 'venda')
  const itensDevol    = itens.filter(i => i.tipo === 'devolucao')
  const hasDevolucao  = itensDevol.length > 0
  const totalVendas   = itensVenda.reduce((s, i) => s + i.total, 0)
  const totalDevolucoes = itensDevol.reduce((s, i) => s + Math.abs(i.total), 0)
  const subtotal      = totalVendas - totalDevolucoes
  const totalDesc     = descontoGlobal
  const saldoFinal    = subtotal - totalDesc
  const total         = saldoFinal > 0 ? saldoFinal : 0
  const valorCredito  = saldoFinal < 0 ? Math.abs(saldoFinal) : 0
  const isTroca       = itensDevol.length > 0 && saldoFinal === 0
  const totalPago     = formas.reduce((s, f) => s + f.valor, 0)
  const troco2        = Math.max(0, totalPago - total)

  // ── Busca de produtos ──────────────────────────────────────────
  const buscarProdutos = useCallback(async (q: string) => {
    if (!q.trim() || q.length < 2) { setSugestoes([]); return }
    setBuscando(true)
    const palavras = q.trim().split(/\s+/).filter(Boolean)
    const selectCols = 'id, nome, sku, ean, preco_venda, preco_custo, estoque, unidade, marca'

    if (palavras.length === 1 && /^\d{8,14}$/.test(palavras[0])) {
      const { data } = await sb.from('produtos')
        .select(selectCols).eq('empresa_id', empresaId).eq('ativo', true).eq('ean', palavras[0]).limit(1)
      if (data && data.length > 0) {
        adicionarProdutoE(data[0] as Produto)
        setBusca(''); setSugestoes([]); setBuscando(false); return
      }
    }
    if (palavras.length === 1) {
      const { data } = await sb.from('produtos')
        .select(selectCols).eq('empresa_id', empresaId).eq('ativo', true).eq('sku', palavras[0]).limit(1)
      if (data && data.length > 0) {
        adicionarProdutoE(data[0] as Produto)
        setBusca(''); setSugestoes([]); setBuscando(false); return
      }
    }
    let query = sb.from('produtos').select(selectCols).eq('empresa_id', empresaId).eq('ativo', true)
    for (const p of palavras) { query = query.ilike('nome', `%${p}%`) }
    const { data, error } = await query.order('nome').limit(20)
    let lista: Produto[] = (error ? [] : data ?? []) as Produto[]
    if (lista.length === 0) {
      const { data: d2 } = await sb.from('produtos')
        .select(selectCols).eq('empresa_id', empresaId).eq('ativo', true)
        .ilike('sku', `%${palavras[0]}%`).order('nome').limit(20)
      lista = (d2 ?? []) as Produto[]
    }
    setSugestoes(lista); setSugestaoIdx(-1); setBuscando(false)
  }, [empresaId])

  useEffect(() => {
    const t = setTimeout(() => buscarProdutos(busca), 220)
    return () => clearTimeout(t)
  }, [busca, buscarProdutos])

  useEffect(() => {
    if (sugestaoIdx < 0 || !sugestaoListRef.current) return
    const el = sugestaoListRef.current.children[sugestaoIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [sugestaoIdx])

  // Quando cliente é selecionado e há pagamento pendente (crédito)
  useEffect(() => {
    if (abrirPagAposCliente && clienteSelecionado && !modalCliente) {
      setAbrirPagAposCliente(false)
      // Reabrir o fluxo de pagamento agora que temos cliente
      if (saldoFinal < 0) setModalCredito(true)
      else abrirPagamento()
    }
  }, [clienteSelecionado, modalCliente])

  function confirmarAdicao(p: Produto, qtd?: number) {
    const rawQ = qtd !== undefined ? qtd : (parseFloat(qtdInput.replace(',', '.')) || 1)
    // Modo devolução: qty sempre negativa
    const q = modoDevol ? -Math.abs(rawQ) : rawQ
    const tipoItem: 'venda' | 'devolucao' = q < 0 ? 'devolucao' : 'venda'

    setItens(prev => {
      // Agrupa apenas com itens do mesmo tipo (não mistura venda+devolucao no mesmo slot)
      const idx = prev.findIndex(i => i.produto_id === p.id && i.tipo === tipoItem)
      if (idx >= 0) {
        const newQ = prev[idx].quantidade + q
        if (newQ === 0) return prev.filter((_, ix) => ix !== idx)
        return prev.map((i, ix) => ix === idx
          ? { ...i, quantidade: newQ, total: newQ * i.preco_unitario * (1 - i.desconto / 100) }
          : i)
      }
      return [...prev, {
        id: uid(), produto_id: p.id, nome: p.nome, sku: p.sku,
        quantidade: q, preco_unitario: p.preco_venda, desconto: 0,
        total: q * p.preco_venda, estoque_disponivel: p.estoque, unidade: p.unidade,
        tipo: tipoItem,
      }]
    })
    setBusca(''); setSugestoes([]); setQtdInput('1'); setProdutoPendente(null)
    setTimeout(() => buscaRef.current?.focus(), 30)
  }

  function selecionarProduto(p: Produto) {
    setProdutoPendente(p)
    setBusca(p.nome); setSugestoes([])
    const defaultQtd = modoDevol ? '-1' : '1'
    setQtdInput(defaultQtd)
    setTimeout(() => { qtdRef.current?.focus(); qtdRef.current?.select() }, 30)
  }

  function adicionarProdutoE(p: Produto, qtd?: number) { confirmarAdicao(p, qtd) }

  function removerItem(id: string) {
    setItens(p => p.filter(i => i.id !== id))
    setItemSelecionado(null)
  }

  function alterarQtd(id: string, qtd: number) {
    if (qtd === 0) { removerItem(id); return }
    setItens(p => p.map(i => {
      if (i.id !== id) return i
      // Mantém tipo coerente com sinal da quantidade
      const novoTipo: 'venda' | 'devolucao' = qtd < 0 ? 'devolucao' : 'venda'
      return { ...i, quantidade: qtd, tipo: novoTipo, total: qtd * i.preco_unitario * (1 - i.desconto / 100) }
    }))
  }

  function alterarDesc(id: string, desc: number) {
    setItens(p => p.map(i => i.id === id
      ? { ...i, desconto: desc, total: i.quantidade * i.preco_unitario * (1 - desc / 100) }
      : i))
  }

  function alterarPreco(id: string, preco: number) {
    setItens(p => p.map(i => i.id === id
      ? { ...i, preco_unitario: preco, total: i.quantidade * preco * (1 - i.desconto / 100) }
      : i))
  }

  // ── Orçamento ─────────────────────────────────────────────────
  async function salvarOrcamento() {
    if (itens.length === 0) return
    setSalvandoOrc(true)
    try {
      const { data: orc, error } = await sb.from('orcamentos').insert({
        empresa_id: empresaId,
        cliente_id: clienteSelecionado?.id ?? null,
        cliente_nome: clienteSelecionado?.nome ?? null,
        operador_nome: operadorNome,
        status: 'aberto',
        subtotal: totalVendas,
        desconto: totalDesc,
        total,
        observacao: obsOrc || null,
        validade: validadeOrc || null,
      }).select().single()
      if (error) throw error
      await sb.from('orcamento_itens').insert(itens.map(i => ({
        orcamento_id: orc.id,
        produto_id: i.produto_id, produto_nome: i.nome, produto_sku: i.sku,
        quantidade: i.quantidade, preco_unitario: i.preco_unitario, desconto: i.desconto, total: i.total,
      })))
      setOrcSalvo({ numero: orc.numero }); setSalvandoOrc(false)
    } catch (e: any) { alert('Erro ao salvar orçamento: ' + e.message); setSalvandoOrc(false) }
  }

  function limparTudo() {
    setItens([]); setBusca(''); setClienteSelecionado(null)
    setDescontoGlobal(0); setObs(''); setEntrega(false); setModoDevol(false)
    setObsOrc(''); setValidadeOrc(''); setOrcSalvo(null)
    setModalOrc(false); setModalPag(false); setModalTroca(false); setModalCredito(false)
    setFiadoParcelas('1'); setFiadoPrimVenc(''); setFiadoIntervalo('30'); setFiadoObs(''); setErrFiado('')
    buscaRef.current?.focus()
  }

  // ── Pagamento ─────────────────────────────────────────────────
  function abrirPagamento() {
    if (itens.length === 0) return

    // Saldo negativo → precisa de cliente para gerar crédito
    if (saldoFinal < 0) {
      if (!clienteSelecionado) {
        setBuscaCliente('')
        setAbrirPagAposCliente(true)
        setModalCliente(true)
        return
      }
      setModalCredito(true)
      return
    }

    // Troca sem diferença
    if (saldoFinal === 0 && hasDevolucao) {
      setModalTroca(true)
      return
    }

    // Pagamento normal (saldo > 0)
    setFormas([{ tipo: 'dinheiro', valor: total }])
    setFormaIdx(0)
    setModalPag(true)
    setTimeout(() => valorRefs.current[0]?.focus(), 80)
  }

  const isFiado = formas.length === 1 && formas[0].tipo === 'fiado'
  const isCarteira = formas.some(f => f.tipo === 'carteira')

  // ── Concluir venda (normal, mista ou troca) ───────────────────
  async function concluirVenda(tipoOp: 'venda' | 'troca' | 'devolucao' | 'mista' = 'venda') {
    if (itens.length === 0) return

    if (isCarteira && !clienteSelecionado && tipoOp !== 'troca') {
      setErrFiado('Selecione o cliente para pagamento via Carteira (F5).')
      return
    }

    if (isFiado && tipoOp !== 'troca') {
      if (!clienteSelecionado) { setErrFiado('Selecione o cliente para venda fiada.'); return }
      if (clienteSelecionado.bloqueado_fiado) { setErrFiado('Cliente bloqueado para compras fiadas.'); return }
      if (!clienteSelecionado.permite_fiado) { setErrFiado('Este cliente não tem permissão para compras fiadas.'); return }
      const saldoDisp = (clienteSelecionado.limite_credito ?? 0) - (clienteSelecionado.saldo_devedor ?? 0)
      if (saldoDisp < total) { setErrFiado(`Limite insuficiente. Disponível: ${fmt(Math.max(0, saldoDisp))}`); return }
      if (!fiadoPrimVenc) { setErrFiado('Informe a data do primeiro vencimento.'); return }
      setErrFiado('')
    } else if (tipoOp !== 'troca') {
      if (valorCredito === 0 && totalPago < total) return
    }

    setSalvando(true)
    try {
      const formaPag = tipoOp === 'troca' ? 'troca' : isFiado ? 'fiado' : formas.length === 1 ? formas[0].tipo : 'multiplo'
      const operacaoFinal = tipoOp !== 'venda' ? tipoOp : hasDevolucao ? 'mista' : 'venda'

      const { data: venda, error } = await sb.from('vendas').insert({
        empresa_id: empresaId,
        cliente_id: clienteSelecionado?.id ?? null,
        operador_nome: operadorNome,
        status: 'concluida',
        subtotal: totalVendas,
        desconto: totalDesc,
        total: total,
        forma_pagamento: formaPag,
        valor_pago: tipoOp === 'troca' ? 0 : isFiado ? 0 : totalPago,
        troco: tipoOp === 'troca' ? 0 : isFiado ? 0 : troco2,
        observacao: obs || null,
        entrega_solicitada: entrega,
        tipo_operacao: operacaoFinal,
        tem_devolucao: hasDevolucao,
        total_devolucoes: totalDevolucoes,
        credito_gerado: valorCredito,
        created_at: new Date().toISOString(),
      }).select().single()
      if (error) throw error

      // Salvar itens com tipo
      await sb.from('venda_itens').insert(itens.map(i => ({
        venda_id: venda.id,
        produto_id: i.produto_id, produto_nome: i.nome, produto_sku: i.sku,
        quantidade: i.quantidade, preco_unitario: i.preco_unitario, desconto: i.desconto, total: i.total,
        tipo: i.tipo,
      })))

      // Movimentação de estoque
      for (const item of itens) {
        const { data: p } = await sb.from('produtos').select('estoque').eq('id', item.produto_id).single()
        if (!p) continue
        if (item.tipo === 'venda') {
          // Baixa por venda
          await sb.from('produtos').update({ estoque: Math.max(0, p.estoque - item.quantidade) }).eq('id', item.produto_id)
        } else {
          // Entrada por devolução (qty é negativa, usar abs)
          await sb.from('produtos').update({ estoque: p.estoque + Math.abs(item.quantidade) }).eq('id', item.produto_id)
        }
      }

      // Fiado
      if (isFiado && clienteSelecionado) {
        const n = Math.max(1, parseInt(fiadoParcelas) || 1)
        const vp = Math.round((total / n) * 100) / 100
        const parcelas = Array.from({ length: n }, (_, i) => {
          const venc = new Date(fiadoPrimVenc + 'T00:00:00')
          venc.setDate(venc.getDate() + i * (parseInt(fiadoIntervalo) || 30))
          return {
            empresa_id: empresaId, cliente_id: clienteSelecionado.id, cliente_nome: clienteSelecionado.nome,
            origem: 'fiado', origem_id: venda.id,
            numero_doc: `FIADO-${venda.id?.slice(-6).toUpperCase()}`,
            parcela_numero: i + 1, total_parcelas: n,
            data_emissao: new Date().toISOString().split('T')[0],
            data_vencimento: venc.toISOString().split('T')[0],
            valor_original: i === n-1 ? Math.round((total - vp*(n-1))*100)/100 : vp,
            valor_recebido: 0, status: 'aberto', observacao: fiadoObs || null, operador_nome: operadorNome,
          }
        })
        await sb.from('contas_receber').insert(parcelas)
        await sb.from('clientes').update({
          saldo_devedor: (clienteSelecionado.saldo_devedor ?? 0) + total,
          data_ultima_compra_fiada: new Date().toISOString(),
        }).eq('id', clienteSelecionado.id)
      }

      // Crédito gerado por devolução maior que compra
      if (valorCredito > 0 && clienteSelecionado) {
        const credId = uid()
        await sb.from('creditos_cliente').insert({
          id: credId,
          empresa_id: empresaId,
          cliente_id: clienteSelecionado.id,
          cliente_nome: clienteSelecionado.nome,
          cliente_telefone: clienteSelecionado.telefone,
          venda_origem_id: venda.id,
          valor_original: valorCredito,
          saldo_atual: valorCredito,
          status: 'ativo',
          origem: 'devolucao_pdv',
          observacao: `Crédito gerado por devolução em ${new Date().toLocaleString('pt-BR')}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        await sb.from('clientes').update({
          saldo_credito: (clienteSelecionado.saldo_credito ?? 0) + valorCredito,
        }).eq('id', clienteSelecionado.id)
      }

      const msgs: Record<string, string> = {
        troca:    `✓ Troca registrada!\nSem diferença de valor.`,
        devolucao:`✓ Devolução registrada!\nCrédito gerado: ${fmt(valorCredito)}\nCliente: ${clienteSelecionado?.nome ?? '—'}`,
        mista:    `✓ Operação concluída!\nVendas: ${fmt(totalVendas)} | Devoluções: ${fmt(totalDevolucoes)}\nPago: ${fmt(total)}`,
        venda:    isFiado
          ? `✓ Venda fiada registrada!\nTotal: ${fmt(total)}`
          : `✓ Venda concluída!\nTotal: ${fmt(total)}\nTroco: ${fmt(troco2)}`,
      }
      limparTudo()
      alert(msgs[operacaoFinal] ?? msgs.venda)
    } catch (e: any) {
      alert('Erro: ' + e.message)
      setSalvando(false)
    }
  }

  // ── Atalhos globais ─────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (modalPag || modalCliente || modalDesc || modalObs || modalEntrega || modalTroca || modalCredito) return
      switch (e.key) {
        case 'F2': e.preventDefault(); abrirPagamento(); break
        case 'F3': e.preventDefault(); setDescontoInput(String(descontoGlobal)); setModalDesc(true); break
        case 'F4': e.preventDefault(); setModalObs(true); break
        case 'F5': e.preventDefault(); setModalCliente(true); break
        case 'F6': e.preventDefault(); setModoDevol(m => !m); break
        case 'F8': e.preventDefault(); if (itens.length > 0) { setObsOrc(''); setValidadeOrc(''); setOrcSalvo(null); setModalOrc(true) } break
        case 'F9': e.preventDefault(); setModalEntrega(true); break
        case 'Escape': buscaRef.current?.focus(); setSugestoes([]); break
        case 'Delete':
          if (itemSelecionado && document.activeElement === document.body) {
            e.preventDefault(); removerItem(itemSelecionado.id)
          }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalPag, modalCliente, modalDesc, modalObs, modalEntrega, modalTroca, modalCredito,
      itens, total, itemSelecionado, descontoGlobal, modoDevol])

  useEffect(() => {
    if (!modalPag) return
    function onKey(e: KeyboardEvent) {
      if (/^[1-6]$/.test(e.key)) {
        const idx = parseInt(e.key) - 1
        const forma = FORMAS[idx]; if (!forma) return
        e.preventDefault()
        setFormas([{ tipo: forma.id, valor: total }]); setFormaIdx(0)
        setTimeout(() => { valorRefs.current[0]?.focus(); valorRefs.current[0]?.select() }, 30)
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (isFiado || totalPago >= total) concluirVenda(hasDevolucao ? 'mista' : 'venda')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalPag, total, totalPago, formas, hasDevolucao])

  useEffect(() => { buscaRef.current?.focus() }, [])

  function onBuscaKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSugestaoIdx(i => Math.min(i + 1, sugestoes.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSugestaoIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter') {
      e.preventDefault()
      const alvo = sugestaoIdx >= 0 ? sugestoes[sugestaoIdx] : sugestoes.length === 1 ? sugestoes[0] : null
      if (alvo) { selecionarProduto(alvo); setSugestaoIdx(-1) }
    }
    if (e.key === 'Tab' && sugestoes.length > 0) {
      e.preventDefault(); selecionarProduto(sugestoes[sugestaoIdx >= 0 ? sugestaoIdx : 0])
    }
    if (e.key === 'Escape') { setSugestoes([]); setProdutoPendente(null); setBusca('') }
  }

  function onQtdKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (produtoPendente) confirmarAdicao(produtoPendente)
      else { setQtdInput('1'); buscaRef.current?.focus() }
    }
    if (e.key === 'Escape') { setProdutoPendente(null); setBusca(''); setQtdInput('1'); buscaRef.current?.focus() }
  }

  const clientesFiltrados = clientes.filter(c =>
    c.nome.toLowerCase().includes(buscaCliente.toLowerCase()) ||
    (c.cpf_cnpj ?? '').includes(buscaCliente) ||
    (c.telefone ?? '').includes(buscaCliente)
  )

  return (
    <div className="flex flex-col h-screen bg-white select-none" style={{ fontFamily: 'var(--font-inter), Inter, sans-serif' }}>

      {/* ── TOOLBAR ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-gray-100 border-b border-gray-300 text-xs flex-shrink-0">
        <BtnToolbar onClick={abrirPagamento} cor="bg-blue-600 hover:bg-blue-700 text-white" atalho="F2" label="Concluir" />
        <BtnToolbar onClick={() => setModalCliente(true)} cor="bg-white hover:bg-gray-50 text-blue-700 border border-blue-300" atalho="F5"
          label={clienteSelecionado ? clienteSelecionado.nome.split(' ')[0] : 'Cliente'} icon="👤" />
        <BtnToolbar onClick={() => { setDescontoInput(String(descontoGlobal)); setModalDesc(true) }} cor="bg-white hover:bg-gray-50 text-gray-700 border border-gray-300" atalho="F3" label="Desc" icon="%" />
        <BtnToolbar onClick={() => setModalObs(true)} cor="bg-white hover:bg-gray-50 text-gray-700 border border-gray-300" atalho="F4" label="Obs" icon="💬" />
        <BtnToolbar onClick={() => { if (itens.length > 0) { setObsOrc(''); setValidadeOrc(''); setOrcSalvo(null); setModalOrc(true) } }} cor="bg-white hover:bg-gray-50 text-amber-700 border border-amber-300" atalho="F8" label="Orçamento" icon="📋" />
        <BtnToolbar onClick={() => setModalEntrega(true)} cor={`bg-white hover:bg-gray-50 border border-gray-300 ${entrega ? 'text-orange-600 border-orange-300' : 'text-gray-700'}`} atalho="F9" label={entrega ? '🛵 Entrega' : 'Entregar'} />
        {/* Botão devolução */}
        <BtnToolbar
          onClick={() => setModoDevol(m => !m)}
          cor={modoDevol
            ? 'bg-red-500 hover:bg-red-600 text-white border border-red-600'
            : 'bg-white hover:bg-red-50 text-red-600 border border-red-300'}
          atalho="F6"
          label={modoDevol ? '🔄 DEVOLVENDO' : '🔄 Devolver'}
        />
        <div className="flex-1" />
        <span className="text-gray-400 px-2">{operadorNome.split('@')[0]}</span>
        <button onClick={() => router.push('/dashboard')} className="px-3 py-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded text-xs">← Painel</button>
      </div>

      {/* Banner modo devolução */}
      {modoDevol && (
        <div className="bg-red-500 text-white text-center py-1.5 text-xs font-bold tracking-wide flex-shrink-0">
          🔄 MODO DEVOLUÇÃO ATIVO — Os produtos adicionados serão registrados como devolução · F6 para desativar
        </div>
      )}

      {/* ── BUSCA ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex-1 relative">
          <input
            ref={buscaRef}
            value={busca}
            onChange={e => { setBusca(e.target.value); setSugestaoIdx(-1) }}
            onKeyDown={onBuscaKey}
            placeholder={modoDevol ? '🔄 Devolução — busque o produto devolvido' : 'Código, Nome ou use o leitor de código de barras'}
            className={`w-full border rounded px-3 py-2 text-sm focus:outline-none transition-colors ${
              modoDevol
                ? 'border-red-300 bg-red-50 focus:border-red-500'
                : 'border-yellow-300 bg-yellow-50 focus:border-blue-400 focus:bg-white'
            }`}
          />
          {buscando && <span className="absolute right-3 top-2.5 text-gray-400 text-xs">🔍</span>}

          {sugestoes.length > 0 && (
            <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-b-lg shadow-lg z-50 max-h-80 overflow-y-auto">
              <div className="grid grid-cols-[90px_1fr_130px_70px_90px] gap-0 px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-[11px] font-semibold text-gray-400 uppercase tracking-wide sticky top-0">
                <span>SKU</span><span>Nome</span><span>Marca</span><span className="text-center">Estoque</span><span className="text-right">Preço</span>
              </div>
              <div ref={sugestaoListRef}>
                {sugestoes.map((p, i) => (
                  <div key={p.id} onMouseDown={() => { confirmarAdicao(p); setSugestaoIdx(-1) }}
                    className={`grid grid-cols-[90px_1fr_130px_70px_90px] gap-0 px-3 py-2 cursor-pointer text-sm border-b border-gray-50 last:border-0 items-center ${i === sugestaoIdx ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                    <span className="text-gray-400 text-xs font-mono truncate pr-2">{p.sku}</span>
                    <span className="font-medium text-gray-900 truncate pr-2">{p.nome}</span>
                    <span className="text-indigo-600 text-xs truncate pr-2">{p.marca ?? '—'}</span>
                    <span className={`text-center text-xs font-medium ${p.estoque <= 0 ? 'text-red-500' : p.estoque <= 5 ? 'text-orange-500' : 'text-gray-500'}`}>
                      {p.estoque} {p.unidade}
                    </span>
                    <span className="text-right font-semibold text-blue-700">{fmt(p.preco_venda)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {produtoPendente && (
            <span className="text-xs text-blue-600 font-medium max-w-[180px] truncate">
              {produtoPendente.nome.split(' ').slice(0, 3).join(' ')}
            </span>
          )}
          <span className="text-xs text-gray-500">Qtd:</span>
          <input
            ref={qtdRef}
            value={qtdInput}
            onChange={e => setQtdInput(e.target.value)}
            onFocus={e => e.target.select()}
            onKeyDown={onQtdKey}
            className={`w-20 border rounded px-2 py-2 text-sm text-center font-semibold focus:outline-none transition-colors ${
              modoDevol
                ? 'border-red-400 bg-red-50 text-red-700 focus:border-red-600'
                : produtoPendente ? 'border-blue-400 bg-blue-50 focus:border-blue-600' : 'border-gray-300 focus:border-blue-400'
            }`}
          />
          {modoDevol && (
            <span className="text-xs text-red-500 font-medium">neg.</span>
          )}
          {produtoPendente && (
            <button onMouseDown={() => confirmarAdicao(produtoPendente)}
              className={`px-3 py-2 text-white text-xs font-semibold rounded ${modoDevol ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'}`}>
              {modoDevol ? '− Dev' : '+ Add'}
            </button>
          )}
        </div>
      </div>

      {/* ── LISTA DE ITENS ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {itens.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-300 text-sm gap-2">
            <span className="text-4xl">🛒</span>
            <span>Busque um produto ou use o leitor de código de barras</span>
            <span className="text-xs">F6 para ativar modo devolução</span>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
              <tr>
                <th className="text-left px-3 py-2 w-8">#</th>
                <th className="text-left px-3 py-2">Produto</th>
                <th className="text-center px-2 py-2 w-28">Qtd</th>
                <th className="text-right px-2 py-2 w-28">Preço</th>
                <th className="text-center px-2 py-2 w-20">Desc%</th>
                <th className="text-right px-3 py-2 w-32">Total</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item, idx) => {
                const isDev = item.tipo === 'devolucao'
                return (
                  <tr key={item.id}
                    onClick={() => setItemSelecionado(item.id === itemSelecionado?.id ? null : item)}
                    className={`border-b cursor-pointer transition-colors ${
                      isDev
                        ? item.id === itemSelecionado?.id ? 'bg-red-100 border-red-200' : 'bg-red-50 border-red-100 hover:bg-red-100'
                        : item.id === itemSelecionado?.id ? 'bg-blue-50 border-gray-100' : 'hover:bg-gray-50 border-gray-100'
                    }`}>
                    <td className="px-3 py-2 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {isDev && (
                          <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded flex-shrink-0">
                            DEV
                          </span>
                        )}
                        <div>
                          <div className={`font-medium ${isDev ? 'text-red-800' : 'text-gray-900'}`}>{item.nome}</div>
                          <div className="text-xs text-gray-400">{item.sku} · {item.unidade}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onMouseDown={e => { e.stopPropagation(); alterarQtd(item.id, item.quantidade + (isDev ? 1 : -1)) }}
                          className={`w-6 h-6 rounded flex items-center justify-center text-base leading-none ${isDev ? 'bg-red-100 hover:bg-red-200 text-red-700' : 'bg-gray-200 hover:bg-gray-300 text-gray-600'}`}>
                          {isDev ? '+' : '−'}
                        </button>
                        <input value={item.quantidade} onChange={e => alterarQtd(item.id, parseFloat(e.target.value) || 0)}
                          onClick={e => e.stopPropagation()}
                          className={`w-14 text-center border rounded px-1 py-0.5 text-sm font-semibold focus:outline-none ${isDev ? 'border-red-300 text-red-700 bg-red-50' : 'border-gray-300 focus:border-blue-400'}`} />
                        <button onMouseDown={e => { e.stopPropagation(); alterarQtd(item.id, item.quantidade + (isDev ? -1 : 1)) }}
                          className={`w-6 h-6 rounded flex items-center justify-center text-base leading-none ${isDev ? 'bg-red-100 hover:bg-red-200 text-red-700' : 'bg-gray-200 hover:bg-gray-300 text-gray-600'}`}>
                          {isDev ? '−' : '+'}
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input value={item.preco_unitario.toFixed(2)} onChange={e => alterarPreco(item.id, parseFloat(e.target.value) || 0)}
                        onClick={e => e.stopPropagation()}
                        className="w-24 text-right border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:border-blue-400" />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input value={item.desconto} onChange={e => alterarDesc(item.id, parseFloat(e.target.value) || 0)}
                        onClick={e => e.stopPropagation()}
                        className="w-16 text-center border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:border-blue-400" />
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${isDev ? 'text-red-600' : 'text-gray-900'}`}>
                      {isDev ? `−${fmt(Math.abs(item.total))}` : fmt(item.total)}
                    </td>
                    <td className="px-2 py-2">
                      <button onMouseDown={e => { e.stopPropagation(); removerItem(item.id) }}
                        className="w-6 h-6 rounded hover:bg-red-100 text-gray-300 hover:text-red-500 flex items-center justify-center text-base">×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── RODAPÉ ────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t-2 border-gray-300 bg-gray-50">
        {/* Breakdown devolução */}
        {hasDevolucao && (
          <div className="px-4 py-1.5 border-b border-gray-200 flex items-center gap-6 text-xs">
            <span className="text-gray-500">Vendas: <strong className="text-gray-700">{fmt(totalVendas)}</strong></span>
            <span className="text-red-500">Devoluções: <strong>−{fmt(totalDevolucoes)}</strong></span>
            {descontoGlobal > 0 && <span className="text-orange-600">Desc: −{fmt(descontoGlobal)}</span>}
            <span className={`font-semibold ${saldoFinal < 0 ? 'text-amber-600' : saldoFinal === 0 ? 'text-emerald-600' : 'text-blue-700'}`}>
              {saldoFinal < 0
                ? `Crédito ao cliente: ${fmt(valorCredito)}`
                : saldoFinal === 0
                  ? '✓ Troca sem diferença'
                  : `Saldo a pagar: ${fmt(saldoFinal)}`
              }
            </span>
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-6 text-sm text-gray-500">
            <span>{itens.length} {itens.length === 1 ? 'item' : 'itens'}</span>
            {!hasDevolucao && descontoGlobal > 0 && <span className="text-orange-600">Desc: −{fmt(descontoGlobal)}</span>}
            {clienteSelecionado && <span className="text-blue-600">👤 {clienteSelecionado.nome.split(' ')[0]}</span>}
            {entrega && <span className="text-orange-600">🛵 Entrega</span>}
            {hasDevolucao && itensDevol.length > 0 && (
              <span className="text-red-500">🔄 {itensDevol.length} dev.</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-lg text-gray-700 font-semibold">
              {saldoFinal < 0 ? 'Crédito =' : saldoFinal === 0 && hasDevolucao ? 'Troca =' : 'Total ='}
            </span>
            <span className={`text-2xl font-bold ${saldoFinal < 0 ? 'text-amber-600' : saldoFinal === 0 && hasDevolucao ? 'text-emerald-600' : 'text-blue-700'}`}>
              {saldoFinal < 0 ? fmt(valorCredito) : fmt(total)}
            </span>
            <button onClick={abrirPagamento} disabled={itens.length === 0}
              className={`ml-4 px-6 py-2 disabled:opacity-40 text-white font-semibold rounded-lg text-sm transition-colors ${
                saldoFinal < 0 ? 'bg-amber-500 hover:bg-amber-600' :
                saldoFinal === 0 && hasDevolucao ? 'bg-emerald-600 hover:bg-emerald-700' :
                'bg-blue-600 hover:bg-blue-700'
              }`}>
              {saldoFinal < 0 ? '💳 Gerar Crédito (F2)' :
               saldoFinal === 0 && hasDevolucao ? '🔄 Confirmar Troca (F2)' :
               'Concluir (F2)'}
            </button>
          </div>
        </div>
      </div>

      {/* ── MODAL TROCA SEM DIFERENÇA ───────────────────────────── */}
      {modalTroca && (
        <Modal titulo="🔄 Confirmar Troca" onClose={() => setModalTroca(false)} largura="max-w-md">
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-4 text-center">
              <p className="text-3xl font-bold text-emerald-600 mb-1">Troca sem diferença</p>
              <p className="text-sm text-emerald-700">Não há valor a pagar ou crédito a gerar.</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Produtos vendidos</span><span className="font-medium">{fmt(totalVendas)}</span></div>
              <div className="flex justify-between"><span className="text-red-500">Produtos devolvidos</span><span className="font-medium text-red-600">−{fmt(totalDevolucoes)}</span></div>
              <div className="flex justify-between border-t pt-1 mt-1"><span className="font-semibold">Saldo</span><span className="font-bold text-emerald-600">R$ 0,00</span></div>
            </div>
            {clienteSelecionado && (
              <p className="text-xs text-blue-600 text-center">👤 Cliente: {clienteSelecionado.nome}</p>
            )}
            <div className="flex gap-2">
              <button onClick={() => setModalTroca(false)} className="flex-1 py-2.5 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={() => { setModalTroca(false); concluirVenda('troca') }} disabled={salvando}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold rounded-lg text-sm">
                {salvando ? 'Salvando...' : '✓ Confirmar Troca'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL CRÉDITO AO CLIENTE ────────────────────────────── */}
      {modalCredito && (
        <Modal titulo="💳 Crédito ao Cliente" onClose={() => setModalCredito(false)} largura="max-w-md">
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-4 text-center">
              <p className="text-sm text-amber-700 mb-1">Valor da devolução supera a compra.</p>
              <p className="text-xs text-amber-600 mb-3">Um crédito será gerado para o cliente:</p>
              <p className="text-4xl font-bold text-amber-600">{fmt(valorCredito)}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Produtos vendidos</span><span>{fmt(totalVendas)}</span></div>
              <div className="flex justify-between"><span className="text-red-500">Devoluções</span><span className="text-red-600">−{fmt(totalDevolucoes)}</span></div>
              <div className="flex justify-between border-t pt-1 font-semibold"><span>Crédito gerado</span><span className="text-amber-600">{fmt(valorCredito)}</span></div>
            </div>
            {clienteSelecionado ? (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-sm">
                <p className="text-blue-700 font-medium">👤 {clienteSelecionado.nome}</p>
                {clienteSelecionado.cpf_cnpj && <p className="text-xs text-blue-500 mt-0.5">{clienteSelecionado.cpf_cnpj}</p>}
                <p className="text-xs text-blue-500 mt-0.5">Crédito atual: {fmt(clienteSelecionado.saldo_credito ?? 0)}</p>
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">
                ⚠ Nenhum cliente selecionado. Selecione o cliente para gerar crédito.
              </div>
            )}
            {!clienteSelecionado && (
              <button onClick={() => { setModalCredito(false); setBuscaCliente(''); setAbrirPagAposCliente(true); setModalCliente(true) }}
                className="w-full py-2.5 border border-blue-400 text-blue-600 font-medium rounded-lg text-sm hover:bg-blue-50">
                👤 Selecionar Cliente
              </button>
            )}
            <div className="flex gap-2">
              <button onClick={() => setModalCredito(false)} className="flex-1 py-2.5 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={() => { setModalCredito(false); concluirVenda('devolucao') }}
                disabled={salvando || !clienteSelecionado}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-semibold rounded-lg text-sm">
                {salvando ? 'Salvando...' : '✓ Gerar Crédito'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL PAGAMENTO ──────────────────────────────────────── */}
      {modalPag && (
        <Modal titulo="Pagamento" onClose={() => setModalPag(false)} largura="max-w-md">
          <div className="space-y-4">
            {/* Resumo devolução abatida */}
            {hasDevolucao && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-xs space-y-1">
                <div className="flex justify-between text-gray-500"><span>Total vendas</span><span>{fmt(totalVendas)}</span></div>
                <div className="flex justify-between text-red-500"><span>Devoluções abatidas</span><span>−{fmt(totalDevolucoes)}</span></div>
                {descontoGlobal > 0 && <div className="flex justify-between text-orange-500"><span>Desconto</span><span>−{fmt(descontoGlobal)}</span></div>}
              </div>
            )}
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex justify-between items-center">
              <span className="text-sm text-blue-700 font-medium">{hasDevolucao ? 'Saldo a pagar' : 'Total a pagar'}</span>
              <span className="text-2xl font-bold text-blue-700">{fmt(total)}</span>
            </div>

            <div>
              <p className="text-xs text-gray-400 mb-2">Pressione <kbd className="bg-gray-100 border border-gray-300 rounded px-1">1</kbd>–<kbd className="bg-gray-100 border border-gray-300 rounded px-1">6</kbd> para selecionar a forma de pagamento</p>
              <div className="grid grid-cols-6 gap-2">
                {FORMAS.map((f) => {
                  const ativa = formas.length === 1 && formas[0].tipo === f.id
                  return (
                    <button key={f.id}
                      onClick={() => { setFormas([{ tipo: f.id, valor: total }]); setFormaIdx(0); setTimeout(() => { valorRefs.current[0]?.focus(); valorRefs.current[0]?.select() }, 30) }}
                      className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 text-xs font-medium transition-all ${ativa ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}>
                      <span className="text-lg">{f.icon}</span>
                      <span>{f.label}</span>
                      <kbd className={`text-[10px] px-1 rounded ${ativa ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>{f.tecla}</kbd>
                    </button>
                  )
                })}
              </div>
            </div>

            {formas.map((f, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm text-gray-600 w-24 flex-shrink-0">{FORMAS.find(x => x.id === f.tipo)?.label ?? f.tipo}</span>
                <input ref={el => { valorRefs.current[i] = el }}
                  type="number" step="0.01" value={f.valor || ''} placeholder="0,00"
                  onChange={e => setFormas(p => p.map((x, xi) => xi === i ? { ...x, valor: parseFloat(e.target.value) || 0 } : x))}
                  onFocus={e => e.target.select()}
                  className="flex-1 border-2 border-blue-300 rounded-lg px-3 py-2.5 text-sm text-right text-lg font-semibold focus:outline-none focus:border-blue-500" />
                {formas.length > 1 && (
                  <button onClick={() => setFormas(p => p.filter((_, xi) => xi !== i))} className="text-red-400 hover:text-red-600 text-lg">×</button>
                )}
              </div>
            ))}
            {!isFiado && (
              <button onClick={() => setFormas(p => [...p, { tipo: 'dinheiro', valor: 0 }])} className="text-xs text-blue-600 hover:text-blue-800">+ Adicionar forma de pagamento</button>
            )}

            {isFiado && (
              <div className="border border-amber-300 bg-amber-50 rounded-xl p-4 space-y-3">
                <p className="text-amber-800 font-semibold text-sm">📒 Configuração do Fiado</p>
                {clienteSelecionado ? (
                  <div className="text-xs text-amber-700 space-y-1">
                    <p>Cliente: <strong>{clienteSelecionado.nome}</strong></p>
                    <p>Disponível: <strong>{fmt(Math.max(0, (clienteSelecionado.limite_credito ?? 0) - (clienteSelecionado.saldo_devedor ?? 0)))}</strong></p>
                    {clienteSelecionado.bloqueado_fiado && <p className="text-red-600 font-bold">⚠ Cliente BLOQUEADO para fiado</p>}
                  </div>
                ) : <p className="text-xs text-red-600">⚠ Selecione o cliente antes (F5)</p>}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-amber-700">Parcelas</label>
                    <input type="number" min="1" max="60" value={fiadoParcelas} onChange={e => setFiadoParcelas(e.target.value)}
                      className="w-full mt-1 border border-amber-300 bg-white rounded px-2 py-1.5 text-sm text-center" />
                  </div>
                  <div>
                    <label className="text-xs text-amber-700">1º Vencimento *</label>
                    <input type="date" value={fiadoPrimVenc} onChange={e => setFiadoPrimVenc(e.target.value)}
                      className="w-full mt-1 border border-amber-300 bg-white rounded px-2 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-amber-700">Intervalo (dias)</label>
                    <input type="number" value={fiadoIntervalo} onChange={e => setFiadoIntervalo(e.target.value)}
                      className="w-full mt-1 border border-amber-300 bg-white rounded px-2 py-1.5 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-amber-700">Observação</label>
                  <input value={fiadoObs} onChange={e => setFiadoObs(e.target.value)}
                    className="w-full mt-1 border border-amber-300 bg-white rounded px-2 py-1.5 text-sm" />
                </div>
                {errFiado && <p className="text-xs text-red-600 font-medium">{errFiado}</p>}
              </div>
            )}

            {!isFiado && troco2 > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex justify-between">
                <span className="text-sm text-green-700 font-medium">Troco</span>
                <span className="text-xl font-bold text-green-700">{fmt(troco2)}</span>
              </div>
            )}
            {!isFiado && totalPago > 0 && totalPago < total && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex justify-between">
                <span className="text-sm text-red-700">Falta</span>
                <span className="text-xl font-bold text-red-700">{fmt(total - totalPago)}</span>
              </div>
            )}

            {isCarteira && !clienteSelecionado && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-xs text-amber-800 font-medium">
                👛 Carteira exige cliente identificado — pressione F5 para selecionar.
              </div>
            )}

            {errFiado && !isFiado && (
              <p className="text-xs text-red-600 font-medium">{errFiado}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={() => { setModalPag(false); setErrFiado('') }} className="flex-1 py-2.5 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancelar (Esc)</button>
              <button onClick={() => concluirVenda(hasDevolucao ? 'mista' : 'venda')}
                disabled={salvando || (!isFiado && totalPago < total) || (isCarteira && !clienteSelecionado)}
                className={`flex-1 py-2.5 disabled:opacity-40 text-white font-semibold rounded-lg text-sm transition-colors ${isFiado ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                {salvando ? 'Salvando...' : isFiado ? '📒 Confirmar Fiado (Enter)' : '✓ Confirmar (Enter)'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL ORÇAMENTO ──────────────────────────────────────── */}
      {modalOrc && (
        <Modal titulo="Salvar como Orçamento" onClose={() => { setModalOrc(false); setOrcSalvo(null) }} largura="max-w-md">
          {orcSalvo ? (
            <div className="text-center space-y-4 py-2">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto text-3xl">✓</div>
              <div>
                <p className="text-lg font-bold text-gray-900">Orçamento #{orcSalvo.numero} salvo!</p>
                <p className="text-sm text-gray-500 mt-1">Sem baixa de estoque ou lançamento financeiro.</p>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => { setModalOrc(false); setOrcSalvo(null) }} className="flex-1 py-2.5 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Continuar editando</button>
                <button onClick={limparTudo} className="flex-1 py-2.5 bg-blue-600 text-white font-semibold rounded-lg text-sm hover:bg-blue-700">Nova venda</button>
              </div>
              <button onClick={() => router.push('/dashboard/orcamentos')} className="w-full text-xs text-blue-600 hover:text-blue-800 mt-1">Ver todos os orçamentos →</button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex justify-between items-center">
                <div>
                  <p className="text-xs text-amber-700 font-medium">{itens.length} {itens.length === 1 ? 'item' : 'itens'}</p>
                  {clienteSelecionado && <p className="text-xs text-amber-600">👤 {clienteSelecionado.nome}</p>}
                </div>
                <span className="text-2xl font-bold text-amber-700">{fmt(total)}</span>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Validade do orçamento</label>
                <input autoFocus type="date" value={validadeOrc} onChange={e => setValidadeOrc(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Observação (opcional)</label>
                <textarea value={obsOrc} onChange={e => setObsOrc(e.target.value)} rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:border-amber-400" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setModalOrc(false)} className="flex-1 py-2.5 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancelar</button>
                <button onClick={salvarOrcamento} disabled={salvandoOrc}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-semibold rounded-lg text-sm">
                  {salvandoOrc ? 'Salvando...' : '📋 Salvar Orçamento'}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* ── MODAL CLIENTE ─────────────────────────────────────────── */}
      {modalCliente && (
        <Modal titulo="Selecionar Cliente" onClose={() => { setModalCliente(false); setAbrirPagAposCliente(false) }} largura="max-w-lg">
          <input autoFocus value={buscaCliente} onChange={e => setBuscaCliente(e.target.value)}
            placeholder="Buscar por nome, CPF ou telefone..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mb-3 focus:outline-none focus:border-blue-500" />
          {abrirPagAposCliente && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 text-xs text-amber-700">
              ⚠ Para gerar crédito de {fmt(valorCredito)}, é obrigatório identificar o cliente.
            </div>
          )}
          <div className="max-h-72 overflow-y-auto space-y-1">
            {!abrirPagAposCliente && (
              <button onClick={() => { setClienteSelecionado(null); setModalCliente(false) }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 text-sm text-gray-500">
                — Sem cliente (consumidor)
              </button>
            )}
            {clientesFiltrados.map(c => (
              <button key={c.id} onClick={() => { setClienteSelecionado(c); setModalCliente(false) }}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${clienteSelecionado?.id === c.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}`}>
                <div className="font-medium">{c.nome}</div>
                <div className="text-xs text-gray-400">{c.cpf_cnpj} {c.telefone && `· ${c.telefone}`}</div>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* ── MODAL DESCONTO ────────────────────────────────────────── */}
      {modalDesc && (
        <Modal titulo="Desconto Global" onClose={() => setModalDesc(false)} largura="max-w-xs">
          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-600 mb-1 block">Valor do desconto (R$)</label>
              <input autoFocus type="number" step="0.01" value={descontoInput}
                onChange={e => setDescontoInput(e.target.value)}
                onFocus={e => e.target.select()}
                onKeyDown={e => { if (e.key === 'Enter') { setDescontoGlobal(parseFloat(descontoInput) || 0); setModalDesc(false) } }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-right text-lg" />
            </div>
            <button onClick={() => { setDescontoGlobal(parseFloat(descontoInput) || 0); setModalDesc(false) }}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm">
              Aplicar desconto (Enter)
            </button>
          </div>
        </Modal>
      )}

      {/* ── MODAL OBSERVAÇÃO ──────────────────────────────────────── */}
      {modalObs && (
        <Modal titulo="Observação da Venda" onClose={() => setModalObs(false)} largura="max-w-sm">
          <textarea autoFocus value={obs} onChange={e => setObs(e.target.value)} rows={4}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:border-blue-500 mb-3" />
          <button onClick={() => setModalObs(false)} className="w-full py-2.5 bg-blue-600 text-white font-medium rounded-lg text-sm">Salvar</button>
        </Modal>
      )}

      {/* ── MODAL ENTREGA ─────────────────────────────────────────── */}
      {modalEntrega && (
        <Modal titulo="Dados de Entrega" onClose={() => setModalEntrega(false)} largura="max-w-md">
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="text-xs text-gray-500 mb-1 block">Logradouro</label>
                <input autoFocus value={endEntrega.logradouro} onChange={e => setEndEntrega(p => ({ ...p, logradouro: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Número</label>
                <input value={endEntrega.numero} onChange={e => setEndEntrega(p => ({ ...p, numero: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Bairro</label>
                <input value={endEntrega.bairro} onChange={e => setEndEntrega(p => ({ ...p, bairro: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Cidade</label>
                <input value={endEntrega.cidade} onChange={e => setEndEntrega(p => ({ ...p, cidade: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Obs. entrega</label>
              <input value={endEntrega.obs} onChange={e => setEndEntrega(p => ({ ...p, obs: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <button onClick={() => { setEntrega(true); setModalEntrega(false) }}
              className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-lg text-sm">
              🛵 Confirmar entrega
            </button>
            {entrega && (
              <button onClick={() => { setEntrega(false); setModalEntrega(false) }}
                className="w-full py-2 text-red-500 hover:text-red-700 text-sm">
                Cancelar entrega
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

function BtnToolbar({ label, atalho, onClick, cor, icon }: { label: string; atalho: string; onClick: () => void; cor: string; icon?: string }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${cor}`}>
      {icon && <span>{icon}</span>}
      <span>{label}</span>
      <span className="opacity-60 text-[10px]">({atalho})</span>
    </button>
  )
}

function Modal({ titulo, children, onClose, largura = 'max-w-md' }: {
  titulo: string; children: React.ReactNode; onClose: () => void; largura?: string
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${largura} mx-4`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">{titulo}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}
