'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

const TIPOS = [
  { value: 'simples',   label: 'Simples',   desc: 'Produto unitário padrão' },
  { value: 'kit',       label: 'Kit',        desc: 'Composto de outros produtos' },
  { value: 'generico',  label: 'Genérico',   desc: 'Produto sem SKU/EAN definido' },
  { value: 'insumo',    label: 'Insumo',     desc: 'Matéria-prima / uso interno' },
  { value: 'brinde',    label: 'Brinde',     desc: 'Não vendido, distribuído' },
]

type Produto = {
  id: string; nome: string; sku: string | null; ean: string | null
  preco_venda: number; preco_custo: number; unidade: string
  categoria: string | null; marca: string | null
  estoque: number; estoque_minimo: number
  ativo: boolean; disponivel_pdv: boolean; permite_fracao: boolean
  ncm: string | null; tipo: string
  markup?: number | null
  preco_promocional?: number | null
  promocao_inicio?: string | null
  promocao_fim?: string | null
  promocao_ativa?: boolean
  codigo_fornecedor?: string | null
  ibs_cst?: string | null
  ibs_cclasstrib?: string | null
  ibs_aliquota?: number | null
  cbs_aliquota?: number | null
}

type KitItem = { id?: string; produto_id: string; nome: string; unidade: string; quantidade: number }

type ProdutoImagem = { id: string; url: string; ordem: number; principal: boolean }

type Props = { produto: Produto | null; onClose: () => void; onSaved: () => void; empresaId: string }

type Aba = 'geral' | 'preco' | 'promocao' | 'imagens' | 'kit' | 'fiscal'

