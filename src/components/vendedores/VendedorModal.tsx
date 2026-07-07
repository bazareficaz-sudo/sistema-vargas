'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Empresa {
  id: string
  nome: string
  nome_fantasia?: string
}

interface VendedorEmpresa {
  empresa_id: string
  empresa_principal: boolean
  pode_vender: boolean
  ativo: boolean
  empresas: { id: string; nome: string; nome_fantasia?: string } | null
}

interface Vendedor {
  id: string
  codigo?: string
  matricula?: string
  nome: string
  apelido?: string
  cpf?: string
  rg?: string
  telefone?: string
  whatsapp?: string
  email?: string
  data_nascimento?: string
  data_admissao?: string
  data_desligamento?: string
  status: string
  ativo?: boolean
  participa_comissao: boolean
  tipo_remuneracao: string
  obs_comissao?: string
  permite_todas_empresas: boolean
  permite_login: boolean
  obs?: string
  empresa_id: string
  user_id?: string
  identificador_externo?: string
  vendedor_empresas: VendedorEmpresa[]
}

interface Props {
  vendedor: Vendedor | null
  empresas: Empresa[]
  empresaAtualId: string
  onSalvar: (v: any) => void
  onFechar: () => void
}

type Tab = 'dados' | 'empresas' | 'comercial'

interface EmpresaCheck {
  empresa_id: string
  principal: boolean
  pode_vender: boolean
}

function gerarId() {
  return crypto.randomUUID()
}

