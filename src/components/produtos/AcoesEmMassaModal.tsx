'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sincronizarProdutoVinculado } from '@/lib/produtos/vinculo'
import { minimosPorValor } from '@/lib/estoque/minimoEmMassa'

const UNIDADES = ['UN', 'KG', 'LT', 'MT', 'CX', 'PC', 'PR', 'DZ', 'CT', 'M2', 'M3', 'GR', 'ML', 'CM']

type Categoria = { id: string; nome: string; pai_id: string | null }
type Marca = { id: string; nome: string }

export default function AcoesEmMassaModal({ ids, categoriasRaiz, categoriasTodas, marcas, onClose, onAplicado }: {
  ids: string[]
  categoriasRaiz: Categoria[]
  categoriasTodas: Categoria[]
  marcas: Marca[]
  onClose: () => void
  onAplicado: () => void
}) {
  const [aplicarCategoria, setAplicarCategoria] = useState(false)
  const [categoria, setCategoria] = useState('')
  const [subcategoria, setSubcategoria] = useState('')

  const [aplicarMarca, setAplicarMarca] = useState(false)
  const [marca, setMarca] = useState('')

  const [aplicarNcm, setAplicarNcm] = useState(false)
  const [ncm, setNcm] = useState('')

  const [aplicarUnidade, setAplicarUnidade] = useState(false)
  const [unidade, setUnidade] = useState('UN')

  const [aplicarPdv, setAplicarPdv] = useState(false)
  const [disponivelPdv, setDisponivelPdv] = useState(true)

  // Perfis fiscais vêm do banco aqui mesmo, em vez de pela lista de produtos:
  // só esta tela precisa deles. Lista vazia (tabela ainda não criada, ou
  // nenhum perfil) esconde a opção em vez de oferecer um select sem nada.
  const [perfisFiscais, setPerfisFiscais] = useState<{ id: string; nome: string }[]>([])
  const [aplicarPerfil, setAplicarPerfil] = useState(false)
  const [perfilFiscal, setPerfilFiscal] = useState('')
  useEffect(() => {
    createClient().from('perfis_fiscais').select('id, nome').eq('ativo', true).order('nome')
      .then(({ data }) => setPerfisFiscais(data ?? []))
  }, [])

  // ESTOQUE MÍNIMO: a mesma quantidade para todos, ou N dias de venda de
  // cada produto (média diária da rotina de reposição). É o mínimo que
  // alimenta a Lista de Compra, os alertas e o "abaixo do mínimo".
  const [aplicarMinimo, setAplicarMinimo] = useState(false)
  const [modoMinimo, setModoMinimo] = useState<'fixo' | 'dias'>('fixo')
  const [minimoFixo, setMinimoFixo] = useState('')
  const [diasCobertura, setDiasCobertura] = useState('30')
  const [semVendaFixo, setSemVendaFixo] = useState('')
  const [medias, setMedias] = useState<Map<string, number> | null>(null)
  useEffect(() => {
    if (!aplicarMinimo || modoMinimo !== 'dias' || medias) return
    let vivo = true
    ;(async () => {
      const sb = createClient()
      const m = new Map<string, number>()
      for (let i = 0; i < ids.length; i += 150) {
        const { data } = await sb.from('reposicao_metricas').select('produto_id, media_diaria').in('produto_id', ids.slice(i, i + 150))
        for (const r of (data ?? []) as { produto_id: string; media_diaria: number | null }[]) m.set(r.produto_id, Number(r.media_diaria ?? 0))
      }
      if (vivo) setMedias(m)
    })()
    return () => { vivo = false }
  }, [aplicarMinimo, modoMinimo, medias, ids])
  const nDias = Number(diasCobertura) || 0
  const semVendaNum = semVendaFixo.trim() === '' ? null : Math.max(0, Number(semVendaFixo.replace(',', '.')) || 0)
  const previaDias = medias ? minimosPorValor(ids, medias, nDias, semVendaNum) : null

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const subcategoriasDisponiveis = categoria
    ? categoriasTodas.filter(c => c.pai_id && categoriasTodas.find(r => r.id === c.pai_id)?.nome === categoria)
    : []

  const nenhumCampoSelecionado = !aplicarCategoria && !aplicarMarca && !aplicarNcm && !aplicarUnidade && !aplicarPdv && !aplicarPerfil && !aplicarMinimo

  async function aplicar() {
    if (nenhumCampoSelecionado) { setErro('Marque ao menos um campo para aplicar.'); return }
    setSalvando(true); setErro('')

    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (aplicarCategoria) payload.categoria = subcategoria || categoria || null
    if (aplicarMarca) payload.marca = marca || null
    if (aplicarNcm) payload.ncm = ncm.trim() || null
    if (aplicarUnidade) payload.unidade = unidade
    if (aplicarPdv) payload.disponivel_pdv = disponivelPdv
    if (aplicarPerfil) payload.perfil_fiscal_id = perfilFiscal || null
    if (aplicarMinimo && modoMinimo === 'fixo') {
      const n = Number(minimoFixo.replace(',', '.'))
      if (minimoFixo.trim() === '' || !(n >= 0)) { setSalvando(false); setErro('Informe a quantidade mínima (0 para tirar o mínimo).'); return }
      payload.estoque_minimo = n
    }
    if (aplicarMinimo && modoMinimo === 'dias' && (!previaDias || !(nDias > 0))) {
      setSalvando(false); setErro('Informe os dias de venda e aguarde o cálculo.'); return
    }

    const sb = createClient()
    const { error } = await sb.from('produtos').update(payload).in('id', ids)
    if (error) { setSalvando(false); setErro(error.message); return }

    // Por dias de venda cada produto tem o seu mínimo: uma gravação por
    // valor, com todos os produtos que caíram nele.
    if (aplicarMinimo && modoMinimo === 'dias' && previaDias) {
      for (const [valor, grupo] of previaDias.porValor) {
        const { error: e } = await sb.from('produtos').update({ estoque_minimo: valor }).in('id', grupo)
        if (e) { setSalvando(false); setErro(e.message); return }
      }
    }

    // Propaga categoria/marca (os únicos campos de identidade desta tela)
    // pros produtos vinculados numa empresa parceira, se houver.
    if (aplicarCategoria || aplicarMarca) {
      const camposIdentidade: Record<string, unknown> = {}
      if (aplicarCategoria) camposIdentidade.categoria = payload.categoria
      if (aplicarMarca) camposIdentidade.marca = payload.marca
      await Promise.all(ids.map(id => sincronizarProdutoVinculado(sb, id, camposIdentidade)))
    }

    setSalvando(false)
    onAplicado()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Ações em massa</h2>
            <p className="text-xs text-gray-400">{ids.length} produto(s) selecionado(s)</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-3">
          <p className="text-xs text-gray-400">Marque os campos que quer alterar — os demais permanecem como estão.</p>

          <div className="border border-gray-200 rounded-lg px-3 py-3">
            <label className="flex items-center gap-2.5 cursor-pointer mb-2">
              <input type="checkbox" checked={aplicarCategoria} onChange={e => setAplicarCategoria(e.target.checked)}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-sm font-medium text-gray-700">Categoria / Subcategoria</span>
            </label>
            {aplicarCategoria && (
              <div className="grid grid-cols-2 gap-2 pl-6">
                <select value={categoria} onChange={e => { setCategoria(e.target.value); setSubcategoria('') }}
                  className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500 bg-white">
                  <option value="">— Sem categoria —</option>
                  {categoriasRaiz.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                </select>
                <select value={subcategoria} disabled={subcategoriasDisponiveis.length === 0} onChange={e => setSubcategoria(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500 bg-white disabled:bg-gray-100 disabled:text-gray-400">
                  <option value="">— Sem subcategoria —</option>
                  {subcategoriasDisponiveis.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="border border-gray-200 rounded-lg px-3 py-3">
            <label className="flex items-center gap-2.5 cursor-pointer mb-2">
              <input type="checkbox" checked={aplicarMarca} onChange={e => setAplicarMarca(e.target.checked)}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-sm font-medium text-gray-700">Marca</span>
            </label>
            {aplicarMarca && (
              <select value={marca} onChange={e => setMarca(e.target.value)}
                className="ml-6 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500 bg-white">
                <option value="">— Sem marca —</option>
                {marcas.map(m => <option key={m.id} value={m.nome}>{m.nome}</option>)}
              </select>
            )}
          </div>

          <div className="border border-gray-200 rounded-lg px-3 py-3">
            <label className="flex items-center gap-2.5 cursor-pointer mb-2">
              <input type="checkbox" checked={aplicarNcm} onChange={e => setAplicarNcm(e.target.checked)}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-sm font-medium text-gray-700">NCM</span>
            </label>
            {aplicarNcm && (
              <input value={ncm} onChange={e => setNcm(e.target.value)} placeholder="Ex: 6109.10.00"
                className="ml-6 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 font-mono focus:outline-none focus:border-blue-500 w-40" />
            )}
          </div>

          <div className="border border-gray-200 rounded-lg px-3 py-3">
            <label className="flex items-center gap-2.5 cursor-pointer mb-2">
              <input type="checkbox" checked={aplicarUnidade} onChange={e => setAplicarUnidade(e.target.checked)}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-sm font-medium text-gray-700">Unidade</span>
            </label>
            {aplicarUnidade && (
              <select value={unidade} onChange={e => setUnidade(e.target.value)}
                className="ml-6 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500 bg-white">
                {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            )}
          </div>

          <div className="border border-gray-200 rounded-lg px-3 py-3">
            <label className="flex items-center gap-2.5 cursor-pointer mb-2">
              <input type="checkbox" checked={aplicarPdv} onChange={e => setAplicarPdv(e.target.checked)}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-sm font-medium text-gray-700">Disponível no PDV</span>
            </label>
            {aplicarPdv && (
              <div className="flex items-center gap-2 ml-6">
                <button type="button" onClick={() => setDisponivelPdv(true)}
                  className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${disponivelPdv ? 'border-green-500 text-green-700 bg-green-50 font-medium' : 'border-gray-300 text-gray-500 bg-white'}`}>
                  Sim
                </button>
                <button type="button" onClick={() => setDisponivelPdv(false)}
                  className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${!disponivelPdv ? 'border-red-500 text-red-700 bg-red-50 font-medium' : 'border-gray-300 text-gray-500 bg-white'}`}>
                  Não
                </button>
              </div>
            )}
          </div>

          {perfisFiscais.length > 0 && (
            <div className="border border-gray-200 rounded-lg px-3 py-3">
              <label className="flex items-center gap-2.5 cursor-pointer mb-2">
                <input type="checkbox" checked={aplicarPerfil} onChange={e => setAplicarPerfil(e.target.checked)}
                  className="w-4 h-4 accent-blue-600" />
                <span className="text-sm font-medium text-gray-700">Perfil fiscal</span>
              </label>
              {aplicarPerfil && (
                <div className="ml-6">
                  <select value={perfilFiscal} onChange={e => setPerfilFiscal(e.target.value)}
                    className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500 bg-white">
                    <option value="">— Sem perfil —</option>
                    {perfisFiscais.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                  <p className="text-[11px] text-gray-400 mt-1">Define o CFOP e o CSOSN/CST da NF-e conforme a venda. Não altera a NFC-e do PDV.</p>
                </div>
              )}
            </div>
          )}

          <div className="border border-gray-200 rounded-lg px-3 py-3">
            <label className="flex items-center gap-2.5 cursor-pointer mb-2">
              <input type="checkbox" checked={aplicarMinimo} onChange={e => setAplicarMinimo(e.target.checked)}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-sm font-medium text-gray-700">Estoque mínimo</span>
            </label>
            {aplicarMinimo && (
              <div className="ml-6 space-y-2">
                <div className="flex gap-2">
                  {([['fixo', 'Mesma quantidade'], ['dias', 'Por dias de venda']] as const).map(([m, l]) => (
                    <button key={m} type="button" onClick={() => setModoMinimo(m)}
                      className={`px-3 py-1.5 text-xs rounded-full border ${modoMinimo === m ? 'border-blue-500 text-blue-700 bg-blue-50 font-medium' : 'border-gray-300 text-gray-500 bg-white'}`}>
                      {l}
                    </button>
                  ))}
                </div>
                {modoMinimo === 'fixo' ? (
                  <div className="flex items-center gap-2">
                    <input value={minimoFixo} onChange={e => setMinimoFixo(e.target.value)} inputMode="decimal" placeholder="Ex.: 5"
                      className="w-24 border border-gray-300 rounded-lg px-2.5 py-1.5 text-base sm:text-xs focus:outline-none focus:border-blue-500" />
                    <span className="text-[11px] text-gray-500">unidades em todos os selecionados (0 tira o mínimo)</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-600">Cobrir</span>
                      <input value={diasCobertura} onChange={e => setDiasCobertura(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
                        className="w-16 border border-gray-300 rounded-lg px-2.5 py-1.5 text-base sm:text-xs focus:outline-none focus:border-blue-500" />
                      <span className="text-xs text-gray-600">dias de venda de cada produto</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-600">Quem não vendeu:</span>
                      <input value={semVendaFixo} onChange={e => setSemVendaFixo(e.target.value)} inputMode="decimal" placeholder="manter"
                        className="w-20 border border-gray-300 rounded-lg px-2.5 py-1.5 text-base sm:text-xs focus:outline-none focus:border-blue-500" />
                      <span className="text-[11px] text-gray-400">vazio = mantém o mínimo atual</span>
                    </div>
                    <p className="text-[11px] text-gray-500">
                      {!previaDias ? 'Calculando pela média de venda…'
                        : <>{previaDias.comVenda} produto(s) com venda recebem média diária × {nDias || 0} dias (arredondado para cima)
                            {previaDias.semVendaQtd > 0 && <>; {previaDias.semVendaQtd} sem venda {semVendaNum === null ? 'ficam como estão' : `recebem ${semVendaNum}`}</>}.</>}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
          <button onClick={aplicar} disabled={salvando || nenhumCampoSelecionado}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {salvando ? 'Aplicando...' : `Aplicar a ${ids.length} produto(s)`}
          </button>
        </div>
      </div>
    </div>
  )
}
