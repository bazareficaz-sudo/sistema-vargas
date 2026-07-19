'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import DetalheVendaModal from './DetalheVendaModal'
import EnviarWhatsAppModal, { type EnviarWppPayload } from '@/components/integracoes/EnviarWhatsAppModal'

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
  clientes: Cliente
}

type Periodo = 'hoje' | 'ontem' | '7dias' | 'mes' | 'custom'

const FORMA_LABEL: Record<string, string> = {
  dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', pix: 'Pix',
  carteira: 'Carteira', fiado: 'Fiado', troca: 'Troca', multiplo: 'Múltiplo',
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

const SELECT_VENDAS = 'id, numero, total, subtotal, desconto, status, forma_pagamento, pagamentos, tipo_operacao, created_at, cliente_id, clientes(nome, telefone, cpf_cnpj)'

export default function VendasClient({ empresaId, vendasIniciais, totalInicial }: {
  empresaId: string; vendasIniciais: Venda[]; totalInicial: number
}) {
  const [vendas, setVendas] = useState<Venda[]>(vendasIniciais)
  const [total, setTotal] = useState(totalInicial)
  const [carregando, setCarregando] = useState(false)
  const [periodo, setPeriodo] = useState<Periodo>('hoje')
  const [customInicio, setCustomInicio] = useState('')
  const [customFim, setCustomFim] = useState('')
  const [busca, setBusca] = useState('')
  const [buscaDebounced, setBuscaDebounced] = useState('')

  const [detalheAberto, setDetalheAberto] = useState<Venda | null>(null)
  const [modoEdicaoInicial, setModoEdicaoInicial] = useState(false)
  const [gerandoPdfId, setGerandoPdfId] = useState<string | null>(null)
  const [wppAberto, setWppAberto] = useState(false)
  const [wppPayload, setWppPayload] = useState<EnviarWppPayload | null>(null)

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
    setCarregando(true)
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

    const { data, count } = await query
    setVendas((data ?? []) as unknown as Venda[])
    setTotal(count ?? 0)
    setCarregando(false)
  }

  const totalFaturado = vendas.filter(v => v.status === 'concluida').reduce((s, v) => s + (v.total ?? 0), 0)

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

  const CHIPS: { id: Periodo; label: string }[] = [
    { id: 'hoje', label: 'Hoje' }, { id: 'ontem', label: 'Ontem' },
    { id: '7dias', label: '7 dias' }, { id: 'mes', label: 'Este mês' }, { id: 'custom', label: 'Período' },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Vendas</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {total} transações · {fmt(totalFaturado)} faturados
          </p>
        </div>
        <input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por cliente, produto ou número..."
          className="bg-white border border-gray-300 text-gray-800 rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:border-blue-500"
        />
      </div>

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

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 font-medium">#</th>
              <th className="text-left px-4 py-3 font-medium">Data/Hora</th>
              <th className="text-left px-4 py-3 font-medium">Cliente</th>
              <th className="text-left px-4 py-3 font-medium">Pagamento</th>
              <th className="text-right px-4 py-3 font-medium">Desconto</th>
              <th className="text-right px-4 py-3 font-medium">Total</th>
              <th className="text-center px-4 py-3 font-medium">Status</th>
              <th className="text-center px-4 py-3 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {vendas.map(v => (
              <tr key={v.id} className="text-gray-600 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2.5 text-gray-400 font-mono">{v.numero}</td>
                <td className="px-4 py-2.5 text-gray-400 text-xs">
                  {new Date(v.created_at).toLocaleDateString('pt-BR')} {new Date(v.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-2.5 text-gray-900">{v.clientes?.nome ?? 'Consumidor'}</td>
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
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => abrirDetalhe(v, false)} title="Ver detalhes"
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500">👁</button>
                    <button onClick={() => abrirDetalhe(v, true)} title="Editar"
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500">✏️</button>
                    <button onClick={() => imprimirVenda(v)} disabled={gerandoPdfId === v.id} title="Imprimir"
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-40">
                      {gerandoPdfId === v.id ? '⏳' : '🖨️'}
                    </button>
                    <button onClick={() => abrirWhatsapp(v)} disabled={gerandoPdfId === v.id} title="Enviar via WhatsApp"
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-40">
                      {gerandoPdfId === v.id ? '⏳' : '📱'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {vendas.length === 0 && !carregando && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
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
          onAtualizado={(patch) => {
            setVendas(prev => prev.map(v => v.id === detalheAberto.id ? { ...v, ...patch } : v))
            setDetalheAberto(prev => prev ? { ...prev, ...patch } : prev)
          }}
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
