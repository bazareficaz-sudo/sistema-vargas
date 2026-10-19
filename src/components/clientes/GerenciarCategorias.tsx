'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CORES, nomeCategoria, nomeRepetido, type Categoria, type CorCategoria } from '@/lib/clientes/categorias'
import { useCategorias } from './CategoriasCliente'

// Criar, renomear, trocar a cor e apagar categorias. Apagar tira a etiqueta
// dos clientes (o cadastro do cliente não muda).

export default function GerenciarCategorias({ empresaId, categorias, contagem }: {
  empresaId: string; categorias: Categoria[]; contagem: Record<string, number>
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const { lista, recarregar, criar, criarSugeridas } = useCategorias(empresaId, categorias)
  const [nova, setNova] = useState('')
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(null)
  const [erro, setErro] = useState('')

  const fechar = () => { setAberto(false); setEditando(null); setErro(''); router.refresh() }

  async function adicionar() {
    setErro('')
    const r = await criar(nova)
    if (typeof r === 'string') setErro(r); else setNova('')
  }
  async function renomear() {
    if (!editando) return
    const nome = nomeCategoria(editando.nome)
    if (!nome) { setErro('Digite o nome.'); return }
    if (nomeRepetido(lista, nome, editando.id)) { setErro('Já existe uma categoria com esse nome.'); return }
    const { error } = await createClient().from('cliente_categorias').update({ nome, updated_at: new Date().toISOString() }).eq('id', editando.id)
    if (error) { setErro('Não foi possível renomear.'); return }
    setEditando(null); setErro(''); recarregar()
  }
  async function mudarCor(c: Categoria, cor: CorCategoria) {
    const { error } = await createClient().from('cliente_categorias').update({ cor, updated_at: new Date().toISOString() }).eq('id', c.id)
    if (error) setErro('Não foi possível mudar a cor.'); else recarregar()
  }
  async function apagar(c: Categoria) {
    const n = contagem[c.id] ?? 0
    if (!confirm(`Apagar a categoria "${c.nome}"?${n ? ` Ela sai de ${n} cliente${n === 1 ? '' : 's'} (o cadastro deles não muda).` : ''}`)) return
    const { error } = await createClient().from('cliente_categorias').delete().eq('id', c.id)
    if (error) setErro('Não foi possível apagar.'); else recarregar()
  }

  return (
    <>
      <button onClick={() => setAberto(true)}
        className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors">
        🏷 Categorias
      </button>
      {aberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={fechar} />
          <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Categorias de cliente</h2>
                <p className="text-xs text-gray-500">Para marcar o tipo de cliente (ex.: Eletricista) e filtrar depois.</p>
              </div>
              <button onClick={fechar} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
              {lista.length === 0 && (
                <div className="p-5 text-sm text-gray-500 text-center">
                  Nenhuma categoria ainda.
                  <button onClick={async () => { const r = await criarSugeridas(); if (r) setErro(r) }} className="block mx-auto mt-2 text-blue-600 hover:underline">
                    Criar as sugeridas (Eletricista, Bombeiro hidráulico, Pedreiro, Gesseiro…)
                  </button>
                </div>
              )}
              {lista.map(c => (
                <div key={c.id} className="px-5 py-2.5 flex items-center gap-3">
                  <div className="flex gap-1">
                    {(Object.keys(CORES) as CorCategoria[]).map(cor => (
                      <button key={cor} onClick={() => mudarCor(c, cor)} title={CORES[cor].rotulo}
                        className={`w-3.5 h-3.5 rounded-full ${CORES[cor].ponto} ${c.cor === cor ? 'ring-2 ring-offset-1 ring-gray-500' : 'opacity-40 hover:opacity-100'}`} />
                    ))}
                  </div>
                  {editando?.id === c.id
                    ? <input autoFocus value={editando.nome} maxLength={40} onChange={e => setEditando({ id: c.id, nome: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter') renomear(); else if (e.key === 'Escape') setEditando(null) }}
                        onBlur={renomear} className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" />
                    : <button onClick={() => setEditando({ id: c.id, nome: c.nome })} title="Renomear"
                        className={`text-xs px-2.5 py-0.5 rounded-full border ${CORES[c.cor].chip}`}>{c.nome}</button>}
                  <span className="ml-auto text-xs text-gray-400 whitespace-nowrap">{contagem[c.id] ?? 0} cliente{(contagem[c.id] ?? 0) === 1 ? '' : 's'}</span>
                  <button onClick={() => apagar(c)} title="Apagar" className="text-gray-400 hover:text-red-600 text-sm">🗑</button>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 space-y-1">
              <div className="flex gap-2">
                <input value={nova} onChange={e => setNova(e.target.value)} maxLength={40} placeholder="Nova categoria (ex.: Serralheiro)"
                  onKeyDown={e => e.key === 'Enter' && adicionar()}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500" />
                <button onClick={adicionar} disabled={!nova.trim()} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg disabled:opacity-50">Adicionar</button>
              </div>
              {erro && <p className="text-xs text-red-600">{erro}</p>}
              <p className="text-[11px] text-gray-400">Clique no nome para renomear. A contagem atualiza ao fechar.</p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
