'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  calcularRateio, ENTRADA_VAZIA,
  type EntradaPagamento, type ModoAcrescimo, type Unidade,
} from '@/lib/financeiro/pagamento'

// Pagamento de uma ou de várias contas de uma vez. É o mesmo modal nos dois
// casos de propósito: pagar 1 boleto com juros e pagar 8 boletos do mesmo
// fornecedor com juros é a mesma decisão, e duplicar a tela significaria
// duas contas do mesmo dinheiro dando resultados diferentes.

type ContaSimples = {
  id: string; descricao: string; valor: number; vencimento: string
  tipo_despesa_id?: string | null
  fornecedores?: { razao_social: string; nome_fantasia: string | null } | null
}

type TipoDespesa = { id: string; nome: string }

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

const FORMAS = ['pix', 'boleto', 'transferência', 'dinheiro', 'cartão', 'cheque']

export default function PagarContasModal({
  contas, empresaId, onFechar, onPago,
}: {
  contas: ContaSimples[]
  empresaId: string
  onFechar: () => void
  onPago: (ids: string[], dados: { data: string; forma: string }) => void
}) {
  const [data, setData] = useState(() => new Date().toISOString().split('T')[0])
  const [forma, setForma] = useState('pix')
  const [entrada, setEntrada] = useState<EntradaPagamento>(ENTRADA_VAZIA)
  const [tipos, setTipos] = useState<TipoDespesa[]>([])
  const [tipoId, setTipoId] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const calc = calcularRateio(contas, entrada)

  useEffect(() => {
    const sb = createClient()
    sb.from('tipos_despesa').select('id, nome').eq('empresa_id', empresaId).eq('ativo', true)
      .order('nome').then(({ data }) => setTipos(data ?? []))
  }, [empresaId])

  // Ao trocar para "informar o total pago", começa com o valor devido em tela
  // — assim o campo já nasce com um número certo e o usuário só ajusta.
  function trocarModo(m: ModoAcrescimo) {
    setEntrada(e => ({
      ...ENTRADA_VAZIA, modo: m,
      totalPago: m === 'total' ? calc.totalDevido : 0,
    }))
  }

  async function confirmar() {
    setSalvando(true); setErro('')
    try {
      const sb = createClient()
      // Uma conta por vez: cada uma leva a sua parte do juros/multa. Um único
      // UPDATE ... IN (ids) gravaria o mesmo valor em todas.
      for (const item of calc.itens) {
        const patch: Record<string, unknown> = {
          status: 'pago', data_pagamento: data, forma_pagamento: forma,
          valor_pago: item.valorPago, juros: item.juros, multa: item.multa, desconto: item.desconto,
        }
        if (tipoId) patch.tipo_despesa_id = tipoId
        const { error } = await sb.from('contas_pagar').update(patch).eq('id', item.id)
        if (error) throw new Error(error.message)
      }
      onPago(calc.itens.map(i => i.id), { data, forma })
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao registrar o pagamento')
      setSalvando(false)
    }
  }

  const varias = contas.length > 1
  const dif = calc.totalPago - calc.totalDevido

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onFechar} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Registrar pagamento</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {varias ? `${contas.length} contas selecionadas` : contas[0]?.descricao}
          </p>
          <p className="text-2xl font-bold text-gray-900 mt-3">{fmt(calc.totalDevido)}</p>
          <p className="text-xs text-gray-400">valor original</p>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Data do pagamento</label>
              <input type="date" value={data} onChange={e => setData(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Forma</label>
              <select value={forma} onChange={e => setForma(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500">
                {FORMAS.map(f => <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tipo de despesa</label>
            <select value={tipoId} onChange={e => setTipoId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500">
              <option value="">Manter o que já está na conta</option>
              {tipos.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </div>

          {/* Como o acréscimo vai ser informado */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-3">
              {([
                ['nenhum', 'Sem acréscimo'],
                ['detalhado', 'Juros e multa'],
                ['total', 'Informar total pago'],
              ] as [ModoAcrescimo, string][]).map(([m, rotulo]) => (
                <button key={m} onClick={() => trocarModo(m)}
                  className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    entrada.modo === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>
                  {rotulo}
                </button>
              ))}
            </div>

            {entrada.modo === 'detalhado' && (
              <div className="space-y-2">
                {([
                  ['juros', 'jurosUnidade', 'Juros'],
                  ['multa', 'multaUnidade', 'Multa'],
                  ['desconto', 'descontoUnidade', 'Desconto'],
                ] as const).map(([campo, campoUn, rotulo]) => (
                  <div key={campo} className="flex items-center gap-2">
                    <label className="text-xs text-gray-600 w-20">{rotulo}</label>
                    <input type="number" step="0.01" min="0" value={entrada[campo] || ''}
                      onChange={e => setEntrada(s => ({ ...s, [campo]: Number(e.target.value) }))}
                      placeholder="0,00"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-right focus:outline-none focus:border-blue-500" />
                    <div className="flex bg-gray-100 rounded-lg p-0.5">
                      {(['reais', 'percentual'] as Unidade[]).map(u => (
                        <button key={u} onClick={() => setEntrada(s => ({ ...s, [campoUn]: u }))}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md ${
                            entrada[campoUn] === u ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                          }`}>
                          {u === 'reais' ? 'R$' : '%'}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-gray-400">
                  O percentual é calculado sobre o valor original {varias && 'somado das contas selecionadas'}.
                </p>
              </div>
            )}

            {entrada.modo === 'total' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Valor total pago</label>
                <input type="number" step="0.01" min="0" value={entrada.totalPago || ''}
                  onChange={e => setEntrada(s => ({ ...s, totalPago: Number(e.target.value) }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-right font-medium focus:outline-none focus:border-blue-500" />
                <p className="text-[11px] text-gray-500 mt-1.5">
                  {dif > 0 && <>A diferença de <b>{fmt(dif)}</b> é lançada como juros.</>}
                  {dif < 0 && <>Pagou <b>{fmt(-dif)}</b> a menos — a diferença é lançada como desconto.</>}
                  {dif === 0 && 'Sem diferença: nada é lançado como juros nem como desconto.'}
                </p>
              </div>
            )}
          </div>

          {/* Resumo — o que vai sair do caixa */}
          {(calc.totalJuros > 0 || calc.totalMulta > 0 || calc.totalDesconto > 0) && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm space-y-1">
              <div className="flex justify-between text-gray-600"><span>Valor original</span><span>{fmt(calc.totalDevido)}</span></div>
              {calc.totalJuros > 0 && <div className="flex justify-between text-amber-700"><span>Juros</span><span>+ {fmt(calc.totalJuros)}</span></div>}
              {calc.totalMulta > 0 && <div className="flex justify-between text-amber-700"><span>Multa</span><span>+ {fmt(calc.totalMulta)}</span></div>}
              {calc.totalDesconto > 0 && <div className="flex justify-between text-green-700"><span>Desconto</span><span>− {fmt(calc.totalDesconto)}</span></div>}
              <div className="flex justify-between font-semibold text-gray-900 pt-1 border-t border-gray-200">
                <span>Total pago</span><span>{fmt(calc.totalPago)}</span>
              </div>
              {varias && (
                <p className="text-[11px] text-gray-400 pt-1">
                  Rateado entre as {contas.length} contas na proporção do valor de cada uma.
                </p>
              )}
            </div>
          )}

          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onFechar} className="flex-1 px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={salvando}
            className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
            {salvando ? 'Registrando...' : `Confirmar ${fmt(calc.totalPago)}`}
          </button>
        </div>
      </div>
    </div>
  )
}
