'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Automacao, ProdutoRef } from './AutomacoesClient'
import BuscaProdutosMulti from './BuscaProdutosMulti'
import BuscaCliente from './BuscaCliente'
import { horariosDaRegra, LIMITE_NFE_MARKETPLACE_POR_RODADA } from '@/lib/automacoes/tipos'

const TIPOS = [
  { id: 'emissao_fiscal_marketplace', icone: '🛒', label: 'Pedidos de marketplace (NF-e)' },
  { id: 'emissao_fiscal_produto', icone: '📦', label: 'Por produto' },
  { id: 'emissao_fiscal_forma_pagamento', icone: '💳', label: 'Por forma de pagamento' },
  { id: 'emissao_fiscal_cliente', icone: '👤', label: 'Por cliente' },
] as const

type TipoFiscal = typeof TIPOS[number]['id']

type Canal = { id: string; nome: string; plataforma: string }

const NOME_PLATAFORMA: Record<string, string> = {
  mercadolivre: 'Mercado Livre', shopee: 'Shopee', tiktok: 'TikTok Shop', nuvemshop: 'Nuvemshop', loja_online: 'Loja Online',
}
const nomePlataforma = (p: string) => NOME_PLATAFORMA[p] ?? p

const FORMAS_PAGAMENTO = [
  { id: 'dinheiro', label: 'Dinheiro' },
  { id: 'debito', label: 'Cartão de débito' },
  { id: 'credito', label: 'Cartão de crédito' },
  { id: 'pix', label: 'Pix' },
  { id: 'carteira', label: 'Carteira/crédito loja' },
  { id: 'fiado', label: 'Fiado' },
  { id: 'multiplo', label: 'Múltiplo' },
]

const TIMINGS = [
  { id: 'imediato', label: 'Imediato', descricao: 'Assim que a venda entrar (checagem a cada poucos minutos)' },
  { id: 'hora_em_hora', label: 'De hora em hora', descricao: 'No máximo uma rodada por hora' },
  { id: 'horario_especifico', label: 'Horários marcados', descricao: 'Um ou mais horários por dia (ex.: 10:00 e 14:00, antes de cada coleta)' },
] as const
type Timing = typeof TIMINGS[number]['id']

const FORM_VAZIO = {
  tipo: 'emissao_fiscal_produto' as TipoFiscal,
  nome: '',
  observacao: '',
  produtos: [] as ProdutoRef[],
  forma_pagamento: 'pix',
  cliente_id: null as string | null,
  cliente_nome: '',
  ativa: true,
  timing: 'imediato' as Timing,
  horarios: [''] as string[],
  alertar_erro_whatsapp: '',
  // Pedidos de marketplace: um canal específico, ou todos os canais de um marketplace.
  escopo: 'canal' as 'canal' | 'plataforma',
  marketplace_canal_id: '',
  plataforma: '',
}

function icone(tipo: string) { return TIPOS.find(t => t.id === tipo)?.icone ?? '📄' }
function labelTipo(tipo: string) { return TIPOS.find(t => t.id === tipo)?.label ?? tipo }
function labelForma(f: string) { return FORMAS_PAGAMENTO.find(x => x.id === f)?.label ?? f }
function labelTiming(a: Automacao) {
  if (a.timing === 'hora_em_hora') return '⏱ de hora em hora'
  if (a.timing === 'horario_especifico') return `🕐 às ${horariosDaRegra(a.horario_envio).join(', ') || '--:--'}`
  return '⚡ imediato'
}
function fmtData(v: string | null) { return v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null }

