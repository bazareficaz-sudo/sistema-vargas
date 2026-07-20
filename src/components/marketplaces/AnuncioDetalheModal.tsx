'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmt, temDivergencia } from './utils'

export default function AnuncioDetalheModal({ anuncio, canal, regras, onClose, onAtualizado }: {
  anuncio: any; canal: any; regras?: any[]; onClose: () => void; onAtualizado: (anuncio: any) => void
}) {
  const [variacoes, setVariacoes] = useState<any[]>([])
  const [carregandoVariacoes, setCarregandoVariacoes] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [salvandoRegra, setSalvandoRegra] = useState(false)

  async function alterarRegra(regraId: string) {
    setSalvandoRegra(true)
    const sb = createClient()
    await sb.from('marketplace_anuncios').update({ regra_id: regraId || null }).eq('id', anuncio.id)
    onAtualizado({ ...anuncio, regra_id: regraId || null })
    setSalvandoRegra(false)
  }

  useEffect(() => {
    if (!anuncio.tem_variacao) { setVariacoes([]); return }
    let ativo = true
    setCarregandoVariacoes(true)
    const sb = createClient()
    sb.from('marketplace_anuncio_variacoes')
      .select('*, produtos(id, nome, sku)')
      .eq('anuncio_id', anuncio.id)
      .order('nome_variacao')
      .then(({ data }: any) => { if (ativo) { setVariacoes(data ?? []); setCarregandoVariacoes(false) } })
    return () => { ativo = false }
  }, [anuncio.id, anuncio.tem_variacao])

  async function sincronizarItem() {
    if (!anuncio.id_externo) { setErro('Este anúncio não tem ID externo — não veio de sincronização.'); return }
    setSincronizando(true); setErro(''); setAviso('')
    try {
      const endpoint = canal.plataforma === 'mercadolivre' ? '/api/marketplace/mercadolivre/sync-item' : '/api/marketplace/shopee/sync-item'
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canalId: canal.id, idExterno: anuncio.id_externo }),
      })
      const data = await resp.json()
      if (!data.ok) { setErro(data.erro ?? 'Erro ao sincronizar'); return }
      onAtualizado(data.anuncio)
      setVariacoes(data.variacoes ?? [])
      setAviso(data.warnings?.length ? `Sincronizado com ${data.warnings.length} aviso(s).` : 'Sincronizado com sucesso.')
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao sincronizar')
    } finally {
      setSincronizando(false)
    }
  }

  const linkManual = anuncio.url_anuncio || null
  const linkEstimado = !linkManual && canal.seller_id && anuncio.id_externo
    ? `https://shopee.com.br/product/${canal.seller_id}/${anuncio.id_externo}`
    : null
  const link = linkManual ?? linkEstimado

  const diverge = temDivergencia(anuncio)
  const precoDivergente = !!anuncio.produtos && Number(anuncio.preco_venda) !== Number(anuncio.produtos.preco_venda)
  const estoqueDivergente = !!anuncio.produtos && (anuncio.estoque_externo ?? 0) !== (anuncio.produtos.estoque ?? 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{anuncio.titulo}</h2>
            {anuncio.id_externo && <p className="text-xs text-gray-400 font-mono">ID externo: {anuncio.id_externo}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {anuncio.imagens?.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {anuncio.imagens.map((url: string, i: number) => (
                <img key={i} src={url} alt="" className="w-full h-24 object-cover rounded-lg border border-gray-200" />
              ))}
            </div>
          )}

          {anuncio.descricao && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Descrição</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{anuncio.descricao}</p>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">
              Shopee vs. Sistema {diverge && <span className="text-amber-600">— divergência encontrada</span>}
            </p>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <th className="text-left px-3 py-2">Campo</th>
                    <th className="text-right px-3 py-2">Shopee</th>
                    <th className="text-right px-3 py-2">Sistema</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr>
                    <td className="px-3 py-2 text-gray-600">Preço</td>
                    <td className={`px-3 py-2 text-right ${precoDivergente ? 'text-amber-600 font-medium' : 'text-gray-900'}`}>{fmt(anuncio.preco_venda)}</td>
                    <td className="px-3 py-2 text-right text-gray-900">{anuncio.produtos ? fmt(anuncio.produtos.preco_venda) : '—'}</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-gray-600">Estoque</td>
                    <td className={`px-3 py-2 text-right ${estoqueDivergente ? 'text-amber-600 font-medium' : 'text-gray-900'}`}>{anuncio.estoque_externo ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-900">{anuncio.produtos ? anuncio.produtos.estoque : '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {!anuncio.produtos && <p className="text-xs text-gray-400 mt-1">Este anúncio não está vinculado a nenhum produto do sistema.</p>}
          </div>

          {regras && regras.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Regra associada</p>
              <select value={anuncio.regra_id ?? ''} onChange={e => alterarRegra(e.target.value)} disabled={salvandoRegra}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50">
                <option value="">Nenhuma — só espelha o estoque do produto</option>
                {regras.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Usada pela sincronização automática de estoque quando "Aplicar a regra associada ao produto" estiver ativo em Configurar.
              </p>
            </div>
          )}

          {anuncio.tem_variacao && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Variações</p>
              {carregandoVariacoes ? (
                <p className="text-xs text-gray-400">Carregando...</p>
              ) : variacoes.length === 0 ? (
                <p className="text-xs text-gray-400">Nenhuma variação encontrada.</p>
              ) : (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                        <th className="text-left px-3 py-2">Variação</th>
                        <th className="text-left px-3 py-2">SKU</th>
                        <th className="text-right px-3 py-2">Preço</th>
                        <th className="text-right px-3 py-2">Estoque</th>
                        <th className="text-left px-3 py-2">Produto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {variacoes.map(v => (
                        <tr key={v.id}>
                          <td className="px-3 py-2 text-gray-800">{v.nome_variacao || '—'}</td>
                          <td className="px-3 py-2 text-gray-500 font-mono text-xs">{v.sku_variacao || '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-900">{v.preco != null ? fmt(v.preco) : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-900">{v.estoque ?? '—'}</td>
                          <td className="px-3 py-2 text-xs">
                            {v.produtos ? (
                              <span className="text-emerald-700">{v.produtos.nome}</span>
                            ) : (
                              <span className="text-gray-400">Não vinculado</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {link && (
            <p className="text-xs">
              <a href={link} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">Ver na Shopee ↗</a>
              {!linkManual && <span className="text-gray-400"> (link estimado)</span>}
            </p>
          )}

          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
          {aviso && !erro && <p className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{aviso}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Fechar</button>
          {(canal.plataforma === 'shopee' || canal.plataforma === 'mercadolivre') && anuncio.id_externo && (
            <button onClick={sincronizarItem} disabled={sincronizando}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {sincronizando ? 'Sincronizando...' : '↺ Sincronizar este anúncio'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
