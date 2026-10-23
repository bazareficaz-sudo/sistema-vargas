'use client'

import { useEffect, useState } from 'react'

// AS DEVOLUÇÕES A RESOLVER.
//
// Quando a troca fecha a favor do cliente, a loja devolve a diferença — e a
// escolha entre dinheiro da gaveta e crédito na conta é negociada no balcão,
// caso a caso. Essa decisão não fica gravada em lugar nenhum.
//
// Então ela é perguntada aqui, uma vez por devolução. São ~6 por mês.
//
// O ganho sobre automatizar: fica registrado QUEM decidiu e QUANDO, em vez de
// o sistema supor. E o dia em que o PDV passar a perguntar no balcão, esta
// lista simplesmente fica vazia.

type Decisao = { destino: string; decidido_em: string; observacao: string | null }
type Devolucao = {
  id: string; data: string; terminal: string | null; valor: number
  cliente: string | null; podeCredito: boolean; decisao: Decisao | null
}

function brl(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function quando(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default function DevolucoesClient() {
  const [pendentes, setPendentes] = useState<Devolucao[]>([])
  const [decididas, setDecididas] = useState<Devolucao[]>([])
  const [desde, setDesde] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')

  async function carregar() {
    setCarregando(true)
    try {
      const r = await fetch('/api/financeiro/devolucoes')
      const j = await r.json()
      if (!j.ok) throw new Error(j.erro)
      setPendentes(j.pendentes); setDecididas(j.decididas); setDesde(j.desde)
    } catch (e: any) { setErro(e?.message ?? 'Erro ao carregar.') }
    finally { setCarregando(false) }
  }

  useEffect(() => { carregar() }, [])

  async function decidir(vendaId: string, destino: 'dinheiro' | 'credito') {
    setOcupado(vendaId); setErro('')
    try {
      const r = await fetch('/api/financeiro/devolucoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendaId, destino }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.erro)
      carregar()
    } catch (e: any) { setErro(e?.message ?? 'Erro ao registrar.') }
    finally { setOcupado('') }
  }

  if (carregando) return <p className="text-sm text-slate-400">Carregando…</p>

  if (!desde) {
    return (
      <p className="text-sm text-slate-500 bg-white border border-slate-100 rounded-xl p-4">
        O lançamento automático de vendas ainda não foi ligado, então não há devoluções a
        resolver.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <p className="text-sm text-red-800">{erro}</p>
        </div>
      )}

      {pendentes.length === 0 ? (
        <p className="text-sm text-slate-500 bg-white border border-slate-100 rounded-xl p-4">
          Nenhuma devolução esperando decisão.
        </p>
      ) : (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-1">
            A resolver ({pendentes.length})
          </h2>
          <p className="text-xs text-slate-500 mb-2">
            Enquanto não decidir, esse valor não sai do caixa — e o saldo fica maior do que o
            dinheiro que está na gaveta.
          </p>
          <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-50">
            {pendentes.map(d => (
              <div key={d.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800">
                      <strong>{brl(d.valor)}</strong> devolvidos
                      <span className="text-slate-400"> · {quando(d.data)}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {d.terminal ?? 'sem terminal'}
                      {d.cliente && ` · ${d.cliente}`}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => decidir(d.id, 'dinheiro')} disabled={!!ocupado}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-xs font-medium rounded-lg">
                      {ocupado === d.id ? '…' : 'Saiu da gaveta'}
                    </button>
                    {d.podeCredito ? (
                      <button onClick={() => decidir(d.id, 'credito')} disabled={!!ocupado}
                        className="px-3 py-1.5 border border-slate-300 hover:border-slate-400 disabled:opacity-50 text-xs font-medium rounded-lg">
                        Virou crédito
                      </button>
                    ) : (
                      // Sem cliente identificado não há a quem creditar. Mostrar
                      // o botão desabilitado com o motivo evita a pergunta
                      // "por que não funciona?".
                      <span className="px-3 py-1.5 text-xs text-slate-400 border border-slate-200 rounded-lg"
                        title="Venda sem cliente identificado">
                        crédito indisponível
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {decididas.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Já resolvidas</h2>
          <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-50">
            {decididas.map(d => (
              <div key={d.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <span className="text-sm text-slate-700">
                  {brl(d.valor)}
                  <span className="text-slate-400"> · {quando(d.data)} · {d.terminal ?? '—'}</span>
                </span>
                <span className={`text-xs font-medium flex-shrink-0 ${
                  d.decisao!.destino === 'dinheiro' ? 'text-slate-700' : 'text-blue-700'
                }`}>
                  {d.decisao!.destino === 'dinheiro' ? 'saiu da gaveta' : 'virou crédito'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
