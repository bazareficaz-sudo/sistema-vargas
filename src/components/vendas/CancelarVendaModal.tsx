'use client'

import { useState } from 'react'

// Cancelar uma venda, com o que vai ser desfeito escrito ANTES do clique.
//
// Cancelamento não é "apagar a linha": devolve estoque, cancela parcela a
// receber e mexe no saldo do cliente. Quem confirma precisa ver essa lista,
// senão descobre o efeito depois — e aí já não há como voltar sem outro
// conserto manual.
//
// O MOTIVO É OBRIGATÓRIO porque é ele que sobrevive. Daqui a três meses, a
// pergunta que alguém faz é "por que esta venda foi cancelada?", e a resposta
// tem que estar na venda e na parcela, não na memória de quem cancelou.

type VendaResumo = {
  id: string
  // `Venda` na listagem traz numero como string OU number, dependendo da
  // origem do registro. Aceitar os dois aqui é mais honesto que forçar um
  // deles com cast e descobrir na tela.
  numero?: string | number | null
  total?: number | null
  cliente_nome?: string | null
  forma_pagamento?: string | null
  nfce_status?: string | null
  nfce_numero?: string | null
}

type Resultado = {
  devolvidos: { produto: string; quantidade: number; de: number; para: number }[]
  parcelasCanceladas: number
  creditosCancelados: number
  valorEmAberto: number
}

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function CancelarVendaModal({ venda, onFechar, onCancelada }: {
  venda: VendaResumo
  onFechar: () => void
  onCancelada: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [feito, setFeito] = useState<Resultado | null>(null)

  const numero = venda.numero != null && venda.numero !== '' ? String(venda.numero) : venda.id.slice(-6).toUpperCase()
  // A recusa do servidor é a que vale; esta existe para a tela não convidar a
  // um clique que já se sabe que será recusado.
  const temNfce = venda.nfce_status === 'autorizada'

  async function cancelar() {
    if (!motivo.trim()) { setErro('Escreva o motivo — ele fica registrado.'); return }
    setSalvando(true); setErro('')
    try {
      const d = await fetch(`/api/vendas/${venda.id}/cancelar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo: motivo.trim() }),
      }).then(r => r.json())
      if (!d.ok) { setErro(d.erro ?? 'Não foi possível cancelar'); return }
      setFeito(d as Resultado)
    } catch {
      setErro('Falha de conexão — a venda não foi cancelada.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={feito ? onCancelada : onFechar} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="font-semibold text-gray-900">
            {feito ? 'Venda cancelada' : `Cancelar venda #${numero}`}
          </h2>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          {feito ? (
            <>
              <p className="text-sm text-gray-700">
                A venda <strong>#{numero}</strong> foi cancelada. O que foi desfeito:
              </p>
              <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 text-sm">
                <div className="px-4 py-3">
                  <p className="font-medium text-gray-900 mb-1">Estoque devolvido</p>
                  {feito.devolvidos.length === 0 ? (
                    <p className="text-xs text-gray-400">Nenhum item com produto vinculado.</p>
                  ) : feito.devolvidos.map(d => (
                    <p key={d.produto} className="text-xs text-gray-600">
                      {d.produto}: {d.de} → <strong>{d.para}</strong>
                      <span className="text-gray-400"> ({d.quantidade > 0 ? '+' : ''}{d.quantidade})</span>
                    </p>
                  ))}
                </div>
                {feito.parcelasCanceladas > 0 && (
                  <div className="px-4 py-3">
                    <p className="font-medium text-gray-900">A receber</p>
                    <p className="text-xs text-gray-600">
                      {feito.parcelasCanceladas} parcela(s) cancelada(s), {fmt(feito.valorEmAberto)} que
                      deixam de ser cobrados. O motivo ficou escrito em cada uma.
                    </p>
                  </div>
                )}
                {feito.creditosCancelados > 0 && (
                  <div className="px-4 py-3">
                    <p className="font-medium text-gray-900">Crédito do cliente</p>
                    <p className="text-xs text-gray-600">{feito.creditosCancelados} crédito(s) cancelado(s).</p>
                  </div>
                )}
              </div>
              <button onClick={onCancelada}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
                Fechar
              </button>
            </>
          ) : (
            <>
              <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Total</span><strong className="text-gray-900">{fmt(Number(venda.total ?? 0))}</strong></div>
                {venda.cliente_nome && <div className="flex justify-between mt-1"><span className="text-gray-500">Cliente</span><span className="text-gray-700">{venda.cliente_nome}</span></div>}
                {venda.forma_pagamento && <div className="flex justify-between mt-1"><span className="text-gray-500">Pagamento</span><span className="text-gray-700">{venda.forma_pagamento}</span></div>}
              </div>

              {/* O QUE VAI ACONTECER, antes do clique. */}
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-sm font-medium text-amber-900 mb-1.5">O que o cancelamento faz</p>
                <ul className="text-xs text-amber-900 space-y-1 list-disc pl-4">
                  <li>Devolve os itens ao estoque, no depósito de onde saíram.</li>
                  <li>Cancela as parcelas a receber desta venda, deixando escrito nelas que a venda foi cancelada.</li>
                  <li>Abate do saldo devedor do cliente o que ficou em aberto.</li>
                  <li>Cancela crédito que esta venda tenha gerado, se ainda não foi usado.</li>
                </ul>
              </div>

              {temNfce && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                  <p className="text-sm text-red-800">
                    Esta venda tem <strong>NFC-e autorizada</strong> (nº {venda.nfce_numero ?? '—'}). O
                    documento está na SEFAZ e com o cliente. Cancele a nota primeiro — cancelar só aqui
                    deixaria a nota valendo com a venda cancelada no sistema.
                  </p>
                </div>
              )}

              <div>
                <label className="text-xs text-gray-500">Motivo do cancelamento *</label>
                <textarea
                  value={motivo}
                  onChange={e => { setMotivo(e.target.value); setErro('') }}
                  rows={3}
                  autoFocus
                  placeholder="Ex.: cliente desistiu da compra"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                <p className="text-[11px] text-gray-400 mt-1">
                  Fica registrado na venda, nas parcelas canceladas e na auditoria.
                </p>
              </div>

              {erro && <p className="text-sm text-red-600">{erro}</p>}

              <div className="flex gap-3 justify-end">
                <button onClick={onFechar} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">
                  Voltar
                </button>
                <button onClick={cancelar} disabled={salvando || temNfce || !motivo.trim()}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
                  {salvando ? 'Cancelando...' : 'Cancelar a venda'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
