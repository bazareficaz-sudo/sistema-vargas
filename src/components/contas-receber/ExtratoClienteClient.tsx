'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import VendaDaContaModal from './VendaDaContaModal'
import { botao, SEPARADOR } from '@/components/ui/botao'

// Extrato da conta do cliente, no formato de extrato bancário: cada compra
// aumenta o saldo devedor, cada pagamento diminui, e a coluna da direita
// mostra quanto ele devia depois de cada movimento.
//
// O saldo corre sempre desde a primeira movimentação, mesmo quando a tela
// está filtrada por período — por isso existe a linha "Saldo anterior". Um
// extrato que começa do zero no meio da história mente sobre o saldo.

type Cliente = {
  id: string; nome: string; cpf_cnpj: string | null
  telefone: string | null; whatsapp: string | null; telefone_whatsapp: string | null
  saldo_devedor: number | null; saldo_credito: number | null
  limite_credito: number | null; bloqueado_fiado: boolean | null
}
type Conta = {
  id: string; numero_doc: string | null; origem: string; origem_id: string | null
  data_emissao: string; data_vencimento: string
  valor_original: number; valor_recebido: number; valor_aberto: number
  status: string; parcela_numero: number; total_parcelas: number; observacao: string | null
  updated_at: string | null
}
type Recebimento = {
  id: string; conta_id: string | null; valor: number; valor_liquido: number
  desconto: number | null; juros: number | null; multa: number | null
  forma_pagamento: string | null; observacao: string | null; operador_nome: string | null
  created_at: string
  // Data em que o dinheiro entrou. Nula no histórico anterior à coluna —
  // aí vale a data do lançamento.
  data_recebimento: string | null
}

type Linha = {
  id: string
  data: string          // AAAA-MM-DD, pra ordenar e filtrar sem fuso no meio
  quando: string        // texto já formatado
  tipo: 'compra' | 'pagamento'
  historico: string
  detalhe: string | null
  debito: number
  credito: number
  saldo: number
  vendaId: string | null
  contaDoc: string | null
  vencimento: string | null
  status: string | null
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const soData = (v: string) => String(v).slice(0, 10)
const dataBr = (v: string) => {
  const [a, m, d] = soData(v).split('-')
  return `${d}/${m}/${a}`
}

const ROTULO_STATUS: Record<string, { texto: string; cor: string }> = {
  aberto: { texto: 'Em aberto', cor: 'text-gray-500' },
  parcial: { texto: 'Parcial', cor: 'text-amber-700' },
  vencido: { texto: 'Vencido', cor: 'text-red-600' },
  recebido: { texto: 'Pago', cor: 'text-emerald-700' },
  cancelado: { texto: 'Cancelado', cor: 'text-gray-400' },
}

function primeiroDiaDoMes(meses: number) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - meses)
  return d.toISOString().slice(0, 10)
}

