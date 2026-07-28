'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type ProdutoCompleto = {
  id: string
  nome: string
  sku: string | null
  ean: string | null
  categoria: string | null
  marca: string | null
  descricao_marketplace: string | null
  preco_venda: number | null
  preco_custo: number | null
  unidade: string | null
  estoque: number | null
  tags: string[] | null
  tipo: string | null
  mesclado_em: string | null
}

type Imagem = { url: string; ordem: number; principal: boolean; produtoId: string }

const CAMPOS: { chave: keyof ProdutoCompleto; label: string }[] = [
  { chave: 'nome', label: 'Nome' },
  { chave: 'sku', label: 'SKU' },
  { chave: 'ean', label: 'EAN' },
  { chave: 'categoria', label: 'Categoria' },
  { chave: 'marca', label: 'Marca' },
  { chave: 'descricao_marketplace', label: 'Descrição' },
  { chave: 'preco_venda', label: 'Preço de venda' },
  { chave: 'preco_custo', label: 'Preço de custo' },
  { chave: 'unidade', label: 'Unidade' },
]

export default function UnificarProdutosModal({ ids, onClose, onUnificado }: {
  ids: string[]
  onClose: () => void
  onUnificado: () => void
}) {
  const [carregando, setCarregando] = useState(true)
  const [erroCarregar, setErroCarregar] = useState('')
  const [produtos, setProdutos] = useState<ProdutoCompleto[]>([])
  const [imagens, setImagens] = useState<Imagem[]>([])
  const [impacto, setImpacto] = useState<{ vendas: number; anuncios: number; kits: number; movimentacoes: number } | null>(null)

  const [vencedorId, setVencedorId] = useState<string>(ids[0])
  const [campos, setCampos] = useState<Record<string, unknown>>({})
  const [tagsSelecionadas, setTagsSelecionadas] = useState<Set<string>>(new Set())
  const [imagensSelecionadas, setImagensSelecionadas] = useState<Set<string>>(new Set())

  const [etapa, setEtapa] = useState<'revisar' | 'confirmar'>('revisar')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    (async () => {
      const sb = createClient()
      const [{ data: prods, error: e1 }, { data: imgs }] = await Promise.all([
        sb.from('produtos')
          .select('id, nome, sku, ean, categoria, marca, descricao_marketplace, preco_venda, preco_custo, unidade, estoque, tags, tipo, mesclado_em')
          .in('id', ids),
        sb.from('produto_imagens').select('produto_id, url, ordem, principal').in('produto_id', ids).order('ordem'),
      ])
      if (e1) { setErroCarregar(e1.message); setCarregando(false); return }
      const ordenados = (prods ?? []).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
      setProdutos(ordenados as ProdutoCompleto[])
      const imgsMapeadas: Imagem[] = (imgs ?? []).map(i => ({ url: i.url, ordem: i.ordem, principal: i.principal, produtoId: i.produto_id }))
      setImagens(imgsMapeadas)
      setImagensSelecionadas(new Set(imgsMapeadas.map(i => i.url)))
      setTagsSelecionadas(new Set((ordenados ?? []).flatMap(p => p.tags ?? [])))
      setCarregando(false)
    })()
  }, [ids])

  // Reinicializa os campos escolhidos sempre que o vencedor muda
  useEffect(() => {
    const vencedor = produtos.find(p => p.id === vencedorId)
    if (!vencedor) return
    const novo: Record<string, unknown> = {}
    for (const c of CAMPOS) novo[c.chave] = vencedor[c.chave]
    setCampos(novo)
  }, [vencedorId, produtos])

  useEffect(() => {
    if (etapa !== 'confirmar') return
    const perdedorIds = ids.filter(id => id !== vencedorId)
    if (perdedorIds.length === 0) return
    ;(async () => {
      const sb = createClient()
      const [vendas, anuncios, kits, movimentacoes] = await Promise.all([
        sb.from('venda_itens').select('id', { count: 'exact', head: true }).in('produto_id', perdedorIds),
        sb.from('marketplace_anuncios').select('id', { count: 'exact', head: true }).in('produto_id', perdedorIds),
        sb.from('kit_itens').select('id', { count: 'exact', head: true }).in('produto_id', perdedorIds),
        sb.from('estoque_movimentacoes').select('id', { count: 'exact', head: true }).in('produto_id', perdedorIds),
      ])
      setImpacto({
        vendas: vendas.count ?? 0, anuncios: anuncios.count ?? 0,
        kits: kits.count ?? 0, movimentacoes: movimentacoes.count ?? 0,
      })
    })()
  }, [etapa, vencedorId, ids])

  const tagsUniao = useMemo(() => [...new Set(produtos.flatMap(p => p.tags ?? []))].sort(), [produtos])
  const perdedorIds = ids.filter(id => id !== vencedorId)
  const estoqueTotal = produtos.reduce((soma, p) => soma + (p.estoque ?? 0), 0)
  const temKit = produtos.some(p => p.tipo === 'kit')
  const temJaMesclado = produtos.some(p => p.mesclado_em)
  const bloqueado = temKit || temJaMesclado

  function toggleTag(tag: string) {
    setTagsSelecionadas(prev => {
      const novo = new Set(prev)
      if (novo.has(tag)) novo.delete(tag); else novo.add(tag)
      return novo
    })
  }

  function toggleImagem(url: string) {
    setImagensSelecionadas(prev => {
      const novo = new Set(prev)
      if (novo.has(url)) novo.delete(url); else novo.add(url)
      return novo
    })
  }

  async function confirmar() {
    setSalvando(true); setErro('')
    const imagensFinais = imagens
      .filter(img => imagensSelecionadas.has(img.url))
      .map((img, idx) => ({ url: img.url, ordem: idx, principal: idx === 0 }))

    try {
      const resp = await fetch('/api/produtos/unificar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vencedorId, perdedorIds,
          campos, tags: [...tagsSelecionadas], imagens: imagensFinais,
        }),
      })
      const data = await resp.json()
      if (!data.ok) { setErro(data.erro ?? 'Erro ao unificar'); setSalvando(false); return }
      onUnificado()
    } catch (e: any) {
      setErro(e?.message ?? 'Erro ao unificar')
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">🔀 Unificar cadastro</h2>
            <p className="text-xs text-gray-400">{ids.length} produtos selecionados</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {carregando ? (
            <p className="text-sm text-gray-400">Carregando produtos...</p>
          ) : erroCarregar ? (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erroCarregar}</p>
          ) : bloqueado ? (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {temKit
                ? 'Produtos do tipo "kit" não podem ser unificados nesta versão.'
                : 'Um dos produtos selecionados já foi mesclado anteriormente e não pode ser selecionado de novo.'}
            </p>
          ) : etapa === 'revisar' ? (
            <>
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Qual produto permanece?</p>
                <div className="grid grid-cols-1 gap-2">
                  {produtos.map(p => (
                    <label key={p.id} className={`flex items-center gap-3 border rounded-lg px-3 py-2 cursor-pointer ${vencedorId === p.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                      <input type="radio" name="vencedor" checked={vencedorId === p.id} onChange={() => setVencedorId(p.id)} className="w-4 h-4 accent-blue-600" />
                      <span className="text-sm text-gray-800">{p.nome}</span>
                      <span className="text-xs text-gray-400 font-mono ml-auto">SKU {p.sku ?? '—'}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Escolha os dados finais</p>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-gray-100">
                      {CAMPOS.map(c => (
                        <tr key={c.chave}>
                          <td className="px-3 py-2 font-medium text-gray-600 bg-gray-50 w-32">{c.label}</td>
                          {produtos.map(p => (
                            <td key={p.id} className="px-3 py-2">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input type="radio" name={c.chave} checked={campos[c.chave] === p[c.chave]}
                                  onChange={() => setCampos(prev => ({ ...prev, [c.chave]: p[c.chave] }))}
                                  className="w-3.5 h-3.5 accent-blue-600" />
                                <span className="text-gray-700 truncate">{String(p[c.chave] ?? '—')}</span>
                              </label>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {tagsUniao.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2">Tags</p>
                  <div className="flex flex-wrap gap-2">
                    {tagsUniao.map(tag => (
                      <label key={tag} className={`flex items-center gap-1.5 border rounded-full px-2.5 py-1 text-xs cursor-pointer ${tagsSelecionadas.has(tag) ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-500'}`}>
                        <input type="checkbox" checked={tagsSelecionadas.has(tag)} onChange={() => toggleTag(tag)} className="w-3.5 h-3.5 accent-blue-600" />
                        {tag}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {imagens.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2">Imagens</p>
                  <div className="grid grid-cols-6 gap-2">
                    {imagens.map(img => (
                      <label key={img.url} className="relative cursor-pointer">
                        <img src={img.url} className={`w-full aspect-square object-cover rounded-lg border-2 ${imagensSelecionadas.has(img.url) ? 'border-blue-500' : 'border-transparent opacity-40'}`} />
                        <input type="checkbox" checked={imagensSelecionadas.has(img.url)} onChange={() => toggleImagem(img.url)}
                          className="absolute top-1 right-1 w-4 h-4 accent-blue-600" />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <p className="text-xs text-amber-700">
                  📦 Estoque somado: <strong>{estoqueTotal}</strong> (soma automática de todos os produtos selecionados, por serem cadastros duplicados do mesmo item)
                </p>
              </div>

              {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
            </>
          ) : (
            <>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 space-y-1.5 text-sm text-gray-700">
                <p><strong>Produto final:</strong> {String(campos.nome ?? '')} (SKU {String(campos.sku ?? '—')})</p>
                <p><strong>Estoque somado:</strong> {estoqueTotal}</p>
                <p><strong>Imagens finais:</strong> {[...imagensSelecionadas].length}</p>
                <p><strong>Tags finais:</strong> {[...tagsSelecionadas].join(', ') || '—'}</p>
              </div>
              {impacto && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800">
                  <p className="font-medium mb-1">Serão associados ao produto final:</p>
                  <ul className="list-disc list-inside text-xs space-y-0.5">
                    <li>{impacto.vendas} item(ns) de venda</li>
                    <li>{impacto.anuncios} anúncio(s) de marketplace</li>
                    <li>{impacto.kits} composição(ões) de kit</li>
                    <li>{impacto.movimentacoes} movimentação(ões) de estoque</li>
                  </ul>
                </div>
              )}
              <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Os {perdedorIds.length} demais produto(s) serão <strong>desativados</strong> (não excluídos) e marcados como mesclados neste produto.
              </p>
              {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
          {etapa === 'confirmar' && (
            <button onClick={() => setEtapa('revisar')} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">◀ Voltar e revisar</button>
          )}
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
          {!bloqueado && !carregando && !erroCarregar && (
            etapa === 'revisar' ? (
              <button onClick={() => setEtapa('confirmar')}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors">
                Revisar unificação
              </button>
            ) : (
              <button onClick={confirmar} disabled={salvando}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {salvando ? 'Unificando...' : 'Confirmar unificação'}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}
