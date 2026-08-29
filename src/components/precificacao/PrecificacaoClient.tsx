'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ROTULO_SAUDE } from '@/lib/precificacao/motor'
import { ROTULO_CLASSIFICACAO } from '@/lib/precificacao/margens'
import type { SaudePreco } from '@/lib/precificacao/tipos'
import TaxasCanal from './TaxasCanal'
import RegrasPrecificacao from './RegrasPrecificacao'
import RecalculoMassa from './RecalculoMassa'
import AnalisePrecos from './AnalisePrecos'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number) => `${v.toFixed(1).replace('.', ',')}%`

type Aba = 'analise' | 'simulador' | 'regras' | 'recalcular' | 'taxas'

type TipoObjetivo = 'regra' | 'margem_liquida' | 'sobre_custo' | 'markup' | 'lucro_fixo' | 'preco'

const OBJETIVOS: { valor: TipoObjetivo; label: string; unidade: string; ajuda: string; padrao: number }[] = [
  { valor: 'regra', label: 'Usar as regras cadastradas', unidade: '', padrao: 0, ajuda: 'Aplica a regra que vale para este produto em cada canal — e explica qual venceu e por quê.' },
  { valor: 'margem_liquida', label: 'Margem líquida', unidade: '%', padrao: 20, ajuda: 'Quanto sobra de lucro sobre o preço final, já pagas todas as taxas.' },
  { valor: 'sobre_custo', label: 'Lucro sobre o custo', unidade: '%', padrao: 30, ajuda: 'Quanto quero ganhar em cima do que o produto me custou.' },
  { valor: 'markup', label: 'Markup', unidade: '×', padrao: 2.3, ajuda: 'Multiplicador do custo. Markup 2,3 quer dizer preço = custo × 2,3.' },
  { valor: 'lucro_fixo', label: 'Lucro em reais', unidade: 'R$', padrao: 25, ajuda: 'Ganhar sempre o mesmo valor por unidade, independente do preço.' },
  { valor: 'preco', label: 'Já sei o preço', unidade: 'R$', padrao: 99.9, ajuda: 'Informo o preço e o sistema me diz quanto sobra de lucro.' },
]

