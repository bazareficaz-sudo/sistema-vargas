'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { calcularRateio } from '@/lib/financeiro/pagamento'
import { botao } from '@/components/ui/botao'

// Recebimento de várias contas do mesmo cliente de uma vez.
//
// Juros e desconto são informados para o conjunto e rateados entre as contas
// proporcionalmente ao que cada uma tem em aberto — a última absorve a sobra
// do arredondamento, para a soma bater no centavo com o que foi informado.
// Mesma técnica já usada no pagamento em massa de contas a pagar.
//
// Cada conta recebe seu próprio lançamento em `recebimentos`: é assim que o
// extrato do cliente consegue mostrar a que compra cada abatimento se refere.

type Conta = {
  id: string
  cliente_id: string | null
  cliente_nome: string
  numero_doc: string | null
  data_vencimento: string
  valor_original: number
  valor_recebido: number
  valor_aberto: number
  juros: number
  multa: number
  desconto: number
  status: string
}

const FORMAS = ['dinheiro', 'pix', 'debito', 'credito', 'boleto', 'transferencia', 'outro']
const ROTULO_FORMA: Record<string, string> = {
  dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Cartão de débito', credito: 'Cartão de crédito',
  boleto: 'Boleto', transferencia: 'Transferência', outro: 'Outro',
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (v: string) => parseFloat(v.replace(',', '.')) || 0
const hojeStr = () => new Date().toISOString().slice(0, 10)

export default function ReceberEmMassaModal({ contas, empresaId, operador, onFechar, onConcluido }: {
  contas: Conta[]
  empresaId: string
  operador: string | null
  onFechar: () => void
  /** Devolve o que mudou pra listagem se atualizar sem recarregar a página. */
  onConcluido: (atualizadas: { id: string; valor_recebido: number; valor_aberto: number; juros: number; multa: number; desconto: number; status: string }[]) => void
}) {
  const [data, setData] = useState(hojeStr())
  const [forma, setForma] = useState('dinheiro')
  const [juros, setJuros] = useState('0')
  const [jurosUnidade, setJurosUnidade] = useState<'reais' | 'percentual'>('reais')
  const [desconto, setDesconto] = useState('0')
  const [descontoUnidade, setDescontoUnidade] = useState<'reais' | 'percentual'>('reais')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const rateio = useMemo(() => calcularRateio(
    contas.map(c => ({ id: c.id, valor: c.valor_aberto })),
    {
      modo: 'detalhado',
      juros: num(juros), jurosUnidade,
      multa: 0, multaUnidade: 'reais',
      desconto: num(desconto), descontoUnidade,
      totalPago: 0,
    },
  ), [contas, juros, jurosUnidade, desconto, descontoUnidade])

  const porConta = new Map(rateio.itens.map(i => [i.id, i]))
  const clienteId = contas[0]?.cliente_id ?? null

  async function confirmar() {
    if (rateio.totalPago <= 0) { setErro('O valor a receber ficou zerado.'); return }
    setSalvando(true); setErro('')
    const sb = createClient()
    const agora = new Date().toISOString()

    try {
      const atualizadas: Parameters<typeof onConcluido>[0] = []

      for (const c of contas) {
        const r = porConta.get(c.id)
        if (!r) continue

        // O principal abatido é o que a conta tinha em aberto; juros e
        // desconto entram como ajuste e não mexem no principal.
        const principal = r.valor
        const novoRecebido = c.valor_recebido + principal

        await sb.from('recebimentos').insert({
          empresa_id: empresaId,
          conta_id: c.id,
          cliente_id: c.cliente_id,
          valor: principal,
          desconto: r.desconto,
          juros: r.juros,
          multa: 0,
          valor_liquido: r.valorPago,
          forma_pagamento: forma,
          data_recebimento: data,
          observacao: observacao || 'Recebimento em massa',
          operador_nome: operador,
        })

        await sb.from('contas_receber').update({
          valor_recebido: novoRecebido,
          juros: c.juros + r.juros,
          desconto: c.desconto + r.desconto,
          status: 'recebido',
          updated_at: agora,
        }).eq('id', c.id)

        atualizadas.push({
          id: c.id,
          valor_recebido: novoRecebido,
          valor_aberto: 0,
          juros: c.juros + r.juros,
          multa: c.multa,
          desconto: c.desconto + r.desconto,
          status: 'recebido',
        })
      }

      // Saldo devedor do cliente: abate o principal recebido, uma vez só.
      //
      // O recebimento individual tinha dois defeitos aqui — só mexia no
      // saldo quando a conta era quitada por inteiro, e quando mexia
      // subtraía o valor cheio da conta em vez do que entrou. É o que fez o
      // saldo do cadastro divergir das contas em alguns clientes. Aqui abate
      // exatamente o principal.
      if (clienteId) {
        const { data: cli } = await sb.from('clientes').select('saldo_devedor').eq('id', clienteId).single()
        if (cli) {
          await sb.from('clientes').update({
            saldo_devedor: Math.max(0, Number(cli.saldo_devedor ?? 0) - rateio.totalDevido),
            data_ultimo_pagamento: agora,
          }).eq('id', clienteId)
        }
      }

      onConcluido(atualizadas)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Falha ao registrar os recebimentos')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onFechar} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 pt-5 pb-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Receber {contas.length} contas</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {contas[0]?.cliente_nome} · total em aberto {fmt(rateio.totalDevido)}
          </p>
        </div>

        <div className="px-6 py-5 overflow-y-auto space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Data do recebimento *</label>
              <input type="date" value={data} onChange={e => setData(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 h-10 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Forma de recebimento *</label>
              <select value={forma} onChange={e => setForma(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 h-10 text-sm bg-white focus:outline-none focus:border-blue-500">
                {FORMAS.map(f => <option key={f} value={f}>{ROTULO_FORMA[f] ?? f}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <CampoAjuste rotulo="Juros / acréscimo" valor={juros} setValor={setJuros}
              unidade={jurosUnidade} setUnidade={setJurosUnidade} />
            <CampoAjuste rotulo="Desconto" valor={desconto} setValor={setDesconto}
              unidade={descontoUnidade} setUnidade={setDescontoUnidade} />
          </div>
          <p className="text-[11px] text-gray-400 -mt-2">
            Informados para o total e rateados entre as contas conforme o valor de cada uma.
          </p>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Observação <span className="font-normal text-gray-400">(opcional)</span>
            </label>
            <input value={observacao} onChange={e => setObservacao(e.target.value)}
              placeholder="Ex.: acerto do mês"
              className="w-full border border-gray-300 rounded-lg px-3 h-10 text-sm focus:outline-none focus:border-blue-500" />
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Conta</th>
                  <th className="px-3 py-2 text-right font-medium">Em aberto</th>
                  <th className="px-3 py-2 text-right font-medium">Juros</th>
                  <th className="px-3 py-2 text-right font-medium">Desc.</th>
                  <th className="px-3 py-2 text-right font-medium">A receber</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {contas.map(c => {
                  const r = porConta.get(c.id)
                  return (
                    <tr key={c.id}>
                      <td className="px-3 py-2">
                        <span className="text-gray-800">{c.numero_doc ?? c.id.slice(0, 8)}</span>
                        <span className="text-xs text-gray-400"> · vence {c.data_vencimento.slice(8, 10)}/{c.data_vencimento.slice(5, 7)}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600">{fmt(c.valor_aberto)}</td>
                      <td className="px-3 py-2 text-right text-amber-700">{r?.juros ? fmt(r.juros) : '—'}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">{r?.desconto ? fmt(r.desconto) : '—'}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900">{fmt(r?.valorPago ?? 0)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-gray-50 text-sm font-medium">
                <tr>
                  <td className="px-3 py-2.5">Total</td>
                  <td className="px-3 py-2.5 text-right">{fmt(rateio.totalDevido)}</td>
                  <td className="px-3 py-2.5 text-right text-amber-700">{rateio.totalJuros ? fmt(rateio.totalJuros) : '—'}</td>
                  <td className="px-3 py-2.5 text-right text-emerald-700">{rateio.totalDesconto ? fmt(rateio.totalDesconto) : '—'}</td>
                  <td className="px-3 py-2.5 text-right text-gray-900">{fmt(rateio.totalPago)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
            Todas as contas selecionadas serão quitadas por inteiro. Para receber um valor parcial,
            use o botão <b>Receber</b> da própria linha.
          </p>

          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-3">
          <p className="text-sm text-gray-500 mr-auto">
            Total a receber <span className="font-semibold text-gray-900">{fmt(rateio.totalPago)}</span>
          </p>
          <button onClick={onFechar} className={botao('secundario', 'md')}>Cancelar</button>
          <button onClick={confirmar} disabled={salvando} className={botao('primario', 'md')}>
            {salvando ? 'Registrando…' : `Receber ${contas.length} contas`}
          </button>
        </div>
      </div>
    </div>
  )
}

function CampoAjuste({ rotulo, valor, setValor, unidade, setUnidade }: {
  rotulo: string; valor: string; setValor: (v: string) => void
  unidade: 'reais' | 'percentual'; setUnidade: (u: 'reais' | 'percentual') => void
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{rotulo}</label>
      <div className="flex">
        <input value={valor} onChange={e => setValor(e.target.value)} inputMode="decimal"
          className="flex-1 min-w-0 border border-gray-300 rounded-l-lg px-3 h-10 text-sm focus:outline-none focus:border-blue-500" />
        <select value={unidade} onChange={e => setUnidade(e.target.value as 'reais' | 'percentual')}
          className="border border-l-0 border-gray-300 rounded-r-lg px-2 h-10 text-sm bg-gray-50 focus:outline-none">
          <option value="reais">R$</option>
          <option value="percentual">%</option>
        </select>
      </div>
    </div>
  )
}
