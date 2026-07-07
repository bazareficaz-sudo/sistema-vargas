'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const TIPOS = [
  { value: 'loja',          label: 'Loja',                  icon: '🏪' },
  { value: 'principal',     label: 'Estoque Principal',     icon: '🏭' },
  { value: 'secundario',    label: 'Estoque Secundário',    icon: '📦' },
  { value: 'marketplace',   label: 'Marketplace',           icon: '🛒' },
  { value: 'avaria',        label: 'Avaria',                icon: '⚠️' },
  { value: 'troca',         label: 'Troca/Devolução',       icon: '↩️' },
  { value: 'quarentena',    label: 'Quarentena/Conferência',icon: '🔒' },
  { value: 'outro',         label: 'Outro',                 icon: '📁' },
]

type Deposito = {
  id: string; nome: string; codigo: string | null; tipo: string; principal: boolean
  responsavel: string | null; telefone: string | null; email: string | null
  logradouro: string | null; numero: string | null; bairro: string | null
  cidade: string | null; uf: string | null; cep: string | null
  observacao: string | null; ativo: boolean; created_at: string
}

const formVazio = () => ({
  nome: '', codigo: '', tipo: 'loja', principal: false, responsavel: '',
  telefone: '', email: '', logradouro: '', numero: '', bairro: '',
  cidade: '', uf: '', cep: '', observacao: '', ativo: true,
})

function tipoIcon(tipo: string) { return TIPOS.find(t => t.value === tipo)?.icon ?? '📁' }
function tipoLabel(tipo: string) { return TIPOS.find(t => t.value === tipo)?.label ?? tipo }

