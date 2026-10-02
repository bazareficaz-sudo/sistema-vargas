'use client'

import { useState, useEffect, useRef, type ChangeEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmt } from './utils'
import { formatarTituloAnuncio } from '@/lib/texto/titulo'
import PainelDimensoesImagens from './PainelDimensoesImagens'

// Criar anúncio na TikTok Shop — irmão de CriarAnuncioNuvemshopModal, com o
// que é próprio da TikTok:
//   • a categoria é da PLATAFORMA e precisa ser a última da árvore (folha). A
//     TikTok sugere uma pelo título; dá para trocar buscando pelo nome;
//   • cada categoria tem atributos — os obrigatórios travam a publicação;
//   • marca é opcional e vem da lista da TikTok para a categoria;
//   • peso da embalagem é obrigatório (medidas, só em algumas categorias).

type Categoria = { id: string; nome: string; caminho: string }
type Atributo = {
  id: string; nome: string; obrigatorio: boolean; multiplo: boolean; personalizavel: boolean
  valores: { id: string; nome: string }[]
}
type Marca = { id: string; nome: string; autorizada: boolean }
type ValorAtributo = { valorId: string | null; valorTexto: string | null }

const MAX_TITULO = 255

async function consultar(canalId: string, corpo: Record<string, unknown>) {
  const resp = await fetch('/api/marketplace/tiktok/categorias', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ canalId, ...corpo }),
  })
  return resp.json()
}

