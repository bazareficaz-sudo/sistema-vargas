'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

// Mapeamento rápido: pega os anúncios selecionados, propõe um produto para
// cada um e deixa o operador confirmar linha a linha.
//
// A diferença para o "Mapear por SKU" que já existia: lá era tudo ou nada,
// só casava SKU idêntico e não havia como corrigir uma linha errada — quem
// discordasse de um único item tinha que desistir do lote inteiro. Aqui cada
// linha tem caixa de seleção própria, e a errada pode ser trocada sem sair
// da tela.

type Produto = { id: string; nome: string; sku: string | null; precoVenda: number; estoque: number }
type Sugestao = Produto & { metodo: 'sku' | 'ean' | 'nome'; score: number }

type Item = {
  id: string
  titulo: string
  skuCanal: string | null
  precoAnuncio: number
  imagem: string | null
  jaMapeado: boolean
  temVariacao: boolean
  sugestao: Sugestao | null
  alternativas: Sugestao[]
}

type Escolha = {
  produto: Produto | null
  metodo: 'sku' | 'ean' | 'nome' | 'manual'
  score: number
  marcado: boolean
}

const brl = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Acima disso a sugestão entra já marcada. Abaixo, vem desmarcada de
// propósito: o operador precisa olhar antes, que é a razão de a tela existir.
const LIMIAR_ALTA = 50

/** Diferença de preço grande é o sinal mais barato de casamento errado. */
const DIFERENCA_PRECO_SUSPEITA = 0.5

function selo(metodo: string, score: number) {
  if (metodo === 'ean') return { texto: 'EAN', cor: 'bg-emerald-100 text-emerald-700', ajuda: 'Código de barras idêntico — praticamente impossível coincidir por acaso.' }
  if (metodo === 'manual') return { texto: 'escolhido', cor: 'bg-blue-100 text-blue-700', ajuda: 'Produto escolhido por você.' }
  if (metodo === 'sku') {
    return score >= LIMIAR_ALTA
      ? { texto: `SKU · ${score}%`, cor: 'bg-emerald-100 text-emerald-700', ajuda: 'SKU idêntico e nomes parecidos.' }
      : { texto: `SKU · ${score}%`, cor: 'bg-amber-100 text-amber-800', ajuda: 'SKU bate, mas os nomes são bem diferentes. SKU deste sistema é sequencial e pode coincidir com o de outro sistema — confira.' }
  }
  return score >= LIMIAR_ALTA
    ? { texto: `nome · ${score}%`, cor: 'bg-amber-100 text-amber-800', ajuda: 'Nenhum SKU bateu; sugestão vem da semelhança dos nomes.' }
    : { texto: `nome · ${score}%`, cor: 'bg-red-100 text-red-700', ajuda: 'Semelhança fraca. Provavelmente precisa procurar o produto certo.' }
}

