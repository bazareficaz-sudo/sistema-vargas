'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { FORMA_AVISTA_LABEL, linhasCondicoes, type CondicoesOrcamento } from '@/lib/orcamentos/condicoes'

// Condições de pagamento do orçamento — o que faz o cliente fechar.
//
// A tela mostra a prévia exata do que o cliente vai ler, com os valores já
// calculados. Desconto em percentual é abstrato para quem recebe; "sai por
// R$ 1.235,00, você economiza R$ 65,00" não é.

const FORMAS = ['pix', 'dinheiro', 'debito', 'transferencia']

const brl = (v: number) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function num(t: string): number {
  const s = (t ?? '').trim().replace(/\s/g, '')
  if (s === '') return 0
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
  return Number.isFinite(n) ? n : 0
}

export default function CondicoesOrcamentoModal({ orcamentoId, total, inicial, onFechar, onSalvo }: {
  orcamentoId: string
  total: number
  inicial: CondicoesOrcamento
  onFechar: () => void
  onSalvo: (c: CondicoesOrcamento) => void
}) {
  const [descontoPct, setDescontoPct] = useState(String(inicial.descontoAvistaPct || ''))
  const [formas, setFormas] = useState<Set<string>>(new Set(inicial.avistaFormas.length ? inicial.avistaFormas : ['pix', 'dinheiro']))
  const [parcelas, setParcelas] = useState(String(inicial.parcelasMax ?? ''))
  const [semJuros, setSemJuros] = useState(inicial.parcelasSemJuros)
  const [observacao, setObservacao] = useState(inicial.observacao ?? '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const atual: CondicoesOrcamento = {
    descontoAvistaPct: num(descontoPct),
    avistaFormas: [...formas],
    parcelasMax: parcelas ? Math.max(1, Math.floor(num(parcelas))) : null,
    parcelasSemJuros: semJuros,
    observacao: observacao.trim() || null,
  }
  const previa = linhasCondicoes(total, atual)

  async function salvar() {
    if (atual.descontoAvistaPct < 0 || atual.descontoAvistaPct >= 100) {
      setErro('O desconto à vista precisa ficar entre 0 e 99%.'); return
    }
    if (atual.descontoAvistaPct > 0 && formas.size === 0) {
      setErro('Escolha ao menos uma forma de pagamento para o desconto à vista.'); return
    }
    setSalvando(true); setErro('')
    const sb = createClient()
    const { error } = await sb.from('orcamentos').update({
      desconto_avista_pct: atual.descontoAvistaPct,
      avista_formas: atual.avistaFormas,
      parcelas_max: atual.parcelasMax,
      parcelas_sem_juros: atual.parcelasSemJuros,
      condicoes_observacao: atual.observacao,
      updated_at: new Date().toISOString(),
    }).eq('id', orcamentoId)
    setSalvando(false)
    if (error) { setErro(error.message); return }
    onSalvo(atual)
    onFechar()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[88vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Condições de pagamento</h2>
          <p className="text-xs text-gray-500">Aparecem no orçamento impresso e na mensagem enviada ao cliente.</p>
        </div>

        <div className="p-5 space-y-5">
          {/* À vista */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Desconto para pagamento à vista</label>
            <div className="flex items-center gap-2">
              <input value={descontoPct} onChange={e => setDescontoPct(e.target.value)}
                placeholder="0" inputMode="decimal"
                className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm text-right" />
              <span className="text-sm text-gray-500">% sobre {brl(total)}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {FORMAS.map(f => {
                const on = formas.has(f)
                return (
                  <button key={f} type="button"
                    onClick={() => setFormas(p => { const n = new Set(p); n.has(f) ? n.delete(f) : n.add(f); return n })}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                      on ? 'border-green-400 bg-green-50 text-green-800' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}>
                    {FORMA_AVISTA_LABEL[f]}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              Pix e dinheiro não têm taxa de cartão — é neles que o desconto sai do seu bolso por menos.
            </p>
          </div>

          {/* Parcelamento */}
          <div className="border-t border-gray-100 pt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Parcelamento</label>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-500">Em até</span>
              <input value={parcelas} onChange={e => setParcelas(e.target.value)}
                placeholder="—" inputMode="numeric"
                className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm text-right" />
              <span className="text-sm text-gray-500">vezes</span>
              <label className="flex items-center gap-1.5 text-sm text-gray-600 ml-2">
                <input type="checkbox" checked={semJuros} onChange={e => setSemJuros(e.target.checked)} />
                sem juros
              </label>
            </div>
            {atual.parcelasMax && atual.parcelasMax > 1 && (
              <p className="text-xs text-gray-500 mt-1">
                {atual.parcelasMax}x de {brl(total / atual.parcelasMax)}
              </p>
            )}
          </div>

          {/* Observação */}
          <div className="border-t border-gray-100 pt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Outra vantagem (opcional)</label>
            <input value={observacao} onChange={e => setObservacao(e.target.value)}
              placeholder="Ex.: frete grátis para a região central"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>

          {/* Prévia */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <p className="text-xs font-medium text-green-900 mb-1.5">O cliente vai ler assim:</p>
            {previa.length === 0 ? (
              <p className="text-xs text-green-700">
                Nenhuma condição definida ainda — o orçamento vai só com o valor total.
              </p>
            ) : (
              <ul className="space-y-1">
                {previa.map((l, i) => <li key={i} className="text-sm text-green-900">✅ {l}</li>)}
              </ul>
            )}
          </div>

          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onFechar} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={salvar} disabled={salvando}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
            {salvando ? 'Salvando...' : 'Salvar condições'}
          </button>
        </div>
      </div>
    </div>
  )
}
