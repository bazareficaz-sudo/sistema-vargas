'use client'

import { useState, useEffect } from 'react'

// Sangria e suprimento — o mesmo diálogo, dois sentidos.
//
// O UUID NASCE AO ABRIR, não ao confirmar.
//
// É essa escolha que torna o duplo clique inofensivo: os dois cliques
// mandam o MESMO id, e o servidor responde `ja_aplicada` ao segundo em vez
// de transferir de novo. Gerar o id no clique faria cada retry virar uma
// transferência nova — e um timeout, dinheiro em duplicidade.
//
// O botão desabilitado ajuda, mas não é a garantia: ele não sobrevive a um
// refresh no meio do envio, nem a uma aba duplicada. A autoridade é o
// servidor, e o id é o que a sustenta.

export type Especie = 'sangria' | 'suprimento'

export type CaixaPdvOpcao = {
  terminal_id: string
  terminal_nome: string
  caixa_id: string | null
  caixa_nome: string | null
}

export type Comprovante = {
  especie: Especie
  valor: number
  origem: string
  destino: string
  quando: string
  responsavel: string
  id: string
}

function reais(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function TransferenciaModal({ especie, aoFechar, aoConcluir, responsavel }: {
  especie: Especie
  aoFechar: () => void
  aoConcluir: (c: Comprovante) => void
  responsavel: string
}) {
  const [caixas, setCaixas] = useState<CaixaPdvOpcao[]>([])
  const [terminalId, setTerminalId] = useState('')
  const [valor, setValor] = useState('')
  const [observacao, setObservacao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)

  // A identidade da operação, fixa enquanto o diálogo estiver aberto. Um
  // retry depois de timeout reusa exatamente este valor.
  const [idTransferencia] = useState(() => crypto.randomUUID())

  useEffect(() => {
    let vivo = true
    fetch('/api/caixa/pdvs').then(r => r.json()).catch(() => null).then(d => {
      if (!vivo) return
      if (d?.ok) {
        setCaixas(d.caixas)
        if (d.caixas.length === 1) setTerminalId(d.caixas[0].terminal_id)
      }
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [])

  const escolhido = caixas.find(c => c.terminal_id === terminalId)
  const valorNumero = Number(valor.replace(/\./g, '').replace(',', '.'))
  const valorValido = Number.isFinite(valorNumero) && valorNumero > 0

  const nomeGaveta = escolhido ? (escolhido.caixa_nome ?? `Caixa ${escolhido.terminal_nome}`) : ''
  const resumo = !escolhido || !valorValido ? '' : (especie === 'sangria'
    ? `${reais(valorNumero)} sairá do Caixa PDV ${escolhido.terminal_nome} e entrará na Tesouraria da empresa.`
    : `${reais(valorNumero)} sairá da Tesouraria e entrará no Caixa PDV ${escolhido.terminal_nome}.`)

  async function confirmar() {
    if (!escolhido || !valorValido || enviando) return
    setEnviando(true)
    setErro('')
    try {
      const d = await fetch('/api/caixa/transferencias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: idTransferencia,          // o MESMO em qualquer retry
          especie,
          terminal_id: escolhido.terminal_id,
          valor: valorNumero,
          observacao: observacao.trim() || null,
        }),
      }).then(r => r.json())

      if (!d?.ok) {
        setErro(d?.erro ?? 'Não foi possível concluir a transferência.')
        return
      }
      aoConcluir({
        especie, valor: valorNumero,
        origem: especie === 'sangria' ? nomeGaveta : 'Caixa da Empresa',
        destino: especie === 'sangria' ? 'Caixa da Empresa' : nomeGaveta,
        quando: new Date().toLocaleString('pt-BR'),
        responsavel,
        id: idTransferencia,
      })
    } catch {
      // A rede caiu sem resposta: a transferência PODE ter sido gravada.
      // Reabrir e confirmar de novo reusa o mesmo id e converge.
      setErro('Não houve resposta do servidor. Tente confirmar de novo — '
            + 'a operação não será duplicada.')
    } finally {
      setEnviando(false)
    }
  }

  const titulo = especie === 'sangria' ? 'Sangria' : 'Suprimento'

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
         onClick={aoFechar}>
      <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900">{titulo}</h2>
        <p className="text-xs text-gray-500 mt-1">
          {especie === 'sangria'
            ? 'Dinheiro que saiu da gaveta do PDV e foi entregue ao financeiro.'
            : 'Dinheiro que a tesouraria entregou ao PDV, normalmente para troco.'}
        </p>

        {carregando ? (
          <p className="text-sm text-gray-400 py-8 text-center">Carregando caixas...</p>
        ) : caixas.length === 0 ? (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 mt-4">
            Nenhum terminal de PDV ativo nesta empresa. O caixa de PDV é criado a partir de um terminal.
          </p>
        ) : (
          <div className="space-y-3 mt-4">
            <div>
              <label className="text-xs text-gray-500">
                {especie === 'sangria' ? 'Caixa de origem' : 'Caixa de destino'}
              </label>
              <select value={terminalId} onChange={e => { setTerminalId(e.target.value); setErro('') }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1">
                <option value="">Escolha o caixa</option>
                {caixas.map(c => (
                  <option key={c.terminal_id} value={c.terminal_id}>
                    {c.terminal_nome}{c.caixa_id ? '' : ' (primeiro uso)'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500">Valor</label>
              <input value={valor} onChange={e => { setValor(e.target.value); setErro('') }}
                inputMode="decimal" placeholder="0,00" autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
            </div>

            <div>
              <label className="text-xs text-gray-500">Observação (opcional)</label>
              <input value={observacao} onChange={e => setObservacao(e.target.value)}
                placeholder={especie === 'sangria' ? 'Ex.: sangria do turno da tarde' : 'Ex.: reforço de troco'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
            </div>

            {resumo && (
              <p className="text-sm text-gray-900 bg-blue-50 border border-blue-200 rounded-lg px-3 py-3">
                {resumo}
              </p>
            )}

            {erro && <p className="text-xs text-red-600">{erro}</p>}

            <div className="flex gap-2 pt-1">
              <button onClick={aoFechar} disabled={enviando}
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg disabled:opacity-40">
                Cancelar
              </button>
              <button onClick={confirmar} disabled={enviando || !escolhido || !valorValido}
                className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
                {enviando ? 'Enviando...' : `Confirmar ${titulo.toLowerCase()}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** O comprovante depois do sucesso. Sem PDF nesta fase — só o resumo. */
export function ComprovanteTransferencia({ c, aoFechar }: { c: Comprovante; aoFechar: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={aoFechar}>
      <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <p className="text-sm font-semibold text-emerald-700 uppercase tracking-wide">
          {c.especie === 'sangria' ? 'Sangria realizada' : 'Suprimento realizado'}
        </p>
        <p className="text-3xl font-semibold text-gray-900 mt-2">{reais(c.valor)}</p>

        <dl className="mt-4 text-sm space-y-1.5">
          {[
            ['Origem', c.origem],
            ['Destino', c.destino],
            ['Data/hora', c.quando],
            ['Responsável', c.responsavel],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-gray-500">{k}</dt>
              <dd className="text-gray-900 text-right">{v}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 pt-1.5 border-t border-gray-100">
            <dt className="text-gray-500">Identificador</dt>
            <dd className="text-gray-400 text-right text-[11px] font-mono break-all">{c.id}</dd>
          </div>
        </dl>

        <button onClick={aoFechar}
          className="mt-5 w-full px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg">
          Fechar
        </button>
      </div>
    </div>
  )
}
