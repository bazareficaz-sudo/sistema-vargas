'use client'

import { useState } from 'react'

// ACRESCENTAR ANÚNCIOS A UMA CAMPANHA.
//
// O primeiro envio de escrita em campanha deste sistema. Preço promocional é
// preço no ar com prazo — a "Bota Fora" vai até 31/10 —, então a tela pede
// SIMULAÇÃO antes de qualquer envio, e nunca manda direto.
//
// A simulação não é cortesia: a rota calcula a margem de cada item pelo motor
// e aplica a trava. Sem ver o resultado antes, a única forma de saber o que
// aconteceria seria produzi-lo.

type ItemAvaliado = {
  anuncioId: string
  titulo: string
  precoNormal: number | null
  precoPromocional: number
  margem: number | null
  lucro: number | null
  semEconomia: string | null
  veredito: {
    liberado: boolean
    bloqueado: boolean
    motivo?: string
    explicacao?: string
  }
}

type Resposta = {
  ok?: boolean
  simulacao?: boolean
  erro?: string
  mensagem?: string
  precisaConfirmar?: boolean
  resumo?: { liberados: number; exigemConfirmacao: number; bloqueados: number }
  itens?: ItemAvaliado[]
  recusados?: { itemId: number; erro: string; mensagem: string }[]
}

