'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AREAS, CATALOGO, consultasDesconhecidas, type AgenteCatalogo } from '@/lib/ia/agentes'

// CRIAR AGENTES — só aqui.
//
// Decisão de produto de 02/09/2026: a empresa cliente NÃO cria agente, só
// contrata. Um agente é um recorte do catálogo de consultas mais um prompt;
// deixar o cliente montar o próprio significa deixar ele montar um agente
// ruim — que responde mal e é cobrado do sistema, não de quem o montou.

type Plano = { id: string; nome: string }
type PlanoAgente = { plan_id: string; agente_id: string; incluso: boolean; dias_carencia: number }

const VAZIO = {
  codigo: '', nome: '', area: 'vendas', descricao: '', icone: '🤖',
  instrucoes_base: '', consultas: [] as string[], preco_mensal: 0,
  publicado: false, ativo: true, ordem: 0,
}

export default function AgentesAdminClient({
  agentes: iniciais, planos, planoAgentes: vinculosIniciais, contratados,
}: {
  agentes: AgenteCatalogo[]
  planos: Plano[]
  planoAgentes: PlanoAgente[]
  /** Quantas empresas contrataram cada agente — para não apagar o que está em uso. */
  contratados: Record<string, number>
}) {
  const router = useRouter()
  const sb = createClient()
  const [editando, setEditando] = useState<Partial<AgenteCatalogo> | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [vinculos, setVinculos] = useState(vinculosIniciais)

  async function salvar() {
    if (!editando?.codigo?.trim() || !editando.nome?.trim()) {
      setErro('Código e nome são obrigatórios.'); return
    }
    setSalvando(true); setErro('')
    const dados = {
      codigo: editando.codigo.trim(), nome: editando.nome.trim(),
      area: editando.area, descricao: editando.descricao ?? null,
      icone: editando.icone ?? null,
      instrucoes_base: editando.instrucoes_base ?? '',
      consultas: editando.consultas ?? [],
      preco_mensal: Number(editando.preco_mensal ?? 0),
      publicado: !!editando.publicado, ativo: editando.ativo !== false,
      updated_at: new Date().toISOString(),
    }
    const { error } = editando.id
      ? await sb.from('ia_agentes').update(dados).eq('id', editando.id)
      : await sb.from('ia_agentes').insert(dados)
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setEditando(null)
    router.refresh()
  }

  async function alternarPlano(planId: string, agenteId: string, ligado: boolean) {
    if (ligado) {
      await sb.from('plano_agentes').delete().eq('plan_id', planId).eq('agente_id', agenteId)
      setVinculos(v => v.filter(x => !(x.plan_id === planId && x.agente_id === agenteId)))
    } else {
      const novo = { plan_id: planId, agente_id: agenteId, incluso: false, dias_carencia: 0 }
      await sb.from('plano_agentes').insert(novo)
      setVinculos(v => [...v, novo])
    }
  }

  async function mudarCarencia(planId: string, agenteId: string, dias: number, incluso: boolean) {
    await sb.from('plano_agentes').update({ dias_carencia: dias, incluso })
      .eq('plan_id', planId).eq('agente_id', agenteId)
    setVinculos(v => v.map(x =>
      x.plan_id === planId && x.agente_id === agenteId ? { ...x, dias_carencia: dias, incluso } : x))
  }

  return (
    <div className="p-6 text-slate-200">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Agentes de IA</h1>
          <p className="mt-1 text-sm text-slate-400">
            O catálogo. As empresas contratam daqui — elas não criam agentes.
          </p>
        </div>
        <button onClick={() => setEditando({ ...VAZIO })}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
          + Novo agente
        </button>
      </div>

      {erro && <p className="mb-4 rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-300">{erro}</p>}

      <div className="space-y-3">
        {iniciais.length === 0 && (
          <p className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
            Nenhum agente criado ainda.
          </p>
        )}
        {iniciais.map(a => {
          const desconhecidas = consultasDesconhecidas(a)
          const emUso = contratados[a.id] ?? 0
          return (
            <div key={a.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    <span className="mr-1.5">{a.icone}</span>{a.nome}
                    <span className="ml-2 text-xs font-normal text-slate-500">{a.area} · {a.codigo}</span>
                  </p>
                  {a.descricao && <p className="mt-0.5 text-xs text-slate-400">{a.descricao}</p>}
                  <p className="mt-1.5 text-xs text-slate-500">
                    {a.consultas.length} consulta(s) ·{' '}
                    {a.preco_mensal > 0
                      ? a.preco_mensal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) + '/mês'
                      : 'sem preço definido'}
                    {emUso > 0 && <> · <b className="text-slate-300">{emUso} empresa(s) usando</b></>}
                  </p>

                  {/* CONSULTA CADASTRADA QUE NÃO EXISTE. O agente continua
                      funcionando com as outras — mas quem cadastrou precisa
                      ver o erro aqui, e não o cliente numa resposta estranha. */}
                  {desconhecidas.length > 0 && (
                    <p className="mt-1.5 rounded border border-amber-800 bg-amber-950 px-2 py-1 text-[11px] text-amber-300">
                      Consultas que não existem no código e serão ignoradas: <b>{desconhecidas.join(', ')}</b>
                    </p>
                  )}
                  {a.consultas.length === 0 && (
                    <p className="mt-1.5 rounded border border-amber-800 bg-amber-950 px-2 py-1 text-[11px] text-amber-300">
                      Sem consultas: este agente só conversa, não consulta dado nenhum.
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    a.publicado ? 'border-green-800 bg-green-950 text-green-400' : 'border-slate-700 bg-slate-800 text-slate-400'
                  }`}>
                    {a.publicado ? 'publicado' : 'rascunho'}
                  </span>
                  <button onClick={() => setEditando(a)}
                    className="text-xs text-indigo-400 hover:text-indigo-300">editar</button>
                </div>
              </div>

              {/* Em quais planos, e com que carência. */}
              <div className="mt-3 border-t border-slate-800 pt-3">
                <p className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">Disponível nos planos</p>
                <div className="space-y-1.5">
                  {planos.map(p => {
                    const v = vinculos.find(x => x.plan_id === p.id && x.agente_id === a.id)
                    return (
                      <div key={p.id} className="flex flex-wrap items-center gap-2 text-xs">
                        <label className="flex items-center gap-1.5">
                          <input type="checkbox" checked={!!v}
                            onChange={() => void alternarPlano(p.id, a.id, !!v)}
                            className="h-3.5 w-3.5 accent-indigo-500" />
                          <span className="text-slate-300">{p.nome}</span>
                        </label>
                        {v && (
                          <>
                            <label className="flex items-center gap-1 text-slate-400">
                              <input type="checkbox" checked={v.incluso}
                                onChange={e => void mudarCarencia(p.id, a.id, v.dias_carencia, e.target.checked)}
                                className="h-3.5 w-3.5 accent-green-500" />
                              incluso no plano
                            </label>
                            {!v.incluso && (
                              <label className="flex items-center gap-1 text-slate-400">
                                carência
                                <input type="number" min={0} max={365} value={v.dias_carencia}
                                  onChange={e => void mudarCarencia(p.id, a.id, Number(e.target.value), v.incluso)}
                                  className="w-16 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-slate-200" />
                                dias
                              </label>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  A carência conta a partir da <b>ativação pela empresa</b>, não da assinatura do plano —
                  quem experimenta no sexto mês tem os mesmos dias de quem experimentou no primeiro.
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {editando && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4">
          <div className="my-8 w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="mb-4 text-sm font-semibold text-white">
              {editando.id ? `Editar ${editando.nome}` : 'Novo agente'}
            </h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Nome" valor={editando.nome ?? ''} onChange={v => setEditando(e => ({ ...e, nome: v }))} dica="Gege, Sara, Téo…" />
              <Campo label="Código" valor={editando.codigo ?? ''} onChange={v => setEditando(e => ({ ...e, codigo: v.toLowerCase().replace(/[^a-z0-9_]/g, '') }))} dica="identificador estável; o nome muda, ele não" />
              <div>
                <label className="mb-1 block text-xs text-slate-400">Área</label>
                <select value={editando.area} onChange={e => setEditando(x => ({ ...x, area: e.target.value }))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-200">
                  {AREAS.map(a => <option key={a.codigo} value={a.codigo}>{a.nome}</option>)}
                </select>
              </div>
              <Campo label="Ícone" valor={editando.icone ?? ''} onChange={v => setEditando(e => ({ ...e, icone: v }))} dica="um emoji" />
              <Campo label="Preço mensal (R$)" valor={String(editando.preco_mensal ?? 0)} onChange={v => setEditando(e => ({ ...e, preco_mensal: Number(v) || 0 }))} />
              <Campo label="Descrição" valor={editando.descricao ?? ''} onChange={v => setEditando(e => ({ ...e, descricao: v }))} dica="uma linha, aparece para o cliente" />
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs text-slate-400">Instruções base</label>
              <p className="mb-1.5 text-[11px] text-slate-500">
                Define o comportamento para todos os clientes. As instruções que o gestor escreve entram
                DEPOIS desta e não a substituem.
              </p>
              <textarea rows={5} value={editando.instrucoes_base ?? ''}
                onChange={e => setEditando(x => ({ ...x, instrucoes_base: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-sm text-slate-200" />
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs text-slate-400">Consultas que este agente alcança</label>
              <p className="mb-2 text-[11px] text-slate-500">
                Sem consulta marcada, ele só conversa. Marque só o que a área precisa — agente com acesso
                a tudo responde pior, porque escolhe entre opções demais.
              </p>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-800 p-2">
                {CATALOGO.map(c => {
                  const marcada = (editando.consultas ?? []).includes(c.nome)
                  return (
                    <label key={c.nome} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-slate-800">
                      <input type="checkbox" checked={marcada} className="mt-0.5 h-3.5 w-3.5 accent-indigo-500"
                        onChange={() => setEditando(e => ({
                          ...e,
                          consultas: marcada
                            ? (e?.consultas ?? []).filter(n => n !== c.nome)
                            : [...(e?.consultas ?? []), c.nome],
                        }))} />
                      <span className="min-w-0">
                        <span className="block font-mono text-[11px] text-slate-300">{c.nome}</span>
                        <span className="block text-[11px] text-slate-500">{c.descricao}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="mt-4 flex items-center gap-4 text-xs">
              <label className="flex items-center gap-1.5 text-slate-300">
                <input type="checkbox" checked={!!editando.publicado}
                  onChange={e => setEditando(x => ({ ...x, publicado: e.target.checked }))}
                  className="h-3.5 w-3.5 accent-green-500" />
                publicado — visível para as empresas
              </label>
              <label className="flex items-center gap-1.5 text-slate-300">
                <input type="checkbox" checked={editando.ativo !== false}
                  onChange={e => setEditando(x => ({ ...x, ativo: e.target.checked }))}
                  className="h-3.5 w-3.5 accent-indigo-500" />
                ativo
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => { setEditando(null); setErro('') }}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200">Cancelar</button>
              <button onClick={() => void salvar()} disabled={salvando}
                className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Campo({ label, valor, onChange, dica }: {
  label: string; valor: string; onChange: (v: string) => void; dica?: string
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-400">{label}</label>
      <input value={valor} onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-200" />
      {dica && <p className="mt-0.5 text-[11px] text-slate-500">{dica}</p>}
    </div>
  )
}
