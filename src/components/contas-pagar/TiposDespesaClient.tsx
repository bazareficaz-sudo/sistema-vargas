'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Cadastro de Tipos de Despesa. É o que transforma "R$ 38 mil pagos no mês"
// em "R$ 31 mil de fornecedor, R$ 4 mil de imposto, R$ 3 mil de luz" — sem
// ele, o relatório só sabe somar.

type Tipo = { id: string; nome: string; cor: string | null; ativo: boolean }

const CORES = ['#2563eb','#f59e0b','#0891b2','#7c3aed','#dc2626','#059669','#4f46e5','#ea580c','#65a30d','#6b7280']

export default function TiposDespesaClient({
  tipos: inicial, contagem, empresaId,
}: { tipos: Tipo[]; contagem: Record<string, number>; empresaId: string }) {
  const router = useRouter()
  const [tipos, setTipos] = useState(inicial)
  const [novo, setNovo] = useState('')
  const [novaCor, setNovaCor] = useState(CORES[0])
  const [editando, setEditando] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState('')
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function criar() {
    const nome = novo.trim()
    if (!nome) return
    setSalvando(true); setErro('')
    const sb = createClient()
    const { data, error } = await sb.from('tipos_despesa')
      .insert({ empresa_id: empresaId, nome, cor: novaCor })
      .select('id, nome, cor, ativo').single()
    setSalvando(false)
    if (error) {
      // O índice único é por nome normalizado — a mensagem crua do Postgres
      // não diz nada para quem está na tela.
      setErro(error.code === '23505' ? `Já existe um tipo chamado "${nome}".` : error.message)
      return
    }
    setTipos(t => [...t, data as Tipo].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')))
    setNovo('')
    router.refresh()
  }

  async function renomear(id: string) {
    const nome = rascunho.trim()
    if (!nome) { setEditando(null); return }
    const sb = createClient()
    const { error } = await sb.from('tipos_despesa').update({ nome, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { setErro(error.code === '23505' ? `Já existe um tipo chamado "${nome}".` : error.message); return }
    setTipos(t => t.map(x => x.id === id ? { ...x, nome } : x))
    setEditando(null); setErro('')
    router.refresh()
  }

  async function mudarCor(id: string, cor: string) {
    const sb = createClient()
    await sb.from('tipos_despesa').update({ cor }).eq('id', id)
    setTipos(t => t.map(x => x.id === id ? { ...x, cor } : x))
  }

  // Desativa em vez de apagar: as contas já classificadas continuam
  // apontando para o tipo, e o relatório do ano passado não pode mudar
  // porque alguém arrumou a lista hoje.
  async function alternarAtivo(id: string, ativo: boolean) {
    const sb = createClient()
    await sb.from('tipos_despesa').update({ ativo, updated_at: new Date().toISOString() }).eq('id', id)
    setTipos(t => t.map(x => x.id === id ? { ...x, ativo } : x))
    router.refresh()
  }

  const ativos = tipos.filter(t => t.ativo)
  const inativos = tipos.filter(t => !t.ativo)

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>Configurações</span><span>›</span><span className="text-gray-600">Tipos de Despesa</span>
      </div>

      <h1 className="text-xl font-semibold text-gray-900">Tipos de Despesa</h1>
      <p className="text-sm text-gray-500 mt-1 mb-5">
        Categoria de cada conta a pagar. É o que o relatório usa para separar compra de mercadoria de
        luz, imposto e aluguel.
      </p>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <label className="block text-xs font-medium text-gray-600 mb-2">Novo tipo</label>
        <div className="flex items-center gap-2">
          <input value={novo} onChange={e => setNovo(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') criar() }}
            placeholder="Ex.: Combustível"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
          <div className="flex gap-1">
            {CORES.map(c => (
              <button key={c} onClick={() => setNovaCor(c)} title={c}
                className={`w-6 h-6 rounded-full border-2 ${novaCor === c ? 'border-gray-900' : 'border-transparent'}`}
                style={{ background: c }} />
            ))}
          </div>
          <button onClick={criar} disabled={salvando || !novo.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
            Adicionar
          </button>
        </div>
        {erro && <p className="text-sm text-red-600 mt-2">{erro}</p>}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase">
          Em uso ({ativos.length})
        </div>
        <div className="divide-y divide-gray-100">
          {ativos.map(t => (
            <div key={t.id} className="px-4 py-3 flex items-center gap-3">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: t.cor ?? '#6b7280' }} />
              {editando === t.id ? (
                <input value={rascunho} autoFocus
                  onChange={e => setRascunho(e.target.value)}
                  onBlur={() => renomear(t.id)}
                  onKeyDown={e => { if (e.key === 'Enter') renomear(t.id); if (e.key === 'Escape') setEditando(null) }}
                  className="flex-1 border border-blue-400 rounded px-2 py-1 text-sm focus:outline-none" />
              ) : (
                <button onClick={() => { setEditando(t.id); setRascunho(t.nome) }}
                  className="flex-1 text-left text-sm text-gray-900 hover:text-blue-600">
                  {t.nome}
                </button>
              )}
              <span className="text-xs text-gray-400 shrink-0">
                {contagem[t.id] ? `${contagem[t.id]} conta(s)` : 'sem uso'}
              </span>
              <div className="flex gap-1 shrink-0">
                {CORES.map(c => (
                  <button key={c} onClick={() => mudarCor(t.id, c)}
                    className={`w-4 h-4 rounded-full border ${t.cor === c ? 'border-gray-900' : 'border-gray-200'}`}
                    style={{ background: c }} />
                ))}
              </div>
              <button onClick={() => alternarAtivo(t.id, false)}
                className="text-xs text-gray-400 hover:text-red-600 shrink-0">desativar</button>
            </div>
          ))}
          {ativos.length === 0 && <p className="px-4 py-8 text-center text-sm text-gray-400">Nenhum tipo ativo.</p>}
        </div>

        {inativos.length > 0 && (
          <>
            <div className="px-4 py-2.5 border-y border-gray-100 bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
              Desativados ({inativos.length})
            </div>
            <div className="divide-y divide-gray-100">
              {inativos.map(t => (
                <div key={t.id} className="px-4 py-2.5 flex items-center gap-3 opacity-60">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: t.cor ?? '#6b7280' }} />
                  <span className="flex-1 text-sm text-gray-600 line-through">{t.nome}</span>
                  <span className="text-xs text-gray-400">{contagem[t.id] ? `${contagem[t.id]} conta(s)` : ''}</span>
                  <button onClick={() => alternarAtivo(t.id, true)}
                    className="text-xs text-blue-600 hover:text-blue-700">reativar</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Desativar não apaga: as contas já classificadas continuam com o tipo e seguem aparecendo no
        relatório. O tipo só some da lista de escolha em pagamentos novos.
      </p>
    </div>
  )
}
