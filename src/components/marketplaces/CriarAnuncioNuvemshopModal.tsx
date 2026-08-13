'use client'

import { useState, useEffect, type ChangeEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmt } from './utils'
import { formatarTituloAnuncio } from '@/lib/texto/titulo'
import PainelDimensoesImagens from './PainelDimensoesImagens'

// Criar anúncio na Nuvemshop — irmão de CriarAnuncioShopeeModal e
// CriarAnuncioMercadoLivreModal, e bem mais curto que os dois pelo mesmo
// motivo: aqui não existe taxonomia da plataforma. As categorias são da LOJA
// (o lojista criou), não há atributo obrigatório por categoria, e não há
// "tipo de anúncio" nem canal de logística para escolher.
//
// O que sobra de decisão real, então, é conteúdo: título, descrição, fotos,
// preço, estoque e onde o produto aparece na loja.

type Categoria = { id: number; nome: string; parentId: number | null; caminho: string }

export default function CriarAnuncioNuvemshopModal({ canal, canais, empresaId, produtoIdInicial, origemAnuncioId, modoDuplicar, conteudoInicial, onClose, onCriado }: {
  canal?: { id: string; nome: string }
  canais?: { id: string; nome: string }[]
  empresaId: string
  produtoIdInicial?: string
  /** Anúncio já trabalhado usado como base (replicar de outro canal). */
  origemAnuncioId?: string
  /** Segundo anúncio do mesmo produto na MESMA loja. */
  modoDuplicar?: boolean
  conteudoInicial?: { titulo?: string | null; descricao?: string | null; preco?: string | null }
  onClose: () => void
  onCriado: () => void
}) {
  const [canalEscolhidoId, setCanalEscolhidoId] = useState(canal?.id ?? (canais?.length === 1 ? canais[0].id : ''))
  const canalAtivo = canal ?? canais?.find(c => c.id === canalEscolhidoId) ?? null

  const [produto, setProduto] = useState<any | null>(null)
  const [buscaProd, setBuscaProd] = useState('')
  const [resultadosBusca, setResultadosBusca] = useState<any[]>([])

  const [imagens, setImagens] = useState<{ id: string; url: string; principal: boolean; ordem: number }[]>([])
  const [capaUrl, setCapaUrl] = useState<string | null>(null)
  const [uploadandoImg, setUploadandoImg] = useState(false)
  const [erroImg, setErroImg] = useState('')
  const [importandoImagens, setImportandoImagens] = useState(false)

  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [carregandoCategorias, setCarregandoCategorias] = useState(false)
  const [erroCategorias, setErroCategorias] = useState('')
  const [buscaCategoria, setBuscaCategoria] = useState('')
  // null = o operador ainda não mexeu, então vale a categoria casada pelo nome
  // do anúncio de origem (quando houver). Depois do primeiro clique é a
  // escolha dele que manda, inclusive escolher nenhuma.
  const [categoriasEscolhidas, setCategoriasEscolhidas] = useState<number[] | null>(null)

  const [titulo, setTitulo] = useState('')
  // Opções de título geradas pela IA — nunca aplicadas sozinhas: quem escolhe
  // é o operador (ou mantém o que digitou).
  const [titulosSugeridos, setTitulosSugeridos] = useState<string[]>([])
  const [descricao, setDescricao] = useState('')
  const [preenchendoIA, setPreenchendoIA] = useState(false)
  const [preco, setPreco] = useState('')
  const [precoDe, setPrecoDe] = useState('')
  const [estoque, setEstoque] = useState('')
  const [sku, setSku] = useState('')
  const [ean, setEan] = useState('')
  const [marca, setMarca] = useState('')
  const [peso, setPeso] = useState('')
  const [comprimento, setComprimento] = useState('')
  const [largura, setLargura] = useState('')
  const [altura, setAltura] = useState('')
  const [publicado, setPublicado] = useState(true)

  const [origem, setOrigem] = useState<any | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState<{ itemId: string; warning?: string; descricaoGravadaNoCadastro?: boolean } | null>(null)

  // Produto pré-selecionado (entrada pelo Mapa de Anúncios ou por Produtos).
  useEffect(() => {
    if (!produtoIdInicial) return
    const sb = createClient()
    sb.from('produtos').select('*').eq('id', produtoIdInicial).single().then(({ data }) => {
      if (!data) return
      selecionarProduto(data)
      if (conteudoInicial?.titulo) setTitulo(conteudoInicial.titulo)
      if (conteudoInicial?.descricao) setDescricao(conteudoInicial.descricao)
      if (conteudoInicial?.preco) setPreco(conteudoInicial.preco)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoIdInicial])

  // Busca ao vivo, quando o produto não veio pronto.
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
    // O cadastro guarda o nome em CAIXA ALTA — na vitrine da loja isso fica
    // ruim de ler. Continua editável no campo.
    setTitulo(formatarTituloAnuncio(p.nome))
    setTitulosSugeridos([])
    setDescricao(p.descricao_marketplace ?? '')
    setPreco(p.preco_venda ? String(p.preco_venda) : '')
    setEstoque(p.estoque != null ? String(p.estoque) : '0')
    // Produto sem SKU no cadastro (são 12 hoje) cairia na loja sem código
    // nenhum — e é pelo SKU que o pedido da Nuvemshop encontra o produto aqui
    // na volta. Nesse caso vale o id do produto no sistema: feio de ler, mas
    // único e estável. Continua editável.
    setSku(p.sku || p.id)
    setEan(p.ean ?? '')
    setMarca(p.marca ?? '')
    setPeso(p.peso_kg ? String(p.peso_kg) : '')
    setComprimento(p.comprimento_cm ? String(p.comprimento_cm) : '')
    setLargura(p.largura_cm ? String(p.largura_cm) : '')
    setAltura(p.altura_cm ? String(p.altura_cm) : '')
  }

  async function carregarImagens(produtoId: string) {
    const sb = createClient()
    const { data } = await sb.from('produto_imagens').select('id, url, principal, ordem').eq('produto_id', produtoId).order('ordem', { ascending: true })
    setImagens(data ?? [])
    setCapaUrl(prev => {
      const lista = data ?? []
      if (prev && lista.some(i => i.url === prev)) return prev
      return (lista.find(i => i.principal) ?? lista[0])?.url ?? null
    })
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
      const { data: img, error: dbError } = await sb.from('produto_imagens')
        .insert({ empresa_id: empresaId, produto_id: produto.id, url: publicUrl, ordem: imagens.length + erros.length, principal: imagens.length === 0 && erros.length === 0 })
        .select('id, url, principal, ordem').single()
      if (dbError) { erros.push(arquivo.name + ': ' + dbError.message); continue }
      setImagens(prev => [...prev, img])
      setCapaUrl(prev => prev ?? img.url)
    }
    if (erros.length) setErroImg('Alguns arquivos falharam: ' + erros.join('; '))
    setUploadandoImg(false)
    e.target.value = ''
  }

  // Traz para o cadastro do produto as imagens que só existem no anúncio de
  // origem — é o que torna a replicação útil quando o trabalho de foto foi
  // feito direto no outro canal.
  async function importarImagensDaOrigem() {
    if (!produto || !origem?.imagens?.length) return
    setImportandoImagens(true); setErroImg('')
    const sb = createClient()
    const jaTem = new Set(imagens.map(i => i.url))
    const novas = (origem.imagens as string[]).filter(u => !jaTem.has(u))
    let ordem = imagens.length
    for (const url of novas) {
      const { data: img, error } = await sb.from('produto_imagens')
        .insert({ empresa_id: empresaId, produto_id: produto.id, url, ordem, principal: ordem === 0 })
        .select('id, url, principal, ordem').single()
      if (error) { setErroImg('Erro ao importar imagem: ' + error.message); break }
      setImagens(prev => [...prev, img])
      setCapaUrl(prev => prev ?? img.url)
      ordem++
    }
    setImportandoImagens(false)
  }

  // Imagem principal do CADASTRO — outra coisa que a capa deste anúncio. Ela
  // vale pro PDV, pra listagem de produtos e pros próximos anúncios.
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
      await sb.from('produto_imagens').update({ principal: true }).eq('id', novas[0].id)
      novas[0] = { ...novas[0], principal: true }
    }
    setImagens(novas)
    if (capaUrl === img.url) setCapaUrl(novas[0]?.url ?? null)
  }

  // Categorias da loja de destino.
  useEffect(() => {
    if (!canalAtivo) return
    let ativo = true
    setCarregandoCategorias(true); setErroCategorias('')
    fetch('/api/marketplace/nuvemshop/categorias', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canalId: canalAtivo.id }),
    })
      .then(r => r.json())
      .then(d => {
        if (!ativo) return
        if (d.ok) setCategorias(d.categorias ?? [])
        else setErroCategorias(d.erro ?? 'Não foi possível carregar as categorias da loja')
      })
      .catch(() => { if (ativo) setErroCategorias('Não foi possível carregar as categorias da loja') })
      .finally(() => { if (ativo) setCarregandoCategorias(false) })
    return () => { ativo = false }
  }, [canalAtivo?.id])

  // Conteúdo do anúncio de origem (replicar/duplicar).
  useEffect(() => {
    if (!origemAnuncioId) return
    let ativo = true
    fetch(`/api/marketplaces/anuncios/${origemAnuncioId}/replicar`)
      .then(r => r.json())
      .then(d => {
        if (!ativo || !d.ok) return
        const o = d.origem
        setOrigem(o)
        if (o.titulo) setTitulo(String(o.titulo))
        if (o.descricao) setDescricao(o.descricao)
        if (o.marcaExterna) setMarca(String(o.marcaExterna))
        if (o.pesoKg) setPeso(String(o.pesoKg))
        if (o.comprimentoCm) setComprimento(String(o.comprimentoCm))
        if (o.larguraCm) setLargura(String(o.larguraCm))
        if (o.alturaCm) setAltura(String(o.alturaCm))
      })
      .catch(() => { /* origem indisponível — segue com o conteúdo do cadastro */ })
    return () => { ativo = false }
  }, [origemAnuncioId])

  // Categorias da origem casadas pelo NOME. Entre duas lojas Nuvemshop o id
  // não serve para nada (cada loja tem os seus), mas os nomes costumam ser os
  // mesmos.
  //
  // Cuidado com o que `categoria_externa` é de verdade: o sync junta com " > "
  // TODAS as categorias do produto, não um caminho. Num produto que está em
  // "Casa e Jardins" e em "Cozinha" isso parece um caminho e não é. Por isso
  // tento primeiro o caminho inteiro (caso comum, produto numa categoria só
  // com o pai junto) e depois cada pedaço pelo nome.
  const categoriasCasadasPorNome: Categoria[] = (() => {
    if (categorias.length === 0 || origem?.plataforma !== 'nuvemshop' || !origem?.categoriaExterna) return []
    const texto = String(origem.categoriaExterna).trim().toLowerCase()
    const caminhoIgual = categorias.find(c => c.caminho.toLowerCase() === texto)
    if (caminhoIgual) return [caminhoIgual]
    const partes = texto.split('>').map(p => p.trim()).filter(Boolean)
    return partes
      .map(p => categorias.find(c => c.nome.toLowerCase() === p))
      .filter((c): c is Categoria => !!c)
  })()

  const categoriasSelecionadas = categoriasEscolhidas ?? categoriasCasadasPorNome.map(c => c.id)

  // Gera título e descrição. Nunca publica sozinha: enche os campos, que
  // continuam editáveis, e os títulos ficam como opção para clicar.
  //
  // Roda depois da categoria porque as categorias já escolhidas entram no
  // prompt — "Hidráulica > Torneiras" muda o texto que faz sentido escrever.
  async function preencherComIA() {
    if (!produto) return
    setPreenchendoIA(true); setErro('')
    try {
      const resp = await fetch('/api/marketplace/nuvemshop/ia-gerar-conteudo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoNome: produto.nome,
          produtoMarca: marca || produto.marca,
          produtoCategoria: produto.categoria,
          produtoDescricao: produto.descricao_marketplace,
          categoriasLoja: categorias.filter(c => categoriasSelecionadas.includes(c.id)).map(c => c.caminho),
        }),
      })
      const data = await resp.json()
      if (!data.ok) { setErro(data.erro ?? 'Erro ao gerar conteúdo com IA'); return }
      if (Array.isArray(data.titulos) && data.titulos.length > 0) setTitulosSugeridos(data.titulos)
      if (data.descricao) setDescricao(data.descricao)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao usar IA')
    } finally {
      setPreenchendoIA(false)
    }
  }

  function alternarCategoria(id: number) {
    setCategoriasEscolhidas(
      categoriasSelecionadas.includes(id)
        ? categoriasSelecionadas.filter(x => x !== id)
        : [...categoriasSelecionadas, id],
    )
  }

  // Capa primeiro; o resto na ordem do cadastro. A primeira imagem é a que a
  // vitrine mostra na lista de produtos.
  const fotosDoAnuncio = capaUrl
    ? [capaUrl, ...imagens.map(i => i.url).filter(u => u !== capaUrl)]
    : imagens.map(i => i.url)

  const categoriasFiltradas = buscaCategoria.trim()
    ? categorias.filter(c => c.caminho.toLowerCase().includes(buscaCategoria.trim().toLowerCase()))
    : categorias

  // Dois produtos com o mesmo título na mesma loja confundem o comprador e
  // competem pela mesma busca interna.
  const tituloIgualAoOrigem = !!modoDuplicar && !!origem?.titulo
    && titulo.trim().toLowerCase() === String(origem.titulo).trim().toLowerCase()

  const precoDeInvalido = precoDe.trim() !== '' && !(Number(precoDe) > Number(preco))

  const podeEnviar = !!canalAtivo && !!produto && titulo.trim() !== '' && Number(preco) > 0
    && estoque !== '' && !tituloIgualAoOrigem && !precoDeInvalido && !salvando

  async function enviar() {
    if (!podeEnviar || !canalAtivo) return
    setSalvando(true); setErro('')
    try {
      const resp = await fetch('/api/marketplace/nuvemshop/criar-anuncio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canalId: canalAtivo.id, produtoId: produto.id,
          titulo: titulo.trim(), descricao: descricao.trim(),
          preco: Number(preco), precoDe: precoDe.trim() ? Number(precoDe) : null,
          estoque: Number(estoque),
          sku: sku.trim() || null, ean: ean.trim() || null, marca: marca.trim() || null,
          categoriaIds: categoriasSelecionadas,
          peso: peso || undefined, comprimento: comprimento || undefined,
          largura: largura || undefined, altura: altura || undefined,
          publicado, fotos: fotosDoAnuncio,
        }),
      })
      const data = await resp.json()
      if (!data.ok) { setErro(data.erro ?? 'Erro ao criar anúncio'); return }
      setResultado({ itemId: data.itemId, warning: data.warning, descricaoGravadaNoCadastro: data.descricaoGravadaNoCadastro })
      onCriado()
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao criar anúncio')
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
            <h2 className="text-lg font-semibold text-gray-900">Criar anúncio na Nuvemshop</h2>
            {canalAtivo && <p className="text-xs text-gray-400">{canalAtivo.nome}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {!canalAtivo && canais && canais.length > 1 ? (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Escolha a loja Nuvemshop</p>
              <select value={canalEscolhidoId} onChange={e => setCanalEscolhidoId(e.target.value)} autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                <option value="">Selecione...</option>
                {canais.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          ) : resultado ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-4">
              <p className="text-sm font-medium text-emerald-800">✓ Produto criado na Nuvemshop (id {resultado.itemId})</p>
              {!publicado && (
                <p className="text-xs text-emerald-700 mt-1">Criado fora da vitrine — publique na loja quando estiver pronto.</p>
              )}
              {resultado.descricaoGravadaNoCadastro && (
                <p className="text-xs text-emerald-700 mt-1">A descrição também foi gravada no cadastro do produto, que estava sem.</p>
              )}
              {resultado.warning && <p className="text-xs text-amber-700 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{resultado.warning}</p>}
              <button onClick={onClose} className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">Fechar</button>
            </div>
          ) : (
            <>
              {/* Produto */}
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
                          <p className="text-xs text-gray-400">{p.sku} · {fmt(p.preco_venda ?? 0)} · Estoque: {p.estoque}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    {imagens[0] ? (
                      <img src={capaUrl ?? imagens[0].url} alt="" className="w-12 h-12 rounded-lg object-cover border border-gray-200" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300">📷</div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-gray-900">{produto.nome}</p>
                      <p className="text-xs text-gray-500">{produto.sku}</p>
                    </div>
                  </div>
                  {!produtoIdInicial && (
                    <button onClick={() => setProduto(null)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Trocar</button>
                  )}
                </div>
              )}

              {origem && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
                  <p className="text-sm text-indigo-900 font-medium">
                    {modoDuplicar
                      ? <>⧉ Duplicando um anúncio em <strong>{origem.canalNome}</strong></>
                      : <>⧉ Replicando o anúncio de <strong>{origem.canalNome}</strong></>}
                  </p>
                  <p className="text-xs text-indigo-700 mt-1">
                    Título, descrição, marca e medidas vieram de lá.{' '}
                    {origem.descricaoBuscadaAgora && (
                      <>A descrição não estava no sistema e foi buscada agora no Mercado Livre.{' '}</>
                    )}
                    {origem.plataforma === 'nuvemshop'
                      ? 'A categoria é procurada pelo nome, porque cada loja Nuvemshop tem as suas — confira abaixo.'
                      : 'A categoria não veio: no anúncio de origem ela é da outra plataforma e não corresponde às categorias desta loja.'}
                  </p>
                  <p className="text-xs text-indigo-700 mt-1">Preço e estoque continuam sendo os do cadastro — confira antes de publicar.</p>
                  {origem.imagens?.length > 0 && origem.imagens.some((u: string) => !imagens.some(i => i.url === u)) && (
                    <button type="button" onClick={importarImagensDaOrigem} disabled={importandoImagens || !produto}
                      className="mt-2 text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg">
                      {importandoImagens ? 'Importando...' : `Importar ${origem.imagens.filter((u: string) => !imagens.some(i => i.url === u)).length} imagem(ns) do anúncio de origem`}
                    </button>
                  )}
                </div>
              )}

              {produto && (
                <>
                  {/* Imagens */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">Imagens do anúncio ({imagens.length})</p>
                    {imagens.length === 0 ? (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                        ⚠ Esse produto não tem imagem cadastrada. A Nuvemshop aceita publicar assim, mas o produto aparece
                        sem foto na vitrine — o que na prática não vende.
                      </p>
                    ) : (
                      <p className="text-[11px] text-gray-400 mb-2">
                        A <strong>capa</strong> é a foto que aparece na vitrine e na busca da loja — é a primeira da lista.
                        {imagens.length > 1
                          ? ' Clique em outra foto (ou no botão "capa" dela) para trocar.'
                          : ' Com uma foto só, ela é a capa; adicione outra no + para poder escolher.'}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {imagens.map(img => (
                        <div key={img.id} className="relative group w-16 h-16">
                          <img src={img.url} alt="" onClick={() => setCapaUrl(img.url)}
                            title="Usar como capa deste anúncio"
                            className={`w-16 h-16 rounded-lg object-cover border-2 cursor-pointer ${
                              capaUrl === img.url ? 'border-emerald-500 ring-2 ring-emerald-200' : 'border-gray-200'
                            }`} />
                          {capaUrl === img.url && <span className="absolute -top-1.5 -left-1.5 bg-emerald-600 text-white text-[9px] px-1 rounded">capa</span>}
                          <div className="absolute inset-0 bg-black/50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                            {/* Botão explícito além do clique na foto: clicar
                                na imagem não se anuncia sozinho, e a troca de
                                capa é justamente o que se quer fazer aqui. */}
                            {capaUrl !== img.url && (
                              <button type="button" onClick={() => setCapaUrl(img.url)} title="Usar como capa deste anúncio"
                                className="text-white text-[10px] px-1 py-0.5 bg-emerald-600/90 rounded hover:bg-emerald-600">capa</button>
                            )}
                            {/* A estrela troca a imagem principal do CADASTRO,
                                que vale pro PDV e pros outros anúncios — coisa
                                diferente da capa deste anúncio. */}
                            {!img.principal && (
                              <button type="button" onClick={() => definirImagemPrincipal(img.id)} title="Definir como imagem principal do cadastro"
                                className="text-white text-xs hover:scale-110">⭐</button>
                            )}
                            <button type="button" onClick={() => removerImagem(img)} title="Remover" className="text-white text-xs hover:scale-110">🗑</button>
                          </div>
                        </div>
                      ))}
                      <label className={`w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 ${uploadandoImg ? 'opacity-50' : ''}`}>
                        <input type="file" accept="image/*" multiple className="hidden" onChange={handleUploadImagens} disabled={uploadandoImg} />
                        <span className="text-gray-400 text-xl">{uploadandoImg ? '…' : '+'}</span>
                      </label>
                    </div>
                    {erroImg && <p className="text-xs text-red-600 mt-1">{erroImg}</p>}
                    <PainelDimensoesImagens imagens={imagens} plataforma="nuvemshop" produtoId={produto.id}
                      onImagemAjustada={(imagemId, novaUrl) => {
                        setImagens(prev => prev.map(i => i.id === imagemId ? { ...i, url: novaUrl } : i))
                        setCapaUrl(prev => {
                          const antiga = imagens.find(i => i.id === imagemId)
                          return prev && antiga && prev === antiga.url ? novaUrl : prev
                        })
                      }} />
                  </div>

                  <button type="button" onClick={preencherComIA} disabled={preenchendoIA}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 border border-violet-200 text-violet-700 text-sm font-medium rounded-lg transition-colors">
                    {preenchendoIA ? '✨ Pensando...' : '✨ Gerar título e descrição com IA'}
                  </button>

                  {/* Título e descrição */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Título *</label>
                    <input value={titulo} onChange={e => setTitulo(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                    {titulosSugeridos.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-[11px] text-gray-400">Opções da IA — clique para usar:</p>
                        {titulosSugeridos.map((t, i) => (
                          <button key={i} type="button" onClick={() => setTitulo(t)}
                            className={`w-full text-left text-xs px-3 py-1.5 rounded-lg border ${
                              titulo === t ? 'border-violet-400 bg-violet-50 text-violet-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                            }`}>
                            {t} <span className="text-gray-300">({t.length})</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {tituloIgualAoOrigem && (
                      <p className="text-xs text-amber-700 mt-1">
                        O título está igual ao do anúncio de origem. Na mesma loja, dois produtos com o mesmo nome
                        confundem o comprador — mude alguma coisa antes de publicar.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Descrição</label>
                    <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={5}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                    <p className="text-[11px] text-gray-400 mt-1">A Nuvemshop aceita HTML simples aqui (parágrafos, negrito, listas).</p>
                    {descricao.trim() && !produto.descricao_marketplace && (
                      <p className="text-[11px] text-emerald-700 mt-1">
                        Este produto não tem descrição no cadastro — ao publicar, esta descrição é gravada lá também
                        e passa a servir para os próximos anúncios.
                      </p>
                    )}
                  </div>

                  {/* Preço e estoque */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Preço *</label>
                      <input value={preco} onChange={e => setPreco(e.target.value)} type="number" step="0.01"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Preço &quot;de&quot;</label>
                      <input value={precoDe} onChange={e => setPrecoDe(e.target.value)} type="number" step="0.01" placeholder="opcional"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Estoque *</label>
                      <input value={estoque} onChange={e => setEstoque(e.target.value)} type="number"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Marca</label>
                      <input value={marca} onChange={e => setMarca(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                    </div>
                  </div>
                  {precoDeInvalido && (
                    <p className="text-xs text-red-600 -mt-3">
                      O preço &quot;de&quot; precisa ser maior que o preço de venda — é ele que aparece riscado na vitrine.
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">SKU</label>
                      <input value={sku} onChange={e => setSku(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                      <p className="text-[11px] text-gray-400 mt-1">
                        É por ele que o pedido da loja acha o produto aqui.{' '}
                        {produto.sku
                          ? 'Veio do cadastro — vale manter.'
                          : 'Este produto não tem SKU no cadastro, então entrou o id dele no sistema. Se preferir um código curto, cadastre o SKU no produto.'}
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">EAN / código de barras</label>
                      <input value={ean} onChange={e => setEan(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                    </div>
                  </div>

                  {/* Categorias */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Categorias da loja</p>
                    {carregandoCategorias ? (
                      <p className="text-xs text-gray-400">Carregando categorias...</p>
                    ) : erroCategorias ? (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        {erroCategorias} — dá para publicar sem categoria e organizar depois no painel da loja.
                      </p>
                    ) : categorias.length === 0 ? (
                      <p className="text-xs text-gray-400">Esta loja ainda não tem categorias cadastradas.</p>
                    ) : (
                      <>
                        {categoriasCasadasPorNome.length > 0 && categoriasEscolhidas == null && (
                          <p className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 mb-2">
                            {categoriasCasadasPorNome.length === 1 ? 'Categoria casada' : 'Categorias casadas'} pelo nome do
                            anúncio de origem: <strong>{categoriasCasadasPorNome.map(c => c.caminho).join(' · ')}</strong>
                          </p>
                        )}
                        <input value={buscaCategoria} onChange={e => setBuscaCategoria(e.target.value)} placeholder="Filtrar categoria..."
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:border-blue-500" />
                        <div className="max-h-44 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
                          {categoriasFiltradas.map(c => (
                            <label key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                              <input type="checkbox" checked={categoriasSelecionadas.includes(c.id)} onChange={() => alternarCategoria(c.id)} />
                              {c.caminho}
                            </label>
                          ))}
                          {categoriasFiltradas.length === 0 && (
                            <p className="text-xs text-gray-400 px-3 py-3">Nenhuma categoria com esse texto.</p>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-400 mt-1">Sem categoria o produto existe na loja, mas só é achado pela busca.</p>
                      </>
                    )}
                  </div>

                  {/* Peso e medidas */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Peso e medidas (usados no cálculo do frete)</p>
                    <div className="grid grid-cols-4 gap-2">
                      <input value={peso} onChange={e => setPeso(e.target.value)} type="number" step="0.001" placeholder="Peso (kg)"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                      <input value={comprimento} onChange={e => setComprimento(e.target.value)} type="number" step="0.1" placeholder="Compr. (cm)"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                      <input value={largura} onChange={e => setLargura(e.target.value)} type="number" step="0.1" placeholder="Larg. (cm)"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                      <input value={altura} onChange={e => setAltura(e.target.value)} type="number" step="0.1" placeholder="Alt. (cm)"
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">O que for preenchido aqui também é gravado no cadastro do produto.</p>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={publicado} onChange={e => setPublicado(e.target.checked)} />
                    Publicar na vitrine agora
                  </label>
                  {!publicado && (
                    <p className="text-[11px] text-gray-400 -mt-3">
                      O produto é criado, mas fica fora da loja até você publicá-lo — útil para revisar antes.
                    </p>
                  )}
                </>
              )}

              {erro && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{erro}</div>}
            </>
          )}
        </div>

        {!resultado && (
          <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2 flex-shrink-0 sticky bottom-0 bg-white">
            <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
            <button onClick={enviar} disabled={!podeEnviar}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {salvando ? 'Publicando...' : 'Publicar na Nuvemshop'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
