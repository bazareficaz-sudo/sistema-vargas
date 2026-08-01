'use client'

import { useEffect, useState } from 'react'
import { ETAPAS, ETAPA_INFO, proximaEtapa, transicaoPermitida, type Etapa } from '@/lib/pedidos/etapas'

// Painel de um pedido: em que etapa está, para onde pode ir, e tudo que já
// aconteceu com ele.
//
// A linha do tempo existe para responder "quem despachou este pedido, e
// quando?" — pergunta que hoje só tinha resposta na memória de alguém.

export default function PainelEtapaPedido({ pedido, onFechar, onMudou }: {
  pedido: { id: string; fonte: 'venda' | 'marketplace'; numero: string; etapa: Etapa; origemNome: string; statusRotulo: string; clienteNome: string | null }
  onFechar: () => void
  onMudou: (novaEtapa: Etapa) => void
}) {
  const [etapa, setEtapa] = useState<Etapa>(pedido.etapa)
  const [eventos, setEventos] = useState<any[] | null>(null)
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState<Etapa | null>(null)
  const [erro, setErro] = useState('')

  async function carregarEventos() {
    const d = await fetch(`/api/pedidos/etapa?fonte=${pedido.fonte}&id=${pedido.id}`).then(r => r.json())
    if (d.ok) setEventos(d.eventos)
  }
  useEffect(() => { carregarEventos() }, [pedido.id])

  async function mudar(nova: Etapa) {
    const permite = transicaoPermitida(etapa, nova)
    if (!permite.ok) { setErro(permite.motivo ?? ''); return }
    setSalvando(nova); setErro('')
    try {
      const d = await fetch('/api/pedidos/etapa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fonte: pedido.fonte, id: pedido.id, etapa: nova, observacao }),
      }).then(r => r.json())
      if (!d.ok) { setErro(d.erro ?? 'Não foi possível mudar a etapa'); return }
      setEtapa(nova); setObservacao(''); onMudou(nova)
      carregarEventos()
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao mudar a etapa')
    } finally {
      setSalvando(null)
    }
  }

  const info = ETAPA_INFO[etapa]
  const proxima = proximaEtapa(etapa)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onFechar} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-200 sticky top-0 bg-white flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Pedido {pedido.numero}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {pedido.origemNome}
              {pedido.clienteNome && <> · {pedido.clienteNome}</>}
            </p>
          </div>
          <button onClick={onFechar} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Os dois eixos, lado a lado, para não confundir um com o outro */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
              <p className="text-[11px] text-gray-500">O canal informa</p>
              <p className="text-sm text-gray-900 mt-0.5">{pedido.statusRotulo}</p>
            </div>
            <div className={`border rounded-lg px-3 py-2.5 ${info.cor}`}>
              <p className="text-[11px] opacity-70">Aqui no galpão</p>
              <p className="text-sm font-medium mt-0.5">{info.icone} {info.label}</p>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 -mt-3">
            São coisas diferentes: o canal diz o que ele sabe do pagamento e da entrega; a etapa diz o que a sua
            operação já fez. Quando o canal informa envio, a etapa avança sozinha.
          </p>

          {/* Avançar */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">Mudar etapa</p>
            <div className="flex flex-wrap gap-1.5">
              {ETAPAS.filter(e => e.valor !== etapa).map(e => {
                const permite = transicaoPermitida(etapa, e.valor)
                const destaque = e.valor === proxima
                return (
                  <button key={e.valor} onClick={() => mudar(e.valor)}
                    disabled={!permite.ok || salvando !== null}
                    title={permite.ok ? e.ajuda : permite.motivo}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                      destaque ? 'border-blue-400 bg-blue-50 text-blue-800 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}>
                    {salvando === e.valor ? '...' : `${e.icone} ${e.label}`}
                  </button>
                )
              })}
            </div>
            <input value={observacao} onChange={e => setObservacao(e.target.value)}
              placeholder="Observação (opcional) — fica registrada na linha do tempo"
              className="w-full mt-2 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            {erro && <p className="text-xs text-red-600 mt-1.5">{erro}</p>}
          </div>

          {/* Linha do tempo */}
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-medium text-gray-600 mb-2">Linha do tempo</p>
            {eventos === null && <p className="text-xs text-gray-400">Carregando...</p>}
            {eventos?.length === 0 && (
              <p className="text-xs text-gray-400">
                Nada registrado ainda. A partir de agora, toda mudança de etapa aparece aqui com autor e horário.
              </p>
            )}
            <div className="space-y-2.5">
              {eventos?.map(ev => (
                <div key={ev.id} className="flex gap-2.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">{ev.descricao}</p>
                    {ev.observacao && <p className="text-xs text-gray-600 mt-0.5">{ev.observacao}</p>}
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {new Date(ev.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                      {ev.automatico ? ' · automático' : ev.usuario_nome ? ` · ${ev.usuario_nome}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
