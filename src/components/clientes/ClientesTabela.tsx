'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Categoria } from '@/lib/clientes/categorias'
import { ChipCategoria } from './CategoriasCliente'

// Tabela da lista de clientes com seleção para marcar ou tirar uma categoria
// de vários de uma vez (só os desta página).

export type LinhaCliente = {
  id: string; nome: string; cpf_cnpj: string | null; telefone: string | null; cidade: string | null; estado: string | null
  saldo_credito: number | null; saldo_devedor: number | null; status_credito: string | null; categorias: string[]
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function ClientesTabela({ clientes, categorias, empresaId }: { clientes: LinhaCliente[]; categorias: Categoria[]; empresaId: string }) {
  const router = useRouter()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [alvo, setAlvo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState('')
  const porId = new Map(categorias.map(c => [c.id, c]))
  const todos = clientes.length > 0 && clientes.every(c => sel.has(c.id))

  const alternar = (id: string) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  async function aplicar(acao: 'marcar' | 'tirar') {
    if (!alvo || !sel.size) return
    setOcupado(true); setAviso('')
    const ids = [...sel]
    const sb = createClient()
    const { error } = acao === 'marcar'
      ? await sb.from('cliente_categoria_vinculos')
        .upsert(ids.map(cliente_id => ({ cliente_id, categoria_id: alvo, empresa_id: empresaId })), { onConflict: 'cliente_id,categoria_id', ignoreDuplicates: true })
      : await sb.from('cliente_categoria_vinculos').delete().eq('categoria_id', alvo).in('cliente_id', ids)
    setOcupado(false)
    if (error) { setAviso('Não foi possível concluir. Tente de novo.'); return }
    const nome = porId.get(alvo)?.nome ?? ''
    setAviso(`${acao === 'marcar' ? 'Marcado' : 'Tirado'} "${nome}" ${acao === 'marcar' ? 'em' : 'de'} ${ids.length} cliente${ids.length === 1 ? '' : 's'}.`)
    setSel(new Set())
    router.refresh()
  }

  return (
    <>
      {(sel.size > 0 || aviso) && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-blue-50 border-b border-blue-100 text-sm">
          {sel.size > 0 && <>
            <span className="text-blue-800 font-medium">{sel.size} selecionado{sel.size === 1 ? '' : 's'}</span>
            <select value={alvo} onChange={e => setAlvo(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-sm bg-white">
              <option value="">Escolha a categoria…</option>
              {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <button onClick={() => aplicar('marcar')} disabled={!alvo || ocupado} className="px-3 py-1 rounded-lg bg-blue-600 text-white disabled:opacity-50">Marcar</button>
            <button onClick={() => aplicar('tirar')} disabled={!alvo || ocupado} className="px-3 py-1 rounded-lg border border-gray-300 bg-white text-gray-700 disabled:opacity-50">Tirar</button>
            <button onClick={() => setSel(new Set())} className="text-gray-500 hover:underline">Limpar seleção</button>
            {categorias.length === 0 && <span className="text-xs text-gray-500">Crie as categorias no botão 🏷 Categorias.</span>}
          </>}
          {aviso && <span className="text-emerald-700">{aviso}</span>}
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-500 bg-gray-50 border-b border-gray-200">
            <th className="w-10 px-4 py-3">
              <input type="checkbox" checked={todos} onChange={() => setSel(todos ? new Set() : new Set(clientes.map(c => c.id)))} title="Selecionar todos desta página" />
            </th>
            <th className="text-left px-4 py-3 font-medium">Nome</th>
            <th className="text-left px-4 py-3 font-medium">CPF/CNPJ</th>
            <th className="text-left px-4 py-3 font-medium">Telefone</th>
            <th className="text-left px-4 py-3 font-medium">Cidade</th>
            <th className="text-right px-4 py-3 font-medium">Crédito</th>
            <th className="text-right px-4 py-3 font-medium">Débito</th>
            <th className="text-center px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {clientes.map(c => (
            <tr key={c.id} className={`text-gray-600 hover:bg-gray-50 transition-colors ${sel.has(c.id) ? 'bg-blue-50/50' : ''}`}>
              <td className="px-4 py-2.5"><input type="checkbox" checked={sel.has(c.id)} onChange={() => alternar(c.id)} /></td>
              <td className="px-4 py-2.5 text-gray-900 font-medium">
                <Link href={`/dashboard/clientes/${c.id}`} className="hover:text-blue-600 transition-colors">{c.nome}</Link>
                {c.categorias.length > 0 && (
                  <span className="flex flex-wrap gap-1 mt-0.5">
                    {c.categorias.map(id => porId.get(id)).filter((k): k is Categoria => Boolean(k)).map(k => <ChipCategoria key={k.id} c={k} pequeno />)}
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{c.cpf_cnpj ?? '—'}</td>
              <td className="px-4 py-2.5 text-gray-400">{c.telefone ?? '—'}</td>
              <td className="px-4 py-2.5 text-gray-400">{c.cidade ? `${c.cidade}/${c.estado}` : '—'}</td>
              <td className="px-4 py-2.5 text-right text-emerald-600">{(c.saldo_credito ?? 0) > 0 ? brl(c.saldo_credito ?? 0) : '—'}</td>
              <td className="px-4 py-2.5 text-right text-red-600">{(c.saldo_devedor ?? 0) > 0 ? brl(c.saldo_devedor ?? 0) : '—'}</td>
              <td className="px-4 py-2.5 text-center">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                  c.status_credito === 'liberado' ? 'bg-green-100 text-green-700 border-green-200' :
                  c.status_credito === 'bloqueado' ? 'bg-red-100 text-red-600 border-red-200' :
                  'bg-yellow-100 text-yellow-700 border-yellow-200'
                }`}>
                  {c.status_credito ?? 'liberado'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