export default function DepositosClient({ empresaId, operador, depositosIniciais }: {
  empresaId: string; operador: string; depositosIniciais: Deposito[]
}) {
  const sb = createClient()
  const router = useRouter()
  const [lista, setLista] = useState<Deposito[]>(depositosIniciais)
  const [modal, setModal] = useState<'novo' | 'editar' | null>(null)
  const [editando, setEditando] = useState<Deposito | null>(null)
  const [form, setForm] = useState(formVazio())
  const [salvando, setSalvando] = useState(false)
  const [filtroStatus, setFiltroStatus] = useState('ativos')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [erro, setErro] = useState('')

  const filtrado = lista.filter(d => {
    const matchStatus = filtroStatus === 'todos' ? true : filtroStatus === 'ativos' ? d.ativo : !d.ativo
    const matchTipo = !filtroTipo || d.tipo === filtroTipo
    return matchStatus && matchTipo
  })

  function abrirNovo() {
    setForm(formVazio())
    setEditando(null)
    setErro('')
    setModal('novo')
  }

  function abrirEditar(dep: Deposito) {
    setForm({
      nome: dep.nome, codigo: dep.codigo ?? '', tipo: dep.tipo,
      principal: dep.principal, responsavel: dep.responsavel ?? '',
      telefone: dep.telefone ?? '', email: dep.email ?? '',
      logradouro: dep.logradouro ?? '', numero: dep.numero ?? '',
      bairro: dep.bairro ?? '', cidade: dep.cidade ?? '',
      uf: dep.uf ?? '', cep: dep.cep ?? '',
      observacao: dep.observacao ?? '', ativo: dep.ativo,
    })
    setEditando(dep)
    setErro('')
    setModal('editar')
  }

  async function salvar() {
    if (!form.nome.trim()) { setErro('Nome é obrigatório'); return }
    setSalvando(true); setErro('')

    // Se principal = true, remove de outros
    if (form.principal) {
      await sb.from('depositos').update({ principal: false }).eq('empresa_id', empresaId).neq('id', editando?.id ?? '')
    }

    if (modal === 'novo') {
      const { data, error } = await sb.from('depositos').insert({
        empresa_id: empresaId,
        nome: form.nome, codigo: form.codigo || null, tipo: form.tipo,
        principal: form.principal, responsavel: form.responsavel || null,
        telefone: form.telefone || null, email: form.email || null,
        logradouro: form.logradouro || null, numero: form.numero || null,
        bairro: form.bairro || null, cidade: form.cidade || null,
        uf: form.uf || null, cep: form.cep || null,
        observacao: form.observacao || null, ativo: true,
        criado_por: operador,
      }).select().single()
      if (error) { setErro(error.message); setSalvando(false); return }
      if (form.principal) {
        setLista(p => p.map(d => ({ ...d, principal: false })))
      }
      setLista(p => [...p, data as Deposito])
    } else if (editando) {
      const { error } = await sb.from('depositos').update({
        nome: form.nome, codigo: form.codigo || null, tipo: form.tipo,
        principal: form.principal, responsavel: form.responsavel || null,
        telefone: form.telefone || null, email: form.email || null,
        logradouro: form.logradouro || null, numero: form.numero || null,
        bairro: form.bairro || null, cidade: form.cidade || null,
        uf: form.uf || null, cep: form.cep || null,
        observacao: form.observacao || null, ativo: form.ativo,
        updated_at: new Date().toISOString(),
      }).eq('id', editando.id)
      if (error) { setErro(error.message); setSalvando(false); return }
      if (form.principal) {
        setLista(p => p.map(d => ({ ...d, principal: d.id === editando.id })))
      } else {
        setLista(p => p.map(d => d.id === editando.id ? { ...d, ...form } : d))
      }
    }

    setModal(null); setSalvando(false)
  }

  async function alternarAtivo(dep: Deposito) {
    if (dep.principal && dep.ativo) { alert('Não é possível inativar o depósito principal.'); return }
    await sb.from('depositos').update({ ativo: !dep.ativo }).eq('id', dep.id)
    setLista(p => p.map(d => d.id === dep.id ? { ...d, ativo: !d.ativo } : d))
  }

  function F(key: keyof typeof form, val: any) { setForm(p => ({ ...p, [key]: val })) }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Depósitos</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gerencie os locais de armazenamento e estoque</p>
        </div>
        <button onClick={abrirNovo}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-sm">
          + Novo Depósito
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {[['ativos', 'Ativos'], ['inativos', 'Inativos'], ['todos', 'Todos']].map(([v, l]) => (
            <button key={v} onClick={() => setFiltroStatus(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filtroStatus === v ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
              {l}
            </button>
          ))}
        </div>
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
          <option value="">Todos os tipos</option>
          {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
        </select>
        <span className="text-xs text-gray-400 self-center">{filtrado.length} depósito(s)</span>
      </div>

      {/* Grid */}
      {filtrado.length === 0 ? (
        <div className="text-center py-20 text-gray-300">
          <div className="text-5xl mb-3">🏭</div>
          <p className="text-sm">Nenhum depósito encontrado</p>
          <button onClick={abrirNovo} className="mt-4 text-blue-600 text-sm hover:underline">Criar primeiro depósito</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtrado.map(dep => (
            <div key={dep.id} className={`bg-white border rounded-2xl p-5 transition-all ${dep.ativo ? 'border-gray-200 hover:border-blue-300 hover:shadow-sm' : 'border-dashed border-gray-200 opacity-60'}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{tipoIcon(dep.tipo)}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900 text-sm">{dep.nome}</p>
                      {dep.principal && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">Principal</span>
                      )}
                      {!dep.ativo && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">Inativo</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">{tipoLabel(dep.tipo)}{dep.codigo && ` · ${dep.codigo}`}</p>
                  </div>
                </div>
              </div>

              {(dep.responsavel || dep.cidade) && (
                <div className="text-xs text-gray-400 space-y-0.5 mb-3">
                  {dep.responsavel && <p>👤 {dep.responsavel}</p>}
                  {dep.cidade && <p>📍 {dep.cidade}{dep.uf && `, ${dep.uf}`}</p>}
                  {dep.telefone && <p>📞 {dep.telefone}</p>}
                </div>
              )}

              <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                <button onClick={() => router.push(`/dashboard/depositos/${dep.id}`)}
                  className="flex-1 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg font-medium transition-colors">
                  Ver Estoque
                </button>
                <button onClick={() => abrirEditar(dep)}
                  className="flex-1 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors">
                  Editar
                </button>
                <button onClick={() => alternarAtivo(dep)}
                  className={`flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors ${dep.ativo ? 'text-red-500 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}`}>
                  {dep.ativo ? 'Inativar' : 'Reativar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal novo/editar */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
              <h2 className="font-bold text-gray-900 text-lg">{modal === 'novo' ? 'Novo Depósito' : `Editar — ${editando?.nome}`}</h2>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Identificação */}
              <fieldset className="space-y-3">
                <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Identificação</legend>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Nome *</label>
                    <input autoFocus value={form.nome} onChange={e => F('nome', e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Código interno</label>
                    <input value={form.codigo} onChange={e => F('codigo', e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Tipo</label>
                    <select value={form.tipo} onChange={e => F('tipo', e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500">
                      {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col justify-end">
                    <label className="flex items-center gap-3 cursor-pointer p-3 border border-gray-200 rounded-xl hover:bg-gray-50">
                      <input type="checkbox" checked={form.principal} onChange={e => F('principal', e.target.checked)} className="w-4 h-4 rounded" />
                      <div>
                        <p className="text-sm font-medium text-gray-700">Depósito principal</p>
                        <p className="text-xs text-gray-400">Padrão para novas movimentações</p>
                      </div>
                    </label>
                  </div>
                </div>
              </fieldset>

              {/* Responsável */}
              <fieldset className="space-y-3">
                <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Responsável e Contato</legend>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1">
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Responsável</label>
                    <input value={form.responsavel} onChange={e => F('responsavel', e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Telefone</label>
                    <input value={form.telefone} onChange={e => F('telefone', e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">E-mail</label>
                    <input type="email" value={form.email} onChange={e => F('email', e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
              </fieldset>

              {/* Endereço */}
              <fieldset className="space-y-3">
                <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Endereço</legend>
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-3">
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Logradouro</label>
                    <input value={form.logradouro} onChange={e => F('logradouro', e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Número</label>
                    <input value={form.numero} onChange={e => F('numero', e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Bairro</label>
                    <input value={form.bairro} onChange={e => F('bairro', e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Cidade</label>
                    <input value={form.cidade} onChange={e => F('cidade', e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">UF</label>
                      <input value={form.uf} onChange={e => F('uf', e.target.value.toUpperCase())} maxLength={2}
                        className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 text-center" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 mb-1 block">CEP</label>
                      <input value={form.cep} onChange={e => F('cep', e.target.value)}
                        className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
                    </div>
                  </div>
                </div>
              </fieldset>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Observação</label>
                <textarea value={form.observacao} onChange={e => F('observacao', e.target.value)}
                  rows={2} className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:border-blue-500" />
              </div>

              {modal === 'editar' && (
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.ativo} onChange={e => F('ativo', e.target.checked)} className="w-4 h-4 rounded" />
                  <span className="text-sm text-gray-700">Depósito ativo</span>
                </label>
              )}

              {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{erro}</p>}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex gap-3 sticky bottom-0 bg-white">
              <button onClick={() => setModal(null)}
                className="flex-1 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={salvar} disabled={salvando || !form.nome.trim()}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold rounded-xl text-sm">
                {salvando ? 'Salvando...' : modal === 'novo' ? 'Criar Depósito' : 'Salvar Alterações'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
