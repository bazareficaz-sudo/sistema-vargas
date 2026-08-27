'use client'

import { useState } from 'react'
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

export default function PromocoesClient({ canal, promocoes }: {
  canal: any
  promocoes: any[]
  empresaId: string
}) {
  const router = useRouter()
  const [sincronizando, setSincronizando] = useState(false)
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
