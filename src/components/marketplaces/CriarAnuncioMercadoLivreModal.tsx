'use client'

import { useState, useEffect, type ChangeEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatarTituloAnuncio } from '@/lib/texto/titulo'
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
  const [origemCategoria, setOrigemCategoria] = useState<'sugerida' | 'importada' | null>(null)

  const [atributos, setAtributos] = useState<Atributo[]>([])
  const [atributosCarregados, setAtributosCarregados] = useState(false)
  const [valoresAtributos, setValoresAtributos] = useState<Record<string, string>>({})
  const [carregandoAtributos, setCarregandoAtributos] = useState(false)
  const [tiposAnuncio, setTiposAnuncio] = useState<TipoAnuncio[]>([])
  const [listingTypeId, setListingTypeId] = useState('')

  const [condicao, setCondicao] = useState<'new' | 'used'>('new')
  const [titulo, setTitulo] = useState('')
  // Opcoes de titulo geradas pela IA — o operador escolhe, nunca aplica sozinha.
  const [titulosSugeridos, setTitulosSugeridos] = useState<string[]>([])
  const [descricao, setDescricao] = useState('')
  const [preco, setPreco] = useState('')
  const [estoque, setEstoque] = useState('')

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState<{ itemId: string; warning?: string } | null>(null)
  const [preenchendoIA, setPreenchendoIA] = useState(false)

  // Importação a partir de um anúncio já publicado (o nosso ou de outro
  // vendedor) — puxa título, descrição, imagens, categoria e atributos pela
  // API pública do ML, sem publicar nada sozinha.
  const [urlImport, setUrlImport] = useState('')
  const [importando, setImportando] = useState(false)
  const [erroImport, setErroImport] = useState('')
  const [resumoImport, setResumoImport] = useState<string | null>(null)
  const [precoImportado, setPrecoImportado] = useState<number | null>(null)
  // Guardado à parte porque os atributos da categoria carregam depois (e
  // podem recarregar se o usuário trocar a categoria) — o efeito abaixo
  // reaplica os valores importados sempre que a lista muda.
  const [atributosImportados, setAtributosImportados] = useState<Record<string, string>>({})

  // Preenche descrição + o máximo de atributos possível via IA — nunca
  // publica sozinha, só sugere valores editáveis (mesmo padrão do botão
  // equivalente em CriarAnuncioShopeeModal.tsx). Existe porque o ML às vezes
  // rejeita a criação citando atributos que nem apareciam como obrigatórios
  // na lista carregada (atributos condicionais) — preencher mais do que só
  // os marcados "obrigatório" reduz a chance de bater nesse erro de novo.
  async function preencherComIA() {
    if (!produto || atributos.length === 0) return
    setPreenchendoIA(true); setErro('')
    try {
      const resp = await fetch('/api/marketplace/mercadolivre/ia-gerar-conteudo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoNome: produto.nome, produtoMarca: produto.marca, produtoDescricao: produto.descricao_marketplace,
          categoriaPath: caminhoCategoria.map(c => c.name).join(' › '),
          atributos,
        }),
      })
      const data = await resp.json()
      if (!data.ok) { setErro(data.erro ?? 'Erro ao gerar conteúdo com IA'); return }
      if (Array.isArray(data.titulos) && data.titulos.length > 0) setTitulosSugeridos(data.titulos)
      if (data.descricao) setDescricao(data.descricao)
      if (data.atributos && Object.keys(data.atributos).length > 0) {
        setValoresAtributos(prev => ({ ...prev, ...data.atributos }))
      }
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao usar IA')
    } finally {
      setPreenchendoIA(false)
    }
  }

  // Aplica os atributos importados assim que a lista da categoria carrega —
  // casa por id do atributo (BRAND, MODEL, COLOR...), que é o mesmo em
  // qualquer categoria do ML. Quando o atributo é de lista fechada, só
  // aceita o valor se ele existir entre as opções (comparação sem acento/
  // maiúscula), pra não mandar texto livre onde o ML espera um id de opção.
  useEffect(() => {
    if (atributos.length === 0 || Object.keys(atributosImportados).length === 0) return
    const normalizar = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
    const aplicar: Record<string, string> = {}
    for (const a of atributos) {
      const valor = atributosImportados[a.id]
      if (!valor) continue
      if (a.valores.length > 0) {
        const opcao = a.valores.find(v => normalizar(v.name) === normalizar(valor))
        if (opcao) aplicar[a.id] = opcao.name
      } else {
        aplicar[a.id] = valor
      }
    }
    if (Object.keys(aplicar).length > 0) setValoresAtributos(prev => ({ ...prev, ...aplicar }))
  }, [atributos, atributosImportados])

  async function importarDeUrl() {
    if (!urlImport.trim() || !produto) return
    setImportando(true); setErroImport(''); setResumoImport(null)
    try {
      const resp = await fetch('/api/marketplace/mercadolivre/importar-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlImport.trim(), canalId: canalAtivo?.id }),
      })
      const data = await resp.json()
      if (!data.ok) { setErroImport(data.erro ?? 'Erro ao importar anúncio'); return }
      const d = data.dados as {
        titulo: string; descricao: string; preco: number; imagens: string[]
        categoriaId: string | null; categoriaCaminho: { id: string; name: string }[]
        atributos: { id: string; name: string; valueName: string }[]
        condicao: 'new' | 'used' | null; temVariacoes: boolean
      }

      const feito: string[] = []
      if (d.titulo) { setTitulo(d.titulo.slice(0, 60)); feito.push('título') }
      if (d.descricao) { setDescricao(d.descricao); feito.push('descrição') }
      if (d.condicao) setCondicao(d.condicao)
      if (d.preco > 0) setPrecoImportado(d.preco)

      const novasImagens = await importarImagens(d.imagens)
      if (novasImagens > 0) feito.push(`${novasImagens} ${novasImagens > 1 ? 'imagens' : 'imagem'}`)

      if (d.atributos.length > 0) {
        setAtributosImportados(Object.fromEntries(d.atributos.map(a => [a.id, a.valueName])))
        feito.push(`${d.atributos.length} atributos`)
      }

      if (d.categoriaId) {
        setOrigemCategoria('importada')
        await resolverCaminhoCategoria(d.categoriaId, d.categoriaCaminho)
        feito.push('categoria')
      }

      const aviso = d.temVariacoes
        ? ' ⚠ O anúncio de origem tem variações — aqui só é criado anúncio simples, confira preço e atributos.'
        : ''
      setResumoImport((feito.length > 0 ? `Importado: ${feito.join(', ')}.` : 'Nada foi encontrado nesse anúncio.') + aviso)
    } catch (e: any) {
      setErroImport(e.message ?? 'Erro ao importar anúncio')
    } finally {
      setImportando(false)
    }
  }

  // As imagens ficam no cadastro do produto (produto_imagens), não só neste
  // formulário — mesmo comportamento do "+ Adicionar por URL" já existente,
  // que também guarda a URL remota em vez de baixar o arquivo.
  async function importarImagens(urls: string[]): Promise<number> {
    if (!produto || urls.length === 0) return 0
    const jaExistentes = new Set(imagens.map(i => i.url))
    const novas = urls.filter(u => !jaExistentes.has(u))
    if (novas.length === 0) return 0
    const sb = createClient()
    const { error } = await sb.from('produto_imagens').insert(novas.map((url, i) => ({
      empresa_id: empresaId,
      produto_id: produto.id,
      url,
      ordem: imagens.length + i,
      principal: imagens.length === 0 && i === 0,
    })))
    if (error) { setErroImport('Imagens: ' + error.message); return 0 }
    await carregarImagens(produto.id)
    return novas.length
  }

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
    // Cadastro guarda em CAIXA ALTA — anuncio pede texto legivel.
    setTitulo(formatarTituloAnuncio(p.nome).slice(0, 60))
    setTitulosSugeridos([])
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
          await resolverCaminhoCategoria(
            data.sugestao.categoryId,
            data.sugestao.categoryName ? [{ id: data.sugestao.categoryId, name: data.sugestao.categoryName }] : undefined,
          )
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
  async function resolverCaminhoCategoria(categoryId: string, caminho?: { id: string; name: string }[]) {
    if (!canalAtivo) return
    setCarregandoCategorias(true)
    try {
      // Sem endpoint de "ancestrais" nesta integração ainda — quem chama
      // passa o caminho quando conhece (a importação traz o path_from_root
      // do próprio ML); sem isso, mostra o id como único nível resolvido.
      // Em ambos os casos os atributos da categoria carregam direto e o
      // usuário pode trocar manualmente abaixo.
      const nomeResp = await fetch('/api/marketplace/mercadolivre/atributos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canalId: canalAtivo.id, categoryId }),
      })
      const nomeData = await nomeResp.json()
      if (!nomeData.ok) { carregarNivelCategoria(undefined, 0); return }
      setCaminhoCategoria(caminho?.length ? caminho : [{ id: categoryId, name: categoryId }])
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
                <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3">
                  <p className="text-xs font-medium text-violet-800 mb-1">Importar de um anúncio existente</p>
                  <p className="text-[11px] text-violet-600 mb-2">
                    Cole o link de um anúncio do Mercado Livre (seu ou de outro vendedor) pra puxar título, descrição,
                    imagens, categoria e atributos de uma vez. Nada é publicado — tudo fica editável abaixo.
                  </p>
                  <div className="flex gap-2">
                    <input value={urlImport} onChange={e => setUrlImport(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && importarDeUrl()}
                      placeholder="https://produto.mercadolivre.com.br/MLB-..."
                      className="flex-1 border border-violet-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-violet-500" />
                    <button type="button" onClick={importarDeUrl} disabled={importando || !urlImport.trim()}
                      className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg whitespace-nowrap">
                      {importando ? 'Importando...' : 'Importar'}
                    </button>
                  </div>
                  {erroImport && <p className="text-xs text-red-600 mt-2">{erroImport}</p>}
                  {resumoImport && <p className="text-xs text-violet-700 mt-2">✓ {resumoImport}</p>}
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
                    {categoriaFolha && origemCategoria === 'importada' && (
                      <p className="text-xs text-gray-400 mt-0.5">📥 veio do anúncio importado — confira antes de publicar</p>
                    )}
                  </div>

                  {carregandoAtributos && <p className="text-xs text-gray-400">Carregando atributos da categoria...</p>}

                  {!carregandoAtributos && categoriaFolha && atributosCarregados && atributos.length === 0 && (
                    <p className="text-xs text-gray-400">Esta categoria não tem atributos específicos no Mercado Livre.</p>
                  )}
                  {atributos.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-medium text-gray-500">Atributos da categoria</p>
                        <button type="button" onClick={preencherComIA} disabled={preenchendoIA}
                          className="text-xs text-violet-600 hover:text-violet-800 font-medium disabled:opacity-50">
                          {preenchendoIA ? 'Preenchendo…' : '✨ Preencher com IA'}
                        </button>
                      </div>
                      <p className="text-[11px] text-gray-400 -mt-1 mb-2">
                        O Mercado Livre às vezes exige atributos que nem aparecem como obrigatórios aqui — a IA tenta preencher o máximo possível pra reduzir erro na publicação. Confira antes de publicar.
                      </p>
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
                    {titulosSugeridos.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-xs text-violet-700 font-medium">✨ Sugestões de título — clique pra usar:</p>
                        {titulosSugeridos.map(t => (
                          <button key={t} type="button" onClick={() => setTitulo(t.slice(0, 60))}
                            className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${t === titulo ? 'border-violet-400 bg-violet-50 text-violet-900' : 'border-gray-200 hover:border-violet-300 hover:bg-violet-50 text-gray-700'}`}>
                            {t}
                            <span className="text-xs text-gray-400 ml-2">{t.length} car.</span>
                          </button>
                        ))}
                      </div>
                    )}
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
                      {/* Preço nunca é sobrescrito pela importação — é decisão
                          comercial nossa, não do anúncio de origem. Fica só
                          como referência, com um atalho pra adotar. */}
                      {precoImportado != null && Number(preco) !== precoImportado && (
                        <p className="text-xs text-gray-400 mt-1">
                          No anúncio importado: {fmt(precoImportado)}{' '}
                          <button type="button" onClick={() => setPreco(String(precoImportado))}
                            className="text-blue-600 hover:text-blue-800 font-medium">usar este preço</button>
                        </p>
                      )}
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
