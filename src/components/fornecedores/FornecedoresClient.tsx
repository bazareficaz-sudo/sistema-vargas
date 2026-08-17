'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Fornecedor = {
  id: string; empresa_id: string; razao_social: string; nome_fantasia: string | null
  cnpj: string | null; ie: string | null; telefone: string | null; email: string | null
  contato: string | null; endereco: string | null; numero: string | null
  complemento: string | null; bairro: string | null; cidade: string | null
  estado: string | null; cep: string | null; observacoes: string | null; ativo: boolean
  prazo_entrega_dias: number | null; pedido_minimo_valor: number | null
  condicao_pagamento_padrao: string | null
}

const EMPTY: Omit<Fornecedor, 'id' | 'empresa_id'> = {
  razao_social: '', nome_fantasia: '', cnpj: '', ie: '', telefone: '', email: '',
  contato: '', endereco: '', numero: '', complemento: '', bairro: '', cidade: '',
  estado: '', cep: '', observacoes: '', ativo: true,
  prazo_entrega_dias: null, pedido_minimo_valor: null, condicao_pagamento_padrao: '',
}

const ESTADOS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']

export default function FornecedoresClient({
  fornecedores: inicial, empresaId, qInicial,
}: { fornecedores: Fornecedor[]; empresaId: string; qInicial: string }) {
  const router = useRouter()
  const [fornecedores, setFornecedores] = useState(inicial)
  const [q, setQ] = useState(qInicial)
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<Fornecedor | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [aba, setAba] = useState<'dados' | 'endereco' | 'obs'>('dados')

  function abrirNovo() { setForm(EMPTY); setEditando(null); setAba('dados'); setErro(''); setModal(true) }
  function abrirEditar(f: Fornecedor) {
    setForm({ razao_social: f.razao_social, nome_fantasia: f.nome_fantasia ?? '', cnpj: f.cnpj ?? '',
      ie: f.ie ?? '', telefone: f.telefone ?? '', email: f.email ?? '', contato: f.contato ?? '',
      endereco: f.endereco ?? '', numero: f.numero ?? '', complemento: f.complemento ?? '',
      bairro: f.bairro ?? '', cidade: f.cidade ?? '', estado: f.estado ?? '', cep: f.cep ?? '',
      observacoes: f.observacoes ?? '', ativo: f.ativo,
      prazo_entrega_dias: f.prazo_entrega_dias, pedido_minimo_valor: f.pedido_minimo_valor,
      condicao_pagamento_padrao: f.condicao_pagamento_padrao ?? '' })
    setEditando(f); setAba('dados'); setErro(''); setModal(true)
  }

  function set(k: keyof typeof EMPTY, v: string | boolean | number | null) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function salvar() {
    if (!form.razao_social.trim()) { setErro('Razão social obrigatória.'); return }
    setErro(''); setSalvando(true)
    const sb = createClient()
    const payload = { ...form, empresa_id: empresaId, nome_fantasia: form.nome_fantasia || null,
      cnpj: form.cnpj || null, ie: form.ie || null, telefone: form.telefone || null,
      email: form.email || null, contato: form.contato || null, endereco: form.endereco || null,
      numero: form.numero || null, complemento: form.complemento || null, bairro: form.bairro || null,
      cidade: form.cidade || null, estado: form.estado || null, cep: form.cep || null,
      observacoes: form.observacoes || null,
      condicao_pagamento_padrao: form.condicao_pagamento_padrao || null }

    if (editando) {
      const { error } = await sb.from('fornecedores').update(payload).eq('id', editando.id)
      if (error) { setErro(error.message); setSalvando(false); return }
      setFornecedores(prev => prev.map(f => f.id === editando.id ? { ...f, ...payload } : f))
    } else {
      const { data, error } = await sb.from('fornecedores').insert(payload).select().single()
      if (error) { setErro(error.message); setSalvando(false); return }
      setFornecedores(prev => [...prev, data].sort((a, b) => a.razao_social.localeCompare(b.razao_social)))
    }
    setSalvando(false); setModal(false)
  }

  async function toggleAtivo(f: Fornecedor) {
    const sb = createClient()
    await sb.from('fornecedores').update({ ativo: !f.ativo }).eq('id', f.id)
    setFornecedores(prev => prev.map(x => x.id === f.id ? { ...x, ativo: !x.ativo } : x))
  }

  async function excluir(f: Fornecedor) {
    if (!confirm(`Excluir "${f.razao_social}"?`)) return
    const sb = createClient()
    await sb.from('fornecedores').delete().eq('id', f.id)
    setFornecedores(prev => prev.filter(x => x.id !== f.id))
  }

  const filtrados = fornecedores.filter(f =>
    !q || f.razao_social.toLowerCase().includes(q.toLowerCase()) ||
    (f.nome_fantasia ?? '').toLowerCase().includes(q.toLowerCase()) ||
    (f.cnpj ?? '').includes(q))

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>cadastros</span><span>›</span>
        <span className="text-gray-600 font-medium">fornecedores</span>
      </div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Fornecedores</h1>
          <p className="text-gray-500 text-sm mt-0.5">{fornecedores.length} cadastrados</p>
        </div>
        <button onClick={abrirNovo}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
          + Novo fornecedor
        </button>
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Buscar por nome, fantasia ou CNPJ..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white" />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Razão Social</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Nome Fantasia</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">CNPJ</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Contato</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Cidade/UF</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Ativo</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtrados.map(f => (
              <tr key={f.id} className="hover:bg-gray-50 transition-colors group">
                <td className="px-4 py-3">
                  <button onClick={() => abrirEditar(f)} className="text-left text-gray-900 font-medium hover:text-blue-600 transition-colors">
                    {f.razao_social}
                  </button>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{f.nome_fantasia ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{f.cnpj ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  <div>{f.contato ?? '—'}</div>
                  {f.telefone && <div className="text-gray-400">{f.telefone}</div>}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {f.cidade && f.estado ? `${f.cidade} / ${f.estado}` : '—'}
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => toggleAtivo(f)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${f.ativo ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${f.ativo ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Link href={`/dashboard/fornecedores/${f.id}/produtos`} className="text-xs text-slate-600 hover:text-slate-900">Produtos</Link>
                    <button onClick={() => abrirEditar(f)} className="text-xs text-blue-600 hover:text-blue-800">Editar</button>
                    <button onClick={() => excluir(f)} className="text-xs text-red-500 hover:text-red-700">Excluir</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr><td colSpan={7} className="py-12 text-center text-gray-400">Nenhum fornecedor encontrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/30" onClick={() => setModal(false)} />
          <div className="relative ml-auto w-full max-w-2xl bg-white h-full flex flex-col shadow-2xl">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                {editando ? 'Editar Fornecedor' : 'Novo Fornecedor'}
              </h2>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            {/* Abas */}
            <div className="flex border-b border-gray-200 px-6">
              {([['dados','Dados'], ['endereco','Endereço'], ['obs','Observações']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setAba(k)}
                  className={`py-3 px-4 text-sm border-b-2 transition-colors ${aba === k ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                  {l}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {aba === 'dados' && (
                <>
                  <Field label="Razão Social *" value={form.razao_social} onChange={v => set('razao_social', v)} />
                  <Field label="Nome Fantasia" value={form.nome_fantasia ?? ''} onChange={v => set('nome_fantasia', v)} />
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="CNPJ" value={form.cnpj ?? ''} onChange={v => set('cnpj', v)} placeholder="00.000.000/0000-00" />
                    <Field label="Inscrição Estadual" value={form.ie ?? ''} onChange={v => set('ie', v)} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Telefone" value={form.telefone ?? ''} onChange={v => set('telefone', v)} placeholder="(00) 00000-0000" />
                    <Field label="E-mail" value={form.email ?? ''} onChange={v => set('email', v)} type="email" />
                  </div>
                  <Field label="Nome do Contato" value={form.contato ?? ''} onChange={v => set('contato', v)} />
                  <div className="grid grid-cols-3 gap-4 pt-2 border-t border-gray-100">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1 mt-3">Prazo de entrega (dias)</label>
                      <input type="number" min={0} value={form.prazo_entrega_dias ?? ''}
                        onChange={e => set('prazo_entrega_dias', e.target.value === '' ? null : Number(e.target.value))}
                        placeholder="ex: 7"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1 mt-3">Pedido mínimo (R$)</label>
                      <input type="number" min={0} step="0.01" value={form.pedido_minimo_valor ?? ''}
                        onChange={e => set('pedido_minimo_valor', e.target.value === '' ? null : Number(e.target.value))}
                        placeholder="0,00"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1 mt-3">Condição de pagamento</label>
                      <input value={form.condicao_pagamento_padrao ?? ''} onChange={e => set('condicao_pagamento_padrao', e.target.value)}
                        placeholder="ex: 30/60/90"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Usados pelo Auxiliar de Compras para calcular quando comprar. O prazo real, medido pelas entregas, sobrepõe este valor assim que houver histórico suficiente.
                  </p>
                  <div className="flex items-center gap-3 pt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.ativo} onChange={e => set('ativo', e.target.checked)} className="w-4 h-4 accent-blue-600" />
                      <span className="text-sm text-gray-700">Fornecedor ativo</span>
                    </label>
                  </div>
                </>
              )}
              {aba === 'endereco' && (
                <>
                  <div className="grid grid-cols-4 gap-4">
                    <div className="col-span-3">
                      <Field label="CEP" value={form.cep ?? ''} onChange={v => set('cep', v)} placeholder="00000-000" />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    <div className="col-span-3">
                      <Field label="Endereço" value={form.endereco ?? ''} onChange={v => set('endereco', v)} />
                    </div>
                    <Field label="Número" value={form.numero ?? ''} onChange={v => set('numero', v)} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Complemento" value={form.complemento ?? ''} onChange={v => set('complemento', v)} />
                    <Field label="Bairro" value={form.bairro ?? ''} onChange={v => set('bairro', v)} />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <Field label="Cidade" value={form.cidade ?? ''} onChange={v => set('cidade', v)} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Estado</label>
                      <select value={form.estado ?? ''} onChange={e => set('estado', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500">
                        <option value="">—</option>
                        {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
                      </select>
                    </div>
                  </div>
                </>
              )}
              {aba === 'obs' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Observações</label>
                  <textarea value={form.observacoes ?? ''} onChange={e => set('observacoes', e.target.value)} rows={6}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 resize-none" />
                </div>
              )}
            </div>

            {erro && <p className="px-6 text-sm text-red-600">{erro}</p>}
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => setModal(false)} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button onClick={salvar} disabled={salvando}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {salvando ? 'Salvando...' : 'Salvar fornecedor'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
    </div>
  )
}
