'use client'

import { useState, useEffect, type ChangeEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmt } from './utils'

type Categoria = { id: string; name: string }
type Atributo = { id: string; name: string; obrigatorio: boolean; tipo: string; valores: { id: string; name: string }[] }
type TipoAnuncio = { id: string; name: string }

export default function CriarAnuncioMercadoLivreModal({ canal, canais, empresaId, produtoIdInicial, onClose, onCriado }: {
  canal?: { id: string; nome: string }
  canais?: { id: string; nome: string }[]
  empresaId: string; produtoIdInicial?: string
  onClose: () => void
  onCriado: () => void
}) {
  const [canalEscolhidoId, setCanalEscolhidoId] = useState(canal?.id ?? (canais?.length === 1 ? canais[0].id : ''))
  const canalAtivo = canal ?? canais?.find(c => c.id === canalEscolhidoId) ?? null

  const [produto, setProduto] = useState<any | null>(null)
  const [imagens, setImagens] = useState<{ id: string; url: string; principal: boolean; ordem: number }[]>([])
  const [uploadandoImg, setUploadandoImg] = useState(false)
  const [erroImg, setErroImg] = useState('')
  const [urlImgInput, setUrlImgInput] = useState('')
  const [adicionandoUrlImg, setAdicionandoUrlImg] = useState(false)
  const [buscaProd, setBuscaProd] = useState('')
  const [resultadosBusca, setResultadosBusca] = useState<any[]>([])

  // Categoria em cascata — cada posição do array é um nível já escolhido.
  // Diferente da Shopee (árvore inteira numa chamada), o ML pagina nível a
  // nível: uma categoria é folha quando a busca por filhas devolve vazio.
  const [caminhoCategoria, setCaminhoCategoria] = useState<Categoria[]>([])
  const [opcoesPorNivel, setOpcoesPorNivel] = useState<Categoria[][]>([])
  const [carregandoCategorias, setCarregandoCategorias] = useState(false)
  const [categoriaEhFolha, setCategoriaEhFolha] = useState(false)
  const categoriaFolha = categoriaEhFolha && caminhoCategoria.length > 0 ? caminhoCategoria[caminhoCategoria.length - 1] : null
  const [origemCategoria, setOrigemCategoria] = useState<'sugerida' | null>(null)

  const [atributos, setAtributos] = useState<Atributo[]>([])
  const [atributosCarregados, setAtributosCarregados] = useState(false)
  const [valoresAtributos, setValoresAtributos] = useState<Record<string, string>>({})
  const [carregandoAtributos, setCarregandoAtributos] = useState(false)
  const [tiposAnuncio, setTiposAnuncio] = useState<TipoAnuncio[]>([])
  const [listingTypeId, setListingTypeId] = useState('')

  const [condicao, setCondicao] = useState<'new' | 'used'>('new')
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [preco, setPreco] = useState('')
  const [estoque, setEstoque] = useState('')

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState<{ itemId: string; warning?: string } | null>(null)

  useEffect(() => {
    if (!produtoIdInicial) return
    const sb = createClient()
    sb.from('produtos').select('*').eq('id', produtoIdInicial).single().then(({ data }) => {
      if (data) selecionarProduto(data)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoIdInicial])

  useEffect(() => {
    if (produtoIdInicial || produto) { setResultadosBusca([]); return }
    const termo = buscaProd.trim()
    if (termo.length < 2) { setResultadosBusca([]); return }
    let ativo = true
    const timer = setTimeout(async () => {
      const sb = createClient()
      const palavras = termo.toLowerCase().split(/\s+/).map(p => p.replace(/[,()%]/g, '')).filter(Boolean)
      let query = sb.from('produtos').select('*').eq('empresa_id', empresaId).eq('ativo', true).order('nome').limit(8)
      for (const palavra of palavras) query = query.or(`nome.ilike.%${palavra}%,sku.ilike.%${palavra}%`)
      const { data } = await query
      if (ativo) setResultadosBusca(data ?? [])
    }, 250)
    return () => { ativo = false; clearTimeout(timer) }
  }, [buscaProd, produto, produtoIdInicial, empresaId])

  function selecionarProduto(p: any) {
    setProduto(p)
    setTitulo(p.nome)
    setPreco(p.preco_venda ? String(p.preco_venda) : '')
    setEstoque(p.estoque != null ? String(p.estoque) : '0')
    setDescricao(p.descricao_marketplace ?? '')
  }

  async function carregarImagens(produtoId: string) {
    const sb = createClient()
    const { data } = await sb.from('produto_imagens').select('id, url, principal, ordem').eq('produto_id', produtoId).order('ordem', { ascending: true })
    setImagens(data ?? [])
  }

  useEffect(() => {
    if (!produto) { setImagens([]); return }
    carregarImagens(produto.id)
  }, [produto])

  async function handleUploadImagens(e: ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(e.target.files ?? [])
    if (!arquivos.length || !produto) return
    setUploadandoImg(true); setErroImg('')
    const sb = createClient()
    const erros: string[] = []
    for (const arquivo of arquivos) {
      const ext = arquivo.name.split('.').pop()?.toLowerCase() ?? 'jpg'
      const path = `${empresaId}/${produto.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: uploadError } = await sb.storage.from('produto-imagens').upload(path, arquivo, { upsert: false })
      if (uploadError) { erros.push(arquivo.name + ': ' + uploadError.message); continue }
      const { data: { publicUrl } } = sb.storage.from('produto-imagens').getPublicUrl(path)
      const ordem = imagens.length + erros.length
      const principal = imagens.length === 0 && erros.length === 0
      const { data: img, error: dbError } = await sb.from('produto_imagens')
        .insert({ empresa_id: empresaId, produto_id: produto.id, url: publicUrl, ordem, principal })
        .select('id, url, principal, ordem').single()
      if (dbError) { erros.push(arquivo.name + ': ' + dbError.message); continue }
      setImagens(prev => [...prev, img])
    }
    if (erros.length) setErroImg('Alguns arquivos falharam: ' + erros.join('; '))
    setUploadandoImg(false)
    e.target.value = ''
  }

  async function adicionarImagemPorUrl() {
    if (!urlImgInput.trim() || !produto) return
    setUploadandoImg(true); setErroImg('')
    const sb = createClient()
    const ordem = imagens.length
    const principal = imagens.length === 0
    const { data: img, error } = await sb.from('produto_imagens')
      .insert({ empresa_id: empresaId, produto_id: produto.id, url: urlImgInput.trim(), ordem, principal })
      .select('id, url, principal, ordem').single()
    if (error) { setErroImg('Erro: ' + error.message); setUploadandoImg(false); return }
    setImagens(prev => [...prev, img])
    setUrlImgInput(''); setAdicionandoUrlImg(false); setUploadandoImg(false)
  }

  async function definirImagemPrincipal(id: string) {
    if (!produto) return
    const sb = createClient()
    await sb.from('produto_imagens').update({ principal: false }).eq('produto_id', produto.id)
    await sb.from('produto_imagens').update({ principal: true }).eq('id', id)
    setImagens(prev => prev.map(img => ({ ...img, principal: img.id === id })))
  }

  async function removerImagem(img: { id: string; url: string; principal: boolean }) {
    if (!confirm('Remover esta imagem?')) return
    const sb = createClient()
    const path = img.url.split('/produto-imagens/')[1]
    if (path) await sb.storage.from('produto-imagens').remove([path])
    await sb.from('produto_imagens').delete().eq('id', img.id)
    const novas = imagens.filter(i => i.id !== img.id)
    if (img.principal && novas.length > 0) {
      const sb2 = createClient()
      await sb2.from('produto_imagens').update({ principal: true }).eq('id', novas[0].id)
      novas[0] = { ...novas[0], principal: true }
    }
    setImagens(novas)
  }

  // Assim que o produto e o canal estiverem prontos, tenta sugerir a
  // categoria automaticamente (domain_discovery, ferramenta oficial do ML
  // a partir do título) — se não achar, cai no comportamento padrão de
  // carregar as categorias raiz pra escolha manual.
  useEffect(() => {
    if (!produto || !canalAtivo) return
    let ativo = true
    ;(async () => {
      try {
        const resp = await fetch('/api/marketplace/mercadolivre/categoria-sugerida', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId: canalAtivo.id, titulo: produto.nome }),
        })
        const data = await resp.json()
        if (!ativo) return
        if (data.ok && data.sugestao?.categoryId) {
          setOrigemCategoria('sugerida')
          await resolverCaminhoCategoria(data.sugestao.categoryId)
          return
        }
      } catch { /* segue pro comportamento padrão */ }
      if (ativo) carregarNivelCategoria(undefined, 0)
    })()
    return () => { ativo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produto, canalAtivo])

  // Reconstrói o caminho nível a nível a partir de uma categoria-folha
  // sugerida (o domain_discovery só devolve o id final, não o caminho).
  async function resolverCaminhoCategoria(categoryId: string) {
    if (!canalAtivo) return
    setCarregandoCategorias(true)
    try {
      // Sem endpoint de "ancestrais" nesta integração ainda — mostra a
      // categoria sugerida como único nível já resolvido e carrega os
      // atributos dela direto; o usuário pode trocar manualmente abaixo.
      const nomeResp = await fetch('/api/marketplace/mercadolivre/atributos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canalId: canalAtivo.id, categoryId }),
      })
      const nomeData = await nomeResp.json()
      if (!nomeData.ok) { carregarNivelCategoria(undefined, 0); return }
      setCaminhoCategoria([{ id: categoryId, name: categoryId }])
      setOpcoesPorNivel([])
      setCategoriaEhFolha(true)
      setAtributos(nomeData.atributos ?? [])
      setTiposAnuncio(nomeData.tiposAnuncio ?? [])
      setAtributosCarregados(true)
      if ((nomeData.tiposAnuncio ?? []).length > 0) setListingTypeId(nomeData.tiposAnuncio[0].id)
    } finally {
      setCarregandoCategorias(false)
    }
  }

  async function carregarNivelCategoria(parentId: string | undefined, nivel: number) {
    if (!canalAtivo) return
    setCarregandoCategorias(true)
    try {
      const resp = await fetch('/api/marketplace/mercadolivre/categorias', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canalId: canalAtivo.id, parentId }),
      })
      const data = await resp.json()
      if (!data.ok) { setErro(data.erro ?? 'Erro ao buscar categorias'); return }
      setOpcoesPorNivel(prev => {
        const novo = prev.slice(0, nivel)
        novo[nivel] = data.categorias
        return novo
      })
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao buscar categorias')
    } finally {
      setCarregandoCategorias(false)
    }
  }

  async function escolherCategoria(nivel: number, categoryId: string) {
    const opcoes = opcoesPorNivel[nivel] ?? []
    const cat = opcoes.find(c => c.id === categoryId)
    if (!cat) return
    const novoCaminho = [...caminhoCategoria.slice(0, nivel), cat]
    setCaminhoCategoria(novoCaminho)
    setOrigemCategoria(null)
    setAtributos([]); setValoresAtributos({}); setAtributosCarregados(false); setCategoriaEhFolha(false)

    setCarregandoCategorias(true)
    try {
      const resp = await fetch('/api/marketplace/mercadolivre/categorias', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canalId: canalAtivo!.id, parentId: cat.id }),
      })
      const data = await resp.json()
      if (data.ok && data.categorias.length > 0) {
        setOpcoesPorNivel(prev => { const novo = prev.slice(0, nivel + 1); novo[nivel + 1] = data.categorias; return novo })
        setCategoriaEhFolha(false)
      } else {
        setOpcoesPorNivel(prev => prev.slice(0, nivel + 1))
        setCategoriaEhFolha(true)
        await carregarAtributos(cat.id)
      }
    } finally {
      setCarregandoCategorias(false)
    }
  }

  async function carregarAtributos(categoryId: string) {
    if (!canalAtivo) return
    setCarregandoAtributos(true)
    setAtributosCarregados(false)
    try {
      const resp = await fetch('/api/marketplace/mercadolivre/atributos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canalId: canalAtivo.id, categoryId }),
      })
      const data = await resp.json()
      if (!data.ok) { setErro(data.erro ?? 'Erro ao buscar atributos'); return }
      setAtributos(data.atributos ?? [])
      setTiposAnuncio(data.tiposAnuncio ?? [])
      setAtributosCarregados(true)
      if ((data.tiposAnuncio ?? []).length > 0) setListingTypeId((data.tiposAnuncio ?? [])[0].id)
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao buscar atributos')
    } finally {
      setCarregandoAtributos(false)
    }
  }

  const atributosObrigatoriosFaltando = atributos.filter(a => a.obrigatorio && !valoresAtributos[a.id]?.trim())

  const podeEnviar = !!canalAtivo && !!produto && !!categoriaFolha && titulo.trim() && Number(preco) > 0
    && estoque !== '' && !!listingTypeId && atributosObrigatoriosFaltando.length === 0 && imagens.length > 0

  async function enviar() {
    if (!podeEnviar || !canalAtivo) return
    setSalvando(true); setErro('')
    try {
      const resp = await fetch('/api/marketplace/mercadolivre/criar-anuncio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canalId: canalAtivo.id, produtoId: produto.id, categoryId: categoriaFolha!.id,
          titulo: titulo.trim(), descricao: descricao.trim(), preco: Number(preco), estoque: Number(estoque),
          condicao, listingTypeId,
          atributos: atributos.filter(a => valoresAtributos[a.id]?.trim()).map(a => ({ id: a.id, valueName: valoresAtributos[a.id] })),
        }),
      })
      const data = await resp.json()
      if (!data.ok) { setErro(data.erro ?? 'Erro ao criar anúncio'); return }
      setResultado({ itemId: data.itemId, warning: data.warning })
      onCriado()
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao criar anúncio')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Criar anúncio no Mercado Livre</h2>
            {canalAtivo && <p className="text-xs text-gray-400">{canalAtivo.nome}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {!canalAtivo && canais && canais.length > 1 ? (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Escolha a conta do Mercado Livre</p>
              <select value={canalEscolhidoId} onChange={e => setCanalEscolhidoId(e.target.value)} autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                <option value="">Selecione...</option>
                {canais.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          ) : resultado ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-4">
              <p className="text-sm font-medium text-emerald-800">✓ Anúncio criado no Mercado Livre (item {resultado.itemId})</p>
              {resultado.warning && <p className="text-xs text-amber-700 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{resultado.warning}</p>}
              <button onClick={onClose} className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">Fechar</button>
            </div>
          ) : (
            <>
              {!produto ? (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Escolha o produto</p>
                  <input value={buscaProd} onChange={e => setBuscaProd(e.target.value)} autoFocus
                    placeholder="Nome ou SKU..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  {resultadosBusca.length > 0 && (
                    <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden">
                      {resultadosBusca.map(p => (
                        <button key={p.id} onClick={() => selecionarProduto(p)}
                          className="w-full text-left px-4 py-2.5 hover:bg-blue-50 border-b border-gray-100 last:border-0">
                          <p className="text-sm font-medium text-gray-900">{p.nome}</p>
                          <p className="text-xs text-gray-400">{p.sku} · {fmt(p.preco_venda)} · Estoque: {p.estoque}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    {imagens[0] ? (
                      <img src={imagens.find(i => i.principal)?.url ?? imagens[0].url} alt="" className="w-12 h-12 rounded-lg object-cover border border-gray-200" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300">📷</div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-gray-900">{produto.nome}</p>
                      <p className="text-xs text-gray-500">{produto.sku}</p>
                    </div>
                  </div>
                  {!produtoIdInicial && (
                    <button onClick={() => { setProduto(null); setCaminhoCategoria([]); setOpcoesPorNivel([]); setAtributos([]); setOrigemCategoria(null) }}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium">Trocar</button>
                  )}
                </div>
              )}

              {produto && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Imagens do anúncio ({imagens.length}) *</p>
                  {imagens.length === 0 && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                      ⚠ Esse produto não tem nenhuma imagem cadastrada — o Mercado Livre exige pelo menos uma. Adicione abaixo.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {imagens.map(img => (
                      <div key={img.id} className="relative group w-16 h-16">
                        <img src={img.url} alt="" className={`w-16 h-16 rounded-lg object-cover border-2 ${img.principal ? 'border-blue-500' : 'border-gray-200'}`} />
                        {img.principal && <span className="absolute -top-1.5 -left-1.5 bg-blue-600 text-white text-[9px] px-1 rounded">principal</span>}
                        <div className="absolute inset-0 bg-black/50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                          {!img.principal && (
                            <button type="button" onClick={() => definirImagemPrincipal(img.id)} title="Definir como principal"
                              className="text-white text-xs hover:scale-110">⭐</button>
                          )}
                          <button type="button" onClick={() => removerImagem(img)} title="Remover"
                            className="text-white text-xs hover:scale-110">🗑</button>
                        </div>
                      </div>
                    ))}
                    <label className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 cursor-pointer text-xl">
                      {uploadandoImg ? '…' : '+'}
                      <input type="file" accept="image/*" multiple className="hidden" disabled={uploadandoImg} onChange={handleUploadImagens} />
                    </label>
                  </div>
                  {!adicionandoUrlImg ? (
                    <button type="button" onClick={() => setAdicionandoUrlImg(true)} className="text-xs text-blue-600 hover:text-blue-800 font-medium mt-2">+ Adicionar por URL</button>
                  ) : (
                    <div className="flex gap-2 mt-2">
                      <input value={urlImgInput} onChange={e => setUrlImgInput(e.target.value)} placeholder="https://..."
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500" />
                      <button type="button" onClick={adicionarImagemPorUrl} disabled={uploadandoImg || !urlImgInput.trim()}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg">Adicionar</button>
                      <button type="button" onClick={() => { setAdicionandoUrlImg(false); setUrlImgInput('') }}
                        className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50">Cancelar</button>
                    </div>
                  )}
                  {erroImg && <p className="text-xs text-red-600 mt-1">{erroImg}</p>}
                </div>
              )}

              {produto && (
                <>
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">Categoria no Mercado Livre</p>
                    <div className="space-y-2">
                      {opcoesPorNivel.map((opcoes, nivel) => (
                        <select key={nivel} value={caminhoCategoria[nivel]?.id ?? ''} onChange={e => escolherCategoria(nivel, e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                          <option value="">{nivel === 0 ? 'Selecione a categoria...' : 'Selecione a subcategoria...'}</option>
                          {opcoes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      ))}
                    </div>
                    {carregandoCategorias && <p className="text-xs text-gray-400 mt-1">Carregando...</p>}
                    {categoriaFolha && (
                      <p className="text-xs text-emerald-600 mt-1">✓ {caminhoCategoria.map(c => c.name).join(' › ')}</p>
                    )}
                    {categoriaFolha && origemCategoria === 'sugerida' && (
                      <p className="text-xs text-gray-400 mt-0.5">✨ sugerida pelo próprio Mercado Livre com base no título — confira antes de publicar</p>
                    )}
                  </div>

                  {carregandoAtributos && <p className="text-xs text-gray-400">Carregando atributos da categoria...</p>}

                  {!carregandoAtributos && categoriaFolha && atributosCarregados && atributos.length === 0 && (
                    <p className="text-xs text-gray-400">Esta categoria não tem atributos específicos no Mercado Livre.</p>
                  )}
                  {atributos.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-2">Atributos da categoria</p>
                      <div className="space-y-3">
                        {atributos.map(a => (
                          <div key={a.id}>
                            <label className="block text-xs text-gray-600 mb-1">
                              {a.name} {a.obrigatorio && <span className="text-red-500">*</span>}
                            </label>
                            {a.valores.length > 0 ? (
                              <select
                                value={valoresAtributos[a.id] ?? ''}
                                onChange={e => setValoresAtributos(prev => ({ ...prev, [a.id]: e.target.value }))}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                                <option value="">Selecione...</option>
                                {a.valores.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                              </select>
                            ) : (
                              <input
                                value={valoresAtributos[a.id] ?? ''}
                                onChange={e => setValoresAtributos(prev => ({ ...prev, [a.id]: e.target.value }))}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Condição</label>
                      <select value={condicao} onChange={e => setCondicao(e.target.value as 'new' | 'used')}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                        <option value="new">Novo</option>
                        <option value="used">Usado</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Tipo de anúncio *</label>
                      <select value={listingTypeId} onChange={e => setListingTypeId(e.target.value)} disabled={tiposAnuncio.length === 0}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white disabled:bg-gray-100">
                        <option value="">{tiposAnuncio.length === 0 ? 'Selecione a categoria primeiro' : 'Selecione...'}</option>
                        {tiposAnuncio.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Título do anúncio *</label>
                    <input value={titulo} onChange={e => setTitulo(e.target.value)} maxLength={60}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                    <p className="text-xs text-gray-400 mt-1">{titulo.length}/60 caracteres</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Descrição</label>
                    <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={4}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Preço de venda (R$) *</label>
                      <input type="number" step="0.01" value={preco} onChange={e => setPreco(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Estoque *</label>
                      <input type="number" value={estoque} onChange={e => setEstoque(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                    </div>
                  </div>
                </>
              )}

              {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
            </>
          )}
        </div>

        {!resultado && (
          <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2 flex-shrink-0">
            <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
            <button onClick={enviar} disabled={!podeEnviar || salvando}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {salvando ? 'Publicando...' : 'Publicar no Mercado Livre'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