export default function EditarProdutoModal({ produto, onClose, onSaved, empresaId }: Props) {
  const [form, setForm] = useState<Produto | null>(null)
  const [aba, setAba] = useState<Aba>('geral')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [categorias, setCategorias] = useState<{ id: string; nome: string }[]>([])
  const [marcas, setMarcas] = useState<{ id: string; nome: string }[]>([])
  const [kitItens, setKitItens] = useState<KitItem[]>([])
  const [buscaKit, setBuscaKit] = useState('')
  const [resultadosKit, setResultadosKit] = useState<Produto[]>([])
  const [promocaoInfinita, setPromocaoInfinita] = useState(false)

  // Imagens
  const [imagens, setImagens] = useState<ProdutoImagem[]>([])
  const [uploadando, setUploadando] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [adicionandoUrl, setAdicionandoUrl] = useState(false)
  const [erroImg, setErroImg] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const buscarRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const sb = createClient()

  useEffect(() => {
    if (produto) {
      setForm({ ...produto })
      setAba('geral')
      setPromocaoInfinita(!produto.promocao_fim)
      if (produto.tipo === 'kit') carregarKitItens(produto.id)
      carregarImagens(produto.id)
    }
  }, [produto])

  useEffect(() => {
    Promise.all([
      sb.from('categorias').select('id, nome').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      sb.from('marcas').select('id, nome').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
    ]).then(([cats, mks]) => {
      setCategorias(cats.data ?? [])
      setMarcas(mks.data ?? [])
    })
  }, [empresaId])

  async function carregarImagens(produtoId: string) {
    const { data } = await sb
      .from('produto_imagens')
      .select('id, url, ordem, principal')
      .eq('produto_id', produtoId)
      .order('ordem', { ascending: true })
    setImagens(data ?? [])
  }

  async function carregarKitItens(kitId: string) {
    // kit_itens tem duas FKs pra produtos (kit_id e produto_id) — precisa
    // desambiguar qual relação usar no embed, senão o PostgREST recusa a
    // consulta por ambiguidade e "data" vem undefined/vazio silenciosamente.
    const { data, error } = await sb
      .from('kit_itens')
      .select('id, produto_id, quantidade, produtos!produto_id(nome, unidade)')
      .eq('kit_id', kitId)
    if (error) { setErro('Erro ao carregar componentes do kit: ' + error.message); return }
    setKitItens((data ?? []).map((d: any) => ({
      id: d.id,
      produto_id: d.produto_id,
      nome: d.produtos?.nome ?? '',
      unidade: d.produtos?.unidade ?? 'UN',
      quantidade: d.quantidade,
    })))
  }

  function campo<K extends keyof Produto>(field: K, value: Produto[K]) {
    setForm(prev => prev ? { ...prev, [field]: value } : prev)
  }

  function aplicarMarkup(markup: number) {
    if (!form) return
    const custo = form.preco_custo ?? 0
    const venda = custo > 0 ? parseFloat((custo * (1 + markup / 100)).toFixed(2)) : form.preco_venda
    setForm(prev => prev ? { ...prev, markup, preco_venda: venda } : prev)
  }

  // ── Kit busca ──
  useEffect(() => {
    if (!buscaKit || buscaKit.length < 2) { setResultadosKit([]); return }
    clearTimeout(buscarRef.current)
    buscarRef.current = setTimeout(async () => {
      const { data } = await sb.from('produtos')
        .select('id, nome, unidade, preco_venda')
        .eq('empresa_id', empresaId)
        .neq('id', form?.id ?? '')
        .neq('tipo', 'kit')
        .ilike('nome', `%${buscaKit}%`)
        .limit(8)
      setResultadosKit((data ?? []) as any)
    }, 300)
  }, [buscaKit, empresaId, form?.id])

  async function adicionarKitItem(prod: Produto) {
    if (kitItens.find(k => k.produto_id === prod.id)) return
    const novoItem: KitItem = { produto_id: prod.id, nome: prod.nome, unidade: prod.unidade, quantidade: 1 }
    setKitItens(prev => [...prev, novoItem])
    setBuscaKit(''); setResultadosKit([])
    if (form?.id) {
      const { data, error } = await sb.from('kit_itens')
        .insert({ kit_id: form.id, produto_id: prod.id, quantidade: 1 })
        .select().single()
      if (error) setErro('Erro ao salvar item do kit: ' + error.message)
      else if (data) setKitItens(prev => prev.map(k => k.produto_id === prod.id ? { ...k, id: data.id } : k))
    }
  }

  async function atualizarQtdKit(produtoId: string, quantidade: number) {
    setKitItens(prev => prev.map(k => k.produto_id === produtoId ? { ...k, quantidade } : k))
    if (form?.id) {
      await sb.from('kit_itens').update({ quantidade }).eq('kit_id', form.id).eq('produto_id', produtoId)
    }
  }

  async function removerKitItem(produtoId: string) {
    setKitItens(prev => prev.filter(k => k.produto_id !== produtoId))
    if (form?.id) {
      await sb.from('kit_itens').delete().eq('kit_id', form.id).eq('produto_id', produtoId)
    }
  }

  // ── Imagens: Upload do dispositivo ──
  async function handleUploadArquivos(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(e.target.files ?? [])
    if (!arquivos.length || !form) return
    setUploadando(true); setErroImg('')
    const erros: string[] = []
    for (const arquivo of arquivos) {
      const ext = arquivo.name.split('.').pop()?.toLowerCase() ?? 'jpg'
      const path = `${empresaId}/${form.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: uploadError } = await sb.storage.from('produto-imagens').upload(path, arquivo, { upsert: false })
      if (uploadError) { erros.push(arquivo.name + ': ' + uploadError.message); continue }
      const { data: { publicUrl } } = sb.storage.from('produto-imagens').getPublicUrl(path)
      const ordem = imagens.length + erros.length
      const principal = imagens.length === 0 && erros.length === 0
      const { data: img, error: dbError } = await sb.from('produto_imagens').insert({
        empresa_id: empresaId,
        produto_id: form.id,
        url: publicUrl,
        ordem,
        principal,
      }).select().single()
      if (dbError) { erros.push(arquivo.name + ': ' + dbError.message); continue }
      setImagens(prev => [...prev, img])
    }
    if (erros.length) setErroImg('Alguns arquivos falharam: ' + erros.join('; '))
    setUploadando(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Imagens: Adicionar via URL ──
  async function adicionarViaUrl() {
    if (!urlInput.trim() || !form) return
    setUploadando(true); setErroImg('')
    const ordem = imagens.length
    const principal = imagens.length === 0
    const { data: img, error } = await sb.from('produto_imagens').insert({
      empresa_id: empresaId,
      produto_id: form.id,
      url: urlInput.trim(),
      ordem,
      principal,
    }).select().single()
    if (error) { setErroImg('Erro: ' + error.message); setUploadando(false); return }
    setImagens(prev => [...prev, img])
    setUrlInput(''); setAdicionandoUrl(false); setUploadando(false)
  }

  // ── Imagens: Definir principal ──
  async function definirPrincipal(id: string) {
    if (!form) return
    await sb.from('produto_imagens').update({ principal: false }).eq('produto_id', form.id)
    await sb.from('produto_imagens').update({ principal: true }).eq('id', id)
    setImagens(prev => prev.map(img => ({ ...img, principal: img.id === id })))
  }

  // ── Imagens: Remover ──
  async function removerImagem(img: ProdutoImagem) {
    if (!confirm('Remover esta imagem?')) return
    // Tenta deletar do storage (funciona só para uploads, URL externa ignora erro)
    const path = img.url.split('/produto-imagens/')[1]
    if (path) await sb.storage.from('produto-imagens').remove([path])
    await sb.from('produto_imagens').delete().eq('id', img.id)
    const novas = imagens.filter(i => i.id !== img.id)
    // Se era principal, define a próxima como principal
    if (img.principal && novas.length > 0) {
      await sb.from('produto_imagens').update({ principal: true }).eq('id', novas[0].id)
      novas[0] = { ...novas[0], principal: true }
    }
    setImagens(novas)
  }

  // ── Imagens: Reordenar (move para cima) ──
  async function moverImagem(idx: number, dir: -1 | 1) {
    const destIdx = idx + dir
    if (destIdx < 0 || destIdx >= imagens.length) return
    const novas = [...imagens]
    ;[novas[idx], novas[destIdx]] = [novas[destIdx], novas[idx]]
    const atualizadas = novas.map((img, i) => ({ ...img, ordem: i }))
    setImagens(atualizadas)
    for (const img of atualizadas) {
      await sb.from('produto_imagens').update({ ordem: img.ordem }).eq('id', img.id)
    }
  }

  async function salvar() {
    if (!form) return
    setSalvando(true); setErro('')
    const isKit = form.tipo === 'kit'
    const { error } = await sb.from('produtos').update({
      nome: form.nome,
      tipo: form.tipo,
      sku: form.sku || null,
      ean: form.ean || null,
      codigo_fornecedor: form.codigo_fornecedor || null,
      preco_venda: form.preco_venda,
      ...(isKit ? {} : { preco_custo: form.preco_custo, markup: form.markup ?? null }),
      preco_promocional: form.preco_promocional ?? null,
      promocao_inicio: form.promocao_inicio ?? null,
      promocao_fim: promocaoInfinita ? null : (form.promocao_fim ?? null),
      promocao_ativa: form.promocao_ativa ?? false,
      unidade: form.unidade,
      categoria: form.categoria || null,
      marca: form.marca || null,
      ...(isKit ? {} : { estoque: form.estoque, estoque_minimo: form.estoque_minimo }),
      ativo: form.ativo,
      disponivel_pdv: form.disponivel_pdv,
      permite_fracao: form.permite_fracao,
      ncm: form.ncm || null,
      ibs_cst: form.ibs_cst || null,
      ibs_cclasstrib: form.ibs_cclasstrib || null,
      ibs_aliquota: form.ibs_aliquota ?? null,
      cbs_aliquota: form.cbs_aliquota ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', form.id)
    if (error) { setSalvando(false); setErro(error.message); return }

    if (form.tipo === 'kit' && kitItens.length > 0) {
      await sb.from('kit_itens').delete().eq('kit_id', form.id)
      const { error: kitError } = await sb.from('kit_itens').insert(
        kitItens.map(k => ({ kit_id: form.id, produto_id: k.produto_id, quantidade: k.quantidade }))
      )
      if (kitError) { setSalvando(false); setErro('Produto salvo, mas erro na composição: ' + kitError.message); return }
    }

    setSalvando(false)
    onSaved(); onClose()
  }

  if (!produto || !form) return null

  const abaAtiva  = 'border-b-2 border-blue-600 text-blue-600 font-medium'
  const abaInativa = 'border-b-2 border-transparent text-gray-500 hover:text-gray-700'

  const markupCalculado = form.preco_custo > 0 && form.preco_venda > 0
    ? (((form.preco_venda - form.preco_custo) / form.preco_custo) * 100) : 0

  const abas: { key: Aba; label: string; show?: boolean }[] = [
    { key: 'geral',    label: 'Geral' },
    { key: 'preco',    label: 'Preço & Markup' },
    { key: 'promocao', label: 'Promoção' },
    { key: 'imagens',  label: `Imagens${imagens.length > 0 ? ` (${imagens.length})` : ''}` },
    { key: 'kit',      label: 'Composição', show: form.tipo === 'kit' },
    { key: 'fiscal',   label: 'Fiscal' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full h-full sm:h-auto max-w-none sm:max-w-4xl max-h-none sm:max-h-[92vh] bg-white sm:rounded-2xl overflow-y-auto shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-start gap-3">
            {/* Thumb principal */}
            {imagens[0] ? (
              <img src={imagens[0].url} alt={form.nome}
                className="w-12 h-12 rounded-lg object-cover border border-gray-200 flex-shrink-0" />
            ) : (
              <div className="w-12 h-12 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center flex-shrink-0 text-gray-300 text-xl">
                📷
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-gray-900 font-semibold text-base">Editar produto</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  form.tipo === 'kit'      ? 'bg-purple-100 text-purple-700' :
                  form.tipo === 'insumo'   ? 'bg-orange-100 text-orange-700' :
                  form.tipo === 'brinde'   ? 'bg-pink-100 text-pink-700' :
                  form.tipo === 'generico' ? 'bg-gray-100 text-gray-600' :
                  'bg-blue-100 text-blue-700'
                }`}>{TIPOS.find(t => t.value === form.tipo)?.label ?? form.tipo}</span>
              </div>
              <p className="text-gray-400 text-xs mt-0.5 truncate max-w-sm">{produto.nome}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {/* Abas */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-gray-200 px-6">
          {abas.filter(a => a.show !== false).map(a => (
            <button key={a.key} onClick={() => setAba(a.key)}
              className={`py-3 px-1 text-sm transition-colors whitespace-nowrap ${aba === a.key ? abaAtiva : abaInativa}`}>
              {a.label}
            </button>
          ))}
        </div>

        <div className="flex-1 px-6 py-5">

          {/* ── ABA GERAL ── */}
          {aba === 'geral' && (
            <div className="space-y-4">
              {/* Tipo */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Tipo de produto</label>
                <div className="grid grid-cols-5 gap-2">
                  {TIPOS.map(t => (
                    <button key={t.value} onClick={() => campo('tipo', t.value)} title={t.desc}
                      className={`py-2 px-1 text-xs border rounded-lg text-center transition-colors font-medium ${
                        form.tipo === t.value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Status toggles */}
              <div className="flex gap-5 py-1">
                {[
                  { field: 'ativo' as const,          label: 'Ativo' },
                  { field: 'disponivel_pdv' as const,  label: 'Disponível no PDV' },
                  { field: 'permite_fracao' as const,  label: 'Permite fração' },
                ].map(({ field, label }) => (
                  <label key={field} className="flex items-center gap-2 cursor-pointer select-none">
                    <div onClick={() => campo(field, !form[field])}
                      className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${form[field] ? 'bg-green-500' : 'bg-gray-300'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form[field] ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                    <span className="text-sm text-gray-700">{label}</span>
                  </label>
                ))}
              </div>

              {/* Nome */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Descrição *</label>
                <input value={form.nome} onChange={e => campo('nome', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
              </div>

              {/* SKU + EAN + Código Fornecedor */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Código (SKU)</label>
                  <input value={form.sku ?? ''} onChange={e => campo('sku', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">GTIN/EAN</label>
                  <input value={form.ean ?? ''} onChange={e => campo('ean', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
              </div>

              {/* Código do fornecedor */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Código do Fornecedor</label>
                  <input value={form.codigo_fornecedor ?? ''} onChange={e => campo('codigo_fornecedor', e.target.value)}
                    placeholder="Ex: REF-12345"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Unidade</label>
                  <select value={form.unidade} onChange={e => campo('unidade', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500">
                    {['UN','KG','LT','MT','CX','PC','PR','DZ','CT','M2','M3','GR','ML','CM'].map(u => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Categoria + Marca */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Categoria</label>
                  <select value={form.categoria ?? ''} onChange={e => campo('categoria', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500">
                    <option value="">— Sem categoria —</option>
                    {categorias.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Marca</label>
                  <select value={form.marca ?? ''} onChange={e => campo('marca', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500">
                    <option value="">— Sem marca —</option>
                    {marcas.map(m => <option key={m.id} value={m.nome}>{m.nome}</option>)}
                  </select>
                </div>
              </div>

              {/* Estoque */}
              {form.tipo === 'kit' && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                  <span className="mt-0.5">⚠️</span>
                  <span>O estoque de kits é calculado automaticamente com base nos componentes. Edite o estoque de cada componente individualmente.</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Estoque atual</label>
                  <input type="number" value={form.estoque}
                    disabled={form.tipo === 'kit'}
                    onChange={e => campo('estoque', parseFloat(e.target.value) || 0)}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none ${form.tipo === 'kit' ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed' : 'border-gray-300 text-gray-900 focus:border-blue-500'}`} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Estoque mínimo</label>
                  <input type="number" value={form.estoque_minimo}
                    disabled={form.tipo === 'kit'}
                    onChange={e => campo('estoque_minimo', parseFloat(e.target.value) || 0)}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none ${form.tipo === 'kit' ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed' : 'border-gray-300 text-gray-900 focus:border-blue-500'}`} />
                </div>
              </div>
            </div>
          )}

          {/* ── ABA PREÇO & MARKUP ── */}
          {aba === 'preco' && (
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Custo (R$)
                  {form.tipo === 'kit' && <span className="ml-1 text-amber-500 text-[10px]">(soma dos componentes)</span>}
                </label>
                <input type="number" step="0.01" value={form.preco_custo}
                  disabled={form.tipo === 'kit'}
                  onChange={e => {
                    const custo = parseFloat(e.target.value) || 0
                    const mk = form.markup ?? 0
                    const venda = mk > 0 ? parseFloat((custo * (1 + mk / 100)).toFixed(2)) : form.preco_venda
                    setForm(prev => prev ? { ...prev, preco_custo: custo, preco_venda: venda } : prev)
                  }}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none ${form.tipo === 'kit' ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed' : 'border-gray-300 text-gray-900 focus:border-blue-500'}`} />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <label className="block text-xs font-medium text-blue-700 mb-3">Markup (%)</label>
                <div className="flex items-center gap-3">
                  <input type="number" step="0.01"
                    value={form.markup ?? markupCalculado.toFixed(2)}
                    onChange={e => aplicarMarkup(parseFloat(e.target.value) || 0)}
                    className="w-32 border border-blue-300 rounded-lg px-3 py-2 text-sm text-gray-900 font-mono focus:outline-none focus:border-blue-500 bg-white" />
                  <span className="text-blue-600 text-sm font-medium">%</span>
                  <div className="flex gap-2 ml-2">
                    {[20, 30, 50, 100].map(mk => (
                      <button key={mk} onClick={() => aplicarMarkup(mk)}
                        className="px-3 py-1.5 text-xs border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors bg-white">
                        {mk}%
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-blue-500 mt-2">
                  Preço de venda calculado: <strong>
                    {form.preco_custo > 0
                      ? (form.preco_custo * (1 + (form.markup ?? markupCalculado) / 100)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                      : '—'}
                  </strong>
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Preço de venda (R$)
                  <span className="text-gray-400 font-normal ml-1">— ou defina manualmente</span>
                </label>
                <input type="number" step="0.01" value={form.preco_venda}
                  onChange={e => {
                    const venda = parseFloat(e.target.value) || 0
                    const custo = form.preco_custo ?? 0
                    const mk = custo > 0 ? ((venda - custo) / custo) * 100 : 0
                    setForm(prev => prev ? { ...prev, preco_venda: venda, markup: parseFloat(mk.toFixed(4)) } : prev)
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 font-mono text-base" />
                {form.preco_custo > 0 && form.preco_venda > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    Margem: <span className={`font-medium ${form.preco_venda > form.preco_custo ? 'text-green-600' : 'text-red-600'}`}>
                      {markupCalculado.toFixed(1)}%
                    </span>
                    {' '}· Lucro bruto: <span className="font-medium text-green-600">
                      {(form.preco_venda - form.preco_custo).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── ABA PROMOÇÃO ── */}
          {aba === 'promocao' && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div onClick={() => campo('promocao_ativa', !form.promocao_ativa)}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${form.promocao_ativa ? 'bg-orange-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.promocao_ativa ? 'translate-x-6' : 'translate-x-1'}`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Promoção ativa</p>
                  <p className="text-xs text-gray-500">O preço promocional será exibido no PDV quando ativo</p>
                </div>
              </div>

              {form.promocao_ativa ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Preço promocional (R$)</label>
                    <input type="number" step="0.01"
                      value={form.preco_promocional ?? ''}
                      onChange={e => campo('preco_promocional', parseFloat(e.target.value) || null)}
                      placeholder={`Normal: ${form.preco_venda.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}
                      className="w-full border border-orange-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-orange-500 font-mono text-base" />
                    {form.preco_promocional && form.preco_venda > 0 && (
                      <p className="text-xs text-orange-600 mt-1">
                        Desconto de {(((form.preco_venda - form.preco_promocional) / form.preco_venda) * 100).toFixed(1)}% sobre o preço normal
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Data de início</label>
                    <input type="datetime-local"
                      value={form.promocao_inicio ? form.promocao_inicio.slice(0, 16) : ''}
                      onChange={e => campo('promocao_inicio', e.target.value ? new Date(e.target.value).toISOString() : null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-600">Data de término</label>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input type="checkbox" checked={promocaoInfinita} onChange={e => setPromocaoInfinita(e.target.checked)}
                          className="w-3.5 h-3.5 accent-orange-500" />
                        <span className="text-xs text-gray-500">Sem prazo (infinito)</span>
                      </label>
                    </div>
                    <input type="datetime-local" disabled={promocaoInfinita}
                      value={form.promocao_fim ? form.promocao_fim.slice(0, 16) : ''}
                      onChange={e => campo('promocao_fim', e.target.value ? new Date(e.target.value).toISOString() : null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400" />
                    {promocaoInfinita && (
                      <p className="text-xs text-orange-500 mt-1">A promoção ficará ativa até ser desativada manualmente.</p>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-4xl mb-2">🏷️</p>
                  <p className="text-sm">Ative a promoção para configurar o preço especial e o período.</p>
                </div>
              )}
            </div>
          )}

          {/* ── ABA IMAGENS ── */}
          {aba === 'imagens' && (
            <div className="space-y-5">
              {/* Ações de upload */}
              <div className="flex gap-2 flex-wrap">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                  multiple
                  className="hidden"
                  onChange={handleUploadArquivos}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadando}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                  {uploadando ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : '📁'}
                  Upload do dispositivo
                </button>
                <button
                  onClick={() => setAdicionandoUrl(v => !v)}
                  disabled={uploadando}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
                  🔗 Importar por URL
                </button>
              </div>

              {/* Input de URL */}
              {adicionandoUrl && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                  <label className="block text-xs font-medium text-gray-600">URL da imagem</label>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={urlInput}
                      onChange={e => setUrlInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && adicionarViaUrl()}
                      placeholder="https://exemplo.com/imagem.jpg"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                    />
                    <button onClick={adicionarViaUrl} disabled={!urlInput.trim() || uploadando}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
                      Adicionar
                    </button>
                    <button onClick={() => { setAdicionandoUrl(false); setUrlInput('') }}
                      className="px-3 py-2 border border-gray-300 text-gray-500 text-sm rounded-lg hover:bg-gray-50">
                      ✕
                    </button>
                  </div>
                  {urlInput && (
                    <div className="mt-2">
                      <p className="text-xs text-gray-400 mb-1">Pré-visualização:</p>
                      <img src={urlInput} alt="preview" onError={e => (e.currentTarget.style.display = 'none')}
                        className="h-20 rounded-lg object-cover border border-gray-200" />
                    </div>
                  )}
                </div>
              )}

              {erroImg && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erroImg}</p>
              )}

              {/* Grade de imagens */}
              {imagens.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">
                    {imagens.length} imagem(ns) · Arraste para reordenar · A primeira é a imagem principal
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    {imagens.map((img, idx) => (
                      <div key={img.id} className={`relative group rounded-xl overflow-hidden border-2 transition-colors ${img.principal ? 'border-blue-400' : 'border-gray-200'}`}>
                        <img src={img.url} alt={`Imagem ${idx + 1}`}
                          className="w-full h-36 object-cover bg-gray-100" />
                        {/* Badge principal */}
                        {img.principal && (
                          <div className="absolute top-2 left-2 bg-blue-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                            PRINCIPAL
                          </div>
                        )}
                        {/* Overlay de ações */}
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                          {!img.principal && (
                            <button onClick={() => definirPrincipal(img.id)}
                              className="w-full text-[11px] bg-blue-500 hover:bg-blue-600 text-white py-1.5 rounded-lg font-medium">
                              ★ Definir principal
                            </button>
                          )}
                          <div className="flex gap-1 w-full">
                            <button onClick={() => moverImagem(idx, -1)} disabled={idx === 0}
                              className="flex-1 text-[11px] bg-white/20 hover:bg-white/30 disabled:opacity-30 text-white py-1.5 rounded-lg">
                              ←
                            </button>
                            <button onClick={() => moverImagem(idx, 1)} disabled={idx === imagens.length - 1}
                              className="flex-1 text-[11px] bg-white/20 hover:bg-white/30 disabled:opacity-30 text-white py-1.5 rounded-lg">
                              →
                            </button>
                          </div>
                          <button onClick={() => removerImagem(img)}
                            className="w-full text-[11px] bg-red-500 hover:bg-red-600 text-white py-1.5 rounded-lg font-medium">
                            🗑 Remover
                          </button>
                        </div>
                        {/* Número */}
                        <div className="absolute bottom-1.5 right-1.5 bg-black/50 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold">
                          {idx + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div
                  className="border-2 border-dashed border-gray-200 rounded-xl py-14 flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:border-blue-300 hover:text-blue-400 transition-colors"
                  onClick={() => fileInputRef.current?.click()}>
                  <span className="text-5xl mb-3">📷</span>
                  <p className="text-sm font-medium">Nenhuma imagem cadastrada</p>
                  <p className="text-xs mt-1">Clique para fazer upload ou use o botão acima</p>
                </div>
              )}

              <p className="text-xs text-gray-400">
                Formatos aceitos: JPG, PNG, WEBP, GIF · Máx 5 MB por arquivo · Múltiplos arquivos suportados
              </p>
            </div>
          )}

          {/* ── ABA KIT / COMPOSIÇÃO ── */}
          {aba === 'kit' && form.tipo === 'kit' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">Defina os produtos que compõem este kit. O preço do kit é definido manualmente na aba <strong>Preço</strong>.</p>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Adicionar produto ao kit</label>
                <input value={buscaKit} onChange={e => setBuscaKit(e.target.value)}
                  placeholder="Digite o nome do produto..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
                {resultadosKit.length > 0 && (
                  <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden">
                    {resultadosKit.map(p => (
                      <button key={p.id} onClick={() => adicionarKitItem(p)}
                        className="w-full text-left px-3 py-2.5 hover:bg-blue-50 flex items-center justify-between border-b border-gray-100 last:border-0 transition-colors bg-white">
                        <div>
                          <p className="text-sm text-gray-900">{p.nome}</p>
                          <p className="text-xs text-gray-400">{p.unidade} · {(p.preco_venda ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                        </div>
                        <span className="text-blue-500 text-xs font-medium">+ Adicionar</span>
                      </button>
                    ))}
                  </div>
                )}
                {buscaKit.length >= 2 && resultadosKit.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1">Nenhum produto encontrado para "{buscaKit}".</p>
                )}
              </div>

              {kitItens.length > 0 ? (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-600">Produto</th>
                        <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-600">Qtd</th>
                        <th className="w-12 px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {kitItens.map(item => (
                        <tr key={item.produto_id} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-gray-900">{item.nome}
                            <span className="text-gray-400 text-xs ml-1">{item.unidade}</span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <div className="inline-flex items-center gap-1.5">
                              <button type="button"
                                onClick={() => atualizarQtdKit(item.produto_id, Math.max(1, Math.round(item.quantidade) - 1))}
                                disabled={Math.round(item.quantidade) <= 1}
                                className="w-6 h-6 flex items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                                −
                              </button>
                              <input type="number" min="1" step="1" value={Math.round(item.quantidade)}
                                onChange={e => atualizarQtdKit(item.produto_id, Math.max(1, parseInt(e.target.value) || 1))}
                                className="w-14 border border-gray-300 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-blue-500" />
                              <button type="button"
                                onClick={() => atualizarQtdKit(item.produto_id, Math.round(item.quantidade) + 1)}
                                className="w-6 h-6 flex items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors">
                                +
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <button onClick={() => removerKitItem(item.produto_id)}
                              className="text-red-400 hover:text-red-600 transition-colors text-lg leading-none">×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
                  <p className="text-3xl mb-2">📦</p>
                  <p className="text-sm">Nenhum produto no kit ainda.<br />Busque produtos acima para adicionar.</p>
                </div>
              )}
            </div>
          )}

          {/* ── ABA FISCAL ── */}
          {aba === 'fiscal' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">NCM</label>
                  <input value={form.ncm ?? ''} onChange={e => campo('ncm', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-700 mb-1">Reforma tributária — IBS/CBS</p>
                <p className="text-xs text-gray-400 mb-3">
                  Só cadastro para referência interna — o sistema não calcula automaticamente nem emite nota fiscal.
                  Confirme os valores com a contabilidade antes de usar em apuração real.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">CST IBS/CBS</label>
                    <input value={form.ibs_cst ?? ''} onChange={e => campo('ibs_cst', e.target.value)}
                      placeholder="Ex: 000"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Classificação Tributária (cClassTrib)</label>
                    <input value={form.ibs_cclasstrib ?? ''} onChange={e => campo('ibs_cclasstrib', e.target.value)}
                      placeholder="Ex: 000001"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Alíquota IBS (%)</label>
                    <input type="number" step="0.0001" value={form.ibs_aliquota ?? ''}
                      onChange={e => campo('ibs_aliquota', e.target.value === '' ? null : parseFloat(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Alíquota CBS (%)</label>
                    <input type="number" step="0.0001" value={form.cbs_aliquota ?? ''}
                      onChange={e => campo('cbs_aliquota', e.target.value === '' ? null : parseFloat(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-400">Demais configurações fiscais (CFOP, CST, ICMS) são gerenciadas diretamente no PDV.</p>
            </div>
          )}

          {erro && <p className="mt-4 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center">
          <div className="text-xs text-gray-400">
            {form.tipo === 'kit' && `${kitItens.length} produto(s) no kit`}
            {aba === 'imagens' && imagens.length > 0 && `${imagens.length} imagem(ns)`}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button onClick={salvar} disabled={salvando}
              className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors font-medium">
              {salvando ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
