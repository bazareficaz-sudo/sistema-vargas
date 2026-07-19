'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Automacao, Canal, ProdutoRef } from './AutomacoesClient'
import BuscaProdutosMulti from './BuscaProdutosMulti'
import BuscaCliente from './BuscaCliente'

const TIPOS = [
  { id: 'whatsapp_relatorio_diario', icone: '📊', label: 'Relatório diário' },
  { id: 'whatsapp_pedido_cliente', icone: '🧾', label: 'Pedido ao cliente' },
  { id: 'whatsapp_alerta_produto', icone: '📦', label: 'Alerta de venda de produto' },
  { id: 'whatsapp_alerta_pedido_marketplace', icone: '🏪', label: 'Alerta de pedido marketplace' },
  { id: 'whatsapp_estoque_baixo', icone: '📉', label: 'Alerta de estoque baixo' },
  { id: 'whatsapp_conta_receber', icone: '💰', label: 'Contas a receber vencendo' },
  { id: 'whatsapp_conta_pagar', icone: '💳', label: 'Contas a pagar vencendo' },
] as const

type TipoWpp = typeof TIPOS[number]['id']

const RELATORIOS = [
  { id: 'vendas_dia', label: 'Vendas do dia' },
  { id: 'estoque_baixo', label: 'Estoque baixo' },
  { id: 'contas_receber', label: 'Contas a receber' },
  { id: 'contas_pagar', label: 'Contas a pagar' },
  { id: 'resumo_geral', label: 'Resumo geral' },
]

const FORM_VAZIO = {
  tipo: 'whatsapp_relatorio_diario' as TipoWpp,
  nome: '',
  observacao: '',
  numero_destino: '',
  horario_envio: '18:00',
  tipo_relatorio: 'vendas_dia',
  dias_alerta: '3',
  limite_estoque: '0',
  produtos: [] as ProdutoRef[],
  cliente_id: null as string | null,
  cliente_nome: '',
  marketplace_canal_id: '',
  ativa: true,
}

function icone(tipo: string) { return TIPOS.find(t => t.id === tipo)?.icone ?? '💬' }
function labelTipo(tipo: string) { return TIPOS.find(t => t.id === tipo)?.label ?? tipo }
function fmtData(v: string | null) { return v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null }

function resumoRegra(a: Automacao) {
  switch (a.tipo) {
    case 'whatsapp_relatorio_diario': {
      const rel = RELATORIOS.find(r => r.id === a.tipo_relatorio)?.label ?? a.tipo_relatorio
      return `${rel} · todo dia às ${a.horario_envio} · pra ${a.numero_destino}`
    }
    case 'whatsapp_pedido_cliente':
      return `Envia ao WhatsApp de ${a.cliente_nome} quando ele comprar`
    case 'whatsapp_alerta_produto':
      return `${(a.produtos ?? []).map(p => p.produto_nome).join(', ') || 'produto(s)'} · pra ${a.numero_destino}`
    case 'whatsapp_alerta_pedido_marketplace':
      return `Pedidos novos do canal · pra ${a.numero_destino}`
    case 'whatsapp_estoque_baixo':
      return `${Number(a.limite_estoque) > 0 ? `Limite: ${a.limite_estoque}` : 'Usa o mínimo de cada produto'} · pra ${a.numero_destino}`
    case 'whatsapp_conta_receber':
      return `${a.dias_alerta} dia(s) de antecedência · pra ${a.numero_destino}`
    case 'whatsapp_conta_pagar':
      return `${a.dias_alerta} dia(s) de antecedência · pra ${a.numero_destino}`
    default:
      return ''
  }
}