export default function ExtratoClienteClient({ cliente, contas, recebimentos }: {
  cliente: Cliente; contas: Conta[]; recebimentos: Recebimento[]
}) {
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [vendoVenda, setVendoVenda] = useState<{ vendaId: string; doc: string | null } | null>(null)

  const telefone = cliente.telefone_whatsapp || cliente.whatsapp || cliente.telefone || null

  // Todas as linhas, em ordem, com o saldo acumulado. Conta cancelada fica
  // de fora do saldo: ela não é dívida, e somá-la inflaria o extrato.
  const todas = useMemo<Linha[]>(() => {
    const eventos: Omit<Linha, 'saldo'>[] = []

    for (const c of contas) {
      if (c.status === 'cancelado') continue
      const parcela = c.total_parcelas > 1 ? ` (parcela ${c.parcela_numero}/${c.total_parcelas})` : ''
      eventos.push({
        id: `c-${c.id}`,
        data: soData(c.data_emissao),
        quando: dataBr(c.data_emissao),
        tipo: 'compra',
        historico: `Compra${parcela}`,
        detalhe: c.numero_doc,
        debito: Number(c.valor_original ?? 0),
        credito: 0,
        vendaId: c.origem_id,
        contaDoc: c.numero_doc,
        vencimento: dataBr(c.data_vencimento),
        status: c.status,
      })
    }

    const docPorConta = new Map(contas.map(c => [c.id, c.numero_doc]))

    // Quanto cada conta já tem de recebimento detalhado. Serve pra achar
    // pagamento que existe mas nunca virou lançamento (ver abaixo).
    const detalhadoPorConta = new Map<string, number>()
    for (const r of recebimentos) {
      if (!r.conta_id) continue
      detalhadoPorConta.set(r.conta_id, (detalhadoPorConta.get(r.conta_id) ?? 0) + Number(r.valor_liquido ?? r.valor ?? 0))
    }

    // Nem todo pagamento foi gravado em `recebimentos`: parte do histórico
    // só atualizou `contas_receber.valor_recebido`. Montar o extrato apenas
    // pelos lançamentos mostraria o cliente devendo mais do que deve. A
    // diferença entra como uma linha própria, com a data da última alteração
    // da conta e dizendo que veio sem detalhe — inventar forma de pagamento
    // ou data exata seria pior que admitir o que não se sabe.
    for (const c of contas) {
      if (c.status === 'cancelado') continue
      const recebido = Number(c.valor_recebido ?? 0)
      if (recebido <= 0) continue
      const semRegistro = recebido - (detalhadoPorConta.get(c.id) ?? 0)
      if (semRegistro <= 0.005) continue
      eventos.push({
        id: `s-${c.id}`,
        data: soData(c.updated_at ?? c.data_emissao),
        quando: dataBr(c.updated_at ?? c.data_emissao),
        tipo: 'pagamento',
        historico: 'Pagamento (sem registro detalhado)',
        detalhe: c.numero_doc,
        debito: 0,
        credito: semRegistro,
        vendaId: null,
        contaDoc: c.numero_doc,
        vencimento: null,
        status: null,
      })
    }

    for (const r of recebimentos) {
      const extras: string[] = []
      if (Number(r.juros ?? 0) > 0) extras.push(`juros ${fmt(Number(r.juros))}`)
      if (Number(r.multa ?? 0) > 0) extras.push(`multa ${fmt(Number(r.multa))}`)
      if (Number(r.desconto ?? 0) > 0) extras.push(`desconto ${fmt(Number(r.desconto))}`)
      eventos.push({
        id: `r-${r.id}`,
        data: soData(r.data_recebimento ?? r.created_at),
        quando: dataBr(r.data_recebimento ?? r.created_at),
        tipo: 'pagamento',
        historico: `Pagamento${r.forma_pagamento ? ` — ${r.forma_pagamento}` : ''}`,
        detalhe: [r.conta_id ? docPorConta.get(r.conta_id) : null, extras.join(' · ') || null]
          .filter(Boolean).join(' · ') || null,
        debito: 0,
        // O que abate a dívida é o valor líquido: juros e multa entram no que
        // o cliente pagou, mas não reduzem o principal em dobro.
        credito: Number(r.valor_liquido ?? r.valor ?? 0),
        vendaId: null,
        contaDoc: r.conta_id ? docPorConta.get(r.conta_id) ?? null : null,
        vencimento: null,
        status: null,
      })
    }

    // Mesma data: a compra vem antes do pagamento — pagar antes de comprar
    // deixaria o saldo negativo por uma linha, sem ser verdade.
    eventos.sort((a, b) => a.data === b.data
      ? (a.tipo === b.tipo ? 0 : a.tipo === 'compra' ? -1 : 1)
      : a.data < b.data ? -1 : 1)

    let saldo = 0
    return eventos.map(e => {
      saldo += e.debito - e.credito
      return { ...e, saldo }
    })
  }, [contas, recebimentos])

  const noPeriodo = useMemo(() => {
    if (!de && !ate) return todas
    return todas.filter(l => (!de || l.data >= de) && (!ate || l.data <= ate))
  }, [todas, de, ate])

  // O saldo antes da primeira linha do recorte — sem ele o extrato filtrado
  // pareceria começar do zero.
  const saldoAnterior = useMemo(() => {
    if (!de) return 0
    const antes = todas.filter(l => l.data < de)
    return antes.length > 0 ? antes[antes.length - 1].saldo : 0
  }, [todas, de])

  const totalComprado = noPeriodo.reduce((s, l) => s + l.debito, 0)
  const totalPago = noPeriodo.reduce((s, l) => s + l.credito, 0)
  const saldoFinal = todas.length > 0 ? (noPeriodo.length > 0 ? noPeriodo[noPeriodo.length - 1].saldo : saldoAnterior) : 0

  const emAberto = contas.filter(c => c.status !== 'cancelado' && c.status !== 'recebido')
  const vencidas = emAberto.filter(c => soData(c.data_vencimento) < new Date().toISOString().slice(0, 10))

  function exportarCsv() {
    const linhas = [
      ['Data', 'Histórico', 'Documento', 'Débito', 'Crédito', 'Saldo'],
      ...(de ? [['', 'Saldo anterior', '', '', '', saldoAnterior.toFixed(2)]] : []),
      ...noPeriodo.map(l => [
        l.quando, l.historico, l.detalhe ?? '',
        l.debito ? l.debito.toFixed(2) : '',
        l.credito ? l.credito.toFixed(2) : '',
        l.saldo.toFixed(2),
      ]),
    ]
    const csv = linhas.map(c => c.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `extrato-${cliente.nome.replace(/\s+/g, '-').toLowerCase()}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <Link href="/dashboard/contas-receber" className="text-xs text-gray-400 hover:text-gray-600">← Contas a Receber</Link>
          <h1 className="text-xl font-semibold text-gray-900 mt-1">Extrato de {cliente.nome}</h1>
          <p className="text-sm text-gray-500">
            {cliente.cpf_cnpj ?? 'sem CPF/CNPJ'}
            {telefone ? ` · ${telefone}` : ''}
            {cliente.bloqueado_fiado ? ' · 🔒 fiado bloqueado' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Link href={`/dashboard/clientes/${cliente.id}`} className={botao('sutil', 'sm')}>Ficha do cliente</Link>
          <span className={SEPARADOR} />
          <button onClick={exportarCsv} className={botao('secundario', 'sm')}>Exportar CSV</button>
          <button onClick={() => window.print()} className={botao('secundario', 'sm')}>Imprimir</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Cartao titulo="Saldo devedor" valor={fmt(saldoFinal)} destaque={saldoFinal > 0 ? 'text-red-600' : 'text-emerald-700'}
          rodape={`${emAberto.length} conta(s) em aberto`} />
        <Cartao titulo="Comprado no período" valor={fmt(totalComprado)} rodape={`${noPeriodo.filter(l => l.tipo === 'compra').length} compra(s)`} />
        <Cartao titulo="Pago no período" valor={fmt(totalPago)} destaque="text-emerald-700"
          rodape={`${noPeriodo.filter(l => l.tipo === 'pagamento').length} pagamento(s)`} />
        <Cartao titulo="Vencidas" valor={fmt(vencidas.reduce((s, c) => s + Number(c.valor_aberto ?? 0), 0))}
          destaque={vencidas.length > 0 ? 'text-red-600' : undefined}
          rodape={vencidas.length > 0 ? `${vencidas.length} conta(s) atrasada(s)` : 'nenhuma em atraso'} />
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4 print:hidden">
        <div>
          <label className="block text-xs text-gray-500 mb-1">De</label>
          <input type="date" value={de} onChange={e => setDe(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 h-9 text-sm focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Até</label>
          <input type="date" value={ate} onChange={e => setAte(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 h-9 text-sm focus:outline-none focus:border-blue-500" />
        </div>
        <button onClick={() => { setDe(primeiroDiaDoMes(0)); setAte('') }} className={botao('sutil', 'sm')}>Este mês</button>
        <button onClick={() => { setDe(primeiroDiaDoMes(2)); setAte('') }} className={botao('sutil', 'sm')}>3 meses</button>
        <button onClick={() => { setDe(''); setAte('') }} className={botao('sutil', 'sm')}>Tudo</button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">Data</th>
                <th className="px-3 py-3 text-left font-medium">Histórico</th>
                <th className="px-3 py-3 text-right font-medium whitespace-nowrap">Compra (+)</th>
                <th className="px-3 py-3 text-right font-medium whitespace-nowrap">Pagamento (−)</th>
                <th className="px-3 py-3 text-right font-medium whitespace-nowrap">Saldo</th>
                <th className="px-3 py-3 text-center font-medium print:hidden">Compra</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {de && (
                <tr className="bg-gray-50/60">
                  <td className="px-3 py-2 text-gray-400 text-xs">—</td>
                  <td className="px-3 py-2 text-gray-500 italic">Saldo anterior</td>
                  <td /><td />
                  <td className="px-3 py-2 text-right text-gray-600">{fmt(saldoAnterior)}</td>
                  <td className="print:hidden" />
                </tr>
              )}

              {noPeriodo.map(l => (
                <tr key={l.id} className={l.tipo === 'pagamento' ? 'bg-emerald-50/30' : undefined}>
                  <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{l.quando}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-gray-800">{l.historico}</span>
                    {l.detalhe && <span className="text-xs text-gray-400"> · {l.detalhe}</span>}
                    {l.tipo === 'compra' && l.status && ROTULO_STATUS[l.status] && (
                      <span className={`text-xs ml-2 ${ROTULO_STATUS[l.status].cor}`}>
                        {ROTULO_STATUS[l.status].texto}
                        {l.vencimento ? ` · vence ${l.vencimento}` : ''}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-800 whitespace-nowrap">{l.debito ? fmt(l.debito) : ''}</td>
                  <td className="px-3 py-2.5 text-right text-emerald-700 whitespace-nowrap">{l.credito ? `− ${fmt(l.credito)}` : ''}</td>
                  <td className="px-3 py-2.5 text-right font-medium text-gray-900 whitespace-nowrap">{fmt(l.saldo)}</td>
                  <td className="px-3 py-2.5 text-center print:hidden">
                    {l.vendaId && (
                      <button onClick={() => setVendoVenda({ vendaId: l.vendaId!, doc: l.contaDoc })}
                        title="Ver o que foi comprado" className={botao('sutil', 'sm')}>Ver</button>
                    )}
                  </td>
                </tr>
              ))}

              {noPeriodo.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-gray-400">
                  {todas.length === 0 ? 'Este cliente ainda não tem movimentação na conta.' : 'Nenhuma movimentação no período escolhido.'}
                </td></tr>
              )}
            </tbody>
            {noPeriodo.length > 0 && (
              <tfoot className="bg-gray-50 text-sm font-medium">
                <tr>
                  <td className="px-3 py-3" colSpan={2}>Total do período</td>
                  <td className="px-3 py-3 text-right text-gray-900">{fmt(totalComprado)}</td>
                  <td className="px-3 py-3 text-right text-emerald-700">− {fmt(totalPago)}</td>
                  <td className="px-3 py-3 text-right text-gray-900">{fmt(saldoFinal)}</td>
                  <td className="print:hidden" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-3">
        O saldo corre desde a primeira movimentação do cliente. Contas canceladas não entram na conta.
        Linhas marcadas como <em>sem registro detalhado</em> são pagamentos que constam na conta mas não
        têm lançamento próprio — entram no saldo com a data da última alteração da conta.
      </p>

      {vendoVenda && (
        <VendaDaContaModal
          vendaId={vendoVenda.vendaId}
          clienteNome={cliente.nome}
          clienteTelefone={telefone}
          contaDoc={vendoVenda.doc}
          onClose={() => setVendoVenda(null)}
        />
      )}
    </div>
  )
}

function Cartao({ titulo, valor, rodape, destaque }: {
  titulo: string; valor: string; rodape?: string; destaque?: string
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
      <p className="text-xs text-gray-500">{titulo}</p>
      <p className={`text-xl font-semibold mt-0.5 ${destaque ?? 'text-gray-900'}`}>{valor}</p>
      {rodape && <p className="text-xs text-gray-400 mt-0.5">{rodape}</p>}
    </div>
  )
}
