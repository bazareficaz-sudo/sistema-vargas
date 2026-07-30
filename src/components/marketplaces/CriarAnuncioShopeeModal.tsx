'use client'

import { useState, useEffect, type ChangeEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmt } from './utils'
import { formatarTituloAnuncio } from '@/lib/texto/titulo'

type Categoria = { category_id: number; original_category_name: string; has_children: boolean }
type Atributo = {
  attribute_id: number; attribute_name: string; is_mandatory: boolean; attribute_type: string
  attribute_value_list: { value_id: number; original_value_name: string }[]
}
type Marca = { brand_id: number; original_brand_name: string }
type CanalLogistica = { logistic_id: number; logistic_name: string; enabled: boolean }

export default function CriarAnuncioShopeeModal({ canal, canais, empresaId, produtoIdInicial, onClose, onCriado }: {
  canal?: { id: string; nome: string }
  canais?: { id: string; nome: string }[]
  empresaId: string; produtoIdInicial?: string
  onClose: () => void
  onCriado: () => void
}) {
  // Entrada a partir de Anúncios já vem com `canal` fixo (página já é de um
  // canal só). Entrada a partir de Produtos não tem canal em contexto —
  // recebe a lista de lojas Shopee e escolhe aqui (auto-escolhe se só tiver 1).
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
  const [caminhoCategoria, setCaminhoCategoria] = useState<Categoria[]>([])
  const [opcoesPorNivel, setOpcoesPorNivel] = useState<Categoria[][]>([])
  const [carregandoCategorias, setCarregandoCategorias] = useState(false)
  const categoriaFolha = caminhoCategoria.length > 0 && !caminhoCategoria[caminhoCategoria.length - 1].has_children
    ? caminhoCategoria[caminhoCategoria.length - 1] : null

  const [atributos, setAtributos] = useState<Atributo[]>([])
  const [atributosCarregados, setAtributosCarregados] = useState(false)
  const [valoresAtributos, setValoresAtributos] = useState<Record<number, { valueId?: number; texto?: string }>>({})
  const [marcas, setMarcas] = useState<Marca[]>([])
  const [brandId, setBrandId] = useState('')
  const [carregandoAtributos, setCarregandoAtributos] = useState(false)

  const [canaisLogistica, setCanaisLogistica] = useState<CanalLogistica[]>([])
  const [logisticaSelecionada, setLogisticaSelecionada] = useState<Set<number>>(new Set())

  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [preco, setPreco] = useState('')
  const [estoque, setEstoque] = useState('')
  const [peso, setPeso] = useState('')
  const [comprimento, setComprimento] = useState('')
  const [largura, setLargura] = useState('')
  const [altura, setAltura] = useState('')

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState<{ itemId: string; warning?: string } | null>(null)
  const [preenchendoIA, setPreenchendoIA] = useState(false)
  const [origemCategoria, setOrigemCategoria] = useState<'recomendada' | 'lembrada' | 'deduzida' | null>(null)

  // Carrega o produto pré-selecionado (entrada a partir da tela de Produtos)
  useEffect(() => {
    if (!produtoIdInicial) return
    const sb = createClient()
    sb.from('produtos').select('*').eq('id', produtoIdInicial).single().then(({ data }) => {
      if (data) selecionarProduto(data)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoIdInicial])

  // Busca ao vivo (só quando não veio produto pré-selecionado)
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
    // O cadastro guarda o nome em CAIXA ALTA; anúncio em caixa alta é ruim de
    // ler e a Shopee penaliza. Continua editável no campo.
    setTitulo(formatarTituloAnuncio(p.nome))
    setPreco(p.preco_venda ? String(p.preco_venda) : '')
    setEstoque(p.estoque != null ? String(p.estoque) : '0')
    setPeso(p.peso_kg ? String(p.peso_kg) : '')
    setComprimento(p.comprimento_cm ? String(p.comprimento_cm) : '')
    setLargura(p.largura_cm ? String(p.largura_cm) : '')
    setAltura(p.altura_cm ? String(p.altura_cm) : '')
  }

  // Galeria de imagens do produto — mesma tabela/bucket usados em
  // EditarProdutoModal.tsx (produto_imagens + storage "produto-imagens"),
  // gerenciável direto aqui pra não precisar sair do fluxo de criar anúncio.
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

  // Assim que o produto (e o canal) estiverem prontos, tenta pré-selecionar
  // a categoria sem IA, em ordem de confiança decrescente:
  // 1) "recomendada" — ferramenta oficial da Shopee (category_recommend),
  //    baseada no nome exato deste produto — a mais confiável, roda sempre
  //    primeiro;
  // 2) "lembrada" — categoria já usada e confirmada antes pra um produto
  //    com a mesma categoria interna (marketplace_categoria_sugestao);
  // 3) "deduzida" — nenhuma das anteriores achou nada, tenta adivinhar por
  //    sobreposição de palavras-chave entre o produto e a árvore da Shopee.
  // Se nenhuma achar nada, cai no comportamento padrão de carregar só as
  // categorias raiz pra escolha manual.
  useEffect(() => {
    if (!produto || !canalAtivo) return
    let ativo = true

    async function aplicarCaminho(data: any, origem: 'recomendada' | 'lembrada' | 'deduzida') {
      setOrigemCategoria(origem)
      setOpcoesPorNivel(data.opcoesPorNivel)
      setCaminhoCategoria(data.caminho)
      if (data.resolvidoAteFolha) {
        await carregarAtributosEMarcas(data.caminho[data.caminho.length - 1].category_id)
      } else {
        carregarNivelCategoria(data.caminho[data.caminho.length - 1].category_id, data.opcoesPorNivel.length)
      }
    }

    ;(async () => {
      try {
        const respRec = await fetch('/api/marketplace/shopee/categoria-recomendada', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId: canalAtivo.id, produtoNome: produto.nome }),
        })
        const dataRec = await respRec.json()
        if (!ativo) return
        if (dataRec.ok && dataRec.encontrado && dataRec.caminho?.length > 0) {
          await aplicarCaminho(dataRec, 'recomendada')
          return
        }
      } catch {
        // segue pra próxima tentativa
      }

      try {
        const resp = await fetch('/api/marketplace/shopee/categoria-sugerida', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId: canalAtivo.id, produtoCategoria: produto.categoria ?? null }),
        })
        const data = await resp.json()
        if (!ativo) return
        if (data.ok && data.encontrado && data.caminho?.length > 0) {
          await aplicarCaminho(data, 'lembrada')
          return
        }
      } catch {
        // segue pra próxima tentativa
      }

      try {
        const resp2 = await fetch('/api/marketplace/shopee/categoria-deduzida', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId: canalAtivo.id, produtoNome: produto.nome, produtoCategoria: produto.categoria ?? null }),
        })
        const data2 = await resp2.json()
        if (!ativo) return
        if (data2.ok && data2.encontrado && data2.caminho?.length > 0) {
          await aplicarCaminho(data2, 'deduzida')
          return
        }
      } catch {
        // sem dedução disponível — segue pro comportamento padrão abaixo
      }

      if (ativo) carregarNivelCategoria(undefined, 0)
    })()
    return () => { ativo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produto, canalAtivo])

  async function carregarNivelCategoria(parentCategoryId: number | undefined, nivel: number) {
    if (!canalAtivo) return
    setCarregandoCategorias(true)
    try {
      const resp = await fetch('/api/marketplace/shopee/categorias', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canalId: canalAtivo.id, parentCategoryId }),
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

  function escolherCategoria(nivel: number, categoryId: string) {
    const opcoes = opcoesPorNivel[nivel] ?? []
    const cat = opcoes.find(c => String(c.category_id) === categoryId)
    if (!cat) return
    const novoCaminho = [...caminhoCategoria.slice(0, nivel), cat]
    setCaminhoCategoria(novoCaminho)
    setOrigemCategoria(null) // escolha manual a partir daqui — não é mais lembrada nem deduzida
    setAtributos([]); setValoresAtributos({}); setMarcas([]); setBrandId(''); setAtributosCarregados(false)
    if (cat.has_children) {
      carregarNivelCategoria(cat.category_id, nivel + 1)
    } else {
      setOpcoesPorNivel(prev => prev.slice(0, nivel + 1))
      carregarAtributosEMarcas(cat.category_id)
    }
  }

  async function carregarAtributosEMarcas(categoryId: number): Promise<{ atributos: Atributo[]; marcas: Marca[] } | null> {
    if (!canalAtivo) return null
    setCarregandoAtributos(true)
    setAtributosCarregados(false)
    try {
      const resp = await fetch('/api/marketplace/shopee/atributos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canalId: canalAtivo.id, categoryId }),
      })
      const data = await resp.json()
      if (!data.ok) { setErro(data.erro ?? 'Erro ao buscar atributos'); return null }
      setAtributos(data.atributos ?? [])
      setMarcas(data.marcas ?? [])
      setAtributosCarregados(true)
      // Pré-seleciona a marca se o nome do produto bater com alguma da lista.
      if (produto?.marca && (data.marcas ?? []).length > 0) {
        const bate = data.marcas.find((m: Marca) => m.original_brand_name.toLowerCase() === produto.marca.toLowerCase())
        if (bate) setBrandId(String(bate.brand_id))
      }
      return { atributos: data.atributos ?? [], marcas: data.marcas ?? [] }
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao buscar atributos')
      return null
    } finally {
      setCarregandoAtributos(false)
    }
  }

  // Um clique só: se ainda não tem categoria-folha, deixa a IA navegar a
  // árvore de categorias nível a nível; depois pede descrição/atributos/marca
  // sugeridos. Tudo continua editável — a IA nunca envia o anúncio sozinha.
  async function preencherComIA() {
    if (!canalAtivo || !produto) return
    setPreenchendoIA(true); setErro('')
    try {
      let categoriaPathAtual = caminhoCategoria.map(c => c.original_category_name).join(' › ')
      let atributosAtuais = atributos
      let marcasAtuais = marcas

      // Aviso de categoria é acumulado, não interrompe: descrição e título não
      // dependem de ter categoria-folha resolvida, e antes um tropeço aqui
      // fazia o botão inteiro voltar sem preencher nada.
      let avisoCategoria = ''

      if (!categoriaFolha) {
        const resp = await fetch('/api/marketplace/shopee/ia-sugerir-categoria', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId: canalAtivo.id, produtoNome: produto.nome, produtoMarca: produto.marca, produtoCategoria: produto.categoria }),
        })
        const data = await resp.json()
        if (!data.ok) {
          avisoCategoria = data.erro ?? 'Erro ao sugerir categoria com IA'
        } else if (!data.caminho || data.caminho.length === 0) {
          avisoCategoria = 'A IA não conseguiu sugerir uma categoria pra esse produto — escolha manualmente acima.'
        } else {
          setOpcoesPorNivel(data.opcoesPorNivel)
          setCaminhoCategoria(data.caminho)
          setOrigemCategoria(null) // categoria escolhida pela IA — não é "lembrada" nem "deduzida" por palavras
          categoriaPathAtual = data.caminho.map((c: Categoria) => c.original_category_name).join(' › ')

          if (!data.resolvidoAteFolha) {
            avisoCategoria = 'A IA chegou até ' + categoriaPathAtual + ' mas não fechou numa categoria final — continue escolhendo a partir daí.'
          } else {
            const folha = data.caminho[data.caminho.length - 1]
            const carregado = await carregarAtributosEMarcas(folha.category_id)
            if (carregado) {
              atributosAtuais = carregado.atributos
              marcasAtuais = carregado.marcas
            }
          }
        }
      }

      const respConteudo = await fetch('/api/marketplace/shopee/ia-gerar-conteudo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produtoNome: produto.nome, produtoMarca: produto.marca, categoriaPath: categoriaPathAtual,
          atributos: atributosAtuais, marcas: marcasAtuais,
        }),
      })
      const dataConteudo = await respConteudo.json()
      if (!dataConteudo.ok) {
        setErro([avisoCategoria, dataConteudo.erro ?? 'Erro ao gerar conteúdo com IA'].filter(Boolean).join(' · '))
        return
      }

      if (dataConteudo.descricao) setDescricao(dataConteudo.descricao)
      if (dataConteudo.atributos && Object.keys(dataConteudo.atributos).length > 0) {
        setValoresAtributos(prev => {
          const novo = { ...prev }
          for (const [attrId, valor] of Object.entries(dataConteudo.atributos)) novo[Number(attrId)] = valor as any
          return novo
        })
      }
      if (dataConteudo.brandId != null) setBrandId(String(dataConteudo.brandId))
      if (avisoCategoria) setErro(avisoCategoria)
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao usar IA')
    } finally {
      setPreenchendoIA(false)
    }
  }

  // Canais de logística — não dependem de categoria, carrega uma vez.
  useEffect(() => {
    if (!produto || !canalAtivo) return
    const sb2 = fetch('/api/marketplace/shopee/canais-logistica', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canalId: canalAtivo.id }),
    }).then(r => r.json()).then(data => {
      if (data.ok) {
        setCanaisLogistica(data.canais)
        setLogisticaSelecionada(new Set((data.canais as CanalLogistica[]).filter(c => c.enabled).map(c => c.logistic_id)))
      }
    }).catch(() => {})
    return () => { void sb2 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produto, canalAtivo])

  function toggleLogistica(id: number) {
    setLogisticaSelecionada(prev => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id); else novo.add(id)
      return novo
    })
  }

  const atributosObrigatoriosFaltando = atributos.filter(a => {
    if (!a.is_mandatory) return false
    const v = valoresAtributos[a.attribute_id]
    return !v || (v.valueId == null && !v.texto?.trim())
  })

  const podeEnviar = !!canalAtivo && !!produto && !!categoriaFolha && titulo.trim() && Number(preco) > 0
    && estoque !== '' && Number(peso) > 0 && atributosObrigatoriosFaltando.length === 0
    && imagens.length > 0

  async function enviar() {
    if (!podeEnviar || !canalAtivo) return
    setSalvando(true); setErro('')
    try {
      const resp = await fetch('/api/marketplace/shopee/criar-anuncio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canalId: canalAtivo.id, produtoId: produto.id, categoryId: categoriaFolha!.category_id,
          categoriaIds: caminhoCategoria.map(c => c.category_id),
          titulo: titulo.trim(), descricao: descricao.trim(), preco: Number(preco), estoque: Number(estoque),
          peso: Number(peso), comprimento: comprimento || undefined, largura: largura || undefined, altura: altura || undefined,
          brandId: brandId || undefined, brandNome: brandId ? marcas.find(m => String(m.brand_id) === brandId)?.original_brand_name : undefined,
          atributos: atributos
            .filter(a => valoresAtributos[a.attribute_id])
            .map(a => ({ attribute_id: a.attribute_id, value_id: valoresAtributos[a.attribute_id].valueId, texto: valoresAtributos[a.attribute_id].texto })),
          canaisLogisticaHabilitados: Array.from(logisticaSelecionada),
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
            <h2 className="text-lg font-semibold text-gray-900">Criar anúncio na Shopee</h2>
            {canalAtivo && <p className="text-xs text-gray-400">{canalAtivo.nome}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {!canalAtivo && canais && canais.length > 1 ? (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Escolha a loja Shopee</p>
              <select value={canalEscolhidoId} onChange={e => setCanalEscolhidoId(e.target.value)} autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                <option value="">Selecione...</option>
                {canais.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          ) : resultado ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-4">
              <p className="text-sm font-medium text-emerald-800">✓ Anúncio criado na Shopee (item {resultado.itemId})</p>
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
                  <p className="text-xs font-medium text-gray-500 mb-2">Imagens do anúncio ({imagens.length}/9) *</p>
                  {imagens.length === 0 && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                      ⚠ Esse produto não tem nenhuma imagem cadastrada — a Shopee exige pelo menos uma. Adicione abaixo.
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
                    {imagens.length < 9 && (
                      <label className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 cursor-pointer text-xl">
                        {uploadandoImg ? '…' : '+'}
                        <input type="file" accept="image/*" multiple className="hidden" disabled={uploadandoImg} onChange={handleUploadImagens} />
                      </label>
                    )}
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

              {produto && canalAtivo && (
                <button onClick={preencherComIA} disabled={preenchendoIA}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 border border-violet-200 text-violet-700 text-sm font-medium rounded-lg transition-colors">
                  {preenchendoIA
                    ? '✨ Pensando...'
                    : categoriaFolha ? '✨ Preencher descrição e atributos com IA' : '✨ Preencher com IA (categoria, descrição e atributos)'}
                </button>
              )}

              {produto && (
                <>
                  {/* Categoria em cascata */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">Categoria na Shopee</p>
                    <div className="space-y-2">
                      {opcoesPorNivel.map((opcoes, nivel) => (
                        <select key={nivel} value={caminhoCategoria[nivel]?.category_id ?? ''} onChange={e => escolherCategoria(nivel, e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                          <option value="">{nivel === 0 ? 'Selecione a categoria...' : 'Selecione a subcategoria...'}</option>
                          {opcoes.map(c => <option key={c.category_id} value={c.category_id}>{c.original_category_name}</option>)}
                        </select>
                      ))}
                    </div>
                    {carregandoCategorias && <p className="text-xs text-gray-400 mt-1">Carregando...</p>}
                    {categoriaFolha && (
                      <p className="text-xs text-emerald-600 mt-1">✓ {caminhoCategoria.map(c => c.original_category_name).join(' › ')}</p>
                    )}
                    {categoriaFolha && origemCategoria === 'recomendada' && (
                      <p className="text-xs text-gray-400 mt-0.5">✨ recomendada pela própria Shopee com base no título — confira antes de publicar</p>
                    )}
                    {categoriaFolha && origemCategoria === 'lembrada' && (
                      <p className="text-xs text-gray-400 mt-0.5">📌 pré-selecionada com base num anúncio anterior — confira antes de publicar</p>
                    )}
                    {categoriaFolha && origemCategoria === 'deduzida' && (
                      <p className="text-xs text-gray-400 mt-0.5">🔎 sugerida por palavras-chave do produto — confira antes de publicar</p>
                    )}
                  </div>

                  {carregandoAtributos && <p className="text-xs text-gray-400">Carregando atributos da categoria...</p>}

                  {/* Atributos */}
                  {!carregandoAtributos && categoriaFolha && atributosCarregados && atributos.length === 0 && (
                    <p className="text-xs text-gray-400">Esta categoria não exige atributos específicos na Shopee.</p>
                  )}
                  {atributos.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-2">Atributos da categoria</p>
                      <div className="space-y-3">
                        {atributos.map(a => (
                          <div key={a.attribute_id}>
                            <label className="block text-xs text-gray-600 mb-1">
                              {a.attribute_name} {a.is_mandatory && <span className="text-red-500">*</span>}
                            </label>
                            {a.attribute_value_list.length > 0 ? (
                              <select
                                value={valoresAtributos[a.attribute_id]?.valueId ?? ''}
                                onChange={e => setValoresAtributos(prev => ({ ...prev, [a.attribute_id]: { valueId: Number(e.target.value) || undefined } }))}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                                <option value="">Selecione...</option>
                                {a.attribute_value_list.map(v => <option key={v.value_id} value={v.value_id}>{v.original_value_name}</option>)}
                              </select>
                            ) : (
                              <input
                                value={valoresAtributos[a.attribute_id]?.texto ?? ''}
                                onChange={e => setValoresAtributos(prev => ({ ...prev, [a.attribute_id]: { texto: e.target.value } }))}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Marca */}
                  {marcas.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Marca</label>
                      <select value={brandId} onChange={e => setBrandId(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                        <option value="">— Sem marca —</option>
                        {marcas.map(m => <option key={m.brand_id} value={m.brand_id}>{m.original_brand_name}</option>)}
                      </select>
                      <p className="text-xs text-gray-400 mt-1">Algumas categorias exigem marca — se a Shopee recusar sem marca, escolha uma da lista.</p>
                    </div>
                  )}

                  {/* Título / descrição */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Título do anúncio *</label>
                    <input value={titulo} onChange={e => setTitulo(e.target.value)} maxLength={120}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Descrição</label>
                    <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={4}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  </div>

                  {/* Preço / estoque */}
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

                  {/* Peso / dimensões */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">Peso e dimensões do pacote</p>
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-1">Peso (kg) *</label>
                        <input type="number" step="0.01" value={peso} onChange={e => setPeso(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-blue-500" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-1">Compr. (cm)</label>
                        <input type="number" value={comprimento} onChange={e => setComprimento(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-blue-500" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-1">Larg. (cm)</label>
                        <input type="number" value={largura} onChange={e => setLargura(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-blue-500" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-1">Alt. (cm)</label>
                        <input type="number" value={altura} onChange={e => setAltura(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-blue-500" />
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Ficam salvos no produto pra próxima vez.</p>
                  </div>

                  {/* Logística */}
                  {canaisLogistica.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-2">Canais de envio</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {canaisLogistica.map(c => (
                          <label key={c.logistic_id} className="flex items-center gap-2 text-sm text-gray-700">
                            <input type="checkbox" checked={logisticaSelecionada.has(c.logistic_id)} onChange={() => toggleLogistica(c.logistic_id)}
                              className="w-4 h-4 accent-blue-600" />
                            {c.logistic_name}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
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
              {salvando ? 'Publicando...' : 'Publicar na Shopee'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
