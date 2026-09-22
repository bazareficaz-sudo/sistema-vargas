'use client'

import { useState, useEffect } from 'react'

// Abertura e fechamento da gaveta.
//
// Os UUIDs nascem AO ABRIR o diálogo, não ao confirmar — mesma regra da
// Fase 2. É isso que faz duplo clique, timeout e refresh convergirem para a
// mesma operação em vez de abrirem duas sessões ou entregarem o dinheiro
// duas vezes.

export type FundoOrigem = 'herdado' | 'tesouraria' | 'manual'

export type CaixaPdvSessao = {
  terminal_id: string
  terminal_nome: string
  caixa_id: string | null
  caixa_nome: string | null
  sessao_id: string | null
  sessao_aberta_em: string | null
  sessao_fundo_inicial: number | null
  saldo_gaveta: number | null
}

function reais(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function paraNumero(texto: string) {
  return Number(texto.replace(/\./g, '').replace(',', '.'))
}

// ── Abertura ──────────────────────────────────────────────────────────────

export function AbrirCaixaModal({ caixa, aoFechar, aoAbrir }: {
  caixa: CaixaPdvSessao
  aoFechar: () => void
  aoAbrir: () => void
}) {
  const [origem, setOrigem] = useState<FundoOrigem>('herdado')
  const [valor, setValor] = useState('')
  const [observacao, setObservacao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  // Quanto já existe na gaveta: é o fundo herdado, e não é digitável.
  //
  // `undefined` = ainda carregando; `null` = a leitura falhou. Os dois são
  // diferentes de ZERO, e confundi-los foi o defeito: gaveta com R$ 50 no
  // ledger aparecia como R$ 0,00 e a abertura por herança era recusada pelo
  // servidor.
  const [saldoGaveta, setSaldoGaveta] = useState<number | null | undefined>(undefined)

  const [idSessao] = useState(() => crypto.randomUUID())
  const [idTransferencia] = useState(() => crypto.randomUUID())

  useEffect(() => {
    let vivo = true
    // Gaveta que nunca operou não tem caixa, e aí zero é a resposta certa.
    if (!caixa.caixa_id) { setSaldoGaveta(0); return }
    // Releitura no instante de abrir o diálogo: o saldo é do servidor, e
    // entre o card carregar e o operador clicar pode ter havido movimento.
    fetch(`/api/caixa/pdvs`).then(r => r.json()).catch(() => null).then(d => {
      if (!vivo) return
      const c = d?.caixas?.find((x: CaixaPdvSessao) => x.terminal_id === caixa.terminal_id)
      // `?? null`, nunca `?? 0`: saldo que não chegou não é gaveta vazia.
      setSaldoGaveta(c?.saldo_gaveta ?? null)
    })
    return () => { vivo = false }
  }, [caixa.caixa_id, caixa.terminal_id])

  const herdadoConhecido = typeof saldoGaveta === 'number'
  const herdado = herdadoConhecido ? saldoGaveta : 0
  const valorNumero = origem === 'herdado' ? herdado : paraNumero(valor)
  // Sem saber o saldo, não dá para abrir por herança: o servidor exige que
  // o valor informado seja exatamente o do ledger, e chutar zero produziria
  // `fundo_herdado_divergente`.
  const valido = origem === 'herdado'
    ? herdadoConhecido
    : Number.isFinite(valorNumero) && valorNumero > 0 && (origem !== 'manual' || observacao.trim() !== '')

  const nomeCaixa = caixa.caixa_nome ?? `Caixa ${caixa.terminal_nome}`
  const resumo = !valido ? '' : origem === 'tesouraria'
    ? `${reais(valorNumero)} sairá da Tesouraria e entrará fisicamente no ${nomeCaixa}.`
    : origem === 'herdado'
      ? `${reais(herdado)} já está na gaveta do ${nomeCaixa}, vindo do fechamento anterior. Nenhum dinheiro será movimentado.`
      : `${reais(valorNumero)} será registrado como dinheiro que já estava fisicamente no ${nomeCaixa}.`

  async function confirmar() {
    if (!valido || enviando) return
    setEnviando(true); setErro('')
    try {
      const d = await fetch('/api/caixa/sessoes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: idSessao,                 // o MESMO em qualquer retry
          terminal_id: caixa.terminal_id,
          fundo_origem: origem,
          fundo_inicial: valorNumero,
          observacao: observacao.trim() || null,
          transferencia_id: origem === 'tesouraria' ? idTransferencia : null,
        }),
      }).then(r => r.json())
      if (!d?.ok) { setErro(d?.erro ?? 'Não foi possível abrir o caixa.'); return }
      aoAbrir()
    } catch {
      setErro('Não houve resposta do servidor. Tente confirmar de novo — o caixa não será aberto duas vezes.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={aoFechar}>
      <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900">Abrir {nomeCaixa}</h2>
        <p className="text-xs text-gray-500 mt-1">
          O turno começa agora. O fundo é o dinheiro que está na gaveta neste momento.
        </p>

        <div className="space-y-3 mt-4">
          <div>
            <label className="text-xs text-gray-500">De onde vem o fundo</label>
            <select value={origem} onChange={e => { setOrigem(e.target.value as FundoOrigem); setErro('') }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1">
              <option value="herdado">Já estava na gaveta (do fechamento anterior)</option>
              <option value="tesouraria">Veio da Tesouraria</option>
              <option value="manual">Informar manualmente</option>
            </select>
          </div>

          {origem === 'herdado' ? (
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-3">
              <p className="text-xs text-gray-500">Saldo que ficou na gaveta</p>
              <p className="text-2xl font-semibold text-gray-900">
                {saldoGaveta === undefined ? 'carregando...' : herdadoConhecido ? reais(herdado) : '—'}
              </p>
              {saldoGaveta === null ? (
                <p className="text-[11px] text-red-600 mt-1">
                  Não foi possível ler o saldo desta gaveta. Feche e tente de novo — abrir sem
                  esse número abriria com o fundo errado.
                </p>
              ) : (
                <p className="text-[11px] text-gray-400 mt-1">
                  Este valor não é digitado: é o saldo que o ledger registra para esta gaveta. Se
                  não bate com o dinheiro físico, a diferença aparecerá no fechamento.
                </p>
              )}
            </div>
          ) : (
            <div>
              <label className="text-xs text-gray-500">Valor do fundo</label>
              <input value={valor} onChange={e => { setValor(e.target.value); setErro('') }}
                inputMode="decimal" placeholder="0,00" autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
          )}

          <div>
            <label className="text-xs text-gray-500">
              Observação {origem === 'manual' ? '(obrigatória)' : '(opcional)'}
            </label>
            <input value={observacao} onChange={e => { setObservacao(e.target.value); setErro('') }}
              placeholder={origem === 'manual' ? 'De onde veio esse dinheiro?' : 'Ex.: abertura do turno da manhã'}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
            {origem === 'manual' && (
              <p className="text-[11px] text-amber-700 mt-1">
                Este é o único jeito de entrar dinheiro sem origem rastreada. Fica registrado no extrato.
              </p>
            )}
          </div>

          {resumo && (
            <p className="text-sm text-gray-900 bg-blue-50 border border-blue-200 rounded-lg px-3 py-3">{resumo}</p>
          )}
          {erro && <p className="text-xs text-red-600">{erro}</p>}

          <div className="flex gap-2 pt-1">
            <button onClick={aoFechar} disabled={enviando}
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg disabled:opacity-40">
              Cancelar
            </button>
            <button onClick={confirmar} disabled={enviando || !valido}
              className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
              {enviando ? 'Abrindo...' : 'Abrir caixa'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Fechamento ────────────────────────────────────────────────────────────

type Demonstrativo = { categoria: string; rotulo: string; valor: number }

export function FecharCaixaModal({ caixa, aoFechar, aoFechado }: {
  caixa: CaixaPdvSessao
  aoFechar: () => void
  aoFechado: (r: ResultadoFechamento) => void
}) {
  const [esperado, setEsperado] = useState<number | null>(null)
  const [demonstrativo, setDemonstrativo] = useState<Demonstrativo[]>([])
  const [fecha, setFecha] = useState(true)
  const [carregando, setCarregando] = useState(true)
  const [contado, setContado] = useState('')
  const [troco, setTroco] = useState('')
  const [observacao, setObservacao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  const [idTransferencia] = useState(() => crypto.randomUUID())

  useEffect(() => {
    let vivo = true
    if (!caixa.sessao_id) return
    fetch(`/api/caixa/sessoes/${caixa.sessao_id}`).then(r => r.json()).catch(() => null).then(d => {
      if (!vivo) return
      if (d?.ok) {
        setEsperado(Number(d.saldo_esperado))
        setDemonstrativo(d.demonstrativo ?? [])
        setFecha(d.demonstrativo_fecha !== false)
      }
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [caixa.sessao_id])

  const nomeCaixa = caixa.caixa_nome ?? `Caixa ${caixa.terminal_nome}`
  const contadoNum = paraNumero(contado)
  const trocoNum = troco.trim() === '' ? 0 : paraNumero(troco)
  const temContado = Number.isFinite(contadoNum) && contadoNum >= 0 && contado.trim() !== ''
  const trocoOk = Number.isFinite(trocoNum) && trocoNum >= 0 && trocoNum <= (temContado ? contadoNum : 0)
  const valido = temContado && trocoOk && esperado != null

  const diferenca = temContado && esperado != null ? contadoNum - esperado : 0
  const entregar = valido ? contadoNum - trocoNum : 0

  async function confirmar() {
    if (!valido || enviando || !caixa.sessao_id) return
    setEnviando(true); setErro('')
    try {
      const d = await fetch(`/api/caixa/sessoes/${caixa.sessao_id}/fechar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valor_contado: contadoNum,
          valor_mantido_troco: trocoNum,
          observacao: observacao.trim() || null,
          transferencia_id: idTransferencia,   // o MESMO em qualquer retry
          valor_esperado_visto: esperado,      // protege contra fechar com número velho
        }),
      }).then(r => r.json())
      if (!d?.ok) {
        setErro(d?.estado === 'conflito_esperado'
          ? `O caixa foi movimentado enquanto você contava. O esperado agora é ${reais(Number(d.esperado_agora))}. Feche o diálogo e recomece a conferência.`
          : (d?.erro ?? 'Não foi possível fechar o caixa.'))
        return
      }
      aoFechado({ ...d.fechamento, caixa_nome: nomeCaixa })
    } catch {
      setErro('Não houve resposta do servidor. Tente confirmar de novo — o fechamento não será duplicado.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={aoFechar}>
      <div className="bg-white rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900">Fechar {nomeCaixa}</h2>

        {carregando ? (
          <p className="text-sm text-gray-400 py-8 text-center">Calculando o esperado...</p>
        ) : (
          <div className="space-y-4 mt-4">
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  {demonstrativo.map(l => (
                    <tr key={l.categoria} className="border-b border-gray-100">
                      <td className="px-4 py-2 text-gray-600">{l.rotulo}</td>
                      <td className={`px-4 py-2 text-right font-medium ${l.valor < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                        {l.valor < 0 ? '−' : '+'} {reais(Math.abs(l.valor))}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-900">Esperado na gaveta</td>
                    <td className="px-4 py-3 text-right text-lg font-semibold text-gray-900">
                      {esperado != null ? reais(esperado) : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {!fecha && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                O demonstrativo acima não soma exatamente o esperado — há movimento de um tipo que
                esta tela ainda não sabe classificar. O valor esperado continua correto.
              </p>
            )}

            <div>
              <label className="text-xs text-gray-500">Valor contado na gaveta</label>
              <input value={contado} onChange={e => { setContado(e.target.value); setErro('') }}
                inputMode="decimal" placeholder="0,00" autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
            </div>

            {temContado && esperado != null && (
              <div className={`rounded-lg px-3 py-2 text-sm border ${
                diferenca === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : diferenca > 0 ? 'bg-blue-50 border-blue-200 text-blue-800'
                : 'bg-red-50 border-red-200 text-red-800'}`}>
                {diferenca === 0 ? 'Conferido — o contado bate com o esperado.'
                  : diferenca > 0 ? `Sobra de ${reais(diferenca)}.`
                  : `Falta de ${reais(Math.abs(diferenca))}.`}
              </div>
            )}

            <div>
              <label className="text-xs text-gray-500">Manter na gaveta para troco</label>
              <input value={troco} onChange={e => { setTroco(e.target.value); setErro('') }}
                inputMode="decimal" placeholder="0,00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
              {temContado && !trocoOk && (
                <p className="text-[11px] text-red-600 mt-1">
                  Não é possível manter mais troco do que o dinheiro contado.
                </p>
              )}
            </div>

            <div>
              <label className="text-xs text-gray-500">Observação (opcional)</label>
              <input value={observacao} onChange={e => setObservacao(e.target.value)}
                placeholder="Ex.: conferido com o gerente"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
            </div>

            {valido && (
              <p className="text-sm text-gray-900 bg-blue-50 border border-blue-200 rounded-lg px-3 py-3">
                {reais(trocoNum)} permanecerá no {nomeCaixa}.{' '}
                {reais(entregar)} será transferido para a Tesouraria.{' '}
                Diferença do fechamento: {diferenca < 0 ? `− ${reais(Math.abs(diferenca))}` : reais(diferenca)}.
              </p>
            )}
            {erro && <p className="text-xs text-red-600">{erro}</p>}

            <div className="flex gap-2">
              <button onClick={aoFechar} disabled={enviando}
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg disabled:opacity-40">
                Cancelar
              </button>
              <button onClick={confirmar} disabled={enviando || !valido}
                className="flex-1 px-4 py-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
                {enviando ? 'Fechando...' : 'Confirmar fechamento'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export type ResultadoFechamento = {
  sessao_id: string
  caixa_nome: string
  valor_esperado: number
  valor_contado: number
  diferenca: number
  valor_mantido_troco: number
  valor_entregue_tesouraria: number
  saldo_final_do_caixa: number | null
}

export function ComprovanteFechamento({ r, aoFechar }: { r: ResultadoFechamento; aoFechar: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={aoFechar}>
      <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <p className="text-sm font-semibold text-emerald-700 uppercase tracking-wide">Caixa fechado</p>
        <p className="text-lg font-medium text-gray-900 mt-1">{r.caixa_nome}</p>

        <dl className="mt-4 text-sm space-y-1.5">
          {[
            ['Esperado', reais(r.valor_esperado)],
            ['Contado', reais(r.valor_contado)],
            ['Diferença', r.diferenca === 0 ? 'Conferido'
              : r.diferenca > 0 ? `Sobra de ${reais(r.diferenca)}` : `Falta de ${reais(Math.abs(r.diferenca))}`],
            ['Mantido para troco', reais(r.valor_mantido_troco)],
            ['Entregue à Tesouraria', reais(r.valor_entregue_tesouraria)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-gray-500">{k}</dt>
              <dd className="text-gray-900 text-right">{v}</dd>
            </div>
          ))}
        </dl>

        {r.saldo_final_do_caixa != null && (
          <p className="text-[11px] text-gray-400 mt-3 pt-3 border-t border-gray-100">
            A gaveta fica com {reais(r.saldo_final_do_caixa)} — é esse valor que a próxima
            abertura vai herdar, sem criar dinheiro novo.
          </p>
        )}

        <button onClick={aoFechar}
          className="mt-5 w-full px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg">
          Fechar
        </button>
      </div>
    </div>
  )
}