export default function PrecificacaoClient({ empresaId }: { empresaId: string }) {
  const [aba, setAba] = useState<Aba>('analise')

  // ── Simulador ──────────────────────────────────────────────
  const [busca, setBusca] = useState('')
  const [resultadosBusca, setResultadosBusca] = useState<any[]>([])
  const [produto, setProduto] = useState<any | null>(null)
  const [custoManual, setCustoManual] = useState('')

  const [tipoObjetivo, setTipoObjetivo] = useState<TipoObjetivo>('margem_liquida')
  const [valorObjetivo, setValorObjetivo] = useState('20')

  // Cenário promocional: um preço candidato OU um desconto sobre o preço que
  // o objetivo produziu. Simular não altera nada — é a regra desta fase.
  const [verFaixas, setVerFaixas] = useState(false)
  const [precoPromo, setPrecoPromo] = useState('')
  const [descontoPromo, setDescontoPromo] = useState('')

  const [calculando, setCalculando] = useState(false)
  const [erro, setErro] = useState('')
  const [saida, setSaida] = useState<any | null>(null)
  const [expandido, setExpandido] = useState<string | null>(null)

  // ── Taxas ──────────────────────────────────────────────────
  const [itensConfig, setItensConfig] = useState<any[] | null>(null)
  const [carregandoConfig, setCarregandoConfig] = useState(false)

  useEffect(() => {
    if (aba !== 'taxas' || itensConfig) return
    setCarregandoConfig(true)
    fetch('/api/precificacao/config')
      .then(r => r.json())
      .then(d => { if (d.ok) setItensConfig(d.itens); else setErro(d.erro ?? 'Erro ao carregar as taxas') })
      .finally(() => setCarregandoConfig(false))
  }, [aba, itensConfig])

  useEffect(() => {
    if (produto || busca.trim().length < 2) { setResultadosBusca([]); return }
    let ativo = true
    const t = setTimeout(async () => {
      const sb = createClient()
      const palavras = busca.trim().split(/\s+/).filter(p => p.length >= 2)
      let q = sb.from('produtos').select('id, nome, sku, preco_custo, preco_venda, tipo')
        .eq('empresa_id', empresaId).eq('ativo', true).order('nome').limit(8)
      for (const p of palavras) q = q.or(`nome.ilike.%${p}%,sku.ilike.%${p}%`)
      const { data } = await q
      if (ativo) setResultadosBusca(data ?? [])
    }, 300)
    return () => { ativo = false; clearTimeout(t) }
  }, [busca, produto, empresaId])

  function escolherObjetivo(t: TipoObjetivo) {
    setTipoObjetivo(t)
    setValorObjetivo(String(OBJETIVOS.find(o => o.valor === t)!.padrao))
  }

  async function simular() {
    setCalculando(true); setErro(''); setSaida(null); setExpandido(null)
    try {
      // Modo "regra" passa pela rota que resolve a hierarquia e devolve a
      // explicação; os demais vão direto ao motor com o objetivo digitado.
      const porRegra = tipoObjetivo === 'regra'
      const resp = await fetch(porRegra ? '/api/precificacao/explicar' : '/api/precificacao/simular', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(porRegra ? { produtoId: produto?.id } : {
          produtoId: produto?.id,
          custoManual: produto ? undefined : Number(custoManual.replace(',', '.')),
          objetivo: { tipo: tipoObjetivo, valor: Number(valorObjetivo.replace(',', '.')) },
          sugerirQuantidade: verFaixas || undefined,
          precoCandidato: precoPromo.trim() ? Number(precoPromo.replace(',', '.')) : undefined,
          descontoPercentual: descontoPromo.trim() ? Number(descontoPromo.replace(',', '.')) : undefined,
        }),
      })
      const d = await resp.json()
      if (!d.ok) { setErro(d.erro ?? 'Erro ao simular'); return }
      setSaida(d)
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao simular')
    } finally {
      setCalculando(false)
    }
  }

  const objetivoAtual = OBJETIVOS.find(o => o.valor === tipoObjetivo)!
  const porRegra = tipoObjetivo === 'regra'
  const podeSimular = porRegra
    ? !!produto  // a regra depende de categoria/marca do produto — custo avulso não serve
    : (!!produto || Number(custoManual.replace(',', '.')) > 0) && Number(valorObjetivo.replace(',', '.')) > 0

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-gray-900">Precificação</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Descubra o preço que garante a margem que você quer em cada canal — com todas as taxas na conta.
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-200 mb-5">
        {([['analise', 'Análise'], ['simulador', 'Simulador e comparador'], ['regras', 'Regras'], ['recalcular', 'Recalcular em massa'], ['taxas', 'Taxas por canal']] as [Aba, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${aba === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {aba === 'analise' && <AnalisePrecos />}

      {aba === 'simulador' && (
        <div className="space-y-5">
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            {/* Produto */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Produto</label>
              {produto ? (
                <div className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-sm text-gray-900">{produto.nome}</p>
                    <p className="text-xs text-gray-500">
                      {produto.sku ? `SKU ${produto.sku} · ` : ''}
                      custo {produto.preco_custo ? brl(Number(produto.preco_custo)) : '—'}
                      {produto.tipo === 'kit' ? ' · kit (custo somado dos componentes)' : ''}
                    </p>
                  </div>
                  <button onClick={() => { setProduto(null); setBusca(''); setSaida(null) }}
                    className="text-xs text-gray-400 hover:text-gray-700">trocar</button>
                </div>
              ) : (
                <>
                  <input value={busca} onChange={e => setBusca(e.target.value)}
                    placeholder="Buscar por nome ou SKU..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  {resultadosBusca.length > 0 && (
                    <div className="mt-1 border border-gray-200 rounded-lg divide-y max-h-56 overflow-y-auto">
                      {resultadosBusca.map(p => (
                        <button key={p.id} onClick={() => { setProduto(p); setResultadosBusca([]) }}
                          className="w-full text-left px-3 py-2 hover:bg-blue-50">
                          <p className="text-sm text-gray-900">{p.nome}</p>
                          <p className="text-xs text-gray-500">
                            {p.sku ? `SKU ${p.sku} · ` : ''}custo {p.preco_custo ? brl(Number(p.preco_custo)) : 'não cadastrado'}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-gray-400">ou simule com um custo avulso:</span>
                    <input value={custoManual} onChange={e => setCustoManual(e.target.value)}
                      placeholder="R$ 0,00" inputMode="decimal"
                      className="w-28 border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                </>
              )}
            </div>

            {/* Objetivo */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">O que você quer garantir</label>
              <div className="flex flex-wrap gap-1.5">
                {OBJETIVOS.map(o => (
                  <button key={o.valor} onClick={() => escolherObjetivo(o.valor)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${tipoObjetivo === o.valor ? 'border-blue-400 bg-blue-50 text-blue-800 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2.5">
                {!porRegra && (
                  <>
                    <span className="text-sm text-gray-500">{objetivoAtual.unidade}</span>
                    <input value={valorObjetivo} onChange={e => setValorObjetivo(e.target.value)} inputMode="decimal"
                      className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  </>
                )}
                <p className="text-xs text-gray-400 flex-1">
                  {objetivoAtual.ajuda}
                  {porRegra && !produto && <span className="text-amber-700"> Escolha um produto — a regra depende da categoria e da marca dele.</span>}
                </p>
              </div>
            </div>

            {!porRegra && (
              <div className="border border-slate-200 rounded-lg px-3 py-2.5 bg-slate-50">
                <p className="text-xs font-medium text-gray-700 mb-1.5">
                  Testar uma promoção <span className="font-normal text-gray-400">(opcional — simular não altera nada)</span>
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-xs text-gray-500">Preço promocional</label>
                  <input value={precoPromo} onChange={e => { setPrecoPromo(e.target.value); if (e.target.value) setDescontoPromo('') }}
                    placeholder="R$" inputMode="decimal"
                    className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm" />
                  <span className="text-xs text-gray-400">ou desconto</span>
                  <input value={descontoPromo} onChange={e => { setDescontoPromo(e.target.value); if (e.target.value) setPrecoPromo('') }}
                    placeholder="%" inputMode="decimal"
                    className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-sm" />
                  {(precoPromo || descontoPromo) && (
                    <button type="button" onClick={() => { setPrecoPromo(''); setDescontoPromo('') }}
                      className="text-xs text-gray-400 hover:text-gray-600 underline">limpar</button>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  O desconto incide sobre o preço que o objetivo acima produzir em cada canal. A margem
                  sai do mesmo motor, com a comissão e o frete reais daquele preço.
                </p>

                <label className="flex items-center gap-2 mt-2.5 text-xs text-gray-600">
                  <input type="checkbox" checked={verFaixas} onChange={e => setVerFaixas(e.target.checked)}
                    className="w-3.5 h-3.5 accent-blue-600" />
                  Sugerir preço por quantidade (3+, 5+, 10+)
                </label>
              </div>
            )}

            <button onClick={simular} disabled={!podeSimular || calculando}
              className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
              {calculando ? 'Calculando...' : 'Calcular em todos os canais'}
            </button>

            {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
          </div>

          {saida && (
            <>
              <div className="flex items-baseline justify-between">
                <p className="text-sm text-gray-500">
                  Custo considerado: <strong className="text-gray-900">{brl(saida.custo)}</strong>
                  {saida.produto?.precoVenda ? <> · preço atual no cadastro: {brl(Number(saida.produto.precoVenda))}</> : null}
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {saida.resultados.map((r: any) => {
                  // Canal sem regra aplicável: mostra o buraco em vez de um
                  // preço inventado.
                  if (r.semRegra) {
                    return (
                      <div key={r.canal.id} className="bg-white border border-amber-200 rounded-xl px-4 py-3">
                        <p className="text-sm font-medium text-gray-900">{r.canal.nome}</p>
                        <p className="text-xs text-amber-800 mt-1.5">{r.explicacao}</p>
                      </div>
                    )
                  }
                  const s = ROTULO_SAUDE[r.saude as SaudePreco]
                  const aberto = expandido === r.canal.id
                  return (
                    <div key={r.canal.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{r.canal.nome}</p>
                          <p className="text-xs text-gray-400 capitalize">{r.canal.plataforma}</p>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-lg border ${s.cor}`}>{s.emoji} {s.texto}</span>
                      </div>

                      {r.quantidade && (() => {
                        const q = r.quantidade
                        const cap = q.capacidadePublicacao
                        return (
                          <div className="px-4 py-3 border-b border-gray-100">
                            <div className="flex items-baseline justify-between gap-2 flex-wrap">
                              <p className="text-xs font-medium text-gray-700">Preço por quantidade</p>
                              <span className="text-[10px] text-gray-400">{q.criterio}</span>
                            </div>

                            {q.avaliadas.length === 0 ? (
                              <p className="text-xs text-gray-500 mt-1.5">{q.cabe.motivo}</p>
                            ) : (
                              <table className="w-full text-xs mt-2">
                                <tbody className="divide-y divide-gray-100">
                                  <tr className="text-gray-500">
                                    <td className="py-1">1 un</td>
                                    <td className="py-1 text-right font-mono">{brl(r.resultado.preco)}</td>
                                    <td className="py-1 text-right font-mono">{pct(r.resultado.margemLiquida)}</td>
                                    <td className="py-1 text-right text-gray-300">—</td>
                                  </tr>
                                  {q.avaliadas.map((a: any) => (
                                    <tr key={a.faixa.qtd} className="text-gray-700">
                                      <td className="py-1">{a.faixa.qtd}+</td>
                                      <td className="py-1 text-right font-mono">{brl(a.faixa.preco)}</td>
                                      <td className="py-1 text-right font-mono">{pct(a.resultado.margemLiquida)}</td>
                                      <td className="py-1 text-right text-[10px]"
                                        title={`Lucro do pedido de ${a.faixa.qtd} un: ${brl(a.lucroPedido)}`}>
                                        {a.descontoPercentual > 0 ? `-${pct(a.descontoPercentual)}` : "—"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}

                            {q.avisos?.length > 0 && (
                              <p className="text-[11px] text-gray-500 mt-1.5">{q.avisos[0]}</p>
                            )}
                            {cap?.estado !== "suportado" && (
                              <p className="text-[11px] text-amber-700 mt-1.5">{q.explicacaoPublicacao}</p>
                            )}
                          </div>
                        )
                      })()}

                      {r.promocional && (() => {
                        const c = ROTULO_CLASSIFICACAO[r.promocional.classificacao.classificacao as keyof typeof ROTULO_CLASSIFICACAO]
                        const m = r.promocional.margens
                        return (
                          <div className="px-4 py-3 bg-slate-50 border-b border-gray-100">
                            <div className="flex items-baseline justify-between gap-2 flex-wrap">
                              <p className="text-xs text-gray-500">
                                Promoção a <strong className="text-gray-900 font-mono">{brl(r.promocional.precoCandidato)}</strong>
                                {' '}({pct(r.promocional.descontoPercentual)} sobre {brl(r.promocional.precoBase)})
                              </p>
                              <span className={`text-xs px-2 py-1 rounded-lg border ${c.cor}`}>{c.emoji} {c.texto}</span>
                            </div>
                            <p className="text-xs text-gray-600 mt-1.5">
                              Margem <strong>{pct(r.promocional.cenario.resultado.margemLiquida)}</strong>
                              {' · '}lucro {brl(r.promocional.cenario.resultado.lucro)}
                              {' · '}comissão {brl(r.promocional.cenario.resultado.comissao)}
                              {r.promocional.cenario.resultado.frete > 0 ? ` · frete ${brl(r.promocional.cenario.resultado.frete)}` : ''}
                            </p>
                            <p className="text-[11px] text-gray-500 mt-1">
                              Alvo {pct(m.alvo)}
                              {m.promocionalMinima != null ? ` · mínimo promocional ${pct(m.promocionalMinima)}` : ' · sem política promocional'}
                              {m.piso != null ? ` · piso ${pct(m.piso)}` : ''}
                            </p>
                            <p className="text-[11px] text-gray-500 mt-1">{r.promocional.classificacao.motivo}</p>
                            {r.promocional.cenario.resultado.regime && (
                              <p className="text-[11px] text-gray-400 mt-0.5">Regime: {r.promocional.cenario.resultado.regime.descricao}</p>
                            )}
                          </div>
                        )
                      })()}

                      <div className="px-4 py-3">
                        {r.regra && <PorQueEstePreco r={r} />}

                        <div className="flex items-end justify-between mb-3">
                          <div>
                            <p className="text-xs text-gray-500">Preço de venda</p>
                            <p className="text-2xl font-semibold text-gray-900">{brl(r.resultado.preco)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-gray-500">Lucro por unidade</p>
                            <p className={`text-lg font-semibold ${r.resultado.lucro < 0 ? 'text-red-600' : 'text-green-700'}`}>
                              {brl(r.resultado.lucro)}
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-2 text-center">
                          {[
                            ['Margem', pct(r.resultado.margemLiquida)],
                            ['Markup', `${r.resultado.markup.toFixed(2).replace('.', ',')}×`],
                            ['ROI', pct(r.resultado.roi)],
                            ['Recebe', r.resultado.diasRecebimento ? `${r.resultado.diasRecebimento}d` : '—'],
                          ].map(([k, v]) => (
                            <div key={k} className="bg-gray-50 rounded-lg py-1.5">
                              <p className="text-[11px] text-gray-500">{k}</p>
                              <p className="text-sm font-medium text-gray-900">{v}</p>
                            </div>
                          ))}
                        </div>

                        <div className="mt-3 flex items-center justify-between text-xs">
                          <span className="text-gray-500">
                            Deduções: <strong className="text-gray-700">{brl(r.resultado.totalDeducoes)}</strong>
                            {' · '}líquido: <strong className="text-gray-700">{brl(r.resultado.valorLiquido)}</strong>
                          </span>
                          <button onClick={() => setExpandido(aberto ? null : r.canal.id)}
                            className="text-blue-600 hover:text-blue-800 font-medium">
                            {aberto ? 'ocultar conta' : 'ver a conta'}
                          </button>
                        </div>

                        {aberto && (
                          <div className="mt-3 border-t border-gray-100 pt-3">
                            {r.resultado.linhas.map((l: any, i: number) => (
                              <div key={i} className={`flex items-baseline justify-between py-1 text-sm ${l.sinal === '=' ? 'font-medium text-gray-900' : 'text-gray-600'}`}>
                                <span>
                                  <span className="inline-block w-4 text-gray-400">{l.sinal === '=' ? '' : l.sinal}</span>
                                  {l.rotulo}
                                  {l.detalhe && <span className="text-xs text-gray-400 ml-1.5">({l.detalhe})</span>}
                                </span>
                                <span className="font-mono">{brl(l.valor)}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {r.resultado.avisos.length > 0 && (
                          <div className="mt-3 space-y-1">
                            {r.resultado.avisos.map((a: string, i: number) => (
                              <p key={i} className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">{a}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {saida.resultados.length > 1 && <MelhorCanal resultados={saida.resultados} />}
            </>
          )}
        </div>
      )}

      {aba === 'regras' && <RegrasPrecificacao empresaId={empresaId} />}

      {aba === 'recalcular' && <RecalculoMassa />}

      {aba === 'taxas' && (
        <div className="space-y-4">
          {carregandoConfig && <p className="text-sm text-gray-400">Carregando...</p>}
          {itensConfig?.map(item => (
            <TaxasCanal key={item.canal.id} canal={item.canal} configInicial={item.config} origem={item.origem}
              onSalvo={() => setItensConfig(null)} />
          ))}
          {itensConfig?.length === 0 && (
            <p className="text-sm text-gray-400">Nenhum canal de marketplace conectado ainda.</p>
          )}
        </div>
      )}
    </div>
  )
}

// A resposta para "por que este anúncio está com esse preço?": qual regra
// venceu, por que ela venceu, quais perderam — e quanto isso difere do preço
// que está no ar hoje.
function PorQueEstePreco({ r }: { r: any }) {
  const [verPerdedoras, setVerPerdedoras] = useState(false)
  const dif = r.diferenca

  return (
    <div className="mb-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
      <p className="text-xs text-gray-700">
        Regra <strong>{r.regra.nome}</strong> — {r.regra.descricao}
        {r.regra.margemMinima != null && <> · piso de {r.regra.margemMinima}%</>}
      </p>
      <p className="text-[11px] text-gray-500 mt-0.5">Venceu porque {r.porQue}.</p>

      {dif != null && (
        <p className={`text-xs mt-1.5 ${Math.abs(dif) < 0.01 ? 'text-gray-500' : dif > 0 ? 'text-green-700' : 'text-red-700'}`}>
          {Math.abs(dif) < 0.01
            ? `O anúncio já está exatamente neste preço (${brl(r.precoAtual)}).`
            : dif > 0
              ? `O anúncio está por ${brl(r.precoAtual)} — ${brl(dif)} abaixo do que a regra manda.`
              : `O anúncio está por ${brl(r.precoAtual)} — ${brl(-dif)} acima do que a regra manda.`}
        </p>
      )}

      {r.perdedoras?.length > 0 && (
        <>
          <button onClick={() => setVerPerdedoras(v => !v)}
            className="text-[11px] text-blue-600 hover:text-blue-800 mt-1.5">
            {verPerdedoras ? 'ocultar' : `outras ${r.perdedoras.length} regra(s) também se aplicavam`}
          </button>
          {verPerdedoras && (
            <div className="mt-1 space-y-0.5">
              {r.perdedoras.map((p: any, i: number) => (
                <p key={i} className="text-[11px] text-gray-400">
                  {p.nome} ({p.nivel}) — {p.objetivo}. Perdeu por ser menos específica.
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Conclusão prática do comparador: onde vender rende mais. Compara lucro por
// unidade — o número que importa quando o preço é o mesmo objetivo em todos.
function MelhorCanal({ resultados }: { resultados: any[] }) {
  const validos = resultados.filter(r => r.resultado.preco > 0)
  if (validos.length < 2) return null
  const ordenado = [...validos].sort((a, b) => b.resultado.lucro - a.resultado.lucro)
  const melhor = ordenado[0], pior = ordenado[ordenado.length - 1]
  const dif = melhor.resultado.lucro - pior.resultado.lucro
  if (dif <= 0.01) return null

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
      <p className="text-sm text-blue-900">
        Com esse mesmo objetivo, <strong>{melhor.canal.nome}</strong> deixa{' '}
        <strong>{brl(dif)}</strong> a mais de lucro por unidade que {pior.canal.nome}
        {melhor.resultado.preco !== pior.resultado.preco && (
          <> — e o preço lá é {brl(melhor.resultado.preco)} contra {brl(pior.resultado.preco)}</>
        )}.
      </p>
      <p className="text-xs text-blue-700 mt-1">
        Compare também o prazo de recebimento: vender mais caro recebendo em 30 dias nem sempre é melhor.
      </p>
    </div>
  )
}
