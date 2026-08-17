'use client'

import { useMemo, useState } from 'react'

// A memória do Auxiliar de Compras: quanto tempo cada produto ficou
// zerado, e o que o comprador faz com o que o motor sugere.
//
// As duas coisas começam vazias no dia em que esta tela entra no ar — não
// há como reconstruir o passado. O valor cresce com o tempo de uso, e a
// tela precisa deixar isso claro em vez de parecer quebrada quando
// mostrar pouca coisa nas primeiras semanas.

type Ruptura = {
  id: string
  produto_id: string
  nome: string
  sku: string | null
  inicio: string
  fim: string | null
  dias: number | null
  solicitacoes_durante: number
  unidades_solicitadas_durante: number
}

type Decisao = {
  id: string
  produto_id: string
  nome: string
  sku: string | null
  evento: string
  quantidade_sugerida: number | null
  quantidade_decidida: number | null
  criado_em: string
}

const dataHoraBr = (v: string) => new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function HistoricoClient({ rupturas, decisoes }: { rupturas: Ruptura[]; decisoes: Decisao[] }) {
  const [aba, setAba] = useState<'rupturas' | 'decisoes'>('rupturas')

  const rupturasAbertas = rupturas.filter(r => !r.fim)
  const rupturasFechadas = rupturas.filter(r => r.fim)

  const porProdutoRuptura = useMemo(() => {
    const m = new Map<string, { nome: string; sku: string | null; qtd: number; diasTotal: number; solicitacoes: number; aberta: boolean }>()
    for (const r of rupturas) {
      const e = m.get(r.produto_id) ?? { nome: r.nome, sku: r.sku, qtd: 0, diasTotal: 0, solicitacoes: 0, aberta: false }
      e.qtd++
      e.diasTotal += r.dias ?? 0
      e.solicitacoes += r.solicitacoes_durante
      if (!r.fim) e.aberta = true
      m.set(r.produto_id, e)
    }
    return [...m.entries()].map(([produtoId, v]) => ({ produtoId, ...v }))
      .sort((a, b) => (b.aberta ? 1 : 0) - (a.aberta ? 1 : 0) || b.qtd - a.qtd || b.diasTotal - a.diasTotal)
  }, [rupturas])

  const geradas = decisoes.filter(d => d.evento === 'pedido_gerado')
  const removidas = decisoes.filter(d => d.evento === 'removido_sem_comprar')
  const comparaveis = geradas.filter(d => d.quantidade_sugerida && d.quantidade_sugerida > 0 && d.quantidade_decidida !== null)
  const razaoMedia = comparaveis.length > 0
    ? comparaveis.reduce((s, d) => s + Number(d.quantidade_decidida) / Number(d.quantidade_sugerida), 0) / comparaveis.length
    : null

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <span className="text-gray-600 font-medium">histórico</span>
      </div>

      <h1 className="text-gray-900 text-xl font-semibold mb-1">Histórico do Auxiliar de Compras</h1>
      <p className="text-gray-500 text-sm mb-6">
        Quanto tempo cada produto fica zerado, e o que o comprador faz com o que o motor sugere. Registrado a partir de hoje — não há como reconstruir o passado.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Cartao valor={rupturasAbertas.length} label="Rupturas em andamento" tom={rupturasAbertas.length > 0 ? 'vermelho' : undefined} />
        <Cartao valor={rupturasFechadas.length} label="Rupturas encerradas" />
        <Cartao valor={geradas.length} label="Sugestões viraram pedido" />
        <Cartao valor={removidas.length} label="Sugestões rejeitadas" />
      </div>

      {razaoMedia !== null && comparaveis.length >= 5 && (
        <div className="mb-5 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          Em {comparaveis.length} pedido(s) com sugestão registrada, o comprador levou em média{' '}
          <strong>{Math.round(razaoMedia * 100)}%</strong> da quantidade que o motor sugeriu
          {razaoMedia < 0.9 ? ' — tende a comprar menos do que o cálculo indica.'
            : razaoMedia > 1.1 ? ' — tende a comprar mais do que o cálculo indica.'
            : ', bem perto do sugerido.'}
        </div>
      )}
      {comparaveis.length > 0 && comparaveis.length < 5 && (
        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          Só {comparaveis.length} decisão(ões) registrada(s) até agora — poucas para tirar um padrão. A partir de ~5 pedidos gerados pelo Auxiliar, esta tela passa a mostrar a média.
        </div>
      )}

      <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden mb-4">
        <button onClick={() => setAba('rupturas')}
          className={`px-3 py-1.5 text-xs font-medium ${aba === 'rupturas' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
          Rupturas
        </button>
        <button onClick={() => setAba('decisoes')}
          className={`px-3 py-1.5 text-xs font-medium ${aba === 'decisoes' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
          Decisões
        </button>
      </div>

      {aba === 'rupturas' && (
        porProdutoRuptura.length === 0 ? (
          <VazioRupturas />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Produto</th>
                  <th className="text-right px-2 py-2 font-medium">Vezes zerado</th>
                  <th className="text-right px-2 py-2 font-medium">Dias zerado (total)</th>
                  <th className="text-right px-2 py-2 font-medium">Solicitações do balcão</th>
                  <th className="text-center px-2 py-2 font-medium">Agora</th>
                </tr>
              </thead>
              <tbody>
                {porProdutoRuptura.map(p => (
                  <tr key={p.produtoId} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{p.nome}</div>
                      <div className="text-[11px] text-slate-400">{p.sku ?? '—'}</div>
                    </td>
                    <td className="px-2 py-2 text-right text-slate-700">{p.qtd}</td>
                    <td className="px-2 py-2 text-right text-slate-700">{p.diasTotal}</td>
                    <td className="px-2 py-2 text-right text-slate-700">{p.solicitacoes || '—'}</td>
                    <td className="px-2 py-2 text-center">
                      {p.aberta
                        ? <span className="text-[11px] font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded-full">zerado agora</span>
                        : <span className="text-[11px] text-slate-400">recuperado</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {aba === 'decisoes' && (
        decisoes.length === 0 ? (
          <VazioDecisoes />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Produto</th>
                  <th className="text-center px-2 py-2 font-medium">Decisão</th>
                  <th className="text-right px-2 py-2 font-medium">Sugerido</th>
                  <th className="text-right px-2 py-2 font-medium">Decidido</th>
                  <th className="text-left px-2 py-2 font-medium">Quando</th>
                </tr>
              </thead>
              <tbody>
                {decisoes.map(d => (
                  <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{d.nome}</div>
                      <div className="text-[11px] text-slate-400">{d.sku ?? '—'}</div>
                    </td>
                    <td className="px-2 py-2 text-center">
                      {d.evento === 'pedido_gerado'
                        ? <span className="text-[11px] font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">virou pedido</span>
                        : <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">rejeitado</span>}
                    </td>
                    <td className="px-2 py-2 text-right text-slate-600">{d.quantidade_sugerida ?? '—'}</td>
                    <td className="px-2 py-2 text-right font-medium text-slate-800">{d.quantidade_decidida ?? '—'}</td>
                    <td className="px-2 py-2 text-slate-400 text-[12px]">{dataHoraBr(d.criado_em)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

function Cartao({ valor, label, tom }: { valor: number; label: string; tom?: 'vermelho' }) {
  const cor = tom === 'vermelho' && valor > 0 ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-800'
  return (
    <div className={`rounded-xl border px-4 py-3 ${cor}`}>
      <div className="text-2xl font-semibold">{valor}</div>
      <div className="text-[11px] opacity-70 mt-0.5">{label}</div>
    </div>
  )
}

function VazioRupturas() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-slate-500 text-sm">
      Nenhuma ruptura registrada ainda. A rodada noturna do Auxiliar de Compras detecta quando um produto
      cruza de estoque positivo para zero ou negativo — a partir de hoje.
    </div>
  )
}

function VazioDecisoes() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-slate-500 text-sm">
      Nenhuma decisão registrada ainda. Toda vez que um item passa da Lista de Compra para um pedido —
      ou é removido sem virar pedido — fica anotado aqui.
    </div>
  )
}
