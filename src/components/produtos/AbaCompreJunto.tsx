'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// COMPRE JUNTO no cadastro do produto.
//
// A lista vem sozinha do histórico de vendas do PDV (função
// compre_junto_sugestoes): produto que saiu junto com este em 2+ vendas
// concluídas no último ano. É o que o PDV oferece ao vendedor quando este
// produto está no carrinho.
//
// O gestor só corrige o que o histórico não sabe:
//   · Fixar   — sugerir sempre, mesmo sem histórico (produto novo).
//   · Ocultar — nunca sugerir, mesmo com histórico (coincidência).
// Os ajustes moram em produto_compre_junto_ajuste e valem no sentido
// "este produto no carrinho → sugere aquele".

type Linha = {
  id: string; nome: string; marca: string | null; sku: string | null
  estoque: number; unidade: string; preco_venda: number; foto_url: string | null
  vezes: number; fixo: boolean; oculto: boolean
}
type Candidato = { id: string; nome: string; marca: string | null; sku: string | null }

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function AbaCompreJunto({ produtoId, empresaId, podeEditar }: {
  produtoId: string; empresaId: string; podeEditar: boolean
}) {
  const sb = createClient()
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [mexendo, setMexendo] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [candidatos, setCandidatos] = useState<Candidato[]>([])
  const [verOcultas, setVerOcultas] = useState(false)

  const carregar = useCallback(async () => {
    setErro('')
    const { data: sug, error } = await sb.rpc('compre_junto_sugestoes', {
      p_produto_ids: [produtoId], p_limite: 40, p_incluir_ocultos: true,
    })
    if (error) { setErro('Não foi possível carregar as sugestões.'); setCarregando(false); return }
    const regs = (sug ?? []) as { produto_id: string; vezes: number; fixo: boolean; oculto: boolean }[]
    if (regs.length === 0) { setLinhas([]); setCarregando(false); return }
    const { data: prods } = await sb.from('produtos')
      .select('id, nome, marca, sku, estoque, unidade, preco_venda, foto_url')
      .in('id', regs.map(r => r.produto_id))
    const porId = new Map((prods ?? []).map(p => [p.id as string, p]))
    setLinhas(regs.flatMap(r => {
      const p = porId.get(r.produto_id)
      return p ? [{ ...(p as Omit<Linha, 'vezes' | 'fixo' | 'oculto'>), vezes: r.vezes, fixo: r.fixo, oculto: r.oculto }] : []
    }))
    setCarregando(false)
  }, [produtoId])

  useEffect(() => {
    const t = setTimeout(carregar, 0)
    return () => clearTimeout(t)
  }, [carregar])

  // Busca para fixar uma sugestão manual.
  useEffect(() => {
    const termo = busca.trim()
    const t = setTimeout(async () => {
      if (termo.length < 2) { setCandidatos([]); return }
      const { data } = await sb.from('produtos').select('id, nome, marca, sku')
        .eq('empresa_id', empresaId).eq('ativo', true).neq('id', produtoId)
        .ilike('nome', `%${termo.replace(/[%*]/g, '')}%`).order('nome').limit(8)
      setCandidatos((data ?? []) as Candidato[])
    }, 250)
    return () => clearTimeout(t)
  }, [busca, empresaId, produtoId])

  async function ajustar(sugeridoId: string, acao: 'fixar' | 'ocultar' | null) {
    setMexendo(sugeridoId); setErro('')
    const r = acao === null
      ? await sb.from('produto_compre_junto_ajuste').delete().eq('produto_id', produtoId).eq('sugerido_id', sugeridoId)
      : await sb.from('produto_compre_junto_ajuste').upsert(
          { empresa_id: empresaId, produto_id: produtoId, sugerido_id: sugeridoId, acao },
          { onConflict: 'produto_id,sugerido_id' })
    if (r.error) setErro(r.error.message)
    setMexendo(null)
    await carregar()
  }

  async function fixar(c: Candidato) {
    setBusca(''); setCandidatos([])
    await ajustar(c.id, 'fixar')
  }

  const ativas = linhas.filter(l => !l.oculto)
  const ocultas = linhas.filter(l => l.oculto)

  if (carregando) return <div className="text-center py-10 text-gray-400 text-sm">Carregando...</div>

  return (
    <div className="space-y-5">
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-900">
        <p className="font-medium">💡 O que os clientes costumam levar junto com este produto</p>
        <p className="text-xs text-amber-800 mt-1">
          Calculado sozinho pelas vendas do PDV: entra todo produto que saiu junto com este em 2 ou
          mais vendas no último ano. Quando este produto estiver no carrinho, o PDV mostra estas
          sugestões para o vendedor oferecer.
        </p>
      </div>

      {erro && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{erro}</div>}

      {ativas.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">
          Ainda não há histórico suficiente para este produto.
          {podeEditar && ' Você pode indicar sugestões abaixo.'}
        </p>
      ) : (
        <div className="border border-gray-200 rounded-xl divide-y divide-gray-100">
          {ativas.map(l => (
            <LinhaSugestao key={l.id} l={l} ocupado={mexendo === l.id}>
              {podeEditar && (l.fixo ? (
                <button onClick={() => ajustar(l.id, null)} disabled={mexendo === l.id}
                  className="text-xs px-2 py-1 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
                  Remover indicação
                </button>
              ) : (
                <button onClick={() => ajustar(l.id, 'ocultar')} disabled={mexendo === l.id}
                  title="Não sugerir mais este produto junto com este"
                  className="text-xs px-2 py-1 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
                  Ocultar
                </button>
              ))}
            </LinhaSugestao>
          ))}
        </div>
      )}

      {podeEditar && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Indicar um produto manualmente</label>
          <div className="relative">
            <input value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Busque pelo nome — ex.: fita isolante"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
            {candidatos.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-64 overflow-y-auto">
                {candidatos.map(c => (
                  <button key={c.id} type="button" onClick={() => fixar(c)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-50 last:border-0">
                    <span className="text-gray-900">{c.nome}</span>
                    {c.marca && <span className="ml-2 text-[11px] font-semibold text-indigo-600">{c.marca}</span>}
                    {c.sku && <span className="ml-2 text-[11px] text-gray-400 font-mono">{c.sku}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-1">
            Produto indicado aparece sempre no PDV quando este estiver no carrinho, mesmo sem histórico de vendas.
          </p>
        </div>
      )}

      {ocultas.length > 0 && (
        <div>
          <button type="button" onClick={() => setVerOcultas(v => !v)} className="text-xs text-gray-500 hover:text-gray-700">
            {verOcultas ? '▾' : '▸'} Ocultadas ({ocultas.length})
          </button>
          {verOcultas && (
            <div className="mt-2 border border-gray-200 rounded-xl divide-y divide-gray-100 opacity-70">
              {ocultas.map(l => (
                <LinhaSugestao key={l.id} l={l} ocupado={mexendo === l.id}>
                  {podeEditar && (
                    <button onClick={() => ajustar(l.id, null)} disabled={mexendo === l.id}
                      className="text-xs px-2 py-1 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
                      Voltar a sugerir
                    </button>
                  )}
                </LinhaSugestao>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LinhaSugestao({ l, ocupado, children }: { l: Linha; ocupado: boolean; children?: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2 ${ocupado ? 'opacity-50' : ''}`}>
      {l.foto_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={l.foto_url} alt={l.nome} loading="lazy" className="w-10 h-10 rounded-md object-cover border border-gray-200 shrink-0" />
        : <span className="w-10 h-10 rounded-md bg-gray-100 text-gray-300 flex items-center justify-center text-xs shrink-0">▧</span>}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-900 truncate">{l.nome}</p>
        <p className="text-[11px] text-gray-500">
          {l.marca && <span className="font-semibold text-indigo-600 mr-2">{l.marca}</span>}
          {l.sku && <span className="font-mono mr-2">{l.sku}</span>}
          {fmt(l.preco_venda)} · {l.estoque} {l.unidade}
        </p>
      </div>
      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${l.fixo ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>
        {l.fixo ? '★ indicado' : `junto em ${l.vezes} vendas`}
      </span>
      {children}
    </div>
  )
}
