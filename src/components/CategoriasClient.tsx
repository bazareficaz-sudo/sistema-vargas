'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Categoria = { id: string; nome: string; pai_id: string | null; ativo: boolean; created_at: string }

export default function CategoriasClient({ categorias: inicial, empresaId, contagem = {} }: {
  categorias: Categoria[]; empresaId: string; contagem?: Record<string, number>
}) {
  const router = useRouter()
  const [categorias, setCategorias] = useState(inicial)
  const [movendo, setMovendo] = useState<string | null>(null)
  const [aviso, setAviso] = useState('')
  const [novoNome, setNovoNome] = useState('')
  const [novoPai, setNovoPai] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [editando, setEditando] = useState<Categoria | null>(null)
  const [editNome, setEditNome] = useState('')
  const [erro, setErro] = useState('')

  const raizes = categorias.filter(c => !c.pai_id)
  const subs = categorias.filter(c => !!c.pai_id)

  async function adicionar() {
    if (!novoNome.trim()) return
    setErro('')
    setSalvando(true)
    const sb = createClient()
    const { data, error } = await sb.from('categorias').insert({
      empresa_id: empresaId || null,
      nome: novoNome.trim(),
      pai_id: novoPai || null,
      ativo: true,
    }).select().single()
    setSalvando(false)
    if (error) { setErro(`Erro: ${error.message}`); return }
    if (data) setCategorias(prev => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)))
    setNovoNome(''); setNovoPai('')
  }

  async function toggleAtivo(cat: Categoria) {
    const sb = createClient()
    await sb.from('categorias').update({ ativo: !cat.ativo }).eq('id', cat.id)
    setCategorias(prev => prev.map(c => c.id === cat.id ? { ...c, ativo: !c.ativo } : c))
  }

  async function salvarEdicao() {
    if (!editando || !editNome.trim()) return
    const sb = createClient()
    await sb.from('categorias').update({ nome: editNome.trim() }).eq('id', editando.id)
    setCategorias(prev => prev.map(c => c.id === editando.id ? { ...c, nome: editNome } : c))
    setEditando(null)
  }

  async function excluir(id: string) {
    if (!confirm('Excluir esta categoria?')) return
    const sb = createClient()
    await sb.from('categorias').delete().eq('id', id)
    setCategorias(prev => prev.filter(c => c.id !== id))
  }

  /**
   * Move uma categoria para dentro de outra — e leva os produtos junto.
   *
   * É a operação que faltava. A base tem 100 categorias soltas no mesmo nível,
   * várias delas partes de outra: TORNEIRAS, REGISTROS e RALOS E GRELHAS são
   * MATERIAL HIDRÁULICO. Sem isto, transformar TORNEIRAS em subcategoria
   * deixaria 1.788 produtos apontando para uma categoria que sumiu do primeiro
   * nível — classificados em lugar nenhum.
   *
   * Por isso a mudança de pai reclassifica os produtos na mesma ação:
   * `categoria` vira o nome do pai e `subcategoria` vira o nome de quem foi
   * movido. Passa a ser um clique em vez de 1.788 edições.
   */
  async function moverPara(cat: Categoria, novoPaiId: string) {
    const pai = novoPaiId ? categorias.find(c => c.id === novoPaiId) : null
    if (novoPaiId && !pai) return
    if (novoPaiId === cat.id) { setErro('Uma categoria não pode ser subcategoria dela mesma.'); return }
    // Só um nível: o cadastro do produto tem dois campos, não uma árvore.
    if (pai?.pai_id) { setErro(`"${pai.nome}" já é uma subcategoria. O sistema trabalha com dois níveis.`); return }
    if (categorias.some(c => c.pai_id === cat.id)) {
      setErro(`"${cat.nome}" tem subcategorias dentro dela. Mova ou apague as subcategorias antes.`); return
    }

    const quantos = contagem[cat.nome] ?? 0
    const destino = pai ? `dentro de "${pai.nome}"` : 'para o primeiro nível'
    const texto = quantos > 0
      ? `Mover "${cat.nome}" ${destino}?\n\n${quantos} produto(s) serão reclassificados: categoria passa a ser "${pai?.nome ?? cat.nome}"${pai ? ` e subcategoria "${cat.nome}"` : ' e ficam sem subcategoria'}.`
      : `Mover "${cat.nome}" ${destino}?`
    if (!confirm(texto)) return

    setMovendo(cat.id); setErro(''); setAviso('')
    const sb = createClient()

    const { error } = await sb.from('categorias').update({ pai_id: novoPaiId || null }).eq('id', cat.id)
    if (error) { setMovendo(null); setErro(`Erro ao mover: ${error.message}`); return }

    // Reclassifica os produtos que estavam nesta categoria. Vira subcategoria
    // do novo pai; voltando para o primeiro nível, volta a ser categoria.
    let reclassificados = 0
    if (pai) {
      const { data, error: e2 } = await sb.from('produtos')
        .update({ categoria: pai.nome, subcategoria: cat.nome })
        .eq('empresa_id', empresaId).eq('categoria', cat.nome).select('id')
      if (e2) { setMovendo(null); setErro(`Categoria movida, mas os produtos não foram reclassificados: ${e2.message}`); return }
      reclassificados = data?.length ?? 0
    } else {
      const { data, error: e2 } = await sb.from('produtos')
        .update({ categoria: cat.nome, subcategoria: null })
        .eq('empresa_id', empresaId).eq('subcategoria', cat.nome).select('id')
      if (e2) { setMovendo(null); setErro(`Categoria movida, mas os produtos não foram reclassificados: ${e2.message}`); return }
      reclassificados = data?.length ?? 0
    }

    setCategorias(prev => prev.map(c => (c.id === cat.id ? { ...c, pai_id: novoPaiId || null } : c)))
    setMovendo(null)
    setAviso(`"${cat.nome}" movida${reclassificados > 0 ? ` · ${reclassificados} produto(s) reclassificado(s)` : ''}.`)
    router.refresh()
  }

  function nomePai(paiId: string | null) {
    if (!paiId) return null
    return categorias.find(c => c.id === paiId)?.nome ?? null
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
            <span>início</span><span>›</span><span>cadastros</span><span>›</span>
            <span className="text-gray-600 font-medium">categorias</span>
          </div>
          <h1 className="text-gray-900 text-xl font-semibold">Categorias</h1>
        </div>
      </div>

      {/* Adicionar */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-medium text-gray-700 mb-3">Nova categoria / subcategoria</h2>
        <div className="flex gap-3">
          <input
            value={novoNome}
            onChange={e => setNovoNome(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && adicionar()}
            placeholder="Nome da categoria"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
          />
          <select value={novoPai} onChange={e => setNovoPai(e.target.value)}
            className="w-48 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500">
            <option value="">Categoria raiz</option>
            {raizes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <button onClick={adicionar} disabled={salvando || !novoNome.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {salvando ? '...' : '+ Adicionar'}
          </button>
        </div>
        {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
        {aviso && <p className="mt-2 text-sm text-emerald-700">{aviso}</p>}
        <p className="mt-3 text-xs text-gray-500">
          Dois níveis: categoria e subcategoria. Para transformar uma categoria existente em
          subcategoria — TORNEIRAS dentro de MATERIAL HIDRÁULICO, por exemplo — use a coluna
          <b> Fica dentro de</b> na lista abaixo. Os produtos daquela categoria são reclassificados
          junto, sem precisar editar um por um.
        </p>
      </div>

      {/* Lista */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Nome</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Fica dentro de</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Uso</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Ativo</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {categorias.map(c => (
              <tr key={c.id} className="hover:bg-gray-50 transition-colors group">
                <td className="px-4 py-3 text-gray-900 font-medium">
                  {editando?.id === c.id ? (
                    <div className="flex gap-2">
                      <input value={editNome} onChange={e => setEditNome(e.target.value)}
                        className="border border-blue-400 rounded px-2 py-1 text-sm focus:outline-none" autoFocus />
                      <button onClick={salvarEdicao} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Salvar</button>
                      <button onClick={() => setEditando(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
                    </div>
                  ) : (
                    <span className={!c.pai_id ? 'font-semibold' : 'pl-4 text-gray-700'}>
                      {!c.pai_id ? '' : '↳ '}{c.nome}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs">
                  {/* Mudar o pai aqui é o que reorganiza a árvore E os produtos
                      de uma vez — ver moverPara(). */}
                  <select value={c.pai_id ?? ''} disabled={movendo === c.id}
                    onChange={e => moverPara(c, e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-700 bg-white disabled:opacity-50">
                    <option value="">— categoria principal —</option>
                    {raizes.filter(r => r.id !== c.id).map(r => (
                      <option key={r.id} value={r.id}>dentro de {r.nome}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {(contagem[c.nome] ?? 0) > 0 && (
                    <span className="text-gray-700">{contagem[c.nome]} produto(s)</span>
                  )}
                  {!c.pai_id && subs.filter(s => s.pai_id === c.id).length > 0 && (
                    <span className="text-gray-400"> · {subs.filter(s => s.pai_id === c.id).length} subcategoria(s)</span>
                  )}
                  {(contagem[c.nome] ?? 0) === 0 && subs.filter(s => s.pai_id === c.id).length === 0 && (
                    <span className="text-gray-300">vazia</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => toggleAtivo(c)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${c.ativo ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${c.ativo ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setEditando(c); setEditNome(c.nome) }}
                      className="text-xs text-blue-600 hover:text-blue-800">Editar</button>
                    <button onClick={() => excluir(c.id)}
                      className="text-xs text-red-500 hover:text-red-700">Excluir</button>
                  </div>
                </td>
              </tr>
            ))}
            {categorias.length === 0 && (
              <tr><td colSpan={5} className="py-10 text-center text-gray-400">Nenhuma categoria cadastrada.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
