'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PAPEIS, type Papel } from '@/lib/auth/permissoes'

type Usuario = {
  id: string
  nome: string | null
  email: string
  telefone: string | null
  cargo: string | null
  role: Papel
  status: 'ativo' | 'inativo' | 'bloqueado' | 'convite_pendente'
  data_termino_acesso: string | null
  observacoes: string | null
  created_at: string
}

const STATUS_LABEL: Record<Usuario['status'], string> = {
  ativo: 'Ativo',
  inativo: 'Inativo',
  bloqueado: 'Bloqueado',
  convite_pendente: 'Convite pendente',
}
const STATUS_COR: Record<Usuario['status'], string> = {
  ativo: 'bg-emerald-50 text-emerald-600 border border-emerald-200',
  inativo: 'bg-slate-100 text-slate-500 border border-slate-200',
  bloqueado: 'bg-red-50 text-red-600 border border-red-200',
  convite_pendente: 'bg-amber-50 text-amber-600 border border-amber-200',
}
const PAPEL_COR: Record<Papel, string> = {
  admin: 'bg-violet-50 text-violet-600 border border-violet-200',
  gerente: 'bg-blue-50 text-blue-600 border border-blue-200',
  financeiro: 'bg-teal-50 text-teal-600 border border-teal-200',
  estoque: 'bg-orange-50 text-orange-600 border border-orange-200',
  vendas: 'bg-green-50 text-green-600 border border-green-200',
  leitura: 'bg-gray-50 text-gray-500 border border-gray-200',
}

function fmtData(s: string) { return new Date(s).toLocaleDateString('pt-BR') }

