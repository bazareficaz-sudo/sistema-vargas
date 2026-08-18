'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import EnviarWhatsAppModal, { type EnviarWppPayload } from '@/components/integracoes/EnviarWhatsAppModal'

type Cliente = {
  id: string; nome: string; cpf_cnpj: string | null; telefone: string | null
  limite_credito: number; bloqueado_fiado: boolean; status_credito: string; permite_fiado: boolean
  cobranca_whatsapp_ativa: boolean
}
type Conta = {
  id: string; cliente_id: string | null; valor_aberto: number; status: string
  data_vencimento: string; numero_doc: string | null
}
type Credito = { cliente_id: string | null; saldo_disponivel: number }
type Recebimento = { cliente_id: string | null; created_at: string }

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtDt(d: string) { const [y, m, dia] = d.split('T')[0].split('-'); return `${dia}/${m}/${y}` }
function diasAtraso(d: string) {
  const v = new Date(d.split('T')[0] + 'T00:00:00')
  const h = new Date(); h.setHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((h.getTime() - v.getTime()) / 86400000))
}

type Carteira = {
  cliente: Cliente
  aReceber: number
  vencido: number
  maiorAtraso: number
  pendentes: number
  creditoLoja: number
  ultimoPgto: string | null
  contas: Conta[]
}

type Ordenacao = 'valor' | 'atraso' | 'nome' | 'limite'

