'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import DetalheVendaModal from './DetalheVendaModal'
import EditarItensVendaModal from './EditarItensVendaModal'
import EnviarWhatsAppModal, { type EnviarWppPayload } from '@/components/integracoes/EnviarWhatsAppModal'
import { calcSaude, CONFIG_PADRAO, FAIXAS_PADRAO, type SaudeConfig, type FaixaSaude, type ResultadoSaude } from '@/lib/saude-venda'
import { abrirDanfe, type FormatoPapel } from '@/lib/fiscal/danfe'

type Cliente = { nome: string; telefone: string | null; cpf_cnpj: string | null } | null

export type Venda = {
  id: string
  numero: number | string
  total: number
  subtotal: number
  desconto: number
  status: string
  forma_pagamento: string
  pagamentos: { forma: string; valor: number }[] | null
  tipo_operacao: string
  created_at: string
  cliente_id: string | null
  operador_nome: string | null
  vendedor_nome: string | null
  canal: string | null
  clientes: Cliente
  nfce_status: string | null
  nfce_numero: string | null
  nfce_chave: string | null
  nfce_motivo_rejeicao: string | null
  nfce_url_pdf: string | null
}

type VendaItemLite = {
  venda_id: string; produto_id: string | null; produto_nome: string
  quantidade: number; preco_unitario: number; desconto: number | null
  custo_unitario: number | null; tipo: string
}

type Periodo = 'hoje' | 'ontem' | '7dias' | 'mes' | 'custom'

const FORMA_LABEL: Record<string, string> = {
  dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', pix: 'Pix',
  carteira: 'Carteira', fiado: 'Fiado', troca: 'Troca', multiplo: 'Múltiplo',
  // O PDV grava 'misto' quando a venda foi paga em mais de uma forma —
  // faltava aqui, e por isso essas vendas apareciam com o código cru.
  misto: 'Misto',
}