export default function CriarAnuncioTiktokModal({ canal, canais, empresaId, produtoIdInicial, origemAnuncioId, modoDuplicar, conteudoInicial, onClose, onCriado }: {
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

  const [titulo, setTitulo] = useState('')
  const [titulosSugeridos, setTitulosSugeridos] = useState<string[]>([])
  const [descricao, setDescricao] = useState('')
  const [preenchendoIA, setPreenchendoIA] = useState(false)
  const [preco, setPreco] = useState('')
  const [estoque, setEstoque] = useState('')
  const [sku, setSku] = useState('')
  const [ean, setEan] = useState('')
  const [peso, setPeso] = useState('')
  const [comprimento, setComprimento] = useState('')
  const [largura, setLargura] = useState('')
  const [altura, setAltura] = useState('')

  // Categoria: sugerida pela TikTok até o operador escolher outra.
  const [categoria, setCategoria] = useState<Categoria | null>(null)
  const categoriaManual = useRef(false)
  const [sugerindoCategoria, setSugerindoCategoria] = useState(false)
  const [buscaCategoria, setBuscaCategoria] = useState('')
  const [resultadosCategoria, setResultadosCategoria] = useState<Categoria[]>([])
  const [buscandoCategoria, setBuscandoCategoria] = useState(false)
  const [erroCategoria, setErroCategoria] = useState('')

  const [atributos, setAtributos] = useState<Atributo[]>([])
  const [valores, setValores] = useState<Record<string, ValorAtributo>>({})
  const [marcas, setMarcas] = useState<Marca[]>([])
  const [marcaId, setMarcaId] = useState('')
  const [buscaMarca, setBuscaMarca] = useState('')
  const [medidasObrigatorias, setMedidasObrigatorias] = useState(false)
  const [certificacoes, setCertificacoes] = useState<string[]>([])
  const [carregandoDetalhes, setCarregandoDetalhes] = useState(false)

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
    setTitulo(formatarTituloAnuncio(p.nome))
    setTitulosSugeridos([])
    setDescricao(p.descricao_marketplace ?? '')
    setPreco(p.preco_venda ? String(p.preco_venda) : '')
    setEstoque(p.estoque != null ? String(p.estoque) : '0')
    // É pelo SKU que o pedido da TikTok encontra o produto aqui na volta.
    setSku(p.sku || p.id)
    setEan(p.ean ?? '')
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

  // Traz para o cadastro as imagens que só existem no anúncio de origem.
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

  async function removerImagem(img: { id: string; url: string; principal: boolean }) {
    if (!confirm('Remover esta imagem do cadastro do produto?')) return
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
        if (o.pesoKg) setPeso(String(o.pesoKg))
        if (o.comprimentoCm) setComprimento(String(o.comprimentoCm))
        if (o.larguraCm) setLargura(String(o.larguraCm))
        if (o.alturaCm) setAltura(String(o.alturaCm))
        // De outra loja TikTok, categoria e atributos valem direto.
        if (o.tiktok?.categoryId) {
          categoriaManual.current = true
          setCategoria({ id: o.tiktok.categoryId, nome: '', caminho: o.tiktok.categoriaCaminho ?? `Categoria ${o.tiktok.categoryId}` })
        }
      })
      .catch(() => { /* origem indisponível — segue com o conteúdo do cadastro */ })
    return () => { ativo = false }
  }, [origemAnuncioId])

  // Categoria sugerida pela TikTok a partir do título — refeita enquanto o
  // operador edita o título, até ele escolher uma na mão.
  useEffect(() => {
    if (!canalAtivo || !produto || categoriaManual.current) return
    const t = titulo.trim()
    if (t.length < 5) return
    let ativo = true
    const timer = setTimeout(async () => {
      setSugerindoCategoria(true); setErroCategoria('')
      try {
        const d = await consultar(canalAtivo.id, { acao: 'recomendar', titulo: t })
        if (!ativo || categoriaManual.current) return
        if (d.ok && d.categoria) setCategoria(d.categoria)
        else if (!d.ok) setErroCategoria(d.erro ?? 'Não foi possível sugerir a categoria')
      } catch { if (ativo) setErroCategoria('Não foi possível sugerir a categoria') }
      finally { if (ativo) setSugerindoCategoria(false) }
    }, 700)
    return () => { ativo = false; clearTimeout(timer) }
  }, [titulo, canalAtivo?.id, produto?.id])

  // Busca de categoria pelo nome.
  useEffect(() => {
    if (!canalAtivo) return
    const termo = buscaCategoria.trim()
    if (termo.length < 3) { setResultadosCategoria([]); return }
    let ativo = true
    const timer = setTimeout(async () => {
      setBuscandoCategoria(true)
      try {
        const d = await consultar(canalAtivo.id, { acao: 'buscar', termo })
        if (!ativo) return
        if (d.ok) setResultadosCategoria(d.categorias ?? [])
        else setErroCategoria(d.erro ?? 'Erro na busca de categoria')
      } finally { if (ativo) setBuscandoCategoria(false) }
    }, 400)
    return () => { ativo = false; clearTimeout(timer) }
  }, [buscaCategoria, canalAtivo?.id])

  // Atributos, marcas e regras da categoria escolhida.
  useEffect(() => {
    if (!canalAtivo || !categoria) { setAtributos([]); setMarcas([]); return }
    let ativo = true
    setCarregandoDetalhes(true); setErroCategoria('')
    consultar(canalAtivo.id, { acao: 'detalhes', categoryId: categoria.id })
      .then(d => {
        if (!ativo) return
        if (!d.ok) { setErroCategoria(d.erro ?? 'Não foi possível carregar os atributos da categoria'); return }
        const lista: Atributo[] = d.atributos ?? []
        setAtributos(lista)
        setMedidasObrigatorias(!!d.medidasObrigatorias)
        setCertificacoes(d.certificacoesObrigatorias ?? [])
        setMarcas(d.marcas ?? [])
        // Atributos do anúncio de origem (TikTok) entram já preenchidos.
        const daOrigem: { id: string; valorId: string | null; valorTexto: string | null }[] = origem?.tiktok?.atributos ?? []
        setValores(prev => {
          const novo: Record<string, ValorAtributo> = {}
          for (const a of lista) {
            const o = daOrigem.find(x => x.id === a.id)
            if (prev[a.id]) novo[a.id] = prev[a.id]
            else if (o) novo[a.id] = { valorId: o.valorId, valorTexto: o.valorTexto }
          }
          return novo
        })
        // Marca: a da origem TikTok; senão a do cadastro, se a TikTok tiver.
        const marcasLista: Marca[] = d.marcas ?? []
        if (origem?.tiktok?.marca?.id) {
          setMarcaId(origem.tiktok.marca.id)
          if (!marcasLista.some(m => m.id === origem.tiktok.marca.id)) setMarcas([origem.tiktok.marca, ...marcasLista])
        } else if (produto?.marca) {
          const igual = marcasLista.find(m => m.nome.trim().toLowerCase() === String(produto.marca).trim().toLowerCase())
          if (igual) setMarcaId(igual.id)
        }
      })
      .catch(() => { if (ativo) setErroCategoria('Não foi possível carregar os atributos da categoria') })
      .finally(() => { if (ativo) setCarregandoDetalhes(false) })
    return () => { ativo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoria?.id, canalAtivo?.id])

  // Marca pelo nome (a lista da categoria vem limitada).
  useEffect(() => {
    if (!canalAtivo || !categoria) return
    const termo = buscaMarca.trim()
    if (termo.length < 2) return
    let ativo = true
    const timer = setTimeout(async () => {
      const d = await consultar(canalAtivo.id, { acao: 'marcas', categoryId: categoria.id, marca: termo })
      if (!ativo || !d.ok) return
      setMarcas(prev => {
        const porId = new Map(prev.map(m => [m.id, m]))
        for (const m of d.marcas ?? []) porId.set(m.id, m)
        return [...porId.values()]
      })
    }, 400)
    return () => { ativo = false; clearTimeout(timer) }
  }, [buscaMarca, categoria?.id, canalAtivo?.id])

  function escolherCategoria(c: Categoria) {
    categoriaManual.current = true
    setCategoria(c)
    setBuscaCategoria(''); setResultadosCategoria([])
    setValores({}); setMarcaId('')
  }

  async function preencherComIA() {
    if (!produto) return
    setPreenchendoIA(true); setErro('')
    try {
      const resp = await fetch('/api/marketplace/nuvemshop/ia-gerar-conteudo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoNome: produto.nome,
          produtoMarca: produto.marca,
          produtoCategoria: produto.categoria,
          produtoDescricao: produto.descricao_marketplace,
          categoriasLoja: categoria ? [categoria.caminho] : [],
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

  const fotosDoAnuncio = (capaUrl
    ? [capaUrl, ...imagens.map(i => i.url).filter(u => u !== capaUrl)]
    : imagens.map(i => i.url)).slice(0, 9)

  const tituloIgualAoOrigem = !!modoDuplicar && !!origem?.titulo
    && titulo.trim().toLowerCase() === String(origem.titulo).trim().toLowerCase()

  const preenchido = (a: Atributo) => !!(valores[a.id]?.valorId || valores[a.id]?.valorTexto?.trim())
  const faltandoAtributos = atributos.filter(a => a.obrigatorio && !preenchido(a))
  const faltandoMedidas = medidasObrigatorias && !(Number(comprimento) > 0 && Number(largura) > 0 && Number(altura) > 0)

  const pendencias: string[] = []
  if (produto) {
    if (imagens.length === 0) pendencias.push('ao menos uma imagem')
    if (!categoria) pendencias.push('categoria')
    if (!(Number(peso) > 0)) pendencias.push('peso da embalagem')
    if (faltandoMedidas) pendencias.push('medidas da embalagem (exigidas nesta categoria)')
    if (faltandoAtributos.length) pendencias.push(`atributos obrigatórios: ${faltandoAtributos.map(a => a.nome).join(', ')}`)
  }

  const podeEnviar = !!canalAtivo && !!produto && titulo.trim() !== '' && titulo.trim().length <= MAX_TITULO
    && Number(preco) > 0 && estoque !== '' && !tituloIgualAoOrigem && pendencias.length === 0
    && !carregandoDetalhes && !salvando

  async function enviar() {
    if (!podeEnviar || !canalAtivo || !categoria) return
    setSalvando(true); setErro('')
    try {
      const resp = await fetch('/api/marketplace/tiktok/criar-anuncio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canalId: canalAtivo.id, produtoId: produto.id,
          titulo: titulo.trim(), descricao: descricao.trim(),
          preco: Number(preco), estoque: Number(estoque),
          sku: sku.trim() || null, ean: ean.trim() || null,
          categoryId: categoria.id, brandId: marcaId || null,
          atributos: Object.entries(valores)
            .filter(([id]) => atributos.some(a => a.id === id))
            .map(([id, v]) => ({ id, valorId: v.valorId, valorTexto: v.valorTexto })),
          peso: peso || undefined, comprimento: comprimento || undefined,
          largura: largura || undefined, altura: altura || undefined,
          fotos: fotosDoAnuncio,
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

  const campo = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500'
  const obrigatorios = atributos.filter(a => a.obrigatorio)
  const opcionais = atributos.filter(a => !a.obrigatorio)

  function inputAtributo(a: Atributo) {
    const v = valores[a.id] ?? { valorId: null, valorTexto: null }
    const definir = (novo: ValorAtributo) => setValores(prev => ({ ...prev, [a.id]: novo }))
    const faltando = a.obrigatorio && !preenchido(a)
    return (
      <div key={a.id}>
        <label className={`block text-xs font-medium mb-1 ${faltando ? 'text-red-600' : 'text-gray-500'}`}>
          {a.nome}{a.obrigatorio && ' *'}
        </label>
        {a.valores.length > 0 ? (
          <select
            value={v.valorId ?? (v.valorTexto ? '__texto' : '')}
            onChange={e => {
              const val = e.target.value
              if (val === '__texto') definir({ valorId: null, valorTexto: v.valorTexto ?? '' })
              else definir({ valorId: val || null, valorTexto: null })
            }}
            className={`${campo} bg-white ${faltando ? 'border-red-300' : ''}`}>
            <option value="">{a.obrigatorio ? 'Selecione...' : '—'}</option>
            {a.valores.map(op => <option key={op.id} value={op.id}>{op.nome}</option>)}
            {a.personalizavel && <option value="__texto">Outro (digitar)</option>}
          </select>
        ) : null}
        {(a.valores.length === 0 || (!v.valorId && v.valorTexto != null)) && (
          <input value={v.valorTexto ?? ''} onChange={e => definir({ valorId: null, valorTexto: e.target.value })}
            placeholder={a.valores.length > 0 ? 'Digite o valor' : ''}
            className={`${campo} ${a.valores.length > 0 ? 'mt-1' : ''} ${faltando ? 'border-red-300' : ''}`} />
        )}
      </div>
    )
  }

  const marcasFiltradas = buscaMarca.trim()
    ? marcas.filter(m => m.nome.toLowerCase().includes(buscaMarca.trim().toLowerCase()) || m.id === marcaId)
    : marcas

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Criar anúncio na TikTok Shop</h2>
            {canalAtivo && <p className="text-xs text-gray-400">{canalAtivo.nome}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {!canalAtivo && canais && canais.length > 1 ? (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Escolha a loja TikTok</p>
              <select value={canalEscolhidoId} onChange={e => setCanalEscolhidoId(e.target.value)} autoFocus className={`${campo} bg-white`}>
                <option value="">Selecione...</option>
                {canais.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          ) : resultado ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-4">
              <p className="text-sm font-medium text-emerald-800">✓ Produto enviado para a TikTok Shop (id {resultado.itemId})</p>
              <p className="text-xs text-emerald-700 mt-1">A TikTok revisa todo produto novo antes de liberar a venda — o status aparece na tela de Anúncios.</p>
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
                  <input value={buscaProd} onChange={e => setBuscaProd(e.target.value)} autoFocus placeholder="Nome ou SKU..." className={campo} />
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
                  <div className="flex items-center gap-3 min-w-0">
                    {imagens[0] ? (
                      <img src={capaUrl ?? imagens[0].url} alt="" className="w-12 h-12 rounded-lg object-cover border border-gray-200" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300">📷</div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{produto.nome}</p>
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
                    Título, descrição e medidas vieram de lá.{' '}
                    {origem.plataforma === 'tiktok'
                      ? 'Categoria, marca e atributos também — são os mesmos em qualquer loja TikTok.'
                      : 'A categoria é sugerida pela TikTok a partir do título — confira abaixo.'}
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
                    <p className="text-xs font-medium text-gray-500 mb-2">Imagens do anúncio ({Math.min(imagens.length, 9)}{imagens.length > 9 ? ` de ${imagens.length} — a TikTok aceita até 9` : ''})</p>
                    {imagens.length === 0 ? (
                      <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2">
                        A TikTok exige ao menos uma imagem. Adicione no + abaixo.
                      </p>
                    ) : (
                      <p className="text-[11px] text-gray-400 mb-2">
                        A <strong>capa</strong> é a primeira foto do anúncio. Clique em outra foto para trocar.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {imagens.map(img => (
                        <div key={img.id} className="relative group w-16 h-16">
                          <img src={img.url} alt="" onClick={() => setCapaUrl(img.url)} title="Usar como capa deste anúncio"
                            className={`w-16 h-16 rounded-lg object-cover border-2 cursor-pointer ${capaUrl === img.url ? 'border-emerald-500 ring-2 ring-emerald-200' : 'border-gray-200'}`} />
                          {capaUrl === img.url && <span className="absolute -top-1.5 -left-1.5 bg-emerald-600 text-white text-[9px] px-1 rounded">capa</span>}
                          <div className="absolute inset-0 bg-black/50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                            {capaUrl !== img.url && (
                              <button type="button" onClick={() => setCapaUrl(img.url)} title="Usar como capa deste anúncio"
                                className="text-white text-[10px] px-1 py-0.5 bg-emerald-600/90 rounded hover:bg-emerald-600">capa</button>
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
                    <PainelDimensoesImagens imagens={imagens} plataforma="tiktok" produtoId={produto.id}
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
                    <label className="block text-xs font-medium text-gray-500 mb-1">Título * <span className={titulo.length > MAX_TITULO ? 'text-red-600' : 'text-gray-300'}>({titulo.length}/{MAX_TITULO})</span></label>
                    <input value={titulo} onChange={e => setTitulo(e.target.value)} className={campo} />
                    {titulosSugeridos.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-[11px] text-gray-400">Opções da IA — clique para usar:</p>
                        {titulosSugeridos.map((t, i) => (
                          <button key={i} type="button" onClick={() => setTitulo(t)}
                            className={`w-full text-left text-xs px-3 py-1.5 rounded-lg border ${titulo === t ? 'border-violet-400 bg-violet-50 text-violet-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                            {t} <span className="text-gray-300">({t.length})</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {tituloIgualAoOrigem && (
                      <p className="text-xs text-amber-700 mt-1">O título está igual ao do anúncio de origem — na mesma loja, mude alguma coisa antes de publicar.</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Descrição</label>
                    <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={5} className={campo} />
                    <p className="text-[11px] text-gray-400 mt-1">Sem descrição, vai o título no lugar (a TikTok exige uma).</p>
                    {descricao.trim() && !produto.descricao_marketplace && (
                      <p className="text-[11px] text-emerald-700 mt-1">Este produto não tem descrição no cadastro — ao publicar, esta descrição é gravada lá também.</p>
                    )}
                  </div>

                  {/* Preço, estoque, códigos */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Preço *</label>
                      <input value={preco} onChange={e => setPreco(e.target.value)} type="number" step="0.01" className={campo} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Estoque *</label>
                      <input value={estoque} onChange={e => setEstoque(e.target.value)} type="number" className={campo} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">SKU</label>
                      <input value={sku} onChange={e => setSku(e.target.value)} className={campo} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">EAN</label>
                      <input value={ean} onChange={e => setEan(e.target.value)} className={campo} />
                    </div>
                  </div>

                  {/* Categoria */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Categoria da TikTok *</p>
                    {categoria ? (
                      <div className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                        <span className="text-sm text-emerald-900">{categoria.caminho}</span>
                        {!categoriaManual.current && <span className="text-[10px] text-emerald-700 whitespace-nowrap">sugerida pela TikTok</span>}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">{sugerindoCategoria ? 'Pedindo sugestão à TikTok...' : 'Nenhuma categoria ainda.'}</p>
                    )}
                    <input value={buscaCategoria} onChange={e => setBuscaCategoria(e.target.value)}
                      placeholder={categoria ? 'Trocar: buscar outra categoria pelo nome...' : 'Buscar categoria pelo nome...'}
                      className={`${campo} mt-2`} />
                    {buscandoCategoria && <p className="text-[11px] text-gray-400 mt-1">Buscando...</p>}
                    {resultadosCategoria.length > 0 && (
                      <div className="mt-1 max-h-44 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
                        {resultadosCategoria.map(c => (
                          <button key={c.id} type="button" onClick={() => escolherCategoria(c)}
                            className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-blue-50">{c.caminho}</button>
                        ))}
                      </div>
                    )}
                    {!buscandoCategoria && buscaCategoria.trim().length >= 3 && resultadosCategoria.length === 0 && (
                      <p className="text-[11px] text-gray-400 mt-1">Nenhuma categoria com esse nome.</p>
                    )}
                    {erroCategoria && <p className="text-xs text-red-600 mt-1">{erroCategoria}</p>}
                  </div>

                  {categoria && (
                    <>
                      {carregandoDetalhes ? (
                        <p className="text-xs text-gray-400">Carregando atributos da categoria...</p>
                      ) : (
                        <>
                          {/* Marca */}
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Marca</label>
                            <div className="grid grid-cols-2 gap-2">
                              <input value={buscaMarca} onChange={e => setBuscaMarca(e.target.value)} placeholder="Buscar marca..." className={campo} />
                              <select value={marcaId} onChange={e => setMarcaId(e.target.value)} className={`${campo} bg-white`}>
                                <option value="">Sem marca</option>
                                {marcasFiltradas.map(m => <option key={m.id} value={m.id}>{m.nome}{m.autorizada ? '' : ' (não autorizada)'}</option>)}
                              </select>
                            </div>
                            {produto.marca && !marcaId && (
                              <p className="text-[11px] text-gray-400 mt-1">O cadastro diz &quot;{produto.marca}&quot; — busque pelo nome se a TikTok tiver essa marca.</p>
                            )}
                          </div>

                          {obrigatorios.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-gray-700 mb-2">Atributos obrigatórios</p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{obrigatorios.map(inputAtributo)}</div>
                            </div>
                          )}
                          {opcionais.length > 0 && (
                            <details>
                              <summary className="text-xs font-medium text-gray-500 cursor-pointer">Atributos opcionais ({opcionais.length}) — ajudam a busca</summary>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">{opcionais.map(inputAtributo)}</div>
                            </details>
                          )}
                          {certificacoes.length > 0 && (
                            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                              Esta categoria pede certificação ({certificacoes.join(', ')}). Envie pelo Seller Center depois de criar o anúncio, ou ele fica parado na revisão.
                            </p>
                          )}
                        </>
                      )}
                    </>
                  )}

                  {/* Peso e medidas */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">
                      Peso da embalagem * {medidasObrigatorias ? 'e medidas *' : 'e medidas'} (frete)
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <input value={peso} onChange={e => setPeso(e.target.value)} type="number" step="0.001" placeholder="Peso (kg)" className={campo} />
                      <input value={comprimento} onChange={e => setComprimento(e.target.value)} type="number" step="0.1" placeholder="Compr. (cm)" className={campo} />
                      <input value={largura} onChange={e => setLargura(e.target.value)} type="number" step="0.1" placeholder="Larg. (cm)" className={campo} />
                      <input value={altura} onChange={e => setAltura(e.target.value)} type="number" step="0.1" placeholder="Alt. (cm)" className={campo} />
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">O que for preenchido aqui também é gravado no cadastro do produto.</p>
                  </div>

                  {pendencias.length > 0 && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      Falta para publicar: {pendencias.join(' · ')}
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
              {salvando ? 'Publicando (enviando fotos)...' : 'Publicar na TikTok'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
