'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Automacao, ProdutoRef } from './AutomacoesClient'
import BuscaProdutosMulti from './BuscaProdutosMulti'
import BuscaCliente from './BuscaCliente'

const TIPOS = [
  { id: 'emissao_fiscal_produto', icone: '📦', label: 'Por produto' },
  { id: 'emissao_fiscal_forma_pagamento', icone: '💳', label: 'Por forma de pagamento' },
  { id: 'emissao_fiscal_cliente', icone: '👤', label: 'Por cliente' },
] as const

type TipoFiscal = typeof TIPOS[number]['id']

const FORMAS_PAGAMENTO = [
  { id: 'dinheiro', label: 'Dinheiro' },
  { id: 'debito', label: 'Cartão de débito' },
  { id: 'credito', label: 'Cartão de crédito' },
  { id: 'pix', label: 'Pix' },
  { id: 'carteira', label: 'Carteira/crédito loja' },
  { id: 'fiado', label: 'Fiado' },
  { id: 'multiplo', label: 'Múltiplo' },
]

const FORM_VAZIO = {
  tipo: 'emissao_fiscal_produto' as TipoFiscal,
  nome: '',
  observacao: '',
  produtos: [] as ProdutoRef[],
  forma_pagamento: 'pix',
  cliente_id: null as string | null,
  cliente_nome: '',
  ativa: true,
}

function icone(tipo: string) { return TIPOS.find(t => t.id === tipo)?.icone ?? '📄' }
function labelTipo(tipo: string) { return TIPOS.find(t => t.id === tipo)?.label ?? tipo }
function labelForma(f: string) { return FORMAS_PAGAMENTO.find(x => x.id === f)?.label ?? f }
function fmtData(v: string | null) { return v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null }

function resumoRegra(a: Automacao) {
  switch (a.tipo) {
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

export default function RegrasFiscais({ empresaId, automacoes, onChange }: {
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
      tipo: a.tipo as TipoFiscal,
      nome: a.nome,
      observacao: a.observacao ?? '',
      produtos: a.produtos ?? [],
      forma_pagamento: a.forma_pagamento ?? 'pix',
      cliente_id: a.cliente_id,
      cliente_nome: a.cliente_nome ?? '',
      ativa: a.ativa,
    })
    setErro('')
    setModal(true)
  }

  function nomeSugerido(): string {
    switch (form.tipo) {
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
      modelo_fiscal: 'nfce',
      produtos: form.tipo === 'emissao_fiscal_produto' ? form.produtos : null,
      forma_pagamento: form.tipo === 'emissao_fiscal_forma_pagamento' ? form.forma_pagamento : null,
      cliente_id: form.tipo === 'emissao_fiscal_cliente' ? form.cliente_id : null,
      cliente_nome: form.tipo === 'emissao_fiscal_cliente' ? form.cliente_nome : null,
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
        ℹ️ A NFC-e não é mais emitida automaticamente pra toda venda — só manualmente (botão "Emitir agora" na venda) ou quando uma dessas regras acertar a condição. Sem nenhuma regra ativa, nenhuma venda emite nota sozinha.
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
                  <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">NFC-e</span>
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
