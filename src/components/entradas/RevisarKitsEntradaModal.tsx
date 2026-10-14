'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  aplicarPrecosKits, arred2, arredondarFinal, carregarKitsDaEntrada, descontoSobrePecas, markupDe,
  precoComDesconto, precoComMarkup, type KitDaEntrada, type OrigemEntrada,
} from '@/lib/produtos/kitsDaEntrada'

// Revisão de preço dos kits que usam alguma peça desta entrada (manual ou
// XML). Abre da lista de entradas e das telas de revisão de preço. Só grava
// o que o operador mudou — a sugestão e os atalhos apenas preenchem o campo.

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number | null) => v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
// Aceita "12,50", "1.234,50" e "12.50" — com vírgula, o ponto é milhar.
const lerNumero = (s: string) => {
  const t = s.trim()
  const n = parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : NaN
}
const paraCampo = (v: number) => v.toFixed(2).replace('.', ',')

type Filtro = 'todos' | 'alerta' | 'sugestao' | 'alterados'

function alertas(k: KitDaEntrada, preco: number) {
  const out: { texto: string; cls: string }[] = []
  if (k.custoConfiavel && preco > 0 && preco <= k.custo) out.push({ texto: '⚠ abaixo do custo', cls: 'bg-red-50 text-red-700 border-red-200' })
  if (k.somaPecas > 0 && preco > k.somaPecas + 0.005) out.push({ texto: 'mais caro que as peças', cls: 'bg-amber-50 text-amber-700 border-amber-200' })
  if (!k.custoConfiavel) out.push({ texto: 'peça sem custo', cls: 'bg-gray-50 text-gray-500 border-gray-200' })
  return out
}