function fmt(v: number) { return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

function inicioDoDia(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function fimDoDia(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }

function calcularRange(periodo: Periodo, custom: { inicio: string; fim: string }): { inicio: Date; fim: Date } {
  const hoje = new Date()
  if (periodo === 'hoje') return { inicio: inicioDoDia(hoje), fim: fimDoDia(hoje) }
  if (periodo === 'ontem') {
    const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1)
    return { inicio: inicioDoDia(ontem), fim: fimDoDia(ontem) }
  }
  if (periodo === '7dias') {
    const seteAtras = new Date(hoje); seteAtras.setDate(seteAtras.getDate() - 6)
    return { inicio: inicioDoDia(seteAtras), fim: fimDoDia(hoje) }
  }
  if (periodo === 'mes') {
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
    return { inicio: inicioDoDia(inicioMes), fim: fimDoDia(hoje) }
  }
  const inicio = custom.inicio ? inicioDoDia(new Date(custom.inicio + 'T00:00:00')) : inicioDoDia(hoje)
  const fim = custom.fim ? fimDoDia(new Date(custom.fim + 'T00:00:00')) : fimDoDia(hoje)
  return { inicio, fim }
}

const SELECT_VENDAS = 'id, numero, total, subtotal, desconto, status, forma_pagamento, pagamentos, tipo_operacao, created_at, cliente_id, operador_nome, vendedor_nome, canal, clientes(nome, telefone, cpf_cnpj), nfce_status, nfce_numero, nfce_chave, nfce_motivo_rejeicao, nfce_url_pdf'

export default function VendasClient({ empresaId, vendasIniciais, totalInicial, empresaEstoqueNome, empresaFiscalNome, saudeConfig, saudeFaixas, formatoImpressao, erroInicial }: {
  empresaId: string; vendasIniciais: Venda[]; totalInicial: number
  // Config da conta (Empresas → Estoque/Fiscal) — igual em toda linha hoje.
  empresaEstoqueNome: string; empresaFiscalNome: string
  saudeConfig?: SaudeConfig | null; saudeFaixas?: FaixaSaude[]
  formatoImpressao?: FormatoPapel
  erroInicial?: string | null
}) {
  const [vendas, setVendas] = useState<Venda[]>(vendasIniciais)
  const [total, setTotal] = useState(totalInicial)
  const [carregando, setCarregando] = useState(false)
  const [erroBusca, setErroBusca] = useState(erroInicial ?? '')
  const [periodo, setPeriodo] = useState<Periodo>('hoje')
  const [customInicio, setCustomInicio] = useState('')
  const [customFim, setCustomFim] = useState('')
  const [busca, setBusca] = useState('')
  const [buscaDebounced, setBuscaDebounced] = useState('')

  const [detalheAberto, setDetalheAberto] = useState<Venda | null>(null)
  const [modoEdicaoInicial, setModoEdicaoInicial] = useState(false)
  // Correção de itens da venda — modal próprio, separado do detalhe, porque
  // mexe em estoque e não é edição de cadastro.
  const [corrigindo, setCorrigindo] = useState<Venda | null>(null)
  const [gerandoPdfId, setGerandoPdfId] = useState<string | null>(null)
  const [wppAberto, setWppAberto] = useState(false)
  const [wppPayload, setWppPayload] = useState<EnviarWppPayload | null>(null)

  const [itensPorVenda, setItensPorVenda] = useState<Record<string, VendaItemLite[]>>({})
  const [saudePorVenda, setSaudePorVenda] = useState<Record<string, { resultado: ResultadoSaude; aproximado: boolean }>>({})
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [aplicandoMassa, setAplicandoMassa] = useState(false)
  const [resumoMassa, setResumoMassa] = useState('')
  const [trocandoPagamento, setTrocandoPagamento] = useState(false)
  const [novaFormaMassa, setNovaFormaMassa] = useState('pix')
  const [emitindoId, setEmitindoId] = useState<string | null>(null)

  const cfgSaude = saudeConfig ?? CONFIG_PADRAO
  const faixasSaude = (saudeFaixas && saudeFaixas.length > 0) ? saudeFaixas : FAIXAS_PADRAO

  const primeiraRenderizacao = useRef(true)

  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca), 350)
    return () => clearTimeout(t)
  }, [busca])

  useEffect(() => {
    if (primeiraRenderizacao.current) { primeiraRenderizacao.current = false; return }
    buscarVendas()
  }, [periodo, customInicio, customFim, buscaDebounced])

  async function buscarVendas() {
    setCarregando(true); setErroBusca('')
    const sb = createClient()
    const { inicio, fim } = calcularRange(periodo, { inicio: customInicio, fim: customFim })
    const termo = buscaDebounced.trim()

    let idsFiltro: string[] | null = null
    if (termo) {
      const [{ data: itensMatch }, { data: clienteMatch }] = await Promise.all([
        sb.from('venda_itens').select('venda_id').ilike('produto_nome', `%${termo}%`).limit(500),
        sb.from('vendas').select('id, clientes!inner(nome)').eq('empresa_id', empresaId).ilike('clientes.nome', `%${termo}%`).limit(500),
      ])
      const ids = new Set<string>()
      for (const i of itensMatch ?? []) ids.add(i.venda_id)
      for (const v of clienteMatch ?? []) ids.add(v.id)
      if (/^\d+$/.test(termo)) {
        const { data: porNumero } = await sb.from('vendas').select('id').eq('empresa_id', empresaId).eq('numero', parseInt(termo)).limit(20)
        for (const v of porNumero ?? []) ids.add(v.id)
      }
      idsFiltro = [...ids]
      if (idsFiltro.length === 0) { setVendas([]); setTotal(0); setCarregando(false); return }
    }

    let query = sb.from('vendas').select(SELECT_VENDAS, { count: 'exact' })
      .eq('empresa_id', empresaId)
      .gte('created_at', inicio.toISOString())
      .lte('created_at', fim.toISOString())
      .order('created_at', { ascending: false })
      .limit(300)
    if (idsFiltro) query = query.in('id', idsFiltro)

    const { data, count, error } = await query
    if (error) { setErroBusca(error.message); setCarregando(false); return }
    setVendas((data ?? []) as unknown as Venda[])
    setTotal(count ?? 0)
    setCarregando(false)
  }

  // Filtro por forma de pagamento.
  //
  // As opções saem do que existe no período carregado, não de uma lista
  // fixa: a produção usa códigos que a lista fixa não previa ('misto'), e
  // uma forma sem opção é uma venda inalcançável.
  //
  // Uma venda paga em mais de uma forma entra em TODAS as formas que ela
  // usou — quem filtra por Pix quer ver também a venda que foi metade Pix,
  // metade dinheiro.
  const [formasFiltro, setFormasFiltro] = useState<Set<string>>(new Set())

  const formasDaVenda = (v: Venda): string[] => {
    const formas = new Set<string>()
    if (v.forma_pagamento) formas.add(v.forma_pagamento)
    for (const p of v.pagamentos ?? []) if (p?.forma) formas.add(p.forma)
    return [...formas]
  }

  const formasPresentes = (() => {
    const contagem = new Map<string, number>()
    for (const v of vendas) for (const f of formasDaVenda(v)) contagem.set(f, (contagem.get(f) ?? 0) + 1)
    return [...contagem.entries()].sort((a, b) => b[1] - a[1])
  })()

  // Filtro por situação fiscal. Combina com os demais em cadeia: período e
  // busca já reduziram `vendas`, pagamento reduz depois, e este reduz por
  // último — marcar um não desmarca os outros.
  //
  // Troca e devolução ficam FORA da conta de "sem nota": NFC-e é emitida só
  // para venda (é o mesmo critério do painel de detalhe). Sem isso, a lista
  // de pendências viria cheia de devolução que nunca vai ter nota.
  type SituacaoFiscal = '' | 'com' | 'sem' | 'rejeitada'
  const [fiscalFiltro, setFiscalFiltro] = useState<SituacaoFiscal>('')

  const ehVendaFiscalizavel = (v: Venda) => v.tipo_operacao === 'venda'
  const temNota = (v: Venda) => v.nfce_status === 'autorizada'
  const foiRecusada = (v: Venda) => v.nfce_status === 'rejeitada' || v.nfce_status === 'erro'

  const casaFiscal = (v: Venda): boolean => {
    if (fiscalFiltro === '') return true
    if (fiscalFiltro === 'com') return temNota(v)
    if (fiscalFiltro === 'rejeitada') return foiRecusada(v)
    // 'sem' — o que ainda precisa de nota: nunca emitida, recusada ou
    // cancelada. É a lista de trabalho, não só "status nulo".
    return ehVendaFiscalizavel(v) && !temNota(v)
  }

  const contagemFiscal = {
    com: vendas.filter(temNota).length,
    sem: vendas.filter(v => ehVendaFiscalizavel(v) && !temNota(v)).length,
    rejeitada: vendas.filter(foiRecusada).length,
  }

  const vendasFiltradas = vendas
    .filter(v => formasFiltro.size === 0 || formasDaVenda(v).some(f => formasFiltro.has(f)))
    .filter(casaFiscal)

  const totalFaturado = vendasFiltradas.filter(v => v.status === 'concluida').reduce((s, v) => s + (v.total ?? 0), 0)

  // Saúde retroativa por venda — reaproveita o mesmo calcSaude usado ao vivo
  // no PDV. Vendas antigas não têm custo_unitario salvo (coluna nova), então
  // caem no fallback do custo ATUAL do produto — aproximação, marcada como tal.
  useEffect(() => {
    if (vendas.length === 0) { setItensPorVenda({}); setSaudePorVenda({}); return }
    let ativo = true
    ;(async () => {
      const sb = createClient()
      const ids = vendas.map(v => v.id)
      const { data: itens } = await sb.from('venda_itens')
        .select('venda_id, produto_id, produto_nome, quantidade, preco_unitario, desconto, custo_unitario, tipo')
        .in('venda_id', ids)
      if (!ativo) return

      const porVenda: Record<string, VendaItemLite[]> = {}
      const produtoIdsSemCusto = new Set<string>()
      for (const it of (itens ?? []) as VendaItemLite[]) {
        ;(porVenda[it.venda_id] ??= []).push(it)
        if (it.custo_unitario == null && it.produto_id) produtoIdsSemCusto.add(it.produto_id)
      }
      setItensPorVenda(porVenda)

      const custoAtualPorProduto: Record<string, number> = {}
      if (produtoIdsSemCusto.size > 0) {
        const { data: produtosData } = await sb.from('produtos').select('id, preco_custo').in('id', [...produtoIdsSemCusto])
        for (const p of produtosData ?? []) custoAtualPorProduto[p.id] = p.preco_custo ?? 0
      }
      if (!ativo) return

      const saudeCalc: Record<string, { resultado: ResultadoSaude; aproximado: boolean }> = {}
      for (const v of vendas) {
        const itensV = porVenda[v.id] ?? []
        let aproximado = false
        const itensCalc = itensV.map(it => {
          let custo = it.custo_unitario
          if (custo == null) {
            aproximado = true
            custo = it.produto_id ? (custoAtualPorProduto[it.produto_id] ?? 0) : 0
          }
          return { custo, preco_unitario: it.preco_unitario, quantidade: it.quantidade, tipo: (it.tipo === 'devolucao' ? 'devolucao' : 'venda') as 'venda' | 'devolucao' }
        })
        const resultado = calcSaude(itensCalc, v.desconto ?? 0, v.forma_pagamento, 1, cfgSaude, faixasSaude)
        saudeCalc[v.id] = { resultado, aproximado }
      }
      setSaudePorVenda(saudeCalc)
    })()
    return () => { ativo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendas])

  async function gerarPdfUrl(vendaId: string): Promise<string | null> {
    setGerandoPdfId(vendaId)
    try {
      const res = await fetch(`/api/vendas/${vendaId}/comprovante-pdf`, { method: 'POST' })
      const data = await res.json()
      if (!data.ok) { alert(data.erro ?? 'Falha ao gerar PDF'); return null }
      return data.url as string
    } catch (e: any) {
      alert('Erro ao gerar PDF: ' + e.message)
      return null
    } finally {
      setGerandoPdfId(null)
    }
  }

  async function imprimirVenda(venda: Venda) {
    const url = await gerarPdfUrl(venda.id)
    if (url) window.open(url, '_blank')
  }

  async function abrirWhatsapp(venda: Venda) {
    const url = await gerarPdfUrl(venda.id)
    if (!url) return
    setWppPayload({
      telefone: venda.clientes?.telefone ?? '',
      mensagem: `Segue o comprovante da sua compra #${venda.numero} — Total: ${fmt(venda.total)}. Obrigado! 🙏`,
      tipo: 'comprovante_venda',
      cliente_id: venda.cliente_id,
      cliente_nome: venda.clientes?.nome ?? null,
      referencia_tipo: 'venda',
      referencia_id: venda.id,
      pdf_url: url,
    })
    setWppAberto(true)
  }

  function abrirDetalhe(venda: Venda, edicao = false) {
    setModoEdicaoInicial(edicao)
    setDetalheAberto(venda)
  }

  function toggleTodos(checked: boolean) {
    // Só o que está visível — marcar tudo com filtro ativo não pode pegar
    // venda que a pessoa não está vendo.
    setSelecionados(checked ? new Set(vendasFiltradas.map(v => v.id)) : new Set())
  }
  function toggleUm(id: string) {
    setSelecionados(prev => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id); else novo.add(id)
      return novo
    })
  }

  function aguardar(ms: number) { return new Promise(r => setTimeout(r, ms)) }

  // NFC-e autorizada = cStat 100 da SEFAZ ("Autorizado o uso da NF-e"). Só
  // nesse caso existe DANFE pra imprimir; rejeitada/pendente/não emitida não
  // tem documento válido.
  function podeImprimirNfce(v: Venda) {
    return v.nfce_status === 'autorizada' && !!v.nfce_url_pdf
  }

  function imprimirNfce(v: Venda, imprimir = true) {
    const r = abrirDanfe(v.nfce_url_pdf, { imprimir, formato: formatoImpressao })
    if (!r.ok) alert(`NFC-e da venda #${v.numero}: ${r.erro}`)
  }

  async function imprimirNfceSelecionadas() {
    const todas = vendas.filter(v => selecionados.has(v.id))
    const comNfce = todas.filter(podeImprimirNfce)
    const semNfce = todas.length - comNfce.length
    if (comNfce.length === 0) {
      alert('Nenhuma das vendas selecionadas tem NFC-e autorizada pra imprimir.')
      return
    }
    setAplicandoMassa(true); setResumoMassa('')
    let ok = 0
    const falhas: string[] = []
    for (const v of comNfce) {
      const r = abrirDanfe(v.nfce_url_pdf, { imprimir: true })
      if (r.ok) ok++; else falhas.push(`#${v.numero}: ${r.erro}`)
      await aguardar(400) // evita o navegador barrar várias janelas de uma vez
    }
    const partes = [`${ok} NFC-e aberta(s) pra impressão`]
    if (semNfce > 0) partes.push(`${semNfce} pulada(s) sem NFC-e autorizada`)
    if (falhas.length > 0) partes.push(falhas.join('; '))
    setResumoMassa(partes.join(' · '))
    setAplicandoMassa(false)
  }

  async function imprimirSelecionados() {
    const alvos = vendas.filter(v => selecionados.has(v.id))
    if (alvos.length === 0) return
    setAplicandoMassa(true); setResumoMassa('')
    let ok = 0
    for (const v of alvos) {
      const url = await gerarPdfUrl(v.id)
      if (url) { window.open(url, '_blank'); ok++ }
      await aguardar(300) // evita bloqueio de pop-up por abrir muitas abas de uma vez
    }
    setResumoMassa(`${ok} de ${alvos.length} comprovante(s) aberto(s) em novas abas. Se o navegador bloqueou alguma, permita pop-ups pra este site.`)
    setAplicandoMassa(false)
  }

  async function enviarWhatsappSelecionados() {
    const alvos = vendas.filter(v => selecionados.has(v.id))
    if (alvos.length === 0) return
    setAplicandoMassa(true); setResumoMassa('')
    let enviados = 0
    const semTelefone: string[] = []
    const falhas: string[] = []
    for (const v of alvos) {
      if (!v.clientes?.telefone) { semTelefone.push(String(v.numero)); continue }
      const url = await gerarPdfUrl(v.id)
      if (!url) { falhas.push(String(v.numero)); continue }
      try {
        const res = await fetch('/api/whatsapp/enviar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            telefone: v.clientes.telefone,
            mensagem: `Segue o comprovante da sua compra #${v.numero} — Total: ${fmt(v.total)}. Obrigado! 🙏`,
            tipo: 'comprovante_venda', cliente_id: v.cliente_id, cliente_nome: v.clientes?.nome ?? null,
            referencia_tipo: 'venda', referencia_id: v.id, pdf_url: url,
          }),
        })
        const data = await res.json()
        if (!res.ok || data.error) falhas.push(String(v.numero)); else enviados++
      } catch { falhas.push(String(v.numero)) }
    }
    const partes = [`${enviados} enviado(s)`]
    if (semTelefone.length) partes.push(`${semTelefone.length} pulado(s) sem telefone (#${semTelefone.join(', #')})`)
    if (falhas.length) partes.push(`${falhas.length} falhou(aram) (#${falhas.join(', #')})`)
    setResumoMassa(partes.join(' · '))
    setAplicandoMassa(false)
  }

  async function mudarPagamentoSelecionados() {
    const alvos = vendas.filter(v => selecionados.has(v.id))
    if (alvos.length === 0) return
    setAplicandoMassa(true); setResumoMassa('')
    const sb = createClient()
    let ok = 0
    for (const v of alvos) {
      const { error } = await sb.from('vendas').update({
        forma_pagamento: novaFormaMassa,
        pagamentos: [{ forma: novaFormaMassa, valor: v.total }],
      }).eq('id', v.id)
      if (!error) ok++
    }
    setVendas(prev => prev.map(v => selecionados.has(v.id)
      ? { ...v, forma_pagamento: novaFormaMassa, pagamentos: [{ forma: novaFormaMassa, valor: v.total }] }
      : v))
    setResumoMassa(`Forma de pagamento atualizada em ${ok} de ${alvos.length} venda(s).`)
    setAplicandoMassa(false)
    setTrocandoPagamento(false)
  }

  // NFC-e só faz sentido pra venda pura (tipo_operacao 'venda') — mesma
  // regra já usada pro botão individual em DetalheVendaModal.tsx.
  //
  // Sem confirmação: emitir nota é o trabalho normal de quem opera esta
  // tela, e o aviso a cada clique só atrasava. O resumo depois da emissão
  // continua dizendo quantas foram autorizadas e quantas falharam.
  async function emitirNfceSelecionados() {
    const todasSelecionadas = vendas.filter(v => selecionados.has(v.id))
    const elegiveis = todasSelecionadas.filter(v => v.tipo_operacao === 'venda')
    // Continua contando as puladas — sai no resumo DEPOIS da emissão, que é
    // relatório do que aconteceu, não aviso pedindo permissão.
    const inelegiveis = todasSelecionadas.length - elegiveis.length
    if (elegiveis.length === 0) {
      alert('Nenhuma venda selecionada é elegível pra NFC-e (só venda pura, sem troca/devolução).')
      return
    }

    setAplicandoMassa(true); setResumoMassa('')
    let autorizadas = 0, jaEmitidas = 0
    const falhas: string[] = []
    for (const v of elegiveis) {
      try {
        const res = await fetch('/api/fiscal/emitir-nfce', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vendaId: v.id }),
        })
        const data = await res.json()
        if (data.jaEmitida) jaEmitidas++
        else if (data.ok) autorizadas++
        else falhas.push(`#${v.numero}: ${data.erro ?? data.motivoRejeicao ?? 'falha desconhecida'}`)
      } catch (e: any) {
        falhas.push(`#${v.numero}: ${e.message}`)
      }
    }
    const partes = [`${autorizadas} autorizada(s)`]
    if (jaEmitidas > 0) partes.push(`${jaEmitidas} já emitida(s) antes`)
    if (inelegiveis > 0) partes.push(`${inelegiveis} pulada(s) (troca/devolução)`)
    if (falhas.length > 0) partes.push(`${falhas.length} falhou(aram): ${falhas.join('; ')}`)
    setResumoMassa(partes.join(' · '))
    setAplicandoMassa(false)
    buscarVendas() // recarrega pra refletir o status fiscal atualizado
  }

  // Emissão individual direto na linha da listagem — mesmo endpoint já
  // usado no modal de detalhe e na emissão em massa, só que sem precisar
  // abrir a venda. Também serve de "tentar de novo" quando o status é erro.
  async function emitirNfceLinha(v: Venda) {
    setEmitindoId(v.id)
    try {
      const resp = await fetch('/api/fiscal/emitir-nfce', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendaId: v.id }),
      })
      const data = await resp.json()
      const patch = {
        nfce_status: data.status ?? (data.ok ? 'autorizada' : 'erro'),
        nfce_numero: data.numero ?? v.nfce_numero,
        nfce_chave: data.chave ?? v.nfce_chave,
        nfce_motivo_rejeicao: data.motivoRejeicao ?? (data.ok ? null : (data.erro ?? 'Erro ao emitir')),
        nfce_url_pdf: data.danfeUrl ?? v.nfce_url_pdf,
      }
      setVendas(prev => prev.map(x => x.id === v.id ? { ...x, ...patch } : x))
      if (detalheAberto?.id === v.id) setDetalheAberto(prev => prev ? { ...prev, ...patch } : prev)
    } catch (e: any) {
      setVendas(prev => prev.map(x => x.id === v.id ? { ...x, nfce_status: 'erro', nfce_motivo_rejeicao: e?.message ?? 'Erro ao emitir' } : x))
    } finally {
      setEmitindoId(null)
    }
  }

  const CHIPS: { id: Periodo; label: string }[] = [
    { id: 'hoje', label: 'Hoje' }, { id: 'ontem', label: 'Ontem' },
    { id: '7dias', label: '7 dias' }, { id: 'mes', label: 'Este mês' }, { id: 'custom', label: 'Período' },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-3">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Vendas</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {formasFiltro.size > 0
              ? `${vendasFiltradas.length} de ${vendas.length} transações`
              : `${total} transações`} · {fmt(totalFaturado)} faturados
          </p>
          <p className="text-xs text-gray-400 mt-1">
            📦 Estoque debitado de: <strong className="text-gray-500">{empresaEstoqueNome}</strong>
            {' · '}🧾 Fiscal emitido por: <strong className="text-gray-500">{empresaFiscalNome}</strong>
          </p>
        </div>
        <button onClick={() => buscarVendas()} disabled={carregando}
          className="px-4 py-2 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
          🔄 Atualizar
        </button>
        <input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por cliente, produto ou número..."
          className="bg-white border border-gray-300 text-gray-800 rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:border-blue-500"
        />
      </div>

      {erroBusca && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-2.5 rounded-lg mb-4 flex items-center justify-between">
          <span>Erro ao carregar vendas: {erroBusca}</span>
          <button onClick={() => setErroBusca('')} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {CHIPS.map(c => (
          <button key={c.id} onClick={() => setPeriodo(c.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              periodo === c.id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}>
            {c.label}
          </button>
        ))}
        {periodo === 'custom' && (
          <div className="flex items-center gap-2 ml-1">
            <input type="date" value={customInicio} onChange={e => setCustomInicio(e.target.value)}
              className="bg-white border border-gray-300 text-gray-800 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500" />
            <span className="text-gray-400 text-xs">até</span>
            <input type="date" value={customFim} onChange={e => setCustomFim(e.target.value)}
              className="bg-white border border-gray-300 text-gray-800 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500" />
          </div>
        )}
        {carregando && <span className="text-xs text-gray-400">Carregando...</span>}
      </div>

      {formasPresentes.length > 1 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs text-gray-500">Pagamento:</span>
          {formasPresentes.map(([forma, qtd]) => {
            const on = formasFiltro.has(forma)
            return (
              <button key={forma}
                onClick={() => setFormasFiltro(prev => {
                  const novo = new Set(prev)
                  novo.has(forma) ? novo.delete(forma) : novo.add(forma)
                  return novo
                })}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}>
                {FORMA_LABEL[forma] ?? forma} <span className="opacity-60">{qtd}</span>
              </button>
            )
          })}
          {formasFiltro.size > 0 && (
            <button onClick={() => setFormasFiltro(new Set())}
              className="text-xs text-gray-500 hover:text-gray-700 underline">limpar</button>
          )}
        </div>
      )}

      {/* Situação fiscal — linha própria para deixar claro que soma com o
          filtro de pagamento acima, em vez de substituí-lo. */}
      {(contagemFiscal.com > 0 || contagemFiscal.sem > 0) && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs text-gray-500">Nota fiscal:</span>
          {([
            ['com', '🧾 Com NFC-e', contagemFiscal.com, 'Vendas com nota autorizada'],
            ['sem', 'Sem NFC-e', contagemFiscal.sem, 'Vendas que ainda precisam de nota (troca e devolução não entram)'],
            ['rejeitada', '⚠ Rejeitada', contagemFiscal.rejeitada, 'A SEFAZ recusou — veja o motivo no detalhe da venda'],
          ] as [SituacaoFiscal, string, number, string][]).map(([valor, rotulo, qtd, ajuda]) => {
            if (qtd === 0 && valor === 'rejeitada') return null
            const on = fiscalFiltro === valor
            return (
              <button key={valor} title={ajuda}
                onClick={() => setFiscalFiltro(on ? '' : valor)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  on
                    ? valor === 'rejeitada' ? 'bg-red-600 border-red-600 text-white' : 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}>
                {rotulo} <span className="opacity-60">{qtd}</span>
              </button>
            )
          })}
          {fiscalFiltro && (
            <button onClick={() => setFiscalFiltro('')}
              className="text-xs text-gray-500 hover:text-gray-700 underline">limpar</button>
          )}
        </div>
      )}

      {selecionados.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 mb-4 flex-wrap">
          <span className="text-sm text-blue-700 font-medium">{selecionados.size} selecionada(s)</span>
          <button onClick={imprimirSelecionados} disabled={aplicandoMassa}
            className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-xs font-medium rounded-lg">
            🖨️ Imprimir selecionadas
          </button>
          <button onClick={enviarWhatsappSelecionados} disabled={aplicandoMassa}
            className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-xs font-medium rounded-lg">
            📱 Enviar por WhatsApp
          </button>
          <button onClick={emitirNfceSelecionados} disabled={aplicandoMassa}
            className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-xs font-medium rounded-lg">
            🧾 Emitir NFC-e
          </button>
          <button onClick={imprimirNfceSelecionadas} disabled={aplicandoMassa}
            title="Imprime a DANFE das vendas com NFC-e autorizada; as demais são puladas"
            className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-xs font-medium rounded-lg">
            🖨️ Imprimir NFC-e
          </button>
          {!trocandoPagamento ? (
            <button onClick={() => setTrocandoPagamento(true)} disabled={aplicandoMassa}
              className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-xs font-medium rounded-lg">
              💳 Mudar forma de pagamento
            </button>
          ) : (
            <div className="flex items-center gap-1.5 bg-white border border-gray-300 rounded-lg px-2 py-1">
              <select value={novaFormaMassa} onChange={e => setNovaFormaMassa(e.target.value)}
                className="text-xs focus:outline-none">
                {Object.entries(FORMA_LABEL).filter(([k]) => k !== 'troca' && k !== 'multiplo').map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
              <button onClick={mudarPagamentoSelecionados} disabled={aplicandoMassa}
                className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium rounded">
                Aplicar
              </button>
              <button onClick={() => setTrocandoPagamento(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
            </div>
          )}
          <button onClick={() => setSelecionados(new Set())} className="text-xs text-blue-400 hover:text-blue-600 ml-auto">✕ limpar seleção</button>
        </div>
      )}
      {resumoMassa && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs px-4 py-2.5 rounded-lg mb-4 flex items-center justify-between">
          <span>{resumoMassa}</span>
          <button onClick={() => setResumoMassa('')} className="text-emerald-400 hover:text-emerald-600">✕</button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3">
                <input type="checkbox" checked={selecionados.size === vendas.length && vendas.length > 0}
                  onChange={e => toggleTodos(e.target.checked)} className="w-4 h-4 accent-blue-600" />
              </th>
              <th className="text-center px-2 py-3 font-medium" title="Saúde da venda">Saúde</th>
              <th className="text-left px-4 py-3 font-medium">#</th>
              <th className="text-left px-4 py-3 font-medium">Data/Hora</th>
              <th className="text-left px-4 py-3 font-medium">Cliente</th>
              <th className="text-left px-4 py-3 font-medium">Vendedor</th>
              <th className="text-left px-4 py-3 font-medium">Itens</th>
              <th className="text-left px-4 py-3 font-medium">Canal</th>
              <th className="text-left px-4 py-3 font-medium">Pagamento</th>
              <th className="text-right px-4 py-3 font-medium">Desconto</th>
              <th className="text-right px-4 py-3 font-medium">Total</th>
              <th className="text-center px-4 py-3 font-medium">Status</th>
              <th className="text-center px-4 py-3 font-medium">Nota Fiscal</th>
              <th className="text-center px-4 py-3 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {vendasFiltradas.map(v => {
              const itensV = (itensPorVenda[v.id] ?? []).filter(i => i.tipo !== 'devolucao')
              const saude = saudePorVenda[v.id]
              return (
              <tr key={v.id} className={`text-gray-600 hover:bg-gray-50 transition-colors ${selecionados.has(v.id) ? 'bg-blue-50/50' : ''}`}>
                <td className="px-4 py-2.5">
                  <input type="checkbox" checked={selecionados.has(v.id)} onChange={() => toggleUm(v.id)} className="w-4 h-4 accent-blue-600" />
                </td>
                <td className="px-2 py-2.5 text-center">
                  {saude ? (
                    <span title={`${saude.resultado.faixa?.nome ?? '—'} · margem ${saude.resultado.margem.toFixed(1)}%${saude.aproximado ? ' (estimado com custo atual)' : ''}`}
                      className="inline-flex items-center gap-0.5">
                      <span className={`inline-block w-2.5 h-2.5 rounded-full ${saude.aproximado ? 'opacity-60' : ''}`}
                        style={{ backgroundColor: saude.resultado.faixa?.cor ?? '#9ca3af' }} />
                      {saude.aproximado && <span className="text-[10px] text-gray-300">~</span>}
                    </span>
                  ) : <span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-200" />}
                </td>
                <td className="px-4 py-2.5 text-gray-400 font-mono">{v.numero}</td>
                <td className="px-4 py-2.5 text-gray-400 text-xs">
                  {new Date(v.created_at).toLocaleDateString('pt-BR')} {new Date(v.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-2.5 text-gray-900">{v.clientes?.nome ?? 'Consumidor'}</td>
                {/* Vendedor é quem VENDEU, escolhido ao fechar o pedido.
                    `operador_nome` é o login do terminal ("balcao") e serve
                    para outra pergunta — por isso vai só no title, para não
                    perder a rastreabilidade nem ocupar a coluna. */}
                <td className="px-4 py-2.5 text-gray-600 text-xs"
                  title={v.operador_nome ? `Operador do PDV: ${v.operador_nome}` : undefined}>
                  {v.vendedor_nome ?? v.operador_nome ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-gray-600 text-xs max-w-[180px] truncate" title={itensV.map(i => i.produto_nome).join(', ')}>
                  {itensV.length > 0 ? `${itensV[0].produto_nome}${itensV.length > 1 ? ` +${itensV.length - 1}` : ''}` : '—'}
                </td>
                <td className="px-4 py-2.5">
                  <span className="text-xs px-2 py-0.5 rounded-full border bg-gray-100 text-gray-600 border-gray-200">{v.canal ?? 'PDV'}</span>
                </td>
                <td className="px-4 py-2.5 text-gray-600 text-xs">{FORMA_LABEL[v.forma_pagamento] ?? v.forma_pagamento}</td>
                <td className="px-4 py-2.5 text-right text-gray-400">
                  {(v.desconto ?? 0) > 0 ? fmt(v.desconto) : '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-gray-900 font-medium">{fmt(v.total)}</td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${
                    v.status === 'concluida' ? 'bg-green-100 text-green-700 border-green-200' :
                    v.status === 'cancelada' ? 'bg-red-100 text-red-600 border-red-200' :
                    'bg-yellow-100 text-yellow-700 border-yellow-200'
                  }`}>{v.status}</span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  {v.tipo_operacao !== 'venda' ? (
                    <span className="text-xs text-gray-300">—</span>
                  ) : v.nfce_status === 'autorizada' ? (
                    // Botão, não link: a DANFE fica guardada como data: URL, e
                    // navegador não navega pra data: — <a href> não abria nada.
                    <button onClick={() => imprimirNfce(v, false)} disabled={!v.nfce_url_pdf}
                      title={v.nfce_url_pdf ? 'Ver DANFE da NFC-e' : 'NFC-e autorizada, mas sem DANFE guardada'}
                      className="text-xs px-2 py-0.5 rounded-full border bg-green-100 text-green-700 border-green-200 hover:bg-green-200 disabled:opacity-60 disabled:hover:bg-green-100">
                      ✅ {v.nfce_numero ?? 'Autorizada'}
                    </button>
                  ) : v.nfce_status === 'erro' ? (
                    <button onClick={() => emitirNfceLinha(v)} disabled={emitindoId === v.id} title={v.nfce_motivo_rejeicao ?? 'Erro ao emitir'}
                      className="text-xs px-2 py-0.5 rounded-full border bg-red-100 text-red-600 border-red-200 hover:bg-red-200 disabled:opacity-50">
                      {emitindoId === v.id ? '⏳' : '⚠️ Tentar de novo'}
                    </button>
                  ) : v.nfce_status === 'pendente' ? (
                    <span className="text-xs px-2 py-0.5 rounded-full border bg-yellow-100 text-yellow-700 border-yellow-200">⏳ Pendente</span>
                  ) : (
                    <button onClick={() => emitirNfceLinha(v)} disabled={emitindoId === v.id}
                      className="text-xs px-2 py-0.5 rounded-full border bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200 disabled:opacity-50">
                      {emitindoId === v.id ? '⏳' : 'Emitir'}
                    </button>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => abrirDetalhe(v, false)} title="Ver detalhes"
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500">👁</button>
                    <button onClick={() => abrirDetalhe(v, true)} title="Editar"
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500">✏️</button>
                    <button onClick={() => imprimirVenda(v)} disabled={gerandoPdfId === v.id} title="Imprimir comprovante"
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-40">
                      {gerandoPdfId === v.id ? '⏳' : '🖨️'}
                    </button>
                    {podeImprimirNfce(v) && (
                      <button onClick={() => imprimirNfce(v)} title={`Imprimir NFC-e nº ${v.nfce_numero ?? ''}`.trim()}
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-green-50 text-green-600">🧾</button>
                    )}
                    <button onClick={() => abrirWhatsapp(v)} disabled={gerandoPdfId === v.id} title="Enviar via WhatsApp"
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-40">
                      {gerandoPdfId === v.id ? '⏳' : '📱'}
                    </button>
                  </div>
                </td>
              </tr>
            )})}
            {vendasFiltradas.length === 0 && !carregando && (
              <tr>
                <td colSpan={14} className="px-4 py-8 text-center text-gray-400">
                  Nenhuma venda encontrada neste período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detalheAberto && (
        <DetalheVendaModal
          venda={detalheAberto}
          empresaId={empresaId}
          modoEdicaoInicial={modoEdicaoInicial}
          onClose={() => setDetalheAberto(null)}
          onImprimir={() => imprimirVenda(detalheAberto)}
          onWhatsapp={() => abrirWhatsapp(detalheAberto)}
          gerandoPdf={gerandoPdfId === detalheAberto.id}
          formatoImpressao={formatoImpressao}
          onAtualizado={(patch) => {
            setVendas(prev => prev.map(v => v.id === detalheAberto.id ? { ...v, ...patch } : v))
            setDetalheAberto(prev => prev ? { ...prev, ...patch } : prev)
          }}
          onCorrigirItens={() => setCorrigindo(detalheAberto)}
        />
      )}

      {corrigindo && (
        <EditarItensVendaModal
          venda={corrigindo}
          empresaId={empresaId}
          onFechar={() => setCorrigindo(null)}
          onSalvo={() => { setDetalheAberto(null); window.location.reload() }}
        />
      )}

      {wppAberto && wppPayload && (
        <EnviarWhatsAppModal
          aberto={wppAberto}
          titulo="Enviar comprovante via WhatsApp"
          payload={wppPayload}
          onClose={() => setWppAberto(false)}
          onEnviado={() => setWppAberto(false)}
        />
      )}
    </div>
  )
}
