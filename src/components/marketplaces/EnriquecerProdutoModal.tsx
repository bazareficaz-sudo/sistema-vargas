'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmt } from './utils'

type Campo = 'nome' | 'marca' | 'preco_venda' | 'estoque'

export default function EnriquecerProdutoModal({ anuncio, empresaId, operador, onClose, onAtualizado }: {
  anuncio: any; empresaId: string; operador: string
  onClose: () => void
  onAtualizado: (anuncioAtualizado: any) => void
}) {
  const [produto, setProduto] = useState<any | null>(null)
  const [imagensProduto, setImagensProduto] = useState<any[]>([])
  const [carregando, setCarregando] = useState(true)
  const [camposSelecionados, setCamposSelecionados] = useState<Set<Campo>>(new Set())
  const [imagensSelecionadas, setImagensSelecionadas] = useState<Set<string>>(new Set())
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    let ativo = true
    async function carregar() {
      const sb = createClient()
      const [{ data: prod }, { data: imgs }] = await Promise.all([
        sb.from('produtos').select('id, nome, marca, preco_venda, estoque').eq('id', anuncio.produto_id).single(),
        sb.from('produto_imagens').select('id, url, ordem, principal').eq('produto_id', anuncio.produto_id).order('ordem'),
      ])
      if (ativo) { setProduto(prod ?? null); setImagensProduto(imgs ?? []); setCarregando(false) }
    }
    carregar()
    return () => { ativo = false }
  }, [anuncio.produto_id])

  function toggleCampo(campo: Campo) {
    setCamposSelecionados(prev => {
      const novo = new Set(prev)
      if (novo.has(campo)) novo.delete(campo); else novo.add(campo)
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

  const valorShopee: Record<Campo, any> = {
    nome: anuncio.titulo,
    marca: anuncio.marca_externa,
    preco_venda: anuncio.preco_venda,
    estoque: anuncio.estoque_externo,
  }

  async function aplicar() {
    if (!produto) return
    setSalvando(true); setErro(''); setAviso('')
    const sb = createClient()

    const updates: Record<string, any> = {}
    const historico: any[] = []
    for (const campo of camposSelecionados) {
      const novo = valorShopee[campo]
      if (novo === undefined || novo === null) continue
      updates[campo] = novo
      historico.push({
        empresa_id: empresaId, produto_id: produto.id, anuncio_id: anuncio.id,
        campo, valor_anterior: produto[campo] != null ? String(produto[campo]) : null, valor_novo: String(novo),
        operador,
      })
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await sb.from('produtos').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', produto.id)
      if (error) { setErro(error.message); setSalvando(false); return }
    }

    const urlsNovas = [...imagensSelecionadas]
    if (urlsNovas.length > 0) {
      await sb.from('produto_imagens').insert(urlsNovas.map((url, i) => ({
        empresa_id: empresaId, produto_id: produto.id, url,
        ordem: imagensProduto.length + i, principal: imagensProduto.length === 0 && i === 0,
      })))
      for (const url of urlsNovas) {
        historico.push({ empresa_id: empresaId, produto_id: produto.id, anuncio_id: anuncio.id, campo: 'imagem', valor_anterior: null, valor_novo: url, operador })
      }
    }

    if (historico.length > 0) {
      await sb.from('marketplace_enriquecimento_historico').insert(historico)
    }

    const produtoAtualizado = { ...produto, ...updates }
    setProduto(produtoAtualizado)
    setCamposSelecionados(new Set())
    setImagensSelecionadas(new Set())
    onAtualizado({ ...anuncio, produtos: { ...anuncio.produtos, ...updates } })
    setAviso('Alterações aplicadas.')
    setSalvando(false)
  }

  const CAMPOS: { key: Campo; label: string; formatar?: (v: any) => string }[] = [
    { key: 'nome', label: 'Nome' },
    { key: 'marca', label: 'Marca' },
    { key: 'preco_venda', label: 'Preço de venda', formatar: v => fmt(Number(v) || 0) },
    { key: 'estoque', label: 'Estoque', formatar: v => String(v ?? '—') },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Enriquecer produto</h2>
            <p className="text-xs text-gray-400 truncate max-w-md">{anuncio.titulo}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {carregando ? (
            <p className="text-sm text-gray-400">Carregando...</p>
          ) : !produto ? (
            <p className="text-sm text-gray-400">Produto vinculado não encontrado.</p>
          ) : (
            <>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Marque os campos da Shopee que deseja trazer para o produto — nenhum é aplicado automaticamente.</p>
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                        <th className="text-left px-3 py-2">Campo</th>
                        <th className="text-left px-3 py-2">Shopee</th>
                        <th className="text-left px-3 py-2">Sistema</th>
                        <th className="text-center px-3 py-2 w-20">Importar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {CAMPOS.map(c => {
                        const vShopee = valorShopee[c.key]
                        const vSistema = produto[c.key]
                        const diverge = String(vShopee ?? '') !== String(vSistema ?? '')
                        return (
                          <tr key={c.key} className={diverge ? 'bg-amber-50/40' : ''}>
                            <td className="px-3 py-2 text-gray-600">{c.label}</td>
                            <td className="px-3 py-2 text-gray-900">{c.formatar ? c.formatar(vShopee) : (vShopee ?? '—')}</td>
                            <td className="px-3 py-2 text-gray-900">{c.formatar ? c.formatar(vSistema) : (vSistema ?? '—')}</td>
                            <td className="px-3 py-2 text-center">
                              <input type="checkbox" checked={camposSelecionados.has(c.key)} onChange={() => toggleCampo(c.key)}
                                disabled={vShopee === undefined || vShopee === null}
                                className="w-4 h-4 accent-emerald-600" />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {anuncio.imagens?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Imagens da Shopee (marque para adicionar ao produto — as imagens atuais não são removidas)</p>
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    {anuncio.imagens.map((url: string, i: number) => (
                      <label key={i} className="relative cursor-pointer">
                        <img src={url} alt="" className={`w-full h-20 object-cover rounded-lg border-2 ${imagensSelecionadas.has(url) ? 'border-emerald-400' : 'border-gray-200'}`} />
                        <input type="checkbox" checked={imagensSelecionadas.has(url)} onChange={() => toggleImagem(url)}
                          className="absolute top-1 right-1 w-4 h-4 accent-emerald-600" />
                      </label>
                    ))}
                  </div>
                  {imagensProduto.length > 0 && (
                    <>
                      <p className="text-xs text-gray-400 mb-1">Imagens atuais do produto ({imagensProduto.length}):</p>
                      <div className="grid grid-cols-6 gap-2">
                        {imagensProduto.map(img => (
                          <img key={img.id} src={img.url} alt="" className="w-full h-14 object-cover rounded-lg border border-gray-200 opacity-70" />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
              {aviso && !erro && <p className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{aviso}</p>}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Fechar</button>
          {produto && (
            <button onClick={aplicar} disabled={salvando || (camposSelecionados.size === 0 && imagensSelecionadas.size === 0)}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {salvando ? 'Aplicando...' : 'Aplicar selecionados'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