export default function CarteiraClientesClient({
  clientes, contas, creditos, recebimentos,
}: {
  clientes: Cliente[]; contas: Conta[]; creditos: Credito[]; recebimentos: Recebimento[]
}) {
  const [busca, setBusca] = useState('')
  const [ordenacao, setOrdenacao] = useState<Ordenacao>('valor')
  const [wppAlvo, setWppAlvo] = useState<{ payload: EnviarWppPayload } | null>(null)

  const carteira: Carteira[] = useMemo(() => {
    const hoje = new Date().toISOString().split('T')[0]

    const creditoPorCliente: Record<string, number> = {}
    creditos.forEach(c => {
      if (!c.cliente_id) return
      creditoPorCliente[c.cliente_id] = (creditoPorCliente[c.cliente_id] ?? 0) + (c.saldo_disponivel ?? 0)
    })

    const ultimoPgtoPorCliente: Record<string, string> = {}
    recebimentos.forEach(r => {
      if (!r.cliente_id) return
      if (!ultimoPgtoPorCliente[r.cliente_id]) ultimoPgtoPorCliente[r.cliente_id] = r.created_at
    })

    const contasPorCliente: Record<string, Conta[]> = {}
    contas.forEach(c => {
      if (!c.cliente_id) return
      ;(contasPorCliente[c.cliente_id] ??= []).push(c)
    })

    return clientes
      .filter(cli => cli.permite_fiado || (contasPorCliente[cli.id]?.length ?? 0) > 0 || (creditoPorCliente[cli.id] ?? 0) > 0)
      .map(cli => {
        const contasCli = contasPorCliente[cli.id] ?? []
        const aReceber = contasCli.reduce((s, c) => s + (c.valor_aberto ?? 0), 0)
        const vencido = contasCli.filter(c => c.data_vencimento < hoje).reduce((s, c) => s + (c.valor_aberto ?? 0), 0)
        const maiorAtraso = contasCli.reduce((m, c) => Math.max(m, diasAtraso(c.data_vencimento)), 0)
        return {
          cliente: cli,
          aReceber,
          vencido,
          maiorAtraso,
          pendentes: contasCli.length,
          creditoLoja: creditoPorCliente[cli.id] ?? 0,
          ultimoPgto: ultimoPgtoPorCliente[cli.id] ?? null,
          contas: contasCli,
        }
      })
  }, [clientes, contas, creditos, recebimentos])

  const carteiraFiltrada = useMemo(() => {
    let list = [...carteira]
    if (busca) {
      const b = busca.toLowerCase()
      list = list.filter(w =>
        w.cliente.nome.toLowerCase().includes(b) ||
        (w.cliente.cpf_cnpj ?? '').includes(b) ||
        (w.cliente.telefone ?? '').includes(b))
    }
    switch (ordenacao) {
      case 'valor': list.sort((a, b) => b.aReceber - a.aReceber); break
      case 'atraso': list.sort((a, b) => b.maiorAtraso - a.maiorAtraso); break
      case 'nome': list.sort((a, b) => a.cliente.nome.localeCompare(b.cliente.nome)); break
      case 'limite':
        list.sort((a, b) => {
          const pa = a.cliente.limite_credito > 0 ? a.aReceber / a.cliente.limite_credito : 0
          const pb = b.cliente.limite_credito > 0 ? b.aReceber / b.cliente.limite_credito : 0
          return pb - pa
        })
        break
    }
    return list
  }, [carteira, busca, ordenacao])

  const totalClientes = carteiraFiltrada.length
  const totalAReceber = carteiraFiltrada.reduce((s, w) => s + w.aReceber, 0)
  const totalVencido = carteiraFiltrada.reduce((s, w) => s + w.vencido, 0)

  function abrirExtrato(w: Carteira) {
    if (!w.cliente.telefone) { alert('Cliente sem telefone cadastrado.'); return }
    const linhas = w.contas
      .sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento))
      .map(c => {
        const atraso = diasAtraso(c.data_vencimento)
        const sit = atraso > 0 ? ` (${atraso}d em atraso)` : ''
        return `• ${c.numero_doc ?? 'Conta'} — venc. ${fmtDt(c.data_vencimento)} — ${fmt(c.valor_aberto)}${sit}`
      })
      .join('\n')
    const mensagem =
      `Olá ${w.cliente.nome}, segue seu extrato de pendências:\n\n${linhas}\n\n` +
      `Total em aberto: ${fmt(w.aReceber)}` +
      (w.vencido > 0 ? `\nTotal vencido: ${fmt(w.vencido)}` : '') +
      (w.creditoLoja > 0 ? `\nVocê possui ${fmt(w.creditoLoja)} de crédito disponível na loja.` : '')

    setWppAlvo({
      payload: {
        telefone: w.cliente.telefone,
        mensagem,
        tipo: 'extrato',
        cliente_id: w.cliente.id,
        cliente_nome: w.cliente.nome,
      },
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-slate-900 text-xl font-bold">Carteira de Clientes</h1>
        <p className="text-slate-500 text-sm mt-0.5">Acompanhe clientes que compram fiado — crédito, pendências e histórico</p>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <p className="text-slate-400 text-xs font-medium">Clientes na carteira</p>
          <p className="text-slate-900 text-2xl font-bold mt-1">{totalClientes}</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <p className="text-slate-400 text-xs font-medium">Total a receber</p>
          <p className="text-blue-600 text-2xl font-bold mt-1">{fmt(totalAReceber)}</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <p className="text-slate-400 text-xs font-medium">Total vencido</p>
          <p className="text-red-600 text-2xl font-bold mt-1">{fmt(totalVencido)}</p>
        </div>
      </div>

      {/* Busca + ordenação */}
      <div className="flex flex-wrap gap-2">
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar cliente, CPF/CNPJ ou telefone..."
          className="bg-white border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm w-64 focus:outline-none focus:border-blue-400 placeholder-slate-400 shadow-sm" />
        <select value={ordenacao} onChange={e => setOrdenacao(e.target.value as Ordenacao)}
          className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-sm shadow-sm">
          <option value="valor">Maior valor a receber</option>
          <option value="atraso">Maior atraso</option>
          <option value="limite">Maior % de limite usado</option>
          <option value="nome">Nome A-Z</option>
        </select>
      </div>

      {/* Lista de cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {carteiraFiltrada.length === 0 && (
          <div className="col-span-full bg-white border border-slate-100 rounded-2xl p-10 text-center shadow-sm">
            <p className="text-4xl mb-3">🗂️</p>
            <p className="text-slate-500">Nenhum cliente na carteira</p>
          </div>
        )}
        {carteiraFiltrada.map(w => {
          const pctLimite = w.cliente.limite_credito > 0 ? Math.min(100, (w.aReceber / w.cliente.limite_credito) * 100) : 0
          const corBarra = pctLimite >= 100 ? 'bg-red-500' : pctLimite >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
          const bloqueado = w.cliente.bloqueado_fiado
          const atencao = !bloqueado && w.cliente.status_credito === 'atencao'
          return (
            <div key={w.cliente.id} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-slate-800 font-semibold truncate">{w.cliente.nome}</p>
                  <p className="text-slate-400 text-xs mt-0.5">{w.cliente.cpf_cnpj ?? 'Sem documento'}</p>
                </div>
                <span className={
                  'shrink-0 text-xs px-2 py-0.5 rounded-full border font-medium ' +
                  (bloqueado ? 'bg-red-50 text-red-600 border-red-100'
                    : atencao ? 'bg-amber-50 text-amber-600 border-amber-100'
                    : 'bg-emerald-50 text-emerald-600 border-emerald-100')
                }>
                  {bloqueado ? 'Bloqueado' : atencao ? 'Atenção' : 'Liberado'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-slate-400 text-xs">A Receber</p>
                  <p className="text-slate-800 font-semibold">{fmt(w.aReceber)}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Crédito Loja</p>
                  <p className="text-emerald-600 font-semibold">{fmt(w.creditoLoja)}</p>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-400">Limite</span>
                  <span className="text-slate-500">
                    {w.cliente.limite_credito > 0 ? `${pctLimite.toFixed(0)}% de ${fmt(w.cliente.limite_credito)}` : 'Sem limite definido'}
                  </span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full ${corBarra}`} style={{ width: `${pctLimite}%` }} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs text-center border-t border-slate-50 pt-3">
                <div>
                  <p className="text-slate-400">Último Pgto</p>
                  <p className="text-slate-600 font-medium mt-0.5">{w.ultimoPgto ? fmtDt(w.ultimoPgto) : '—'}</p>
                </div>
                <div>
                  <p className="text-slate-400">Atraso Máx</p>
                  <p className={`font-medium mt-0.5 ${w.maiorAtraso > 0 ? 'text-red-500' : 'text-slate-600'}`}>
                    {w.maiorAtraso > 0 ? `${w.maiorAtraso}d` : 'Em dia'}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400">Pendentes</p>
                  <p className="text-slate-600 font-medium mt-0.5">{w.pendentes}</p>
                </div>
              </div>

              <div className="flex gap-2 mt-1">
                <button onClick={() => abrirExtrato(w)} disabled={!w.cliente.cobranca_whatsapp_ativa}
                  title={w.cliente.cobranca_whatsapp_ativa ? undefined : 'Este cliente desativou a cobrança automática via WhatsApp'}
                  className="flex-1 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white text-xs rounded-lg font-medium">
                  {w.cliente.cobranca_whatsapp_ativa ? 'Extrato WPP' : '🔕 Extrato WPP'}
                </button>
                <Link href={`/dashboard/clientes/${w.cliente.id}`}
                  className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg font-medium text-center">
                  Contas
                </Link>
              </div>
            </div>
          )
        })}
      </div>

      {wppAlvo && (
        <EnviarWhatsAppModal
          aberto
          titulo="Enviar Extrato via WhatsApp"
          payload={wppAlvo.payload}
          onClose={() => setWppAlvo(null)}
        />
      )}
    </div>
  )
}
