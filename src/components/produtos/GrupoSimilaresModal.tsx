'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { normalizarGrupoSimilar, sugerirNomeGrupo } from '@/lib/produtos/similares'

// GRUPO DE SIMILARES EM MASSA — o mesmo item de marcas diferentes.
//
// O grupo já existia (produtos.grupo_similar): no PDV, lançar um produto com
// grupo abre as outras marcas para o vendedor escolher. Mas só se montava
// abrindo produto por produto e digitando o mesmo rótulo em cada um. Aqui:
// marca os produtos na lista, dá um nome ao grupo, pronto.

type ProdutoSel = { id: string; nome: string; marca: string | null; grupo_similar?: string | null }

export default function GrupoSimilaresModal({ produtos, empresaId, onClose, onAplicado }: {
  produtos: ProdutoSel[]
  empresaId: string
  onClose: () => void
  onAplicado: (grupo: string | null) => void
}) {
  // Grupos que já existem, com quantos produtos cada um tem — para escolher
  // um existente em vez de criar um quase igual.
  const [grupos, setGrupos] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    createClient().from('produtos').select('grupo_similar').eq('empresa_id', empresaId)
      .not('grupo_similar', 'is', null).limit(10000)
      .then(({ data }) => {
        const m = new Map<string, number>()
        for (const r of (data ?? []) as { grupo_similar: string }[]) m.set(r.grupo_similar, (m.get(r.grupo_similar) ?? 0) + 1)
        setGrupos(m)
      })
  }, [empresaId])

  // Começa pelo grupo que os selecionados já têm (o mais comum entre eles);
  // sem nenhum, sugere as palavras em comum dos nomes.
  const [nome, setNome] = useState(() => {
    const cont = new Map<string, number>()
    for (const p of produtos) if (p.grupo_similar) cont.set(p.grupo_similar, (cont.get(p.grupo_similar) ?? 0) + 1)
    const maisComum = [...cont.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    return maisComum ?? sugerirNomeGrupo(produtos.map(p => p.nome)) ?? ''
  })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const alvo = normalizarGrupoSimilar(nome)
  const idsSel = useMemo(() => new Set(produtos.map(p => p.id)), [produtos])
  // Quantos do grupo escolhido NÃO estão na seleção: eles continuam no grupo.
  const jaNoGrupoForaDaSelecao = alvo
    ? (grupos.get(alvo) ?? 0) - produtos.filter(p => p.grupo_similar === alvo).length
    : 0
  const mudamDeGrupo = produtos.filter(p => p.grupo_similar && p.grupo_similar !== alvo)
  const algumComGrupo = produtos.some(p => p.grupo_similar)

  async function gravar(grupo: string | null) {
    setSalvando(true); setErro('')
    const { error } = await createClient().from('produtos')
      .update({ grupo_similar: grupo, updated_at: new Date().toISOString() })
      .in('id', [...idsSel])
    setSalvando(false)
    if (error) { setErro(error.message); return }
    onAplicado(grupo)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !salvando && onClose()} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">🔗 Grupo de similares</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              O mesmo item de marcas diferentes. No PDV, ao lançar um deles, o vendedor vê as outras opções do grupo.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome do grupo</label>
            <input value={nome} onChange={e => setNome(e.target.value)} onBlur={e => setNome(normalizarGrupoSimilar(e.target.value) ?? '')}
              list="grupos-similares-massa" placeholder="Ex.: DISJUNTOR MONO 32A" autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base sm:text-sm uppercase focus:outline-none focus:border-blue-500" />
            <datalist id="grupos-similares-massa">
              {[...grupos.keys()].sort().map(g => <option key={g} value={g} />)}
            </datalist>
            {alvo && (
              <p className="text-[11px] mt-1 text-gray-500">
                {jaNoGrupoForaDaSelecao > 0
                  ? <>O grupo <strong>{alvo}</strong> já existe com {jaNoGrupoForaDaSelecao} outro(s) produto(s); os selecionados entram junto.</>
                  : grupos.has(alvo) ? <>Grupo <strong>{alvo}</strong>.</> : <>Grupo novo: <strong>{alvo}</strong>.</>}
              </p>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">{produtos.length} produto(s) selecionado(s)</p>
            <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-64 overflow-y-auto">
              {produtos.map(p => (
                <li key={p.id} className="px-3 py-2 text-sm">
                  <p className="text-gray-900">{p.nome}</p>
                  <p className="text-[11px] text-gray-500">
                    {p.marca || 'sem marca'}
                    {p.grupo_similar && p.grupo_similar !== alvo && <span className="text-amber-700"> · sai do grupo {p.grupo_similar}</span>}
                    {p.grupo_similar && p.grupo_similar === alvo && <span className="text-emerald-700"> · já está neste grupo</span>}
                  </p>
                </li>
              ))}
            </ul>
            {produtos.length === 1 && !grupos.has(alvo ?? '') && (
              <p className="text-[11px] text-amber-700 mt-1">Um grupo com um produto só não mostra nada no PDV — selecione as outras marcas junto, ou escolha um grupo existente.</p>
            )}
            {mudamDeGrupo.length > 0 && (
              <p className="text-[11px] text-amber-700 mt-1">{mudamDeGrupo.length} produto(s) vão sair do grupo em que estavam.</p>
            )}
          </div>

          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex flex-wrap items-center gap-2">
          {algumComGrupo && (
            <button onClick={() => { if (confirm('Tirar os produtos selecionados de qualquer grupo de similares?')) void gravar(null) }}
              disabled={salvando} className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50">
              Remover do grupo
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} disabled={salvando} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
            <button onClick={() => void gravar(alvo)} disabled={salvando || !alvo}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {salvando ? 'Salvando…' : 'Salvar grupo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