export default function RegrasWhatsApp({ empresaId, canais, automacoes, onChange }: {
  empresaId: string; canais: Canal[]; automacoes: Automacao[]; onChange: (novas: Automacao[]) => void
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
      tipo: a.tipo as TipoWpp,
      nome: a.nome,
      observacao: a.observacao ?? '',
      numero_destino: a.numero_destino ?? '',
      horario_envio: a.horario_envio ?? '18:00',
      tipo_relatorio: a.tipo_relatorio ?? 'vendas_dia',
      dias_alerta: a.dias_alerta != null ? String(a.dias_alerta) : '3',
      limite_estoque: a.limite_estoque != null ? String(a.limite_estoque) : '0',
      produtos: a.produtos ?? [],
      cliente_id: a.cliente_id,
      cliente_nome: a.cliente_nome ?? '',
      marketplace_canal_id: a.marketplace_canal_id ?? '',
      ativa: a.ativa,
    })
    setErro('')
    setModal(true)
  }

  function nomeSugerido(): string {
    switch (form.tipo) {
      case 'whatsapp_relatorio_diario': return `Relatório ${RELATORIOS.find(r => r.id === form.tipo_relatorio)?.label ?? ''} às ${form.horario_envio}`
      case 'whatsapp_pedido_cliente': return `Enviar pedido a ${form.cliente_nome || 'cliente'}`
      case 'whatsapp_alerta_produto': return `Alertar venda de ${form.produtos.length || ''} produto(s)`.replace('  ', ' ')
      case 'whatsapp_alerta_pedido_marketplace': return `Alertar pedido de ${canais.find(c => c.id === form.marketplace_canal_id)?.nome ?? 'marketplace'}`
      case 'whatsapp_estoque_baixo': return 'Alerta de estoque baixo'
      case 'whatsapp_conta_receber': return `Lembrete de contas a receber (${form.dias_alerta}d)`
      case 'whatsapp_conta_pagar': return `Lembrete de contas a pagar (${form.dias_alerta}d)`
      default: return 'Nova automação'
    }
  }

  function precisaDestino() {
    return form.tipo !== 'whatsapp_pedido_cliente'
  }

  function validar(): string {
    if (precisaDestino() && form.numero_destino.replace(/\D/g, '').length < 10) return 'Informe um WhatsApp de destino válido (com DDD).'
    if (form.tipo === 'whatsapp_relatorio_diario' && !form.horario_envio) return 'Informe o horário de envio.'
    if (form.tipo === 'whatsapp_pedido_cliente' && !form.cliente_id) return 'Selecione o cliente.'
    if (form.tipo === 'whatsapp_alerta_produto' && form.produtos.length === 0) return 'Selecione pelo menos 1 produto.'
    if (form.tipo === 'whatsapp_alerta_pedido_marketplace' && !form.marketplace_canal_id) return 'Selecione o canal do marketplace.'
    if ((form.tipo === 'whatsapp_conta_receber' || form.tipo === 'whatsapp_conta_pagar') && (!form.dias_alerta || parseInt(form.dias_alerta) < 0)) return 'Informe os dias de antecedência.'
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
      numero_destino: precisaDestino() ? form.numero_destino.replace(/\D/g, '') : null,
      horario_envio: ['whatsapp_relatorio_diario', 'whatsapp_estoque_baixo', 'whatsapp_conta_receber', 'whatsapp_conta_pagar'].includes(form.tipo) ? form.horario_envio : null,
      tipo_relatorio: form.tipo === 'whatsapp_relatorio_diario' ? form.tipo_relatorio : null,
      dias_alerta: (form.tipo === 'whatsapp_conta_receber' || form.tipo === 'whatsapp_conta_pagar') ? parseInt(form.dias_alerta) || 0 : null,
      limite_estoque: form.tipo === 'whatsapp_estoque_baixo' ? parseFloat(form.limite_estoque) || 0 : null,
      produtos: form.tipo === 'whatsapp_alerta_produto' ? form.produtos : null,
      cliente_id: form.tipo === 'whatsapp_pedido_cliente' ? form.cliente_id : null,
      cliente_nome: form.tipo === 'whatsapp_pedido_cliente' ? form.cliente_nome : null,
      marketplace_canal_id: form.tipo === 'whatsapp_alerta_pedido_marketplace' ? (form.marketplace_canal_id || null) : null,
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
        <p className="text-sm text-gray-500">{automacoes.length} regra(s) de WhatsApp cadastrada(s).</p>
        <button onClick={abrirNova} className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg">+ Nova regra</button>
      </div>

      {automacoes.length === 0 ? (
        <div className="py-10 text-center border border-dashed border-gray-200 rounded-xl">
          <p className="text-3xl mb-2">💬</p>
          <p className="text-gray-600 text-sm font-medium">Nenhuma regra de WhatsApp ainda</p>
          <p className="text-gray-400 text-xs mt-1">Configure relatórios, alertas de venda e lembretes automáticos.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {automacoes.map(a => (
            <div key={a.id} className="border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-xl flex-shrink-0">{icone(a.tipo)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900 text-sm">{a.nome}</p>
                  <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full border border-green-200">{labelTipo(a.tipo)}</span>
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
              <h2 className="text-lg font-semibold text-gray-900">{editando ? 'Editar regra de WhatsApp' : 'Nova regra de WhatsApp'}</h2>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {!editando && (
                <div>
                  <p className="text-xs font-semibold text-gray-700 mb-2">Tipo de automação</p>
                  <div className="grid grid-cols-1 gap-1.5">
                    {TIPOS.map(t => (
                      <label key={t.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${form.tipo === t.id ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <input type="radio" name="tipoWpp" checked={form.tipo === t.id} onChange={() => f('tipo', t.id)} className="accent-green-600" />
                        <span>{t.icone}</span>
                        <span className="text-gray-700">{t.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {form.tipo === 'whatsapp_relatorio_diario' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Conteúdo do relatório</label>
                  <select value={form.tipo_relatorio} onChange={e => f('tipo_relatorio', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500">
                    {RELATORIOS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </div>
              )}

              {form.tipo === 'whatsapp_pedido_cliente' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Cliente</label>
                  <BuscaCliente empresaId={empresaId} clienteId={form.cliente_id} clienteNome={form.cliente_nome}
                    onChange={(id, nome) => { f('cliente_id', id); f('cliente_nome', nome) }} />
                </div>
              )}

              {form.tipo === 'whatsapp_alerta_produto' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Produtos</label>
                  <BuscaProdutosMulti empresaId={empresaId} selecionados={form.produtos} onChange={p => f('produtos', p)} />
                </div>
              )}

              {form.tipo === 'whatsapp_alerta_pedido_marketplace' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Canal do marketplace</label>
                  <select value={form.marketplace_canal_id} onChange={e => f('marketplace_canal_id', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500">
                    <option value="">Selecione um canal</option>
                    {canais.map(c => <option key={c.id} value={c.id}>{c.nome} ({c.plataforma})</option>)}
                  </select>
                  {canais.length === 0 && <p className="text-xs text-gray-400 mt-1">Nenhum canal de marketplace conectado.</p>}
                </div>
              )}

              {form.tipo === 'whatsapp_estoque_baixo' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Limite de estoque</label>
                  <input type="number" value={form.limite_estoque} onChange={e => f('limite_estoque', e.target.value)}
                    placeholder="0 = usa o mínimo cadastrado em cada produto"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
                  <p className="text-[10px] text-gray-400 mt-1">0 = considera o estoque mínimo já cadastrado em cada produto.</p>
                </div>
              )}

              {(form.tipo === 'whatsapp_conta_receber' || form.tipo === 'whatsapp_conta_pagar') && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Dias de antecedência</label>
                  <input type="number" value={form.dias_alerta} onChange={e => f('dias_alerta', e.target.value)}
                    placeholder="Ex: 3"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
                </div>
              )}

              {['whatsapp_relatorio_diario', 'whatsapp_estoque_baixo', 'whatsapp_conta_receber', 'whatsapp_conta_pagar'].includes(form.tipo) && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Horário de checagem</label>
                  <input type="time" value={form.horario_envio} onChange={e => f('horario_envio', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
                </div>
              )}

              {precisaDestino() && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">WhatsApp de destino</label>
                  <input value={form.numero_destino} onChange={e => f('numero_destino', e.target.value)}
                    placeholder="(21) 99999-9999"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nome da regra</label>
                <input value={form.nome} onChange={e => f('nome', e.target.value)}
                  placeholder={nomeSugerido()}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Observação (opcional)</label>
                <textarea value={form.observacao} onChange={e => f('observacao', e.target.value)} rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={form.ativa} onChange={e => f('ativa', e.target.checked)} className="w-4 h-4 accent-green-600" />
                Regra ativa
              </label>

              {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setModal(false)} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={salvar} disabled={salvando}
                className="px-5 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {salvando ? 'Salvando...' : 'Salvar regra'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