function resumoRegra(a: Automacao, canais: Canal[]) {
  switch (a.tipo) {
    case 'emissao_fiscal_marketplace': {
      const alvo = a.marketplace_canal_id
        ? `do canal ${canais.find(c => c.id === a.marketplace_canal_id)?.nome ?? '(removido)'}`
        : `de todos os canais ${nomePlataforma(a.canal_venda ?? '')}`
      return `Emite NF-e dos pedidos pagos ${alvo}`
    }
    case 'emissao_fiscal_produto':
      return `Emite NFC-e ao vender: ${(a.produtos ?? []).map(p => p.produto_nome).join(', ') || 'produto(s)'}`
    case 'emissao_fiscal_forma_pagamento':
      return `Emite NFC-e quando o pagamento é ${labelForma(a.forma_pagamento ?? '')}`
    case 'emissao_fiscal_cliente':
      return `Emite NFC-e sempre que ${a.cliente_nome} comprar`
    default:
      return ''
  }
}

export default function RegrasFiscais({ empresaId, canais, automacoes, onChange }: {
  empresaId: string; canais: Canal[]; automacoes: Automacao[]; onChange: (novas: Automacao[]) => void
}) {
  const plataformas = [...new Set(canais.map(c => c.plataforma))]
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
      tipo: a.tipo as TipoFiscal,
      nome: a.nome,
      observacao: a.observacao ?? '',
      produtos: a.produtos ?? [],
      forma_pagamento: a.forma_pagamento ?? 'pix',
      cliente_id: a.cliente_id,
      cliente_nome: a.cliente_nome ?? '',
      ativa: a.ativa,
      timing: (a.timing as Timing) ?? 'imediato',
      horarios: horariosDaRegra(a.horario_envio).length > 0 ? horariosDaRegra(a.horario_envio) : [''],
      alertar_erro_whatsapp: a.alertar_erro_whatsapp ?? '',
      escopo: a.marketplace_canal_id ? 'canal' : (a.canal_venda ? 'plataforma' : 'canal'),
      marketplace_canal_id: a.marketplace_canal_id ?? '',
      plataforma: a.canal_venda ?? '',
    })
    setErro('')
    setModal(true)
  }

  function nomeSugerido(): string {
    switch (form.tipo) {
      case 'emissao_fiscal_marketplace':
        return form.escopo === 'canal'
          ? `Emitir NF-e — pedidos ${canais.find(c => c.id === form.marketplace_canal_id)?.nome ?? 'do canal'}`
          : `Emitir NF-e — pedidos ${form.plataforma ? nomePlataforma(form.plataforma) : 'do marketplace'}`
      case 'emissao_fiscal_produto': return `Emitir NFC-e ao vender ${form.produtos[0]?.produto_nome ?? 'produto'}${form.produtos.length > 1 ? ` +${form.produtos.length - 1}` : ''}`
      case 'emissao_fiscal_forma_pagamento': return `Emitir NFC-e — pagamento ${labelForma(form.forma_pagamento)}`
      case 'emissao_fiscal_cliente': return `Emitir NFC-e para ${form.cliente_nome || 'cliente'}`
      default: return 'Nova regra fiscal'
    }
  }

  function validar(): string {
    if (form.tipo === 'emissao_fiscal_produto' && form.produtos.length === 0) return 'Selecione pelo menos 1 produto.'
    if (form.tipo === 'emissao_fiscal_forma_pagamento' && !form.forma_pagamento) return 'Selecione a forma de pagamento.'
    if (form.tipo === 'emissao_fiscal_cliente' && !form.cliente_id) return 'Selecione o cliente.'
    if (form.tipo === 'emissao_fiscal_marketplace') {
      if (form.escopo === 'canal' && !form.marketplace_canal_id) return 'Escolha o canal.'
      if (form.escopo === 'plataforma' && !form.plataforma) return 'Escolha o marketplace.'
    }
    if (form.timing === 'horario_especifico' && horariosDaRegra(form.horarios.join(',')).length === 0) return 'Informe pelo menos um horário.'
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
      modelo_fiscal: form.tipo === 'emissao_fiscal_marketplace' ? 'nfe' : 'nfce',
      marketplace_canal_id: form.tipo === 'emissao_fiscal_marketplace' && form.escopo === 'canal' ? form.marketplace_canal_id : null,
      canal_venda: form.tipo === 'emissao_fiscal_marketplace' && form.escopo === 'plataforma' ? form.plataforma : null,
      produtos: form.tipo === 'emissao_fiscal_produto' ? form.produtos : null,
      forma_pagamento: form.tipo === 'emissao_fiscal_forma_pagamento' ? form.forma_pagamento : null,
      cliente_id: form.tipo === 'emissao_fiscal_cliente' ? form.cliente_id : null,
      cliente_nome: form.tipo === 'emissao_fiscal_cliente' ? form.cliente_nome : null,
      timing: form.timing,
      horario_envio: form.timing === 'horario_especifico' ? horariosDaRegra(form.horarios.join(',')).join(', ') : null,
      alertar_erro_whatsapp: form.alertar_erro_whatsapp.trim() || null,
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
      <div className="rounded-xl bg-blue-50 border border-blue-100 px-3 py-2.5 mb-4 text-xs text-blue-700">
        ℹ️ Nenhuma nota é emitida sozinha sem uma regra ativa. As regras <strong>por produto, pagamento e cliente</strong> emitem NFC-e das vendas do PDV; a regra de <strong>pedidos de marketplace</strong> emite NF-e dos pedidos pagos que ainda estão sem nota.
      </div>

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{automacoes.length} regra(s) fiscal(is) cadastrada(s).</p>
        <button onClick={abrirNova} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg">+ Nova regra</button>
      </div>

      {automacoes.length === 0 ? (
        <div className="py-10 text-center border border-dashed border-gray-200 rounded-xl">
          <p className="text-3xl mb-2">📄</p>
          <p className="text-gray-600 text-sm font-medium">Nenhuma regra de emissão fiscal ainda</p>
          <p className="text-gray-400 text-xs mt-1">Sem regras, toda emissão de NFC-e precisa ser manual.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {automacoes.map(a => (
            <div key={a.id} className="border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-xl flex-shrink-0">{icone(a.tipo)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900 text-sm">{a.nome}</p>
                  <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full border border-blue-200">{labelTipo(a.tipo)}</span>
                  <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{a.tipo === 'emissao_fiscal_marketplace' ? 'NF-e' : 'NFC-e'}</span>
                  {!a.ativa && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">inativa</span>}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{resumoRegra(a, canais)} · {labelTiming(a)}</p>
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
              <h2 className="text-lg font-semibold text-gray-900">{editando ? 'Editar regra fiscal' : 'Nova regra fiscal'}</h2>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {!editando && (
                <div>
                  <p className="text-xs font-semibold text-gray-700 mb-2">Condição</p>
                  <div className="grid grid-cols-1 gap-1.5">
                    {TIPOS.map(t => (
                      <label key={t.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${form.tipo === t.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <input type="radio" name="tipoFiscal" checked={form.tipo === t.id} onChange={() => f('tipo', t.id)} className="accent-blue-600" />
                        <span>{t.icone}</span>
                        <span className="text-gray-700">{t.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {form.tipo === 'emissao_fiscal_marketplace' && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-700">Pedidos de qual canal?</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([['canal', 'Um canal'], ['plataforma', 'Todos de um marketplace']] as const).map(([id, label]) => (
                      <label key={id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${form.escopo === id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <input type="radio" name="escopo" checked={form.escopo === id} onChange={() => f('escopo', id)} className="accent-blue-600" />
                        <span className="text-gray-700">{label}</span>
                      </label>
                    ))}
                  </div>
                  {form.escopo === 'canal' ? (
                    <select value={form.marketplace_canal_id} onChange={e => f('marketplace_canal_id', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500">
                      <option value="">Escolha o canal...</option>
                      {canais.map(c => <option key={c.id} value={c.id}>{c.nome} ({nomePlataforma(c.plataforma)})</option>)}
                    </select>
                  ) : (
                    <select value={form.plataforma} onChange={e => f('plataforma', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500">
                      <option value="">Escolha o marketplace...</option>
                      {plataformas.map(p => <option key={p} value={p}>{nomePlataforma(p)}</option>)}
                    </select>
                  )}
                  {canais.length === 0 && <p className="text-xs text-gray-400">Nenhum canal de marketplace ativo.</p>}
                  <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 space-y-1">
                    <p>Emite a NF-e dos pedidos <strong>pagos e ainda sem nota</strong> — a mesma do botão “Conferir/Emitir” do pedido, até {LIMITE_NFE_MARKETPLACE_POR_RODADA} por rodada.</p>
                    <p>Não emite se o marketplace já tiver recebido nota (emitida em outro sistema) nem se a nota foi informada à mão. Pedido bloqueado (produto sem perfil fiscal, endereço faltando) fica marcado com o motivo e é tentado de novo 3h depois.</p>
                    <p><strong>Atenção:</strong> canal cuja empresa emissora está em produção gera nota fiscal real.</p>
                  </div>
                </div>
              )}

              {form.tipo === 'emissao_fiscal_produto' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Produtos</label>
                  <BuscaProdutosMulti empresaId={empresaId} selecionados={form.produtos} onChange={p => f('produtos', p)} />
                </div>
              )}

              {form.tipo === 'emissao_fiscal_forma_pagamento' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-2">Forma de pagamento</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {FORMAS_PAGAMENTO.map(fp => (
                      <label key={fp.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${form.forma_pagamento === fp.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <input type="radio" name="formaPag" checked={form.forma_pagamento === fp.id} onChange={() => f('forma_pagamento', fp.id)} className="accent-blue-600" />
                        <span className="text-gray-700">{fp.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {form.tipo === 'emissao_fiscal_cliente' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Cliente</label>
                  <BuscaCliente empresaId={empresaId} clienteId={form.cliente_id} clienteNome={form.cliente_nome}
                    onChange={(id, nome) => { f('cliente_id', id); f('cliente_nome', nome) }} />
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-gray-700 mb-2">Quando rodar</p>
                <div className="grid grid-cols-1 gap-1.5">
                  {TIMINGS.map(t => (
                    <label key={t.id} className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${form.timing === t.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <input type="radio" name="timing" checked={form.timing === t.id} onChange={() => f('timing', t.id)} className="accent-blue-600 mt-0.5" />
                      <span>
                        <span className="text-gray-700 block">{t.label}</span>
                        <span className="text-gray-400 text-xs">{t.descricao}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {form.timing === 'horario_especifico' && (
                  <div className="mt-2 space-y-1.5">
                    {form.horarios.map((h, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input type="time" value={h}
                          onChange={e => f('horarios', form.horarios.map((x, j) => j === i ? e.target.value : x))}
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                        {form.horarios.length > 1 && (
                          <button type="button" onClick={() => f('horarios', form.horarios.filter((_, j) => j !== i))}
                            className="text-gray-400 hover:text-red-500 text-sm px-2">✕</button>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={() => f('horarios', [...form.horarios, ''])}
                      className="text-xs text-blue-600 hover:text-blue-800">+ Adicionar horário</button>
                    <p className="text-[11px] text-gray-400">Horário de Brasília. Cada horário roda uma vez por dia.</p>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Avisar por WhatsApp se der erro (opcional)</label>
                <input value={form.alertar_erro_whatsapp} onChange={e => f('alertar_erro_whatsapp', e.target.value)}
                  placeholder="(21) 99999-9999"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                <p className="text-[11px] text-gray-400 mt-1">Manda um aviso pra este número quando a emissão falhar (no máximo 1 aviso por hora, enquanto o problema persistir).</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nome da regra</label>
                <input value={form.nome} onChange={e => f('nome', e.target.value)}
                  placeholder={nomeSugerido()}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Observação (opcional)</label>
                <textarea value={form.observacao} onChange={e => f('observacao', e.target.value)} rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={form.ativa} onChange={e => f('ativa', e.target.checked)} className="w-4 h-4 accent-blue-600" />
                Regra ativa
              </label>

              {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setModal(false)} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={salvar} disabled={salvando}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {salvando ? 'Salvando...' : 'Salvar regra'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
