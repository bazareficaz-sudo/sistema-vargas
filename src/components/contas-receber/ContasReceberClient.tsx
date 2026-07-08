'use client'

import { useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import EnviarWhatsAppModal from '@/components/integracoes/EnviarWhatsAppModal'

type Conta = {
  id: string
  cliente_id: string | null
  cliente_nome: string
  origem: string
  numero_doc: string | null
  parcela_numero: number
  total_parcelas: number
  data_emissao: string
  data_vencimento: string
  valor_original: number
  valor_recebido: number
  valor_aberto: number
  juros: number
  multa: number
  desconto: number
  status: string
  forma_prevista: string | null
  observacao: string | null
  operador_nome: string | null
}

type Cliente = {
  id: string
  nome: string
  cpf_cnpj: string | null
  telefone: string | null
  saldo_credito: number
  saldo_devedor: number
  limite_credito: number
  bloqueado_fiado: boolean
}

type CreditoDisp = {
  id: string
  cliente_id: string
  valor_utilizado: number
  saldo_disponivel: number
  descricao: string | null
}

type Metricas = {
  totalAberto: number
  totalVencido: number
  totalHoje: number
  totalEm30: number
}

const STATUS_LABEL: Record<string, string> = {
  aberto: 'Aberto', parcial: 'Parcial', recebido: 'Recebido',
  vencido: 'Vencido', cancelado: 'Cancelado', renegociado: 'Renegociado'
}
const STATUS_COLOR: Record<string, string> = {
  aberto:     'bg-blue-50 text-blue-600 border border-blue-100',
  parcial:    'bg-amber-50 text-amber-600 border border-amber-100',
  recebido:   'bg-emerald-50 text-emerald-600 border border-emerald-100',
  vencido:    'bg-red-50 text-red-600 border border-red-100',
  cancelado:  'bg-slate-100 text-slate-500',
  renegociado:'bg-purple-50 text-purple-600 border border-purple-100',
}
const FORMAS_REC = ['dinheiro','pix','debito','credito','boleto','transferencia','credito_cliente','outro']
const FORMAS_LABEL: Record<string,string> = {
  dinheiro:'Dinheiro', pix:'PIX', debito:'Débito', credito:'Crédito',
  boleto:'Boleto', transferencia:'Transferência', credito_cliente:'Crédito Cliente', outro:'Outro'
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtDt(d: string) {
  const [y,m,dia] = d.split('-')
  return `${dia}/${m}/${y}`
}
function diasAtraso(venc: string) {
  const v = new Date(venc + 'T00:00:00')
  const h = new Date(); h.setHours(0,0,0,0)
  const diff = Math.floor((h.getTime() - v.getTime()) / 86400000)
  return diff
}

export default function ContasReceberClient({
  empresaId, operador, contasIniciais, clientes, creditosDisponiveis, metricas
}: {
  empresaId: string
  operador: string
  contasIniciais: Conta[]
  clientes: Cliente[]
  creditosDisponiveis: CreditoDisp[]
  metricas: Metricas
}) {
  const sb = createClient()
  const [contas, setContas] = useState<Conta[]>(contasIniciais)
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [filtroCliente, setFiltroCliente] = useState('')
  const [filtroVenc, setFiltroVenc] = useState('todos')
  const [busca, setBusca] = useState('')

  // Modal novo lançamento manual
  const [modalNova, setModalNova] = useState(false)
  const [nova, setNova] = useState({
    cliente_id: '', cliente_nome: '', valor_original: '',
    data_vencimento: '', data_emissao: new Date().toISOString().split('T')[0],
    parcela_numero: '1', total_parcelas: '1', forma_prevista: 'dinheiro',
    observacao: '', origem: 'manual', numero_doc: ''
  })
  const [salvandoNova, setSalvandoNova] = useState(false)

  // Modal WhatsApp cobrança
  const [wppConta, setWppConta] = useState<Conta | null>(null)

  // Modal recebimento
  const [contaReceber, setContaReceber] = useState<Conta | null>(null)
  const [receb, setReceb] = useState({
    valor: '', desconto: '0', juros: '0', multa: '0',
    forma: 'dinheiro', conta_destino: '', observacao: '', usar_credito: false
  })
  const [salvandoRec, setSalvandoRec] = useState(false)

  // Modal renegociação
  const [modalRenego, setModalRenego] = useState(false)
  const [contasSel, setContasSel] = useState<string[]>([])
  const [renego, setRenego] = useState({
    desconto: '0', juros: '0', multa: '0',
    parcelas: '1', primeiro_venc: '', intervalo: '30', observacao: ''
  })
  const [salvandoRenego, setSalvandoRenego] = useState(false)

  const hoje = new Date().toISOString().split('T')[0]

  // ── Filtros ──────────────────────────────────────────────────
  const contasFiltradas = useMemo(() => {
    let list = [...contas]
    if (filtroStatus !== 'todos') list = list.filter(c => c.status === filtroStatus)
    if (busca) {
      const b = busca.toLowerCase()
      list = list.filter(c =>
        c.cliente_nome.toLowerCase().includes(b) ||
        (c.numero_doc ?? '').toLowerCase().includes(b)
      )
    }
    if (filtroVenc === 'hoje')   list = list.filter(c => c.data_vencimento === hoje)
    if (filtroVenc === 'atras')  list = list.filter(c => c.data_vencimento < hoje)
    if (filtroVenc === 'prox7')  list = list.filter(c => c.data_vencimento >= hoje && c.data_vencimento <= new Date(Date.now()+7*86400000).toISOString().split('T')[0])
    if (filtroVenc === 'prox30') list = list.filter(c => c.data_vencimento >= hoje && c.data_vencimento <= new Date(Date.now()+30*86400000).toISOString().split('T')[0])
    if (filtroCliente) list = list.filter(c => c.cliente_id === filtroCliente)
    return list
  }, [contas, filtroStatus, busca, filtroVenc, filtroCliente, hoje])

  const clienteCredito = contaReceber
    ? creditosDisponiveis.filter(c => c.cliente_id === contaReceber.cliente_id)
    : []
  const saldoCreditoDisp = clienteCredito.reduce((s,c) => s + c.saldo_disponivel, 0)

  // ── Salvar nova conta manual ─────────────────────────────────
  async function salvarNova() {
    if (!nova.cliente_nome || !nova.valor_original || !nova.data_vencimento) {
      alert('Preencha cliente, valor e vencimento'); return
    }
    setSalvandoNova(true)
    try {
      const { data, error } = await sb.from('contas_receber').insert({
        empresa_id: empresaId,
        cliente_id: nova.cliente_id || null,
        cliente_nome: nova.cliente_nome,
        origem: nova.origem,
        numero_doc: nova.numero_doc || null,
        parcela_numero: parseInt(nova.parcela_numero),
        total_parcelas: parseInt(nova.total_parcelas),
        data_emissao: nova.data_emissao,
        data_vencimento: nova.data_vencimento,
        valor_original: parseFloat(nova.valor_original.replace(',','.')),
        valor_recebido: 0,
        forma_prevista: nova.forma_prevista,
        observacao: nova.observacao || null,
        operador_nome: operador,
        status: 'aberto',
      }).select().single()
      if (error) throw error
      setContas(p => [data as Conta, ...p])
      setModalNova(false)
      setNova({ cliente_id:'', cliente_nome:'', valor_original:'', data_vencimento:'',
        data_emissao: new Date().toISOString().split('T')[0], parcela_numero:'1',
        total_parcelas:'1', forma_prevista:'dinheiro', observacao:'', origem:'manual', numero_doc:'' })
    } catch(e:any) { alert('Erro: ' + e.message) }
    finally { setSalvandoNova(false) }
  }

  // ── Criar em lote (parcelamento) ─────────────────────────────
  async function salvarParcelado() {
    const n = parseInt(nova.total_parcelas)
    if (n < 2) { salvarNova(); return }
    if (!nova.cliente_nome || !nova.valor_original || !nova.data_vencimento) {
      alert('Preencha todos os campos'); return
    }
    setSalvandoNova(true)
    try {
      const valorTotal = parseFloat(nova.valor_original.replace(',','.'))
      const valorParc  = Math.round((valorTotal / n) * 100) / 100
      const rows = Array.from({ length: n }, (_, i) => {
        const venc = new Date(nova.data_vencimento + 'T00:00:00')
        venc.setMonth(venc.getMonth() + i)
        return {
          empresa_id: empresaId,
          cliente_id: nova.cliente_id || null,
          cliente_nome: nova.cliente_nome,
          origem: nova.origem,
          numero_doc: nova.numero_doc ? `${nova.numero_doc}-${i+1}` : null,
          parcela_numero: i + 1,
          total_parcelas: n,
          data_emissao: nova.data_emissao,
          data_vencimento: venc.toISOString().split('T')[0],
          valor_original: i === n-1 ? Math.round((valorTotal - valorParc*(n-1))*100)/100 : valorParc,
          valor_recebido: 0,
          forma_prevista: nova.forma_prevista,
          observacao: nova.observacao || null,
          operador_nome: operador,
          status: 'aberto',
        }
      })
      const { data, error } = await sb.from('contas_receber').insert(rows).select()
      if (error) throw error
      setContas(p => [...(data as Conta[]), ...p])
      setModalNova(false)
    } catch(e:any) { alert('Erro: ' + e.message) }
    finally { setSalvandoNova(false) }
  }

  // ── Receber conta ─────────────────────────────────────────────
  function abrirRecebimento(c: Conta) {
    setContaReceber(c)
    setReceb({
      valor: c.valor_aberto.toFixed(2).replace('.',','),
      desconto: '0', juros: '0', multa: '0',
      forma: c.forma_prevista ?? 'dinheiro',
      conta_destino: '', observacao: '', usar_credito: false
    })
  }

  async function executarRecebimento() {
    if (!contaReceber) return
    const valor    = parseFloat(receb.valor.replace(',','.')) || 0
    const desconto = parseFloat(receb.desconto.replace(',','.')) || 0
    const juros    = parseFloat(receb.juros.replace(',','.')) || 0
    const multa    = parseFloat(receb.multa.replace(',','.')) || 0

    if (valor <= 0) { alert('Informe o valor recebido'); return }
    setSalvandoRec(true)
    try {
      const novoRecebido = contaReceber.valor_recebido + valor
      const novoAberto   = contaReceber.valor_original - novoRecebido
      const novoStatus   = novoAberto <= 0.01 ? 'recebido' : 'parcial'

      // Registrar recebimento
      await sb.from('recebimentos').insert({
        empresa_id: empresaId,
        conta_id: contaReceber.id,
        cliente_id: contaReceber.cliente_id,
        valor, desconto, juros, multa,
        valor_liquido: valor - desconto + juros + multa,
        forma_pagamento: receb.usar_credito ? 'credito_cliente' : receb.forma,
        conta_destino: receb.conta_destino || null,
        observacao: receb.observacao || null,
        operador_nome: operador,
      })

      // Se usou crédito: debitar do saldo de créditos
      if (receb.usar_credito && clienteCredito.length > 0) {
        let restante = valor
        for (const cr of clienteCredito) {
          if (restante <= 0) break
          const usar = Math.min(restante, cr.saldo_disponivel)
          await sb.from('creditos_cliente')
            .update({ valor_utilizado: cr.valor_utilizado + usar, status: cr.saldo_disponivel - usar <= 0.01 ? 'utilizado' : 'parcial', updated_at: new Date().toISOString() })
            .eq('id', cr.id)
          await sb.from('credito_utilizacoes').insert({
            empresa_id: empresaId, credito_id: cr.id,
            cliente_id: contaReceber.cliente_id!, conta_id: contaReceber.id,
            valor: usar, descricao: 'Usado no recebimento', operador,
          })
          restante -= usar
        }
        // Atualizar saldo_credito no cliente
        if (contaReceber.cliente_id) {
          const { data: cli } = await sb.from('clientes').select('saldo_credito').eq('id', contaReceber.cliente_id).single()
          if (cli) await sb.from('clientes').update({ saldo_credito: Math.max(0, cli.saldo_credito - valor) }).eq('id', contaReceber.cliente_id)
        }
      }

      // Atualizar conta
      await sb.from('contas_receber').update({
        valor_recebido: novoRecebido,
        juros: contaReceber.juros + juros,
        multa: contaReceber.multa + multa,
        desconto: contaReceber.desconto + desconto,
        status: novoStatus,
        updated_at: new Date().toISOString(),
      }).eq('id', contaReceber.id)

      // Atualizar saldo_devedor do cliente
      if (contaReceber.cliente_id && novoStatus === 'recebido') {
        const { data: cli } = await sb.from('clientes').select('saldo_devedor').eq('id', contaReceber.cliente_id).single()
        if (cli) {
          await sb.from('clientes').update({
            saldo_devedor: Math.max(0, cli.saldo_devedor - contaReceber.valor_original),
            data_ultimo_pagamento: new Date().toISOString(),
          }).eq('id', contaReceber.cliente_id)
        }
      }

      setContas(p => p.map(c => c.id === contaReceber.id
        ? { ...c, valor_recebido: novoRecebido, valor_aberto: Math.max(0, novoAberto), juros: c.juros+juros, multa: c.multa+multa, desconto: c.desconto+desconto, status: novoStatus }
        : c))
      setContaReceber(null)
    } catch(e:any) { alert('Erro: ' + e.message) }
    finally { setSalvandoRec(false) }
  }

  // ── Renegociação ─────────────────────────────────────────────
  const contasSelecionadas = contas.filter(c => contasSel.includes(c.id))
  const totalReneg = contasSelecionadas.reduce((s,c) => s + c.valor_aberto, 0)
  const descontoR = parseFloat(renego.desconto.replace(',','.')) || 0
  const jurosR    = parseFloat(renego.juros.replace(',','.')) || 0
  const multaR    = parseFloat(renego.multa.replace(',','.')) || 0
  const valorReneg = Math.max(0, totalReneg - descontoR + jurosR + multaR)

  async function executarRenegociacao() {
    if (contasSelecionadas.length === 0 || !renego.primeiro_venc) {
      alert('Selecione contas e defina o primeiro vencimento'); return
    }
    setSalvandoRenego(true)
    try {
      const clienteNome = contasSelecionadas[0].cliente_nome
      const clienteId   = contasSelecionadas[0].cliente_id

      // Criar renegociação
      const { data: rn, error: errRn } = await sb.from('renegociacoes').insert({
        empresa_id: empresaId,
        cliente_id: clienteId,
        cliente_nome: clienteNome,
        valor_original: totalReneg,
        valor_negociado: valorReneg,
        desconto: descontoR, juros: jurosR, multa: multaR,
        parcelas: parseInt(renego.parcelas),
        primeiro_venc: renego.primeiro_venc,
        intervalo_dias: parseInt(renego.intervalo),
        observacao: renego.observacao || null,
        operador_nome: operador,
      }).select().single()
      if (errRn) throw errRn

      // Marcar contas antigas como renegociadas
      await sb.from('contas_receber')
        .update({ status: 'renegociado', renegociacao_id: rn.id, updated_at: new Date().toISOString() })
        .in('id', contasSel)

      // Criar novas parcelas
      const n = parseInt(renego.parcelas)
      const parcelas = Array.from({ length: n }, (_, i) => {
        const venc = new Date(renego.primeiro_venc + 'T00:00:00')
        venc.setDate(venc.getDate() + i * parseInt(renego.intervalo))
        const vp = Math.round((valorReneg / n) * 100) / 100
        return {
          empresa_id: empresaId,
          cliente_id: clienteId,
          cliente_nome: clienteNome,
          origem: 'renegociacao' as const,
          origem_id: rn.id,
          numero_doc: `REN-${rn.id.slice(-6).toUpperCase()}`,
          parcela_numero: i + 1,
          total_parcelas: n,
          data_emissao: new Date().toISOString().split('T')[0],
          data_vencimento: venc.toISOString().split('T')[0],
          valor_original: i === n-1 ? Math.round((valorReneg - vp*(n-1))*100)/100 : vp,
          valor_recebido: 0,
          status: 'aberto',
          operador_nome: operador,
          renegociacao_id: rn.id,
        }
      })
      const { data: novas, error: errN } = await sb.from('contas_receber').insert(parcelas).select()
      if (errN) throw errN

      setContas(p => [
        ...(novas as Conta[]),
        ...p.map(c => contasSel.includes(c.id) ? { ...c, status: 'renegociado' } : c),
      ])
      setContasSel([])
      setModalRenego(false)
      setRenego({ desconto:'0', juros:'0', multa:'0', parcelas:'1', primeiro_venc:'', intervalo:'30', observacao:'' })
    } catch(e:any) { alert('Erro: ' + e.message) }
    finally { setSalvandoRenego(false) }
  }

  async function cancelarConta(id: string) {
    if (!confirm('Cancelar esta conta a receber?')) return
    await sb.from('contas_receber').update({ status: 'cancelado', updated_at: new Date().toISOString() }).eq('id', id)
    setContas(p => p.map(c => c.id === id ? { ...c, status: 'cancelado' } : c))
  }

  const podeReneg = contasSel.length > 0

  return (
    <div className="space-y-4">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-slate-900 text-xl font-bold">Contas a Receber</h1>
          <p className="text-slate-500 text-sm">{contasFiltradas.length} conta(s) listadas</p>
        </div>
        <div className="flex gap-2">
          {podeReneg && (
            <button onClick={() => setModalRenego(true)}
              className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-xl transition-colors">
              ↺ Renegociar ({contasSel.length})
            </button>
          )}
          <button onClick={() => setModalNova(true)}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-xl transition-colors">
            + Nova Conta
          </button>
        </div>
      </div>

      {/* ── Métricas ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total em Aberto', valor: metricas.totalAberto, cor: 'text-blue-600' },
          { label: 'Vencido',         valor: metricas.totalVencido, cor: 'text-red-600' },
          { label: 'Vence Hoje',      valor: metricas.totalHoje,   cor: 'text-amber-600' },
          { label: 'Próximos 30d',    valor: metricas.totalEm30,   cor: 'text-emerald-600' },
        ].map(m => (
          <div key={m.label} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <p className="text-slate-500 text-xs">{m.label}</p>
            <p className={`text-lg font-bold mt-1 ${m.cor}`}>{fmt(m.valor)}</p>
          </div>
        ))}
      </div>

      {/* ── Filtros ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar cliente ou documento..."
          className="bg-white border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm w-56 focus:outline-none focus:border-blue-400 placeholder-slate-400 shadow-sm" />

        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
          className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-sm shadow-sm">
          <option value="todos">Todos os status</option>
          <option value="aberto">Aberto</option>
          <option value="parcial">Parcial</option>
          <option value="vencido">Vencido</option>
          <option value="recebido">Recebido</option>
          <option value="renegociado">Renegociado</option>
        </select>

        <select value={filtroVenc} onChange={e => setFiltroVenc(e.target.value)}
          className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-sm shadow-sm">
          <option value="todos">Qualquer vencimento</option>
          <option value="atras">Vencidos</option>
          <option value="hoje">Vencem hoje</option>
          <option value="prox7">Próximos 7 dias</option>
          <option value="prox30">Próximos 30 dias</option>
        </select>

        <select value={filtroCliente} onChange={e => setFiltroCliente(e.target.value)}
          className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-sm shadow-sm">
          <option value="">Todos os clientes</option>
          {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>

        {contasSel.length > 0 && (
          <button onClick={() => setContasSel([])}
            className="px-3 py-2 bg-slate-100 text-slate-700 text-sm rounded-xl hover:bg-slate-200">
            ✕ Limpar seleção
          </button>
        )}
      </div>

      {/* ── Tabela ───────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 bg-slate-50 border-b border-slate-100 text-xs uppercase tracking-wide">
              <th className="px-3 py-3 text-left w-8">
                <input type="checkbox"
                  checked={contasSel.length === contasFiltradas.filter(c=>['aberto','parcial','vencido'].includes(c.status)).length && contasSel.length > 0}
                  onChange={e => setContasSel(e.target.checked ? contasFiltradas.filter(c=>['aberto','parcial','vencido'].includes(c.status)).map(c=>c.id) : [])}
                  className="rounded" />
              </th>
              <th className="px-3 py-3 text-left">Cliente</th>
              <th className="px-3 py-3 text-left">Doc / Origem</th>
              <th className="px-3 py-3 text-center">Vencimento</th>
              <th className="px-3 py-3 text-right">Valor</th>
              <th className="px-3 py-3 text-right">Recebido</th>
              <th className="px-3 py-3 text-right">Em Aberto</th>
              <th className="px-3 py-3 text-center">Status</th>
              <th className="px-3 py-3 text-center">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {contasFiltradas.length === 0 && (
              <tr><td colSpan={9} className="text-center py-12 text-slate-400">Nenhuma conta encontrada</td></tr>
            )}
            {contasFiltradas.map(c => {
              const atraso = diasAtraso(c.data_vencimento)
              const podeReceber = ['aberto','parcial','vencido'].includes(c.status)
              const selecionavel = ['aberto','parcial','vencido'].includes(c.status)
              return (
                <tr key={c.id} className={`text-slate-700 hover:bg-slate-50 transition-colors ${contasSel.includes(c.id) ? 'bg-blue-50' : ''}`}>
                  <td className="px-3 py-2.5">
                    {selecionavel && (
                      <input type="checkbox" checked={contasSel.includes(c.id)}
                        onChange={e => setContasSel(p => e.target.checked ? [...p, c.id] : p.filter(x=>x!==c.id))}
                        className="rounded" />
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="text-slate-800 font-medium text-sm">{c.cliente_nome}</p>
                    {c.total_parcelas > 1 && (
                      <p className="text-slate-400 text-xs">{c.parcela_numero}/{c.total_parcelas}</p>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="text-slate-500 text-xs">{c.numero_doc ?? '—'}</p>
                    <p className="text-slate-400 text-xs capitalize">{c.origem}</p>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <p className={`text-sm ${atraso > 0 && podeReceber ? 'text-red-500 font-medium' : 'text-slate-500'}`}>
                      {fmtDt(c.data_vencimento)}
                    </p>
                    {atraso > 0 && podeReceber && (
                      <p className="text-red-500 text-xs">{atraso}d atraso</p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-700">{fmt(c.valor_original)}</td>
                  <td className="px-3 py-2.5 text-right text-emerald-600">
                    {c.valor_recebido > 0 ? fmt(c.valor_recebido) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-800">
                    {c.valor_aberto > 0 ? fmt(c.valor_aberto) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[c.status] ?? 'bg-slate-100 text-slate-500'}`}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {podeReceber && (
                        <button onClick={() => abrirRecebimento(c)}
                          className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-lg transition-colors">
                          Receber
                        </button>
                      )}
                      <button onClick={() => setWppConta(c)}
                        title="Enviar cobrança por WhatsApp"
                        className="px-2 py-1 bg-green-50 hover:bg-green-100 text-green-600 text-xs rounded-lg transition-colors">
                        💬
                      </button>
                      {podeReceber && (
                        <button onClick={() => cancelarConta(c.id)}
                          className="px-2 py-1 bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-500 text-xs rounded-lg transition-colors">
                          ✕
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── MODAL NOVA CONTA ─────────────────────────────────────── */}
      {modalNova && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-slate-900 font-semibold">Nova Conta a Receber</h2>
              <button onClick={() => setModalNova(false)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {/* Cliente */}
              <div>
                <label className="text-slate-500 text-xs">Cliente *</label>
                <select value={nova.cliente_id}
                  onChange={e => {
                    const cli = clientes.find(c => c.id === e.target.value)
                    setNova(p => ({ ...p, cliente_id: e.target.value, cliente_nome: cli?.nome ?? '' }))
                  }}
                  className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm">
                  <option value="">Selecione um cliente</option>
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
                {!nova.cliente_id && (
                  <input value={nova.cliente_nome} onChange={e => setNova(p=>({...p, cliente_nome:e.target.value}))}
                    placeholder="Ou digite o nome manualmente"
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm placeholder-slate-400" />
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-500 text-xs">Origem</label>
                  <select value={nova.origem} onChange={e => setNova(p=>({...p, origem:e.target.value}))}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm">
                    <option value="manual">Lançamento Manual</option>
                    <option value="venda">Venda</option>
                    <option value="fiado">Fiado</option>
                    <option value="credito_devolucao">Crédito/Devolução</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-500 text-xs">Nº Documento</label>
                  <input value={nova.numero_doc} onChange={e => setNova(p=>({...p, numero_doc:e.target.value}))}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-500 text-xs">Valor Total *</label>
                  <input value={nova.valor_original} onChange={e => setNova(p=>({...p, valor_original:e.target.value}))}
                    placeholder="0,00"
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-slate-500 text-xs">Forma Prevista</label>
                  <select value={nova.forma_prevista} onChange={e => setNova(p=>({...p, forma_prevista:e.target.value}))}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm">
                    {FORMAS_REC.map(f => <option key={f} value={f}>{FORMAS_LABEL[f]}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-500 text-xs">Emissão</label>
                  <input type="date" value={nova.data_emissao} onChange={e => setNova(p=>({...p, data_emissao:e.target.value}))}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-slate-500 text-xs">1º Vencimento *</label>
                  <input type="date" value={nova.data_vencimento} onChange={e => setNova(p=>({...p, data_vencimento:e.target.value}))}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-slate-500 text-xs">Parcelas</label>
                  <input type="number" min="1" max="60" value={nova.total_parcelas}
                    onChange={e => setNova(p=>({...p, total_parcelas:e.target.value}))}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-slate-500 text-xs">Observação</label>
                <input value={nova.observacao} onChange={e => setNova(p=>({...p, observacao:e.target.value}))}
                  className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button onClick={() => setModalNova(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm hover:bg-slate-200">Cancelar</button>
              <button onClick={parseInt(nova.total_parcelas) > 1 ? salvarParcelado : salvarNova}
                disabled={salvandoNova}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm disabled:opacity-50">
                {salvandoNova ? 'Salvando...' : parseInt(nova.total_parcelas) > 1 ? `Gerar ${nova.total_parcelas} parcelas` : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL RECEBIMENTO ────────────────────────────────────── */}
      {contaReceber && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-slate-900 font-semibold">Registrar Recebimento</h2>
                <p className="text-slate-500 text-xs mt-0.5">{contaReceber.cliente_nome}</p>
              </div>
              <button onClick={() => setContaReceber(null)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {/* Info da conta */}
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 grid grid-cols-3 gap-2 text-xs">
                <div><p className="text-slate-500">Vencimento</p><p className="text-slate-800">{fmtDt(contaReceber.data_vencimento)}</p></div>
                <div><p className="text-slate-500">Valor Original</p><p className="text-slate-800">{fmt(contaReceber.valor_original)}</p></div>
                <div><p className="text-slate-500">Em Aberto</p><p className="text-amber-600 font-semibold">{fmt(contaReceber.valor_aberto)}</p></div>
              </div>

              {/* Crédito disponível */}
              {saldoCreditoDisp > 0 && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex items-center justify-between">
                  <div>
                    <p className="text-emerald-600 text-xs font-medium">Crédito disponível</p>
                    <p className="text-emerald-700 text-sm font-bold">{fmt(saldoCreditoDisp)}</p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={receb.usar_credito}
                      onChange={e => setReceb(p => ({ ...p, usar_credito: e.target.checked, forma: e.target.checked ? 'credito_cliente' : 'dinheiro' }))}
                      className="rounded" />
                    <span className="text-emerald-600 text-xs">Usar crédito</span>
                  </label>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-500 text-xs">Valor Recebido *</label>
                  <input value={receb.valor} onChange={e => setReceb(p=>({...p, valor:e.target.value}))}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-slate-500 text-xs">Desconto</label>
                  <input value={receb.desconto} onChange={e => setReceb(p=>({...p, desconto:e.target.value}))}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-slate-500 text-xs">Juros</label>
                  <input value={receb.juros} onChange={e => setReceb(p=>({...p, juros:e.target.value}))}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-slate-500 text-xs">Multa</label>
                  <input value={receb.multa} onChange={e => setReceb(p=>({...p, multa:e.target.value}))}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                </div>
              </div>

              {!receb.usar_credito && (
                <div>
                  <label className="text-slate-500 text-xs">Forma de Recebimento</label>
                  <select value={receb.forma} onChange={e => setReceb(p=>({...p, forma:e.target.value}))}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm">
                    {FORMAS_REC.filter(f => f !== 'credito_cliente').map(f => <option key={f} value={f}>{FORMAS_LABEL[f]}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="text-slate-500 text-xs">Observação</label>
                <input value={receb.observacao} onChange={e => setReceb(p=>({...p, observacao:e.target.value}))}
                  className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button onClick={() => setContaReceber(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm hover:bg-slate-200">Cancelar</button>
              <button onClick={executarRecebimento} disabled={salvandoRec}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm disabled:opacity-50">
                {salvandoRec ? 'Registrando...' : 'Confirmar Recebimento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL RENEGOCIAÇÃO ───────────────────────────────────── */}
      {modalRenego && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-slate-900 font-semibold">Renegociação de Dívida</h2>
              <button onClick={() => setModalRenego(false)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs space-y-1">
                <p className="text-slate-500">{contasSelecionadas.length} conta(s) selecionada(s)</p>
                <p className="text-slate-800 font-bold text-base">Total: {fmt(totalReneg)}</p>
                <p className="text-slate-400">{contasSelecionadas[0]?.cliente_nome}</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-500 text-xs">Desconto (R$)</label>
                  <input value={renego.desconto} onChange={e => setRenego(p=>({...p, desconto:e.target.value}))}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-slate-500 text-xs">Juros (R$)</label>
                  <input value={renego.juros} onChange={e => setRenego(p=>({...p, juros:e.target.value}))}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-slate-500 text-xs">Multa (R$)</label>
                  <input value={renego.multa} onChange={e => setRenego(p=>({...p, multa:e.target.value}))}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="bg-blue-900/30 border border-blue-800 rounded-lg p-3">
                <p className="text-slate-500 text-xs">Valor Negociado</p>
                <p className="text-blue-300 text-lg font-bold">{fmt(valorReneg)}</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-500 text-xs">Nº Parcelas</label>
                  <input type="number" min="1" value={renego.parcelas} onChange={e => setRenego(p=>({...p, parcelas:e.target.value}))}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-slate-500 text-xs">1º Vencimento *</label>
                  <input type="date" value={renego.primeiro_venc} onChange={e => setRenego(p=>({...p, primeiro_venc:e.target.value}))}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-slate-500 text-xs">Intervalo (dias)</label>
                  <input type="number" value={renego.intervalo} onChange={e => setRenego(p=>({...p, intervalo:e.target.value}))}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-slate-500 text-xs">Observação</label>
                <input value={renego.observacao} onChange={e => setRenego(p=>({...p, observacao:e.target.value}))}
                  className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button onClick={() => setModalRenego(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm hover:bg-slate-200">Cancelar</button>
              <button onClick={executarRenegociacao} disabled={salvandoRenego}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm disabled:opacity-50">
                {salvandoRenego ? 'Renegociando...' : 'Confirmar Renegociação'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL WHATSAPP COBRANÇA ──────────────────────────────── */}
      {wppConta && (() => {
        const cli = clientes.find(c => c.id === wppConta.cliente_id)
        const tel = cli?.telefone ?? ''
        return (
          <EnviarWhatsAppModal
            aberto={!!wppConta}
            titulo="Enviar Cobrança por WhatsApp"
            payload={{
              telefone: tel,
              mensagem: `Olá ${wppConta.cliente_nome}! 👋\nVocê tem um valor em aberto.\n\n💰 *Valor:* ${fmt(wppConta.valor_aberto)}\n📅 *Vencimento:* ${new Date(wppConta.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR')}\n📄 *Doc:* ${wppConta.numero_doc ?? wppConta.id.slice(0, 8)}\n\nPara regularizar, entre em contato conosco.`,
              tipo: 'cobranca',
              cliente_id: wppConta.cliente_id,
              cliente_nome: wppConta.cliente_nome,
              referencia_tipo: 'conta_receber',
              referencia_id: wppConta.id,
            }}
            onClose={() => setWppConta(null)}
            onEnviado={() => setTimeout(() => setWppConta(null), 2000)}
          />
        )
      })()}
    </div>
  )
}