const brl = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function AdicionarNaCampanhaModal({
  canalId, campanha, anuncios, onFechar, onPronto,
}: {
  canalId: string
  campanha: { idExterno: string; nome: string; status: string }
  /** Os anúncios que o operador escolheu na tela de anúncios. */
  anuncios: { id: string; titulo: string; preco_venda: number | null; tem_variacao?: boolean | null }[]
  onFechar: () => void
  onPronto: () => void
}) {
  // Desconto em % é como se pensa uma promoção — "20% off" —, não em reais.
  // O preço de cada item sai daqui, e continua editável um a um.
  const [descontoPct, setDescontoPct] = useState('10')
  const [precos, setPrecos] = useState<Record<string, string>>({})
  const [resp, setResp] = useState<Resposta | null>(null)
  const [ocupado, setOcupado] = useState(false)

  function precoDe(a: { id: string; preco_venda: number | null }) {
    const manual = precos[a.id]
    if (manual !== undefined && manual !== '') return Number(manual)
    const base = Number(a.preco_venda ?? 0)
    const pct = Number(descontoPct) || 0
    return base > 0 ? Number((base * (1 - pct / 100)).toFixed(2)) : 0
  }

  async function chamar(simular: boolean, confirmado = false) {
    setOcupado(true)
    try {
      const r = await fetch('/api/marketplace/shopee/campanha-itens', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canalId, discountId: campanha.idExterno, acao: 'adicionar',
          simular, confirmado,
          itens: anuncios.map(a => ({ anuncioId: a.id, precoPromocional: precoDe(a) })),
        }),
      }).then(x => x.json())
      setResp(r)
      if (!simular && r?.ok) onPronto()
    } catch (e) {
      setResp({ ok: false, erro: e instanceof Error ? e.message : 'Falha na chamada' })
    } finally {
      setOcupado(false)
    }
  }

  const simulou = !!resp?.simulacao
  const resumo = resp?.resumo

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-3xl rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-sm font-semibold text-gray-900">
          Adicionar {anuncios.length} anúncio(s) em &quot;{campanha.nome}&quot;
        </h3>
        <p className="mt-1 text-xs text-gray-500">
          O preço promocional vai ao ar e vale até o fim da campanha. Simule antes de enviar.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <label className="text-xs text-gray-600">Desconto</label>
          <input type="number" min={0} max={99} value={descontoPct}
            onChange={e => { setDescontoPct(e.target.value); setResp(null) }}
            className="w-20 rounded border border-gray-300 px-2 py-1 text-sm" />
          <span className="text-xs text-gray-600">% sobre o preço atual de cada anúncio</span>
          <span className="text-[11px] text-gray-400">— dá para ajustar item a item na lista abaixo</span>
        </div>

        <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Anúncio</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Hoje</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Promocional</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Margem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {anuncios.map(a => {
                const avaliado = resp?.itens?.find(i => i.anuncioId === a.id)
                const v = avaliado?.veredito
                return (
                  <tr key={a.id} className={v?.bloqueado ? 'bg-red-50' : v && !v.liberado ? 'bg-amber-50' : ''}>
                    <td className="px-3 py-2">
                      <p className="text-xs text-gray-900 line-clamp-1">{a.titulo}</p>
                      {/* O MOTIVO NA LINHA. Quem procura por que um item não
                          passou não vai passar o mouse em cada um. */}
                      {v?.explicacao && (
                        <p className={`text-[11px] mt-0.5 ${v.bloqueado ? 'text-red-700' : 'text-amber-800'}`}>
                          {v.bloqueado ? '✕ ' : '⚠ '}{v.explicacao}
                        </p>
                      )}
                      {a.tem_variacao && (
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          tem variações — o preço será aplicado ao item; conferir na Shopee
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-gray-500">{brl(a.preco_venda)}</td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" step="0.01" min={0}
                        value={precos[a.id] ?? String(precoDe(a))}
                        onChange={e => { setPrecos(p => ({ ...p, [a.id]: e.target.value })); setResp(null) }}
                        className="w-24 rounded border border-gray-300 px-2 py-1 text-right text-sm" />
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      {avaliado?.margem == null
                        ? <span className="text-gray-300">—</span>
                        : (
                          <>
                            <span className={avaliado.margem < 0 ? 'text-red-600 font-semibold' : avaliado.margem < 5 ? 'text-amber-700' : 'text-emerald-700'}>
                              {avaliado.margem.toFixed(1)}%
                            </span>
                            <span className="block text-[10px] text-gray-400">{brl(avaliado.lucro)}/un</span>
                          </>
                        )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {resumo && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-green-700">
              {resumo.liberados} liberado(s)
            </span>
            {resumo.exigemConfirmacao > 0 && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800">
                {resumo.exigemConfirmacao} exige(m) confirmação
              </span>
            )}
            {resumo.bloqueados > 0 && (
              <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-700">
                {resumo.bloqueados} bloqueado(s)
              </span>
            )}
          </div>
        )}

        {resp?.erro && !resp.precisaConfirmar && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {resp.erro}{resp.mensagem ? ` — ${resp.mensagem}` : ''}
          </p>
        )}
        {/* RECUSA INDIVIDUAL DA SHOPEE. Ela pode aceitar a chamada e recusar
            itens dentro dela; sem isto a tela diria "enviado" para um item
            que ficou de fora. */}
        {resp?.recusados && resp.recusados.length > 0 && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
            <p className="text-xs font-medium text-red-800">A Shopee recusou {resp.recusados.length} item(ns):</p>
            {resp.recusados.map((r, i) => (
              <p key={i} className="text-[11px] text-red-700">item {r.itemId}: {r.erro} — {r.mensagem}</p>
            ))}
          </div>
        )}
        {resp?.ok && !resp.simulacao && (
          <p className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
            ✓ Enviado. Use &quot;Puxar campanhas da Shopee&quot; para conferir como ficou lá.
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onFechar} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">
            Fechar
          </button>
          <button onClick={() => void chamar(true)} disabled={ocupado}
            className="rounded-lg border border-blue-300 px-4 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50">
            {ocupado ? 'Calculando…' : 'Simular'}
          </button>
          {/* ENVIAR SÓ DEPOIS DE SIMULAR. O botão nem existe antes — não é
              desabilitado, é ausente: um botão cinza convida a procurar como
              habilitá-lo. */}
          {simulou && resumo && resumo.bloqueados === 0 && (
            <button
              onClick={() => {
                if (resumo.exigemConfirmacao > 0 &&
                    !confirm(`${resumo.exigemConfirmacao} item(ns) ficam no prejuízo ou abaixo do piso. Enviar assim mesmo?`)) return
                void chamar(false, true)
              }}
              disabled={ocupado}
              className="rounded-lg bg-red-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
              {ocupado ? 'Enviando…' : `Enviar para a Shopee (${anuncios.length})`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
