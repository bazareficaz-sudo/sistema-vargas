'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Automacao, ProdutoRef } from './AutomacoesClient'
import BuscaProdutosMulti from './BuscaProdutosMulti'

const TIPOS = [
  { id: 'alerta_margem_baixa', icone: '📉', label: 'Queda de margem' },
  { id: 'alerta_produto_parado', icone: '🐌', label: 'Produto parado / sem giro' },
  { id: 'alerta_inadimplencia', icone: '⚠️', label: 'Inadimplência (crediário)' },
  { id: 'alerta_meta_vendas', icone: '🎯', label: 'Meta de vendas' },
] as const

type TipoAlerta = typeof TIPOS[number]['id']

const FORM_VAZIO = {
  tipo: 'alerta_margem_baixa' as TipoAlerta,
  nome: '',
  observacao: '',
  numero_destino: '',
  horario_envio: '18:00',
  dias_alerta: '15',
  limite_estoque: '25',
  produtos: [] as ProdutoRef[],
  ativa: true,
}

function icone(tipo: string) { return TIPOS.find(t => t.id === tipo)?.icone ?? '🔔' }
function labelTipo(tipo: string) { return TIPOS.find(t => t.id === tipo)?.label ?? tipo }
function fmtData(v: string | null) { return v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null }
function fmtMoeda(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

function resumoRegra(a: Automacao) {
  const escopo = (a.produtos ?? []).length > 0 ? `${a.produtos!.length} produto(s) selecionado(s)` : 'todos os produtos'
  switch (a.tipo) {
    case 'alerta_margem_baixa':
      return `Margem < ${a.limite_estoque}% · ${escopo} · pra ${a.numero_destino}`
    case 'alerta_produto_parado':
      return `Sem venda há ${a.dias_alerta}+ dias · ${escopo} · pra ${a.numero_destino}`
    case 'alerta_inadimplencia':
      return `Atraso de ${a.dias_alerta}+ dias · pra ${a.numero_destino}`
    case 'alerta_meta_vendas':
      return `Vendas do dia < ${fmtMoeda(Number(a.limite_estoque ?? 0))} · pra ${a.numero_destino}`
    default:
      return ''
  }
}

export default function RegrasAlertas({ empresaId, automacoes, onChange }: {
  empresaId: string; automacoes: Automacao[]; onChange: (novas: Automacao[]) => void
}) {
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<Automacao | null>(null)
  const [form, setForm] = useState(FORM_VAZIO)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  function f(k: string, v: any) { setForm(p => ({ ...p, [k]: v })) }

  function abrirNova() {
    setEditando(null)
    setForm(FORM_VAZIO)
    setErro('')
    setModal(true)
  }

  function abrirEdicao(a: Automacao) {
    setEditando(a)
    setForm({
      tipo: a.tipo as TipoAlerta,
      nome: a.nome,
      observacao: a.observacao ?? '',
      numero_destino: a.numero_destino ?? '',
      horario_envio: a.horario_envio ?? '18:00',
      dias_alerta: a.dias_alerta != null ? String(a.dias_alerta) : '15',
      limite_estoque: a.limite_estoque != null ? String(a.limite_estoque) : '25',
      produtos: a.produtos ?? [],
      ativa: a.ativa,
    })
    setErro('')
    setModal(true)
  }

  function nomeSugerido(): string {
    switch (form.tipo) {
      case 'alerta_margem_baixa': return `Alerta de margem < ${form.limite_estoque}%`
      case 'alerta_produto_parado': return `Produto parado há ${form.dias_alerta}+ dias`
      case 'alerta_inadimplencia': return `Inadimplência acima de ${form.dias_alerta} dias`
      case 'alerta_meta_vendas': return `Meta de vendas diária: ${fmtMoeda(parseFloat(form.limite_estoque) || 0)}`
      default: return 'Nova automação'
    }
  }

  function validar(): string {
    if (form.numero_destino.replace(/\D/g, '').length < 10) return 'Informe um WhatsApp de destino válido (com DDD).'
    if (!form.horario_envio) return 'Informe o horário de checagem.'
    if (form.tipo === 'alerta_margem_baixa' && (!form.limite_estoque || parseFloat(form.limite_estoque) <= 0)) return 'Informe um percentual de margem mínima maior que zero.'
    if (form.tipo === 'alerta_produto_parado' && (!form.dias_alerta || parseInt(form.dias_alerta) <= 0)) return 'Informe uma quantidade de dias maior que zero.'
    if (form.tipo === 'alerta_inadimplencia' && (form.dias_alerta === '' || parseInt(form.dias_alerta) < 0)) return 'Informe os dias de atraso.'
    if (form.tipo === 'alerta_meta_vendas' && (!form.limite_estoque || parseFloat(form.limite_estoque) <= 0)) return 'Informe uma meta de vendas maior que zero.'
    return ''
  }

  async function salvar() {
    const erroValidacao = validar()
    if (erroValidacao) { setErro(erroValidacao); return }
    setSalvando(true); setErro('')
    const sb = createClient()

    const payload = {
      empresa_id: empresaId,
      nome: form.nome.trim() || nomeSugerido(),
      tipo: form.tipo,
      ativa: form.ativa,
      observacao: form.observacao || null,
      numero_destino: form.numero_destino.replace(/\D/g, ''),
      horario_envio: form.horario_envio,
      dias_alerta: (form.tipo === 'alerta_produto_parado' || form.tipo === 'alerta_inadimplencia') ? parseInt(form.dias_alerta) || 0 : null,
      limite_estoque: (form.tipo === 'alerta_margem_baixa' || form.tipo === 'alerta_meta_vendas') ? parseFloat(form.limite_estoque) || 0 : null,
      produtos: (form.tipo === 'alerta_margem_baixa' || form.tipo === 'alerta_produto_parado') ? form.produtos : null,
      updated_at: new Date().toISOString(),
    }

    if (editando) {
      const { data, error } = await sb.from('automacoes').update(payload).eq('id', editando.id).select().single()
      if (error) { setErro(error.message); setSalvando(false); return }
      onChange([data, ...automacoes.filter(a => a.id !== editando.id)])
    } else {
      const { data, error } = await sb.from('automacoes').insert(payload).select().single()
      if (error) { setErro(error.message); setSalvando(false); return }
      onChange([data, ...automacoes])
    }

    setSalvando(false)
    setModal(false)
  }

  async function excluir(a: Automacao) {
    if (!confirm(`Excluir a automação "${a.nome}"?`)) return
    const sb = createClient()
    await sb.from('automacoes').delete().eq('id', a.id)
    onChange(automacoes.filter(x => x.id !== a.id))
  }

  async function alternarAtiva(a: Automacao) {
    const sb = createClient()
    await sb.from('automacoes').update({ ativa: !a.ativa }).eq('id', a.id)
    onChange(automacoes.map(x => x.id === a.id ? { ...x, ativa: !x.ativa } : x))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{automacoes.length} regra(s) de alerta cadastrada(s).</p>
        <button onClick={abrirNova} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg">+ Nova regra</button>
      </div>

      {automacoes.length === 0 ? (
        <div className="py-10 text-center border border-dashed border-gray-200 rounded-xl">
          <p className="text-3xl mb-2">🔔</p>
          <p className="text-gray-600 text-sm font-medium">Nenhum alerta configurado ainda</p>
          <p className="text-gray-400 text-xs mt-1">Fique de olho em margem, produtos parados, inadimplência e meta de vendas.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {automacoes.map(a => (
            <div key={a.id} className="border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-xl flex-shrink-0">{icone(a.tipo)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900 text-sm">{a.nome}</p>
                  <span className="text-[10px] bg-red-50 text-red-700 px-1.5 py-0.5 rounded-full border border-red-200">{labelTipo(a.tipo)}</span>
                  {!a.ativa && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">inativa</span>}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{resumoRegra(a)}</p>
                <p className="text-[10px] text-gray-400 mt-1">
                  {a.ultima_execucao ? `Última execução: ${fmtData(a.ultima_execucao)} · ${a.total_execucoes}x` : 'Ainda não executada'}
                  {a.ultimo_status === 'erro' && a.ultimo_erro && <span className="text-red-500"> · {a.ultimo_erro}</span>}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => alternarAtiva(a)}
                  className={`w-9 h-5 rounded-full transition-colors relative ${a.ativa ? 'bg-green-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${a.ativa ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
                <button onClick={() => abrirEdicao(a)} className="text-gray-400 hover:text-gray-600 text-xs px-1.5">✏️</button>
                <button onClick={() => excluir(a)} className="text-red-400 hover:text-red-600 text-xs px-1.5">🗑️</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
              <h2 className="text-lg font-semibold text-gray-900">{editando ? 'Editar alerta' : 'Novo alerta'}</h2>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {!editando && (
                <div>
                  <p className="text-xs font-semibold text-gray-700 mb-2">Tipo de alerta</p>
                  <div className="grid grid-cols-1 gap-1.5">
                    {TIPOS.map(t => (
                      <label key={t.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${form.tipo === t.id ? 'border-red-500 bg-red-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <input type="radio" name="tipoAlerta" checked={form.tipo === t.id} onChange={() => f('tipo', t.id)} className="accent-red-600" />
                        <span>{t.icone}</span>
                        <span className="text-gray-700">{t.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {form.tipo === 'alerta_margem_baixa' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Margem mínima (%)</label>
                  <input type="number" value={form.limite_estoque} onChange={e => f('limite_estoque', e.target.value)}
                    placeholder="Ex: 25"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500" />
                  <p className="text-[10px] text-gray-400 mt-1">Avisa quando a margem (preço - custo) / custo ficar abaixo disso.</p>
                </div>
              )}

              {form.tipo === 'alerta_produto_parado' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Dias sem venda</label>
                  <input type="number" value={form.dias_alerta} onChange={e => f('dias_alerta', e.target.value)}
                    placeholder="Ex: 30"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500" />
                </div>
              )}

              {(form.tipo === 'alerta_margem_baixa' || form.tipo === 'alerta_produto_parado') && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Produtos (opcional)</label>
                  <BuscaProdutosMulti empresaId={empresaId} selecionados={form.produtos} onChange={p => f('produtos', p)} />
                  <p className="text-[10px] text-gray-400 mt-1">Vazio = considera todos os produtos.</p>
                </div>
              )}

              {form.tipo === 'alerta_inadimplencia' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Dias de atraso</label>
                  <input type="number" value={form.dias_alerta} onChange={e => f('dias_alerta', e.target.value)}
                    placeholder="Ex: 15"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500" />
                </div>
              )}

              {form.tipo === 'alerta_meta_vendas' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Meta de vendas do dia (R$)</label>
                  <input type="number" step="0.01" value={form.limite_estoque} onChange={e => f('limite_estoque', e.target.value)}
                    placeholder="Ex: 2000"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500" />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Horário de checagem</label>
                <input type="time" value={form.horario_envio} onChange={e => f('horario_envio', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">WhatsApp de destino</label>
                <input value={form.numero_destino} onChange={e => f('numero_destino', e.target.value)}
                  placeholder="(21) 99999-9999"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nome da regra</label>
                <input value={form.nome} onChange={e => f('nome', e.target.value)}
                  placeholder={nomeSugerido()}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Observação (opcional)</label>
                <textarea value={form.observacao} onChange={e => f('observacao', e.target.value)} rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500" />
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={form.ativa} onChange={e => f('ativa', e.target.checked)} className="w-4 h-4 accent-red-600" />
                Regra ativa
              </label>

              {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setModal(false)} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={salvar} disabled={salvando}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {salvando ? 'Salvando...' : 'Salvar regra'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
