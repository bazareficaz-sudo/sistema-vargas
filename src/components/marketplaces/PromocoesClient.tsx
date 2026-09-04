'use client'

import { useState } from 'react'
import type { ItemComEconomia } from '@/lib/marketplace/economiaCampanha'
import { useRouter } from 'next/navigation'

// Promoções do canal — fatia 1: ler o que a Shopee já tem.
//
// A tela ainda NÃO cria nem encerra campanha. Isso é de propósito: antes do
// primeiro `add_discount` de verdade vale ver como as campanhas reais desta
// loja são — quantas, com que janelas, quantos itens, e quais anúncios já
// estão dentro de alguma. Publicar campanha errada mexe em preço no ar.

const SITUACOES: Record<string, { label: string; cls: string }> = {
  ativa:      { label: 'Ativa',      cls: 'bg-emerald-100 text-emerald-700' },
  programada: { label: 'Programada', cls: 'bg-blue-100 text-blue-700' },
  encerrada:  { label: 'Encerrada',  cls: 'bg-gray-100 text-gray-500' },
  rascunho:   { label: 'Rascunho',   cls: 'bg-amber-100 text-amber-700' },
}

const fmt = (v: number | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function data(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export default function PromocoesClient({ canal, promocoes, economia = {} }: {
  canal: any
  promocoes: any[]
  empresaId: string
  /** Margem de cada item, calculada no servidor pela MESMA engine do recálculo. */
  economia?: Record<string, ItemComEconomia>
}) {
  const router = useRouter()
  const [sincronizando, setSincronizando] = useState(false)
  const [sondando, setSondando] = useState(false)
  const [sonda, setSonda] = useState<Record<string, unknown> | null>(null)

  async function sondar() {
    setSondando(true); setSonda(null)
    try {
      const r = await fetch(`/api/marketplace/shopee/sondar-desconto?canalId=${canal.id}`)
        .then(x => x.json())
      setSonda(r)
    } catch (e) {
      setSonda({ ok: false, erro: e instanceof Error ? e.message : 'falha' })
    } finally {
      setSondando(false)
    }
  }
  const [resumo, setResumo] = useState('')
  const [erro, setErro] = useState('')
  const [aberta, setAberta] = useState<string | null>(null)

  const ehShopee = canal.plataforma === 'shopee'

  async function sincronizar() {
    setSincronizando(true); setResumo(''); setErro('')
    try {
      const d = await fetch('/api/marketplace/shopee/promocoes/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canalId: canal.id }),
      }).then(r => r.json())

      if (!d.ok) {
        setErro(d.erro ?? 'Falha ao ler as campanhas na Shopee.')
      } else {
        // Os avisos entram no resumo em vez de virarem log invisível: item
        // em campanha sem anúncio no sistema é exatamente o que o operador
        // precisa saber para agir (sincronizar o catálogo).
        setResumo(
          `${d.campanhas} campanha(s) e ${d.itens} item(ns) lidos da Shopee.`
          + (d.avisos?.length ? ` ${d.avisos.join(' · ')}` : ''))
        router.refresh()
      }
    } catch (e: any) {
      setErro(e?.message ?? 'Erro ao falar com a Shopee.')
    }
    setSincronizando(false)
  }

  const ativas = promocoes.filter(p => p.status === 'ativa').length
  const itensEmCampanhaAtiva = promocoes
    .filter(p => p.status === 'ativa')
    .reduce((s, p) => s + (p.marketplace_promocao_itens?.length ?? 0), 0)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Promoções — {canal.nome}</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {promocoes.length} campanha(s) no sistema
            {ativas > 0 && ` · ${ativas} ativa(s), com ${itensEmCampanhaAtiva} item(ns)`}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <a href={`/dashboard/marketplaces/${canal.id}/anuncios`}
            className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium rounded-lg">
            Anúncios
          </a>
          {ehShopee && (
            <button onClick={sincronizar} disabled={sincronizando}
              title="Lê as campanhas de desconto da Shopee. Não cria nem altera nada lá."
              className="px-4 py-2 border border-blue-300 text-blue-600 text-sm font-medium rounded-lg hover:bg-blue-50 disabled:opacity-50">
              {sincronizando ? 'Lendo...' : '↺ Puxar campanhas da Shopee'}
            </button>
          )}
          {/* SONDA — somente leitura, como a do Mercado Livre. Existe porque
              acrescentar produto a uma campanha e ESCRITA, e nao vamos
              escrever contra um contrato que ninguem mediu. */}
          {ehShopee && (
            <button onClick={() => void sondar()} disabled={sondando}
              title="Mede o que a API de descontos da Shopee responde. Somente GET: não cria, não altera, não acrescenta."
              className="px-4 py-2 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50">
              {sondando ? 'Sondando...' : '🔎 Sondar API de descontos'}
            </button>
          )}
        </div>
      </div>

      {!ehShopee && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 rounded-lg mb-4">
          A gestão de promoções começou pela Shopee. Este canal é {canal.plataforma} — ainda não há
          integração de campanha para ele.
        </div>
      )}
      {resumo && <div className="bg-blue-50 border border-blue-200 text-blue-700 text-xs px-4 py-2.5 rounded-lg mb-4">{resumo}</div>}
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-2.5 rounded-lg mb-4">{erro}</div>}

      <div className="bg-gray-50 border border-gray-200 text-gray-600 text-xs px-4 py-2.5 rounded-lg mb-4">
        Esta tela ainda só <strong>lê</strong>. Criar, alterar e encerrar campanha pela API é a próxima
        fatia — o primeiro envio real mexe em preço no ar, e vem depois de você conferir aqui que o
        que o sistema enxerga bate com o painel da Shopee.
      </div>

      {sonda && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm font-semibold text-gray-900">Sonda da API de descontos</p>
          <p className="text-xs text-gray-500 mt-0.5 mb-3">
            Somente leitura. O <code>erro</code> de cada linha é o código cru da Shopee — vazio
            significa que a chamada passou.
          </p>
          <pre className="max-h-96 overflow-auto rounded-lg bg-gray-50 p-3 text-[10px] leading-relaxed text-gray-700">
            {JSON.stringify(sonda, null, 2)}
          </pre>
        </div>
      )}

      {promocoes.length === 0 ? (
        <div className="text-center py-14 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-3xl mb-2">🏷️</p>
          <p className="text-sm">Nenhuma campanha no sistema ainda.</p>
          {ehShopee && <p className="text-xs mt-1">Use &quot;Puxar campanhas da Shopee&quot; para trazer as que já existem lá.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {promocoes.map(p => {
            const itens = p.marketplace_promocao_itens ?? []
            const st = SITUACOES[p.status] ?? { label: p.status, cls: 'bg-gray-100 text-gray-500' }
            const expandida = aberta === p.id
            const semAnuncio = itens.filter((i: any) => !i.anuncio_id).length
            return (
              <div key={p.id} className="border border-gray-200 rounded-xl bg-white overflow-hidden">
                <button onClick={() => setAberta(expandida ? null : p.id)}
                  className="w-full flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50 text-left">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 truncate">{p.nome}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>
                      {semAnuncio > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"
                          title="Itens da campanha sem anúncio correspondente no sistema — sincronize o catálogo deste canal">
                          {semAnuncio} sem vínculo
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {data(p.inicio)} → {data(p.fim)} · {itens.length} item(ns)
                      {p.id_externo && ` · ID Shopee ${p.id_externo}`}
                    </p>
                  </div>
                  <span className="text-gray-400 text-sm shrink-0">{expandida ? '▲' : '▼'}</span>
                </button>

                {expandida && (
                  itens.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-gray-400 border-t border-gray-100">
                      Campanha sem itens.
                    </p>
                  ) : (
                    <div className="border-t border-gray-100 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="text-left px-4 py-2 text-xs font-medium text-gray-600">Item</th>
                            <th className="text-left px-4 py-2 text-xs font-medium text-gray-600">SKU canal</th>
                            <th className="text-right px-4 py-2 text-xs font-medium text-gray-600">De</th>
                            <th className="text-right px-4 py-2 text-xs font-medium text-gray-600">Por</th>
                            <th className="text-right px-4 py-2 text-xs font-medium text-gray-600">Desconto</th>
                            {/* AS DUAS MARGENS LADO A LADO. Desconto sozinho nao
                                diz se vale a pena: 34% de desconto num item com
                                margem de 40% e negocio; no de 10% e prejuizo. */}
                            <th className="text-right px-4 py-2 text-xs font-medium text-gray-600"
                              title="Margem líquida no preço normal e no promocional — depois de comissão, frete, imposto e embalagem">
                              Margem antes → depois
                            </th>
                            <th className="text-right px-4 py-2 text-xs font-medium text-gray-600">Limite</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {itens.map((i: any) => {
                            const anuncio = Array.isArray(i.marketplace_anuncios) ? i.marketplace_anuncios[0] : i.marketplace_anuncios
                            const de = Number(i.preco_original ?? 0)
                            const por = Number(i.preco_promocional ?? 0)
                            const desconto = de > 0 && por > 0 ? (1 - por / de) * 100 : null
                            return (
                              <tr key={i.id} className="hover:bg-gray-50">
                                <td className="px-4 py-2 text-gray-900">
                                  {anuncio?.titulo ?? i.item_nome ?? `Item ${i.item_id_externo}`}
                                  {i.model_id && <span className="text-gray-400 text-xs block">variação {i.model_id}</span>}
                                  {!i.anuncio_id && (
                                    <span className="text-amber-600 text-xs block">sem anúncio no sistema</span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-gray-500 text-xs font-mono">{anuncio?.sku_canal ?? '—'}</td>
                                <td className="px-4 py-2 text-right text-gray-500 line-through">{fmt(i.preco_original)}</td>
                                <td className="px-4 py-2 text-right font-medium text-emerald-700">{fmt(i.preco_promocional)}</td>
                                <td className="px-4 py-2 text-right text-xs text-gray-600">
                                  {desconto == null ? '—' : `${desconto.toFixed(1)}%`}
                                </td>

                                <td className="px-4 py-2 text-right">
                                  {(() => {
                                    const ec = economia[i.id]
                                    // SEM ECONOMIA NAO E ZERO. Mostrar 0% num item
                                    // sem custo cadastrado seria afirmar que ele nao
                                    // da lucro, quando a verdade e que ninguem sabe.
                                    if (!ec || ec.semEconomia) {
                                      return (
                                        <span className="text-[11px] text-amber-700" title={ec?.semEconomia ?? 'sem dados'}>
                                          não calculável
                                        </span>
                                      )
                                    }
                                    const antes = ec.normal?.resultado.margemLiquida
                                    const depois = ec.promocional?.resultado.margemLiquida
                                    const cor = (m?: number) =>
                                      m == null ? 'text-gray-400' : m < 0 ? 'text-red-600 font-semibold' : m < 5 ? 'text-amber-700' : 'text-emerald-700'
                                    return (
                                      <>
                                        <span className="text-xs">
                                          <span className={cor(antes)}>{antes == null ? '—' : `${antes.toFixed(1)}%`}</span>
                                          <span className="text-gray-300 mx-1">→</span>
                                          <span className={cor(depois)}>{depois == null ? '—' : `${depois.toFixed(1)}%`}</span>
                                        </span>
                                        {/* LUCRO EM REAIS junto do percentual: 8% de
                                            R$ 20 e 8% de R$ 200 sao decisoes
                                            diferentes. */}
                                        {ec.promocional && (
                                          <span className="block text-[10px] text-gray-400">
                                            {fmt(ec.promocional.resultado.lucro)}/un no promocional
                                          </span>
                                        )}
                                        {/* DE ONDE VIERAM COMISSAO E FRETE. Margem
                                            calculada com frete suposto nao pode
                                            parecer margem medida. */}
                                        {ec.origem && (ec.origem.frete.includes('sem_medidas') || ec.origem.comissao.includes('sem_categoria')) && (
                                          <span className="block text-[10px] text-amber-600">⚠ base não medida</span>
                                        )}
                                      </>
                                    )
                                  })()}
                                </td>
                                <td className="px-4 py-2 text-right text-xs text-gray-500">
                                  {/* 0 é "sem limite" na convenção da Shopee, não "nenhum permitido". */}
                                  {i.limite_por_compra == null ? '—' : i.limite_por_compra === 0 ? 'sem limite' : i.limite_por_compra}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