export default function MapeamentoRapidoModal({
  anuncioIds, empresaId, onFechar, onAplicado,
}: {
  anuncioIds: string[]
  empresaId: string
  onFechar: () => void
  onAplicado: (mapa: Record<string, Produto>) => void
}) {
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [itens, setItens] = useState<Item[]>([])
  const [limiteAtingido, setLimiteAtingido] = useState(false)
  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>({})
  const [aplicando, setAplicando] = useState(false)
  const [resultado, setResultado] = useState<{ aplicados: number; jaMapeados: number; erros: number } | null>(null)
  const [soPendentes, setSoPendentes] = useState(true)

  // Busca manual, aberta por linha
  const [buscandoPara, setBuscandoPara] = useState<string | null>(null)
  const [termo, setTermo] = useState('')
  const [resultadosBusca, setResultadosBusca] = useState<Produto[]>([])
  const buscaRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let ativo = true
    fetch('/api/marketplaces/anuncios/sugerir-mapeamento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anuncioIds }),
    })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok || !d.ok) throw new Error(d.erro || `Erro ${r.status} ao gerar sugestões`)
        return d
      })
      .then(d => {
        if (!ativo) return
        const lista: Item[] = d.itens ?? []
        setItens(lista)
        setLimiteAtingido(!!d.limiteAtingido)
        const iniciais: Record<string, Escolha> = {}
        for (const it of lista) {
          iniciais[it.id] = it.sugestao
            ? {
                produto: it.sugestao,
                metodo: it.sugestao.metodo,
                score: it.sugestao.score,
                // Já mapeado não vem marcado: remapear por engano é pior que
                // deixar de fora.
                marcado: !it.jaMapeado && (it.sugestao.metodo === 'ean' || it.sugestao.score >= LIMIAR_ALTA),
              }
            : { produto: null, metodo: 'manual', score: 0, marcado: false }
        }
        setEscolhas(iniciais)
      })
      .catch(e => { if (ativo) setErro(e?.message ?? 'Erro ao gerar sugestões') })
      .finally(() => { if (ativo) setCarregando(false) })
    return () => { ativo = false }
  }, [anuncioIds])

  // Busca de produto (mesmo padrão de consulta do MapearAnuncioModal)
  useEffect(() => {
    if (!buscandoPara) { setResultadosBusca([]); return }
    const t = termo.trim()
    if (t.length < 2) { setResultadosBusca([]); return }
    let ativo = true
    const timer = setTimeout(async () => {
      const sb = createClient()
      const palavras = t.toLowerCase().split(/\s+/).map(p => p.replace(/[,()%]/g, '')).filter(Boolean)
      let query = sb.from('produtos')
        .select('id, nome, sku, preco_venda, estoque')
        .eq('empresa_id', empresaId).eq('ativo', true).order('nome').limit(8)
      for (const palavra of palavras) {
        query = query.or(`nome.ilike.%${palavra}%,sku.ilike.%${palavra}%,ean.ilike.%${palavra}%`)
      }
      const { data } = await query
      if (ativo) {
        setResultadosBusca((data ?? []).map((p: any) => ({
          id: p.id, nome: p.nome, sku: p.sku,
          precoVenda: Number(p.preco_venda ?? 0), estoque: Number(p.estoque ?? 0),
        })))
      }
    }, 250)
    return () => { ativo = false; clearTimeout(timer) }
  }, [termo, buscandoPara, empresaId])

  useEffect(() => { if (buscandoPara) setTimeout(() => buscaRef.current?.focus(), 50) }, [buscandoPara])

  const visiveis = useMemo(
    () => soPendentes ? itens.filter(i => !i.jaMapeado) : itens,
    [itens, soPendentes],
  )

  const marcados = useMemo(
    () => visiveis.filter(i => escolhas[i.id]?.marcado && escolhas[i.id]?.produto),
    [visiveis, escolhas],
  )

  function alternar(id: string) {
    setEscolhas(prev => {
      const atual = prev[id]
      if (!atual?.produto) return prev   // sem produto não há o que marcar
      return { ...prev, [id]: { ...atual, marcado: !atual.marcado } }
    })
  }

  function marcarLote(criterio: 'altas' | 'todas' | 'nenhuma') {
    setEscolhas(prev => {
      const novo = { ...prev }
      for (const it of visiveis) {
        const e = novo[it.id]
        if (!e?.produto) continue
        novo[it.id] = {
          ...e,
          marcado: criterio === 'nenhuma' ? false
            : criterio === 'todas' ? true
            : (e.metodo === 'ean' || e.metodo === 'manual' || e.score >= LIMIAR_ALTA),
        }
      }
      return novo
    })
  }

  function escolherProduto(anuncioId: string, produto: Produto, metodo: Escolha['metodo'], score: number) {
    setEscolhas(prev => ({ ...prev, [anuncioId]: { produto, metodo, score, marcado: true } }))
    setBuscandoPara(null)
    setTermo('')
  }

  async function aplicar() {
    if (marcados.length === 0) return
    setAplicando(true); setErro('')
    try {
      const res = await fetch('/api/marketplaces/mapa-anuncios/sugestoes/aplicar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itens: marcados.map(i => ({
            tipo: 'anuncio',
            id: i.id,
            produtoId: escolhas[i.id].produto!.id,
            metodo: escolhas[i.id].metodo === 'manual' ? 'manual_revisado' : `automatico_${escolhas[i.id].metodo}_revisado`,
          })),
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) throw new Error(d.erro || `Erro ${res.status} ao aplicar`)

      const mapa: Record<string, Produto> = {}
      for (const i of marcados) mapa[i.id] = escolhas[i.id].produto!
      onAplicado(mapa)

      setResultado({
        aplicados: d.aplicados ?? 0,
        jaMapeados: (d.jaMapeadosPorOutraSessao ?? []).length,
        erros: (d.erros ?? []).length,
      })
      setItens(prev => prev.map(i => mapa[i.id] ? { ...i, jaMapeado: true } : i))
    } catch (e: any) {
      setErro(e?.message ?? 'Erro ao aplicar')
    } finally {
      setAplicando(false)
    }
  }

  const semSugestao = visiveis.filter(i => !escolhas[i.id]?.produto).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col">

        {/* Cabeçalho */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Mapeamento rápido</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Confira cada sugestão antes de aplicar. O que ficar desmarcado não é mapeado.
            </p>
          </div>
          <button onClick={onFechar} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>

        {carregando ? (
          <div className="flex-1 flex items-center justify-center py-16">
            <div className="text-center">
              <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-sm text-slate-500">Procurando produtos para {anuncioIds.length} anúncio(s)...</p>
            </div>
          </div>
        ) : erro && itens.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16 px-6 text-center">
            <span className="text-4xl mb-2">⚠️</span>
            <p className="text-sm font-semibold text-red-600">Não foi possível gerar as sugestões</p>
            <p className="text-xs text-slate-500 mt-1 max-w-md">{erro}</p>
          </div>
        ) : (
          <>
            {/* Barra de ações */}
            <div className="px-5 py-2.5 border-b border-slate-100 flex items-center gap-2 flex-wrap shrink-0 bg-slate-50">
              <span className="text-sm font-medium text-slate-700">
                {marcados.length} de {visiveis.length} marcado(s)
              </span>
              <div className="w-px h-4 bg-slate-300 mx-1" />
              <button onClick={() => marcarLote('altas')} className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200">
                Só as confiáveis
              </button>
              <button onClick={() => marcarLote('todas')} className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-white hover:bg-slate-100 text-slate-600 border border-slate-200">
                Marcar todas
              </button>
              <button onClick={() => marcarLote('nenhuma')} className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-white hover:bg-slate-100 text-slate-600 border border-slate-200">
                Desmarcar
              </button>
              <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                <input type="checkbox" checked={soPendentes} onChange={e => setSoPendentes(e.target.checked)} className="rounded" />
                Esconder já mapeados
              </label>
            </div>

            {(limiteAtingido || semSugestao > 0) && (
              <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-800 shrink-0">
                {limiteAtingido && <span>Seleção grande demais — só os primeiros 200 anúncios entraram. </span>}
                {semSugestao > 0 && <span>{semSugestao} sem sugestão: use “Procurar produto” na linha.</span>}
              </div>
            )}

            {/* Lista */}
            <div className="flex-1 overflow-auto">
              {visiveis.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-300">
                  <span className="text-4xl mb-2">✓</span>
                  <p className="text-sm">Todos os anúncios selecionados já estão mapeados</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {visiveis.map(item => {
                    const e = escolhas[item.id]
                    const p = e?.produto
                    const s = p ? selo(e.metodo, e.score) : null
                    const diferencaPreco = p && item.precoAnuncio > 0 && p.precoVenda > 0
                      ? Math.abs(item.precoAnuncio - p.precoVenda) / item.precoAnuncio
                      : 0
                    const precoSuspeito = diferencaPreco >= DIFERENCA_PRECO_SUSPEITA

                    return (
                      <div key={item.id} className={`px-5 py-3 ${item.jaMapeado ? 'bg-slate-50/60' : e?.marcado ? 'bg-emerald-50/40' : ''}`}>
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            disabled={!p || item.jaMapeado}
                            checked={!!e?.marcado}
                            onChange={() => alternar(item.id)}
                            className="mt-1 rounded disabled:opacity-30"
                          />

                          {/* Anúncio */}
                          <div className="flex items-start gap-2 min-w-0 flex-1">
                            {item.imagem
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={item.imagem} alt="" className="w-10 h-10 rounded object-cover border border-slate-200 shrink-0" />
                              : <div className="w-10 h-10 rounded bg-slate-100 shrink-0" />}
                            <div className="min-w-0">
                              <p className="text-sm text-slate-800 truncate" title={item.titulo}>{item.titulo}</p>
                              <p className="text-[11px] text-slate-400">
                                {item.skuCanal ? `SKU do canal: ${item.skuCanal}` : 'sem SKU no canal'}
                                {item.precoAnuncio > 0 && ` · ${brl(item.precoAnuncio)}`}
                                {item.temVariacao && ' · tem variações'}
                                {item.jaMapeado && ' · já mapeado'}
                              </p>
                            </div>
                          </div>

                          <span className="text-slate-300 mt-2 shrink-0">→</span>

                          {/* Produto sugerido / escolhido */}
                          <div className="min-w-0 flex-1">
                            {p ? (
                              <>
                                <p className="text-sm font-medium text-slate-800 truncate" title={p.nome}>{p.nome}</p>
                                <p className="text-[11px] text-slate-400">
                                  {p.sku ?? 'sem SKU'} · {brl(p.precoVenda)} · estoque {p.estoque}
                                </p>
                                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                  {s && (
                                    <span title={s.ajuda} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${s.cor}`}>
                                      {s.texto}
                                    </span>
                                  )}
                                  {precoSuspeito && (
                                    <span
                                      title="O preço do anúncio e o do produto estão bem diferentes. Pode ser markup do canal — ou produto errado."
                                      className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700">
                                      preço {Math.round(diferencaPreco * 100)}% diferente
                                    </span>
                                  )}
                                </div>
                              </>
                            ) : (
                              <p className="text-sm text-slate-400 italic">Nenhum produto encontrado</p>
                            )}

                            {/* Alternativas a um clique */}
                            {!item.jaMapeado && item.alternativas.length > 0 && buscandoPara !== item.id && (
                              <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                                <span className="text-[10px] text-slate-400">ou:</span>
                                {item.alternativas.slice(0, 3).map(alt => (
                                  <button
                                    key={alt.id}
                                    onClick={() => escolherProduto(item.id, alt, 'manual', alt.score)}
                                    title={`${alt.nome} · ${alt.sku ?? 'sem SKU'} · ${brl(alt.precoVenda)}`}
                                    className="px-1.5 py-0.5 text-[10px] rounded bg-slate-100 hover:bg-purple-100 text-slate-600 hover:text-purple-700 max-w-[180px] truncate">
                                    {alt.nome}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {!item.jaMapeado && (
                            <button
                              onClick={() => setBuscandoPara(buscandoPara === item.id ? null : item.id)}
                              className="shrink-0 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-white hover:bg-slate-100 text-slate-600 border border-slate-200">
                              {buscandoPara === item.id ? 'Fechar' : p ? 'Trocar' : 'Procurar produto'}
                            </button>
                          )}
                        </div>

                        {/* Busca manual da linha */}
                        {buscandoPara === item.id && (
                          <div className="mt-2 ml-7 border border-slate-200 rounded-lg p-2 bg-white">
                            <input
                              ref={buscaRef}
                              value={termo}
                              onChange={ev => setTermo(ev.target.value)}
                              placeholder="Buscar por nome, SKU ou EAN..."
                              className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            />
                            {resultadosBusca.length > 0 && (
                              <div className="mt-1.5 divide-y divide-slate-50 max-h-52 overflow-auto">
                                {resultadosBusca.map(r => (
                                  <button
                                    key={r.id}
                                    onClick={() => escolherProduto(item.id, r, 'manual', 0)}
                                    className="w-full text-left px-2 py-1.5 hover:bg-purple-50 rounded">
                                    <p className="text-sm text-slate-800">{r.nome}</p>
                                    <p className="text-[11px] text-slate-400">
                                      {r.sku ?? 'sem SKU'} · {brl(r.precoVenda)} · estoque {r.estoque}
                                    </p>
                                  </button>
                                ))}
                              </div>
                            )}
                            {termo.trim().length >= 2 && resultadosBusca.length === 0 && (
                              <p className="text-[11px] text-slate-400 mt-1.5 px-1">Nenhum produto encontrado para “{termo}”.</p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Rodapé */}
            <div className="px-5 py-3 border-t border-slate-200 shrink-0">
              {resultado && (
                <div className="mb-2 text-xs">
                  <span className="text-emerald-700 font-medium">✓ {resultado.aplicados} mapeado(s).</span>
                  {resultado.jaMapeados > 0 && <span className="text-amber-700 ml-2">{resultado.jaMapeados} já tinham sido mapeados em outra aba.</span>}
                  {resultado.erros > 0 && <span className="text-red-600 ml-2">{resultado.erros} com erro.</span>}
                </div>
              )}
              {erro && itens.length > 0 && <p className="mb-2 text-xs text-red-600">{erro}</p>}

              <div className="flex items-center gap-2">
                <p className="text-[11px] text-slate-500 flex-1">
                  O que for aplicado também fica guardado: no próximo sincronismo, anúncio com o mesmo SKU
                  se liga sozinho ao produto.
                </p>
                <button onClick={onFechar} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                  Fechar
                </button>
                <button
                  onClick={aplicar}
                  disabled={aplicando || marcados.length === 0}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white text-sm font-semibold rounded-lg">
                  {aplicando ? 'Aplicando...' : `Mapear ${marcados.length} selecionado(s)`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
