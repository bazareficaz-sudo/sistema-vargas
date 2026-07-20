'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CATEGORIAS_PERMISSOES, PermissoesPdv, sha256Hex } from './permissoes'

interface Empresa {
  id: string
  nome: string
  nome_fantasia?: string
}

interface Deposito {
  id: string
  empresa_id: string
  nome: string
  principal?: boolean
}

export interface UsuarioPdv {
  id: string
  nome: string
  login: string
  cargo?: string
  ativo: boolean
  senha_hash?: string
  limite_desconto?: number
  empresa_id: string
  empresa_nome?: string
  empresa_fiscal_id?: string
  empresa_fiscal_nome?: string
  empresa_estoque_id?: string
  empresa_estoque_nome?: string
  deposito_id?: string | null
  deposito_nome?: string | null
  unificar_estoque?: boolean
  permissoes?: PermissoesPdv
  created_at?: string
}

interface Props {
  usuario: UsuarioPdv | null
  empresas: Empresa[]
  depositos: Deposito[]
  empresaAtualId: string
  onSalvar: (u: UsuarioPdv) => void
  onFechar: () => void
}

function gerarId() {
  return crypto.randomUUID()
}

function CheckCircle({ checked }: { checked: boolean }) {
  return (
    <span
      className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 border transition-colors ${
        checked ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-300'
      }`}
    >
      {checked && (
        <svg viewBox="0 0 20 20" fill="white" className="w-3 h-3">
          <path d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 111.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z" />
        </svg>
      )}
    </span>
  )
}

export default function UsuarioPdvModal({ usuario, empresas, depositos, empresaAtualId, onSalvar, onFechar }: Props) {
  const isNovo = !usuario

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const [nome, setNome] = useState(usuario?.nome ?? '')
  const [login, setLogin] = useState(usuario?.login ?? '')
  const [senha, setSenha] = useState('')
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [limiteDesconto, setLimiteDesconto] = useState(String(usuario?.limite_desconto ?? 0))
  const [ativo, setAtivo] = useState(usuario?.ativo ?? true)

  const [empresaFiscalId, setEmpresaFiscalId] = useState(usuario?.empresa_fiscal_id ?? empresaAtualId)
  const [empresaEstoqueId, setEmpresaEstoqueId] = useState(usuario?.empresa_estoque_id ?? empresaAtualId)
  const [depositoId, setDepositoId] = useState(usuario?.deposito_id ?? '')
  const [unificarEstoque, setUnificarEstoque] = useState(usuario?.unificar_estoque ?? false)

  const [permissoes, setPermissoes] = useState<PermissoesPdv>(usuario?.permissoes ?? {})

  function togglePermissao(key: string) {
    setPermissoes(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const depositosDaEmpresa = depositos.filter(d => d.empresa_id === empresaEstoqueId)

  async function salvar() {
    setErro('')
    if (!nome.trim()) { setErro('O nome é obrigatório.'); return }
    if (!login.trim()) { setErro('O login é obrigatório.'); return }
    if (isNovo && !senha) { setErro('A senha é obrigatória para um novo usuário.'); return }

    setSalvando(true)
    try {
      const supabase = createClient()
      const id = usuario?.id ?? gerarId()

      const empresaFiscal = empresas.find(e => e.id === empresaFiscalId)
      const empresaEstoque = empresas.find(e => e.id === empresaEstoqueId)
      const deposito = depositosDaEmpresa.find(d => d.id === depositoId)

      const payload: Record<string, unknown> = {
        id,
        empresa_id: empresaAtualId,
        empresa_nome: empresas.find(e => e.id === empresaAtualId)?.nome_fantasia ?? empresas.find(e => e.id === empresaAtualId)?.nome ?? null,
        nome: nome.trim(),
        login: login.trim(),
        cargo: usuario?.cargo ?? 'Operador',
        ativo,
        limite_desconto: Number(limiteDesconto) || 0,
        empresa_fiscal_id: empresaFiscalId || null,
        empresa_fiscal_nome: empresaFiscal?.nome_fantasia ?? empresaFiscal?.nome ?? null,
        empresa_estoque_id: empresaEstoqueId || null,
        empresa_estoque_nome: empresaEstoque?.nome_fantasia ?? empresaEstoque?.nome ?? null,
        deposito_id: depositoId || null,
        deposito_nome: deposito?.nome ?? null,
        unificar_estoque: unificarEstoque,
        permissoes,
        updated_at: new Date().toISOString(),
        ...(isNovo && { created_at: new Date().toISOString() }),
      }

      if (senha) {
        payload.senha_hash = await sha256Hex(senha)
      }

      const { error: errU } = await supabase.from('usuarios_pdv').upsert(payload, { onConflict: 'id' })
      if (errU) throw errU

      onSalvar({ ...(usuario ?? {}), ...payload, id } as UsuarioPdv)
    } catch (e: any) {
      setErro(e?.message ?? 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onFechar} />

      <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col h-screen overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-slate-900 text-xl font-bold">
              {isNovo ? 'Novo Usuário PDV' : 'Editar Usuário PDV'}
            </h2>
            {!isNovo && <p className="text-slate-400 text-xs mt-0.5">{usuario.nome}</p>}
          </div>
          <button onClick={onFechar} className="text-slate-400 hover:text-slate-600 text-2xl leading-none p-1">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Nome *</label>
              <input value={nome} onChange={e => setNome(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Login *</label>
              <input value={login} onChange={e => setLogin(e.target.value.trim().toLowerCase())} autoCapitalize="off" autoCorrect="off"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Senha {!isNovo && '(deixe vazio para manter a atual)'}
            </label>
            <div className="relative">
              <input
                type={mostrarSenha ? 'text' : 'password'}
                value={senha}
                onChange={e => setSenha(e.target.value)}
                placeholder={isNovo ? 'Senha do operador' : 'Nova senha (opcional)'}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 pr-10 text-sm text-slate-800 focus:outline-none focus:border-blue-400"
              />
              <button
                type="button"
                onClick={() => setMostrarSenha(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
              >
                {mostrarSenha ? 'ocultar' : 'ver'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Limite de desconto (%)</label>
              <input type="number" min={0} max={100} value={limiteDesconto} onChange={e => setLimiteDesconto(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
              <p className="text-xs text-slate-400 mt-1">0 = sem limite de desconto (se permitido dar desconto)</p>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-3 cursor-pointer" onClick={() => setAtivo(v => !v)}>
                <button
                  type="button"
                  className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${ativo ? 'bg-emerald-500' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${ativo ? 'left-5' : 'left-1'}`} />
                </button>
                <span className="text-sm font-medium text-slate-700">{ativo ? 'Ativo' : 'Inativo'}</span>
              </label>
            </div>
          </div>

          <hr className="border-slate-100" />
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Permissões do PDV</p>
            <div className="space-y-4">
              {CATEGORIAS_PERMISSOES.map(cat => (
                <div key={cat.label}>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">{cat.label}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {cat.itens.map(item => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => togglePermissao(item.key)}
                        className="flex items-center gap-2 text-left py-0.5"
                      >
                        <CheckCircle checked={!!permissoes[item.key]} />
                        <span className="text-sm text-slate-700">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <hr className="border-slate-100" />
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Fiscal</p>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Empresa de emissão fiscal</label>
            <select value={empresaFiscalId} onChange={e => setEmpresaFiscalId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400">
              {empresas.map(e => <option key={e.id} value={e.id}>{e.nome_fantasia ?? e.nome}</option>)}
            </select>
            <p className="text-xs text-slate-400 mt-1">Empresa do grupo que fará a emissão fiscal (NFC-e/NF-e) das vendas deste operador (independente da empresa de estoque).</p>
          </div>

          <hr className="border-slate-100" />
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Estoque</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Empresa do estoque</label>
                <select value={empresaEstoqueId} onChange={e => { setEmpresaEstoqueId(e.target.value); setDepositoId('') }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400">
                  {empresas.map(e => <option key={e.id} value={e.id}>{e.nome_fantasia ?? e.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Depósito</label>
                <select value={depositoId} onChange={e => setDepositoId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400">
                  <option value="">— nenhum —</option>
                  {depositosDaEmpresa.map(d => (
                    <option key={d.id} value={d.id}>{d.nome}{d.principal ? ' · principal' : ''}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-1">Empresa e depósito onde o estoque será movimentado por este operador (independente da empresa de emissão fiscal).</p>
            <button
              type="button"
              onClick={() => setUnificarEstoque(v => !v)}
              className="flex items-center gap-2 mt-3"
            >
              <CheckCircle checked={unificarEstoque} />
              <span className="text-sm text-slate-700">Unificar estoque</span>
            </button>
          </div>
        </div>

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
            {salvando ? 'Salvando…' : isNovo ? 'Criar Usuário' : 'Atualizar Usuário'}
          </button>
        </div>
      </div>
    </div>
  )
}
