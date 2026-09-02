'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import AskVargas from '@/components/dashboard/AskVargas'
import { agenteUtilizavel } from '@/lib/ia/agentes'

// OS AGENTES DA EMPRESA — contratar, instruir e conversar.
//
// A empresa NAO cria agente: escolhe do catalogo publicado pelo dono da
// plataforma. O que o gestor escreve sao as REGRAS DO NEGOCIO dele, que o
// servidor soma DEPOIS das instrucoes do catalogo — nunca no lugar delas.

export type AgenteNaVitrine = {
  id: string
  nome: string
  area: string
  descricao: string | null
  icone: string | null
  preco_mensal: number
  /** Da oferta do plano desta empresa. Nulo = não oferecido no plano. */
  oferta: { incluso: boolean; dias_carencia: number } | null
  /** O contrato desta empresa, quando existe. */
  contrato: {
    status: 'teste' | 'ativo' | 'cancelado'
    instrucoes: string | null
    teste_ate: string | null
  } | null
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function AgentesClient({ agentes }: { agentes: AgenteNaVitrine[] }) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [editandoInstrucoes, setEditandoInstrucoes] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState('')
  const [conversando, setConversando] = useState<string | null>(null)

  async function acao(agenteId: string, tipo: 'contratar' | 'assinar' | 'cancelar' | 'instrucoes', instrucoes?: string) {
    setOcupado(agenteId); setErro(''); setAviso('')
    try {
      const r = await fetch('/api/agentes/contratar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: tipo, agenteId, instrucoes }),
      }).then(x => x.json())
      if (!r?.ok) { setErro(r?.erro ?? 'Não foi possível concluir.'); return }
      if (r.aviso) setAviso(r.aviso)
      setEditandoInstrucoes(null)
      router.refresh()
    } finally {
      setOcupado(null)
    }
  }

  const contratados = agentes.filter(a => a.contrato && a.contrato.status !== 'cancelado')
  const disponiveis = agentes.filter(a => !contratados.includes(a))

  return (
    <div className="space-y-6">
      {erro && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {aviso && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{aviso}</p>}

      {contratados.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-gray-800">Seus agentes</h2>
          <div className="space-y-3">
            {contratados.map(a => {
              const uso = agenteUtilizavel(a.contrato!)
              return (
                <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">
                        <span className="mr-1.5 text-base">{a.icone}</span>{a.nome}
                        <span className="ml-2 text-xs font-normal capitalize text-gray-500">{a.area}</span>
                      </p>
                      {a.descricao && <p className="mt-0.5 text-xs text-gray-500">{a.descricao}</p>}

                      {/* O PRAZO APARECE ENQUANTO SE USA, e não no dia em que
                          para de funcionar. */}
                      {uso.emTeste && uso.pode && (
                        <p className="mt-1.5 inline-block rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                          Período de teste — {uso.diasRestantes} dia(s) restante(s).
                          {a.preco_mensal > 0 && <> Depois disso, {brl(a.preco_mensal)}/mês.</>}
                        </p>
                      )}
                      {!uso.pode && (
                        <p className="mt-1.5 inline-block rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
                          {uso.motivo}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {uso.pode && (
                        <button onClick={() => setConversando(conversando === a.id ? null : a.id)}
                          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500">
                          {conversando === a.id ? 'fechar' : `falar com ${a.nome}`}
                        </button>
                      )}
                      {(uso.emTeste || !uso.pode) && a.preco_mensal > 0 && (
                        <button onClick={() => void acao(a.id, 'assinar')} disabled={ocupado === a.id}
                          className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50">
                          contratar por {brl(a.preco_mensal)}/mês
                        </button>
                      )}
                      <button onClick={() => { setEditandoInstrucoes(a.id); setRascunho(a.contrato?.instrucoes ?? '') }}
                        className="text-[11px] text-blue-600 hover:underline">instruções</button>
                      <button onClick={() => { if (confirm(`Cancelar ${a.nome}?`)) void acao(a.id, 'cancelar') }}
                        className="text-[11px] text-gray-400 hover:text-red-600">cancelar</button>
                    </div>
                  </div>

                  {editandoInstrucoes === a.id && (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      <p className="mb-1 text-xs font-medium text-gray-700">O que {a.nome} precisa saber do seu negócio</p>
                      <p className="mb-2 text-[11px] leading-5 text-gray-500">
                        Escreva as suas regras — &quot;margem abaixo de 12% é crítica&quot;, &quot;me avise sobre
                        fornecedor com mais de 30 dias de atraso&quot;. Elas orientam as respostas, mas não
                        mudam de onde vem o dado nem autorizam o agente a afirmar o que não conferiu.
                      </p>
                      <textarea rows={4} value={rascunho} onChange={e => setRascunho(e.target.value)}
                        maxLength={4000}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                      <div className="mt-2 flex justify-end gap-2">
                        <button onClick={() => setEditandoInstrucoes(null)}
                          className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700">cancelar</button>
                        <button onClick={() => void acao(a.id, 'instrucoes', rascunho)} disabled={ocupado === a.id}
                          className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                          salvar
                        </button>
                      </div>
                    </div>
                  )}

                  {conversando === a.id && uso.pode && (
                    <div className="mt-3">
                      <AskVargas
                        context={{ agenteId: a.id }}
                        endpoint="/api/agentes/perguntar"
                        descricao={`${a.nome} responde sobre ${a.area} consultando os dados da sua empresa.`}
                        exemplo={`Ex.: pergunte algo sobre ${a.area}`}
                        perguntasSugeridas={[]}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-1 text-sm font-semibold text-gray-800">
          {contratados.length > 0 ? 'Outros agentes' : 'Agentes disponíveis'}
        </h2>
        <p className="mb-3 text-xs text-gray-500">
          Cada agente responde sobre a área dele, consultando os dados da sua empresa.
        </p>

        {disponiveis.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500">
            Nenhum agente disponível no seu plano no momento.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {disponiveis.map(a => (
              <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-sm font-semibold text-gray-900">
                  <span className="mr-1.5 text-base">{a.icone}</span>{a.nome}
                  <span className="ml-2 text-xs font-normal capitalize text-gray-500">{a.area}</span>
                </p>
                {a.descricao && <p className="mt-1 text-xs leading-5 text-gray-500">{a.descricao}</p>}

                <p className="mt-2 text-xs text-gray-700">
                  {a.oferta?.incluso
                    ? <span className="font-medium text-green-700">Incluso no seu plano</span>
                    : a.preco_mensal > 0
                      ? <><b>{brl(a.preco_mensal)}</b>/mês</>
                      : 'Sem custo adicional'}
                  {/* A carência aparece ANTES de ativar, não depois. */}
                  {a.oferta && !a.oferta.incluso && a.oferta.dias_carencia > 0 && (
                    <span className="ml-1 text-blue-700">
                      · {a.oferta.dias_carencia} dias de teste
                      {a.contrato && <span className="text-gray-400"> (já usados)</span>}
                    </span>
                  )}
                </p>

                {a.oferta ? (
                  <button onClick={() => void acao(a.id, 'contratar')} disabled={ocupado === a.id}
                    className="mt-3 w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                    {ocupado === a.id ? 'ativando…'
                      : a.oferta.incluso ? 'ativar'
                      : a.oferta.dias_carencia > 0 && !a.contrato ? `testar por ${a.oferta.dias_carencia} dias`
                      : 'contratar'}
                  </button>
                ) : (
                  <p className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[11px] text-gray-500">
                    Não disponível no seu plano.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