export default function UsuariosClient({ usuarios, usuarioAtualId, limiteUsuarios }: {
  usuarios: Usuario[]
  usuarioAtualId: string
  limiteUsuarios: number
}) {
  const router = useRouter()
  const [convidarAberto, setConvidarAberto] = useState(false)
  const [editando, setEditando] = useState<Usuario | null>(null)
  const [mensagem, setMensagem] = useState('')

  const ativos = usuarios.filter(u => u.status !== 'inativo').length
  const noLimite = limiteUsuarios !== -1 && ativos >= limiteUsuarios

  const [linkAcesso, setLinkAcesso] = useState<{ email: string; link: string } | null>(null)
  const [copiado, setCopiado] = useState(false)

  function avisar(msg: string) {
    setMensagem(msg)
    setTimeout(() => setMensagem(''), 4000)
  }

  async function acaoRapida(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/usuarios/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
    const data = await res.json()
    if (!data.ok) { avisar(data.erro ?? 'Erro ao atualizar'); return }
    router.refresh()
  }

  // Gera um link novo de acesso. O link vem pra tela de propósito: o gestor
  // manda por WhatsApp e não fica dependendo do e-mail chegar (nem do
  // template do Supabase, que ainda sai em inglês).
  async function gerarLinkAcesso(id: string) {
    setLinkAcesso(null)
    const res = await fetch(`/api/usuarios/${id}/reenviar-convite`, { method: 'POST' })
    const data = await res.json()
    if (!data.ok) { avisar(data.erro ?? 'Erro ao gerar o link'); return }
    setLinkAcesso({ email: data.email, link: data.link })
  }

  async function copiarLink() {
    if (!linkAcesso) return
    try {
      await navigator.clipboard.writeText(linkAcesso.link)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch {
      avisar('Não foi possível copiar automaticamente — selecione o link e copie à mão.')
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Usuários</h1>
          <p className="text-sm text-gray-500">
            {ativos} de {limiteUsuarios === -1 ? '∞' : limiteUsuarios} usuários do plano
          </p>
        </div>
        <button
          onClick={() => noLimite ? avisar(`Seu plano permite até ${limiteUsuarios} usuário(s).`) : setConvidarAberto(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + Convidar usuário
        </button>
      </div>

      {mensagem && (
        <div className="mb-4 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg">{mensagem}</div>
      )}

      {linkAcesso && (
        <div className="mb-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-900 font-medium">Link de acesso para {linkAcesso.email}</p>
          <p className="text-xs text-blue-700 mt-1">
            Mande este link para a pessoa (WhatsApp serve). Ao abrir, ela cria a senha e entra.
            O link vale por tempo limitado e só pode ser usado uma vez — se expirar, é só gerar outro aqui.
          </p>
          <div className="flex gap-2 mt-2">
            <input readOnly value={linkAcesso.link} onFocus={e => e.currentTarget.select()}
              className="flex-1 border border-blue-300 rounded-lg px-3 py-2 text-xs font-mono bg-white text-gray-700" />
            <button onClick={copiarLink}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg whitespace-nowrap">
              {copiado ? '✓ Copiado' : 'Copiar link'}
            </button>
            <button onClick={() => setLinkAcesso(null)}
              className="px-3 py-2 border border-blue-200 text-blue-700 text-xs rounded-lg hover:bg-blue-100">Fechar</button>
          </div>
        </div>
      )}

      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs">Nome</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs">E-mail</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs">Cargo</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs">Papel</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs">Status</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs">Desde</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-500 text-xs">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {usuarios.map(u => (
              <tr key={u.id} className={u.id === usuarioAtualId ? 'bg-blue-50/40' : ''}>
                <td className="px-4 py-2.5 text-gray-800 font-medium">{u.nome || '—'} {u.id === usuarioAtualId && <span className="text-xs text-gray-400">(você)</span>}</td>
                <td className="px-4 py-2.5 text-gray-600">{u.email}</td>
                <td className="px-4 py-2.5 text-gray-600">{u.cargo || '—'}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PAPEL_COR[u.role]}`}>
                    {PAPEIS.find(p => p.valor === u.role)?.label ?? u.role}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COR[u.status]}`}>{STATUS_LABEL[u.status]}</span>
                </td>
                <td className="px-4 py-2.5 text-gray-400 text-xs">{fmtData(u.created_at)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1.5 flex-wrap">
                    {u.status === 'convite_pendente' && (
                      <button onClick={() => gerarLinkAcesso(u.id)} className="text-xs px-2 py-1 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">
                        Gerar link de acesso
                      </button>
                    )}
                    {u.id !== usuarioAtualId && (
                      <>
                        <button onClick={() => setEditando(u)} className="text-xs px-2 py-1 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">
                          Editar
                        </button>
                        {u.status === 'ativo' || u.status === 'convite_pendente' ? (
                          <button onClick={() => acaoRapida(u.id, { status: 'inativo' })} className="text-xs px-2 py-1 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">
                            Inativar
                          </button>
                        ) : (
                          <button onClick={() => acaoRapida(u.id, { status: 'ativo' })} className="text-xs px-2 py-1 border border-emerald-200 text-emerald-600 rounded-lg hover:bg-emerald-50">
                            Ativar
                          </button>
                        )}
                        {u.status !== 'bloqueado' ? (
                          <button onClick={() => acaoRapida(u.id, { status: 'bloqueado' })} className="text-xs px-2 py-1 border border-red-200 text-red-600 rounded-lg hover:bg-red-50">
                            Bloquear
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {usuarios.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Nenhum usuário cadastrado ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {convidarAberto && (
        <ConvidarModal onClose={() => setConvidarAberto(false)} onSaved={() => { setConvidarAberto(false); router.refresh() }} onErro={avisar} />
      )}
      {editando && (
        <EditarModal usuario={editando} onClose={() => setEditando(null)} onSaved={() => { setEditando(null); router.refresh() }} onErro={avisar} />
      )}
    </div>
  )
}

function ConvidarModal({ onClose, onSaved, onErro }: { onClose: () => void; onSaved: () => void; onErro: (m: string) => void }) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [telefone, setTelefone] = useState('')
  const [cargo, setCargo] = useState('')
  const [role, setRole] = useState<Papel>('vendas')
  const [dataTerminoAcesso, setDataTerminoAcesso] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    if (!nome.trim() || !email.trim()) { onErro('Nome e e-mail são obrigatórios.'); return }
    setSalvando(true)
    const res = await fetch('/api/usuarios/convidar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, email, telefone, cargo, role, dataTerminoAcesso: dataTerminoAcesso || null }),
    })
    const data = await res.json()
    setSalvando(false)
    if (!data.ok) { onErro(data.erro ?? 'Erro ao convidar'); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Convidar usuário</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nome completo *</label>
            <input value={nome} onChange={e => setNome(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">E-mail *</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Telefone</label>
              <input value={telefone} onChange={e => setTelefone(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Cargo</label>
              <input value={cargo} onChange={e => setCargo(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Papel *</label>
            <select value={role} onChange={e => setRole(e.target.value as Papel)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
              {PAPEIS.map(p => <option key={p.valor} value={p.valor}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Acesso até (opcional)</label>
            <input type="date" value={dataTerminoAcesso} onChange={e => setDataTerminoAcesso(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
            {salvando ? 'Enviando...' : 'Enviar convite'}
          </button>
        </div>
      </div>
    </div>
  )
}

function EditarModal({ usuario, onClose, onSaved, onErro }: { usuario: Usuario; onClose: () => void; onSaved: () => void; onErro: (m: string) => void }) {
  const [role, setRole] = useState<Papel>(usuario.role)
  const [cargo, setCargo] = useState(usuario.cargo ?? '')
  const [telefone, setTelefone] = useState(usuario.telefone ?? '')
  const [observacoes, setObservacoes] = useState(usuario.observacoes ?? '')
  const [dataTerminoAcesso, setDataTerminoAcesso] = useState(usuario.data_termino_acesso ?? '')
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    setSalvando(true)
    const res = await fetch(`/api/usuarios/${usuario.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, cargo, telefone, observacoes, dataTerminoAcesso: dataTerminoAcesso || null }),
    })
    const data = await res.json()
    setSalvando(false)
    if (!data.ok) { onErro(data.erro ?? 'Erro ao salvar'); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Editar usuário</h2>
        <p className="text-xs text-gray-400 mb-4">{usuario.nome} · {usuario.email}</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Papel</label>
            <select value={role} onChange={e => setRole(e.target.value as Papel)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
              {PAPEIS.map(p => <option key={p.valor} value={p.valor}>{p.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Telefone</label>
              <input value={telefone} onChange={e => setTelefone(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Cargo</label>
              <input value={cargo} onChange={e => setCargo(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Acesso até (opcional)</label>
            <input type="date" value={dataTerminoAcesso} onChange={e => setDataTerminoAcesso(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Observações internas</label>
            <textarea value={observacoes} onChange={e => setObservacoes(e.target.value)} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