export default function RevisarKitsEntradaModal({ empresaId, origem, entradaId, onClose }: {
  empresaId: string
  origem: OrigemEntrada
  entradaId: string
  onClose: () => void
}) {
  const [carregando, setCarregando] = useState(true)
  const [kits, setKits] = useState<KitDaEntrada[]>([])
  const [rotulo, setRotulo] = useState('')
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [aberto, setAberto] = useState<string | null>(null)
  const [desconto, setDesconto] = useState('')
  const [markup, setMarkup] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  // Sobe a cada gravação: o efeito abaixo relê os kits com os preços novos.
  const [versao, setVersao] = useState(0)
  const rolagem = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let vivo = true
    carregarKitsDaEntrada(createClient(), empresaId, origem, entradaId).then(r => {
      if (!vivo) return
      // O que pede atenção primeiro: sugestão de preço, depois alerta
      // (abaixo do custo, mais caro que as peças), depois o resto.
      const peso = (k: KitDaEntrada) => k.sugestao != null ? 0 : alertas(k, k.precoAtual).some(a => !a.texto.startsWith('peça')) ? 1 : 2
      setKits([...r.kits].sort((a, b) => peso(a) - peso(b) || a.nome.localeCompare(b.nome, 'pt-BR')))
      setRotulo(r.rotulo); setCampos({})
    }).catch(e => {
      if (vivo) setAviso({ tipo: 'erro', texto: `Não foi possível carregar os kits: ${(e as Error).message}` })
    }).finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [empresaId, origem, entradaId, versao])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const precoDe = useCallback((k: KitDaEntrada) => {
    const s = campos[k.kitId]
    if (s == null || s.trim() === '') return k.precoAtual
    const n = lerNumero(s)
    return Number.isFinite(n) ? n : k.precoAtual
  }, [campos])

  const alterado = useCallback((k: KitDaEntrada) => {
    const s = campos[k.kitId]
    if (s == null || s.trim() === '') return false
    const n = lerNumero(s)
    return Number.isFinite(n) && n > 0 && Math.abs(n - k.precoAtual) >= 0.005
  }, [campos])

  const visiveis = useMemo(() => kits.filter(k =>
    filtro === 'alerta' ? alertas(k, precoDe(k)).some(a => !a.texto.startsWith('peça'))
      : filtro === 'sugestao' ? k.sugestao != null
        : filtro === 'alterados' ? alterado(k) : true), [kits, filtro, precoDe, alterado])

  const nAlerta = kits.filter(k => alertas(k, precoDe(k)).some(a => !a.texto.startsWith('peça'))).length
  const nSugestao = kits.filter(k => k.sugestao != null).length
  const nAlterados = kits.filter(alterado).length

  function preencher(fn: (k: KitDaEntrada) => number | null) {
    setCampos(prev => {
      const novo = { ...prev }
      for (const k of visiveis) {
        const v = fn(k)
        if (v != null && v > 0) novo[k.kitId] = paraCampo(v)
      }
      return novo
    })
  }

  async function gravar() {
    const mudancas = kits.filter(alterado).map(k => ({ kit: k, precoNovo: arred2(lerNumero(campos[k.kitId])) }))
    if (mudancas.length === 0) return
    setSalvando(true); setAviso(null)
    try {
      const r = await aplicarPrecosKits(createClient(), empresaId, mudancas, { origem, entradaId, rotulo })
      if (r.erros.length > 0) setAviso({ tipo: 'erro', texto: `${r.gravados.length} gravado(s). Falharam: ${r.erros.join('; ')}` })
      else setAviso({ tipo: 'ok', texto: `${r.gravados.length} preço(s) de kit atualizado(s).` })
      setVersao(v => v + 1)
      rolagem.current?.scrollTo({ top: 0, behavior: 'smooth' })
    } finally { setSalvando(false) }
  }

  const FILTROS: [Filtro, string, number][] = [
    ['todos', 'Todos', kits.length], ['alerta', 'Com alerta', nAlerta],
    ['sugestao', 'Com sugestão', nSugestao], ['alterados', 'Alterados', nAlterados],
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-4xl max-h-[94vh] sm:max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900">🧩 Rever preços dos kits</h2>
            <p className="text-xs text-gray-500">
              Kits com alguma peça {rotulo ? <>da entrada <strong>{rotulo}</strong></> : 'desta entrada'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="shrink-0 -mr-2 -mt-1 w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div ref={rolagem} className="flex-1 overflow-y-auto overflow-x-hidden">
          {carregando ? (
            <p className="px-6 py-12 text-center text-sm text-gray-400">Procurando os kits…</p>
          ) : kits.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-gray-600">Nenhum kit usa os produtos desta entrada.</p>
              {aviso && <p className={`mt-2 text-xs ${aviso.tipo === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>{aviso.texto}</p>}
            </div>
          ) : (
            <div className="px-4 sm:px-6 py-4 space-y-3">
              <p className="text-xs text-gray-500 leading-snug">
                O custo do kit já reflete o custo novo das peças. Digite o preço novo nos kits que quiser mudar —
                só os alterados são gravados.
                {nSugestao > 0 && <> A <strong>sugestão</strong> mantém o desconto que o kit tinha sobre as peças avulsas.</>}
              </p>

              {/* Atalhos: preenchem o campo dos kits listados abaixo (respeitam o filtro). */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
                <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Preencher os {visiveis.length} kit(s) listados</p>
                <div className="flex flex-wrap items-center gap-2">
                  {nSugestao > 0 && (
                    <button onClick={() => preencher(k => k.sugestao)}
                      className="px-3 py-2 sm:py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
                      ✓ Usar sugestões
                    </button>
                  )}
                  <div className="flex items-center gap-1">
                    <input value={desconto} onChange={e => setDesconto(e.target.value)} inputMode="decimal" placeholder="10"
                      className="w-14 border border-gray-300 rounded-lg px-2 py-2 sm:py-1.5 text-base sm:text-xs text-right focus:outline-none focus:border-blue-500" />
                    <button onClick={() => { const d = lerNumero(desconto); if (Number.isFinite(d)) preencher(k => k.somaPecas > 0 ? precoComDesconto(k.somaPecas, d) : null) }}
                      className="px-2.5 py-2 sm:py-1.5 text-xs rounded-lg border border-gray-300 bg-white hover:bg-gray-100 whitespace-nowrap">% off nas peças</button>
                  </div>
                  <div className="flex items-center gap-1">
                    <input value={markup} onChange={e => setMarkup(e.target.value)} inputMode="decimal" placeholder="60"
                      className="w-14 border border-gray-300 rounded-lg px-2 py-2 sm:py-1.5 text-base sm:text-xs text-right focus:outline-none focus:border-blue-500" />
                    <button onClick={() => { const m = lerNumero(markup); if (Number.isFinite(m)) preencher(k => k.custoConfiavel ? precoComMarkup(k.custo, m) : null) }}
                      className="px-2.5 py-2 sm:py-1.5 text-xs rounded-lg border border-gray-300 bg-white hover:bg-gray-100 whitespace-nowrap">% markup no custo</button>
                  </div>
                  <button onClick={() => preencher(k => arredondarFinal(precoDe(k), '.90'))}
                    className="px-2.5 py-2 sm:py-1.5 text-xs rounded-lg border border-gray-300 bg-white hover:bg-gray-100">,90</button>
                  <button onClick={() => preencher(k => arredondarFinal(precoDe(k), '.99'))}
                    className="px-2.5 py-2 sm:py-1.5 text-xs rounded-lg border border-gray-300 bg-white hover:bg-gray-100">,99</button>
                  {nAlterados > 0 && (
                    <button onClick={() => setCampos({})} className="px-2.5 py-2 sm:py-1.5 text-xs rounded-lg text-gray-500 hover:text-gray-800">↺ Desfazer</button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 max-sm:overflow-x-auto max-sm:-mx-4 max-sm:px-4 max-sm:[scrollbar-width:none]">
                {FILTROS.map(([f, label, n]) => (
                  <button key={f} onClick={() => setFiltro(f)}
                    className={`shrink-0 whitespace-nowrap px-3 py-1.5 text-xs rounded-lg border ${filtro === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                    {label} ({n})
                  </button>
                ))}
              </div>

              {aviso && (
                <p className={`text-xs rounded-lg px-3 py-2 ${aviso.tipo === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{aviso.texto}</p>
              )}

              {visiveis.length === 0 && <p className="text-sm text-gray-400 text-center py-6">Nenhum kit neste filtro.</p>}

              <ul className="space-y-2">
                {visiveis.map(k => {
                  const preco = precoDe(k)
                  const mudou = alterado(k)
                  const mk = markupDe(preco, k.custo)
                  const desc = descontoSobrePecas(preco, k.somaPecas)
                  const daNota = k.componentes.filter(c => c.daEntrada).length
                  return (
                    <li key={k.kitId} className={`border rounded-xl px-3 py-3 ${mudou ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200 bg-white'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 break-words">{k.nome}</p>
                          <div className="flex flex-wrap items-center gap-1 mt-0.5">
                            {k.sku && <span className="text-[11px] font-mono text-gray-400 mr-1">{k.sku}</span>}
                            {alertas(k, preco).map(a => (
                              <span key={a.texto} className={`text-[10px] px-1.5 py-0.5 rounded-full border ${a.cls}`}>{a.texto}</span>
                            ))}
                            {k.revisadoDepois && <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">preço revisto após a nota</span>}
                            {k.promocao != null && <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-orange-50 text-orange-700 border-orange-200">🔥 promoção {brl(k.promocao)}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 grid grid-cols-3 md:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.3fr)_minmax(0,1.4fr)] gap-x-3 gap-y-2 items-start">
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase">Custo</p>
                          <p className="text-sm text-gray-800">{k.custoConfiavel ? brl(k.custo) : '—'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase">Peças avulsas</p>
                          <p className="text-sm text-gray-800">{brl(k.somaPecas)}</p>
                          {k.somaPecasAntes != null && Math.abs(k.somaPecasAntes - k.somaPecas) >= 0.005 && (
                            <p className="text-[10px] text-gray-400">antes {brl(k.somaPecasAntes)}</p>
                          )}
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase">Preço atual</p>
                          <p className="text-sm text-gray-800">{brl(k.precoAtual)}</p>
                          <p className="text-[10px] text-gray-400">markup {pct(markupDe(k.precoAtual, k.custo))}</p>
                        </div>
                        <div className="col-span-3 md:col-span-1">
                          {k.sugestao != null ? (
                            <button onClick={() => setCampos(p => ({ ...p, [k.kitId]: paraCampo(k.sugestao!) }))}
                              title="Mantém o desconto que o kit tinha sobre as peças"
                              className="w-full text-left md:text-right px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100">
                              <span className="block text-[10px] text-emerald-700 uppercase">Sugestão</span>
                              <span className="text-sm font-semibold text-emerald-800">{brl(k.sugestao)}</span>
                            </button>
                          ) : (
                            <p className="hidden md:block text-[11px] text-gray-300 text-right">sem sugestão</p>
                          )}
                        </div>
                        <div className="col-span-3 md:col-span-1">
                          <label className="block text-[10px] text-gray-400 uppercase mb-0.5">Preço novo</label>
                          <input value={campos[k.kitId] ?? ''} onChange={e => setCampos(p => ({ ...p, [k.kitId]: e.target.value }))}
                            inputMode="decimal" placeholder={paraCampo(k.precoAtual)}
                            className={`w-full border rounded-lg px-2.5 py-2 sm:py-1.5 text-base sm:text-sm text-right font-semibold focus:outline-none focus:border-blue-500 ${mudou ? 'border-blue-400' : 'border-gray-300'}`} />
                          <p className="text-[10px] text-gray-500 text-right mt-0.5">
                            markup <strong className={mk != null && mk <= 0 ? 'text-red-600' : 'text-gray-700'}>{pct(mk)}</strong>
                            {' · '}{desc != null && desc < 0 ? <>acima das peças <strong className="text-amber-700">{pct(-desc)}</strong></> : <>desconto <strong className="text-gray-700">{pct(desc)}</strong></>}
                          </p>
                        </div>
                      </div>

                      <button onClick={() => setAberto(a => a === k.kitId ? null : k.kitId)}
                        className="mt-2 text-xs text-blue-600 hover:underline">
                        {aberto === k.kitId ? '▾' : '▸'} {k.componentes.length} peça{k.componentes.length === 1 ? '' : 's'} ({daNota} desta entrada)
                      </button>
                      {aberto === k.kitId && (
                        <ul className="mt-1.5 border border-gray-100 rounded-lg divide-y divide-gray-100 text-xs bg-white">
                          {k.componentes.map(c => (
                            <li key={c.produtoId} className="px-2.5 py-1.5 flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-gray-800 break-words">
                                  <span className="text-gray-500">{c.quantidade.toLocaleString('pt-BR')} ×</span> {c.nome}
                                  {c.daEntrada && <span className="ml-1 inline-block whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">nesta entrada</span>}
                                </p>
                                <p className="text-[11px] text-gray-400">custo {c.custo > 0 ? brl(c.custo) : '—'}{c.sku ? ` · ${c.sku}` : ''}</p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="text-gray-800">{brl(c.precoVenda)}</p>
                                {c.precoAntes != null && Math.abs(c.precoAntes - c.precoVenda) >= 0.005 && (
                                  <p className="text-[10px] text-gray-400">antes {brl(c.precoAntes)}</p>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>

        <div className="px-4 sm:px-6 py-3 border-t border-gray-200 flex items-center justify-between gap-3 bg-white">
          <p className="hidden sm:block text-xs text-gray-500">{nAlterados > 0 ? `${nAlterados} kit(s) com preço novo` : 'Nenhum preço alterado'}</p>
          <div className="flex gap-2 max-sm:w-full max-sm:[&>button]:flex-1">
            <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Fechar</button>
            {kits.length > 0 && <button onClick={gravar} disabled={salvando || nAlterados === 0}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg whitespace-nowrap">
              {salvando ? 'Gravando…' : nAlterados > 0 ? `Gravar ${nAlterados} preço${nAlterados === 1 ? '' : 's'}` : 'Gravar'}
            </button>}
          </div>
        </div>
      </div>
    </div>
  )
}