export default function VendedorModal({ vendedor, empresas, empresaAtualId, onSalvar, onFechar }: Props) {
  const isNovo = !vendedor

  const [tab, setTab] = useState<Tab>('dados')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  // Campos — Dados
  const [nome, setNome] = useState(vendedor?.nome ?? '')
  const [apelido, setApelido] = useState(vendedor?.apelido ?? '')
  const [codigo, setCodigo] = useState(vendedor?.codigo ?? '')
  const [matricula, setMatricula] = useState(vendedor?.matricula ?? '')
  const [cpf, setCpf] = useState(vendedor?.cpf ?? '')
  const [rg, setRg] = useState(vendedor?.rg ?? '')
  const [telefone, setTelefone] = useState(vendedor?.telefone ?? '')
  const [whatsapp, setWhatsapp] = useState(vendedor?.whatsapp ?? '')
  const [email, setEmail] = useState(vendedor?.email ?? '')
  const [dataNasc, setDataNasc] = useState(vendedor?.data_nascimento ?? '')
  const [dataAdm, setDataAdm] = useState(vendedor?.data_admissao ?? '')
  const [dataDesl, setDataDesl] = useState(vendedor?.data_desligamento ?? '')
  const [status, setStatus] = useState(vendedor?.status ?? 'ativo')
  const [obs, setObs] = useState(vendedor?.obs ?? '')
  const [idExterno, setIdExterno] = useState(vendedor?.identificador_externo ?? '')
  const [permiteLogi, setPermiteLogi] = useState(vendedor?.permite_login ?? false)

  // Campos — Empresas
  const initialVinculos: EmpresaCheck[] = vendedor?.vendedor_empresas?.map(ve => ({
    empresa_id: ve.empresa_id,
    principal: ve.empresa_principal,
    pode_vender: ve.pode_vender,
  })) ?? (isNovo ? [{ empresa_id: empresaAtualId, principal: true, pode_vender: true }] : [])

  const [vinculos, setVinculos] = useState<EmpresaCheck[]>(initialVinculos)
  const [permiteTodasEmpresas, setPermiteTodasEmpresas] = useState(vendedor?.permite_todas_empresas ?? false)

  // Campos — Comercial
  const [participaComissao, setParticipaComissao] = useState(vendedor?.participa_comissao ?? false)
  const [tipoRem, setTipoRem] = useState(vendedor?.tipo_remuneracao ?? 'nenhum')
  const [obsComissao, setObsComissao] = useState(vendedor?.obs_comissao ?? '')

  function toggleVinculo(empresaId: string) {
    setVinculos(prev => {
      const existe = prev.find(v => v.empresa_id === empresaId)
      if (existe) {
        const novos = prev.filter(v => v.empresa_id !== empresaId)
        if (existe.principal && novos.length > 0) {
          novos[0].principal = true
        }
        return novos
      } else {
        return [...prev, { empresa_id: empresaId, principal: prev.length === 0, pode_vender: true }]
      }
    })
  }

  function setPrincipal(empresaId: string) {
    setVinculos(prev => prev.map(v => ({ ...v, principal: v.empresa_id === empresaId })))
  }

  function togglePodeVender(empresaId: string) {
    setVinculos(prev => prev.map(v =>
      v.empresa_id === empresaId ? { ...v, pode_vender: !v.pode_vender } : v
    ))
  }

  async function salvar() {
    setErro('')
    if (!nome.trim()) { setErro('O nome do vendedor é obrigatório.'); setTab('dados'); return }
    if (!permiteTodasEmpresas && vinculos.length === 0) {
      setErro('Vincule ao menos uma empresa.'); setTab('empresas'); return
    }

    setSalvando(true)
    try {
      const supabase = createClient()
      const id = vendedor?.id ?? gerarId()

      const empresaPrincipalId = permiteTodasEmpresas
        ? empresaAtualId
        : (vinculos.find(v => v.principal)?.empresa_id ?? vinculos[0]?.empresa_id ?? empresaAtualId)

      const payload = {
        id,
        nome: nome.trim(),
        apelido: apelido.trim() || null,
        codigo: codigo.trim() || null,
        matricula: matricula.trim() || null,
        cpf: cpf.replace(/\D/g, '') || null,
        rg: rg.trim() || null,
        telefone: telefone.replace(/\D/g, '') || null,
        whatsapp: whatsapp.replace(/\D/g, '') || null,
        email: email.trim() || null,
        data_nascimento: dataNasc || null,
        data_admissao: dataAdm || null,
        data_desligamento: dataDesl || null,
        status,
        ativo: status === 'ativo',
        obs: obs.trim() || null,
        identificador_externo: idExterno.trim() || null,
        permite_login: permiteLogi,
        participa_comissao: participaComissao,
        tipo_remuneracao: tipoRem,
        obs_comissao: obsComissao.trim() || null,
        permite_todas_empresas: permiteTodasEmpresas,
        empresa_id: empresaPrincipalId,
        updated_at: new Date().toISOString(),
        ...(isNovo && { created_at: new Date().toISOString() }),
      }

      const { error: errV } = await supabase
        .from('vendedores')
        .upsert(payload, { onConflict: 'id' })

      if (errV) throw errV

      // Sincronizar vendedor_empresas
      if (!permiteTodasEmpresas) {
        await supabase.from('vendedor_empresas').delete().eq('vendedor_id', id)
        if (vinculos.length > 0) {
          await supabase.from('vendedor_empresas').insert(
            vinculos.map(v => ({
              vendedor_id: id,
              empresa_id: v.empresa_id,
              empresa_principal: v.principal,
              pode_vender: v.pode_vender,
              ativo: true,
            }))
          )
        }
      }

      // Montar objeto retorno com vendedor_empresas populado
      const vendedorAtualizado: Vendedor = {
        ...payload,
        status,
        participa_comissao: participaComissao,
        tipo_remuneracao: tipoRem,
        permite_todas_empresas: permiteTodasEmpresas,
        permite_login: permiteLogi,
        vendedor_empresas: vinculos.map(v => ({
          empresa_id: v.empresa_id,
          empresa_principal: v.principal,
          pode_vender: v.pode_vender,
          ativo: true,
          empresas: empresas.find(e => e.id === v.empresa_id) ?? null,
        })),
      } as Vendedor

      onSalvar(vendedorAtualizado)
    } catch (e: any) {
      setErro(e?.message ?? 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'dados',     label: '1. Dados' },
    { key: 'empresas',  label: '2. Empresas' },
    { key: 'comercial', label: '3. Comercial' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Overlay */}
      <div className="flex-1 bg-black/40" onClick={onFechar} />

      {/* Painel lateral */}
      <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col h-screen overflow-hidden">
        {/* Cabeçalho */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-slate-900 text-xl font-bold">
              {isNovo ? 'Novo Vendedor' : 'Editar Vendedor'}
            </h2>
            {!isNovo && <p className="text-slate-400 text-xs mt-0.5">{vendedor.nome}</p>}
          </div>
          <button onClick={onFechar} className="text-slate-400 hover:text-slate-600 text-2xl leading-none p-1">×</button>
        </div>

        {/* Tabs */}
        <div className="px-6 flex gap-1 border-b border-slate-100 bg-slate-50">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* TAB DADOS */}
          {tab === 'dados' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Nome completo *</label>
                  <input value={nome} onChange={e => setNome(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Apelido</label>
                  <input value={apelido} onChange={e => setApelido(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
                  <select value={status} onChange={e => setStatus(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400">
                    <option value="ativo">Ativo</option>
                    <option value="inativo">Inativo</option>
                    <option value="desligado">Desligado</option>
                    <option value="bloqueado">Bloqueado</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Código interno</label>
                  <input value={codigo} onChange={e => setCodigo(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Matrícula</label>
                  <input value={matricula} onChange={e => setMatricula(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
                </div>
              </div>

              <hr className="border-slate-100" />
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Documentos</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">CPF</label>
                  <input value={cpf} onChange={e => setCpf(e.target.value)} placeholder="000.000.000-00"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">RG</label>
                  <input value={rg} onChange={e => setRg(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Data de Nascimento</label>
                  <input type="date" value={dataNasc} onChange={e => setDataNasc(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">ID Externo</label>
                  <input value={idExterno} onChange={e => setIdExterno(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
                </div>
              </div>

              <hr className="border-slate-100" />
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Contato</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Telefone</label>
                  <input value={telefone} onChange={e => setTelefone(e.target.value)} placeholder="(00) 00000-0000"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">WhatsApp</label>
                  <input value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="(00) 00000-0000"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">E-mail</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
                </div>
              </div>

              <hr className="border-slate-100" />
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Vínculo empregatício</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Data de Admissão</label>
                  <input type="date" value={dataAdm} onChange={e => setDataAdm(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Data de Desligamento</label>
                  <input type="date" value={dataDesl} onChange={e => setDataDesl(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Observações</label>
                <textarea value={obs} onChange={e => setObs(e.target.value)} rows={3}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400 resize-none" />
              </div>

              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setPermiteLogi(!permiteLogi)}
                  className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${permiteLogi ? 'bg-blue-500' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${permiteLogi ? 'left-5' : 'left-1'}`} />
                </button>
                <div>
                  <p className="text-sm font-medium text-slate-700">Permite login no sistema</p>
                  <p className="text-xs text-slate-400">Habilita vínculo com usuário da plataforma</p>
                </div>
              </div>
            </div>
          )}

          {/* TAB EMPRESAS */}
          {tab === 'empresas' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                <button
                  type="button"
                  onClick={() => setPermiteTodasEmpresas(!permiteTodasEmpresas)}
                  className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${permiteTodasEmpresas ? 'bg-indigo-500' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${permiteTodasEmpresas ? 'left-5' : 'left-1'}`} />
                </button>
                <div>
                  <p className="text-sm font-medium text-slate-700">Acesso a todas as empresas</p>
                  <p className="text-xs text-slate-400">Ignora os vínculos abaixo e libera todas</p>
                </div>
              </div>

              {!permiteTodasEmpresas && (
                <>
                  <p className="text-xs text-slate-500">Selecione as empresas e defina a empresa principal:</p>
                  <div className="space-y-2">
                    {empresas.map(emp => {
                      const vinculo = vinculos.find(v => v.empresa_id === emp.id)
                      const selecionada = !!vinculo
                      return (
                        <div key={emp.id} className={`rounded-xl border p-3 transition-colors ${selecionada ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}>
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={selecionada}
                              onChange={() => toggleVinculo(emp.id)}
                              className="w-4 h-4 rounded accent-blue-500"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-800 truncate">
                                {emp.nome_fantasia ?? emp.nome}
                              </p>
                              {emp.nome_fantasia && (
                                <p className="text-xs text-slate-400 truncate">{emp.nome}</p>
                              )}
                            </div>
                            {selecionada && (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setPrincipal(emp.id)}
                                  className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${vinculo?.principal ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:border-blue-300'}`}
                                >
                                  {vinculo?.principal ? '★ Principal' : 'Tornar principal'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => togglePodeVender(emp.id)}
                                  className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${vinculo?.pode_vender ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-slate-100 text-slate-400 border border-slate-200'}`}
                                >
                                  {vinculo?.pode_vender ? 'Pode vender' : 'Sem venda'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {vinculos.length > 0 && (
                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-600">
                      {vinculos.length} empresa{vinculos.length > 1 ? 's' : ''} vinculada{vinculos.length > 1 ? 's' : ''}
                      {' · '}Principal: {empresas.find(e => e.id === vinculos.find(v => v.principal)?.empresa_id)?.nome_fantasia ?? '—'}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* TAB COMERCIAL */}
          {tab === 'comercial' && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50">
                <button
                  type="button"
                  onClick={() => setParticipaComissao(!participaComissao)}
                  className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${participaComissao ? 'bg-emerald-500' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${participaComissao ? 'left-5' : 'left-1'}`} />
                </button>
                <div>
                  <p className="text-sm font-medium text-slate-700">Participa de comissão</p>
                  <p className="text-xs text-slate-400">Habilita cálculo de comissão nas vendas deste vendedor</p>
                </div>
              </div>

              {participaComissao && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-2">Tipo de remuneração variável</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { value: 'comissao', label: 'Comissão', desc: '% sobre vendas' },
                        { value: 'bonus',    label: 'Bônus',    desc: 'Valor fixo por meta' },
                        { value: 'meta',     label: 'Meta',     desc: 'Por atingimento de meta' },
                        { value: 'premio',   label: 'Prêmio',   desc: 'Reconhecimento pontual' },
                        { value: 'nenhum',   label: 'Nenhum',   desc: 'Somente salário fixo' },
                      ].map(op => (
                        <button
                          key={op.value}
                          type="button"
                          onClick={() => setTipoRem(op.value)}
                          className={`p-3 rounded-xl border text-left transition-colors ${
                            tipoRem === op.value
                              ? 'border-blue-300 bg-blue-50'
                              : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                          }`}
                        >
                          <p className={`text-sm font-medium ${tipoRem === op.value ? 'text-blue-700' : 'text-slate-700'}`}>{op.label}</p>
                          <p className="text-xs text-slate-400">{op.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Observações sobre comissão</label>
                    <textarea
                      value={obsComissao}
                      onChange={e => setObsComissao(e.target.value)}
                      rows={4}
                      placeholder="Regras específicas, percentuais, metas acordadas…"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400 resize-none"
                    />
                  </div>
                </div>
              )}

              {!participaComissao && (
                <div className="flex flex-col items-center justify-center py-10 text-slate-300">
                  <span className="text-4xl mb-3">💲</span>
                  <p className="text-sm">Ative "Participa de comissão" para configurar</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Rodapé */}
        {erro && (
          <div className="mx-6 mb-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
            {erro}
          </div>
        )}
        <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
          <button
            onClick={onFechar}
            className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={salvando}
            className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {salvando ? 'Salvando…' : isNovo ? 'Criar Vendedor' : 'Salvar Alterações'}
          </button>
        </div>
      </div>
    </div>
  )
}
