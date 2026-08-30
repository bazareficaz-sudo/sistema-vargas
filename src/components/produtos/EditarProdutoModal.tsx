'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { calcularKit, recalcularKitsQueUsam } from '@/lib/produtos/kit'
import { registrarMovimentoEstoque } from '@/lib/produtos/movimentacao'
import { faixasDoProduto } from '@/lib/produtos/promocao'
import { sincronizarProdutoVinculado } from '@/lib/produtos/vinculo'
import VisualizadorImagem from './VisualizadorImagem'
import EnviarImagensWhatsappModal from './EnviarImagensWhatsappModal'
import { botao } from '@/components/ui/botao'
import { gerarEanInternoUnico } from '@/lib/produtos/ean'
import { usePermissao } from '@/contexts/PlanContext'
import ImprimirEtiquetaModal from '@/components/etiquetas/ImprimirEtiquetaModal'

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
  categoria: string | null; subcategoria?: string | null; marca: string | null
  estoque: number; estoque_minimo: number
  ativo: boolean; disponivel_pdv: boolean; permite_fracao: boolean
  ncm: string | null; cest?: string | null; tipo: string
  markup?: number | null
  preco_promocional?: number | null
  promocao_inicio?: string | null
  promocao_fim?: string | null
  promocao_ativa?: boolean
  precos_quantidade?: unknown
  codigo_fornecedor?: string | null
  ibs_cst?: string | null
  ibs_cclasstrib?: string | null
  ibs_aliquota?: number | null
  cbs_aliquota?: number | null
  monitorar?: boolean
  descricao_marketplace?: string | null
  obs_interna?: string | null
  peso_kg?: number | null
  altura_cm?: number | null
  largura_cm?: number | null
  comprimento_cm?: number | null
  cfop?: string | null
  icms_cst?: string | null
  icms_origem?: number | null
  csosn?: string | null
  icms_percentual?: number | null
  pis_cst?: string | null
  pis_percentual?: number | null
  cofins_cst?: string | null
  cofins_percentual?: number | null
  ipi_percentual?: number | null
}

type KitItem = { id?: string; produto_id: string; nome: string; unidade: string; quantidade: number; controla_estoque: boolean }

type ProdutoImagem = { id: string; url: string; ordem: number; principal: boolean; titulo?: string | null }

type AnuncioVinculado = {
  id: string; canalNome: string; plataforma: string; titulo: string
  variacaoNome?: string | null; preco: number; status: string; urlAnuncio: string | null
  // Canal e anúncio-pai são o que a API precisa para pausar. Numa variação,
  // quem pausa é o anúncio dono dela — o marketplace não pausa variação
  // isolada, e mandar o id da variação daria erro sem explicação.
  canalId: string | null
  anuncioId: string
  // Id do anúncio DENTRO da plataforma. É o que as rotas de sincronização
  // pedem — o id daqui não significa nada para o marketplace.
  idExterno: string | null
}

type Props = {
  produto: Produto | null; onClose: () => void; onSaved: () => void; empresaId: string
  // Aba em que o modal abre. Existe para quem chega de fora com um problema
  // específico — a nota recusada por falta de NCM cai direto no fiscal, em
  // vez de obrigar a procurar a aba certa.
  abaInicial?: Aba
}

type Aba = 'geral' | 'preco' | 'promocao' | 'imagens' | 'kit' | 'fiscal' | 'anuncios'

const PLATAFORMA_LABEL: Record<string, string> = {
  mercadolivre: 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon', magalu: 'Magalu', outro: 'Outro',
}

const STATUS_ANUNCIO: Record<string, { label: string; cls: string }> = {
  ativo:     { label: 'Ativo',     cls: 'bg-green-100 text-green-700' },
  pausado:   { label: 'Pausado',   cls: 'bg-amber-100 text-amber-700' },
  rascunho:  { label: 'Rascunho',  cls: 'bg-gray-100 text-gray-500' },
  encerrado: { label: 'Encerrado', cls: 'bg-gray-100 text-gray-500' },
  erro:      { label: 'Erro',      cls: 'bg-red-100 text-red-600' },
}

export default function EditarProdutoModal({ produto, onClose, onSaved, empresaId, abaInicial }: Props) {
  const [form, setForm] = useState<Produto | null>(null)
  const [aba, setAba] = useState<Aba>('geral')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [categorias, setCategorias] = useState<{ id: string; nome: string; pai_id: string | null }[]>([])
  const [criandoSub, setCriandoSub] = useState(false)
  const [marcas, setMarcas] = useState<{ id: string; nome: string }[]>([])
  const [kitItens, setKitItens] = useState<KitItem[]>([])
  const [recalculandoKit, setRecalculandoKit] = useState(false)
  const [buscaKit, setBuscaKit] = useState('')
  const [resultadosKit, setResultadosKit] = useState<Produto[]>([])
  const [promocaoInfinita, setPromocaoInfinita] = useState(false)
  // Faixas de atacado. Sempre três linhas na tela, mesmo vazias — é mais fácil
  // preencher a segunda quando ela já está ali do que descobrir um botão de
  // "adicionar faixa". Linha em branco não é gravada.
  const [faixas, setFaixas] = useState<{ qtd: string; preco: string }[]>(
    [{ qtd: '', preco: '' }, { qtd: '', preco: '' }, { qtd: '', preco: '' }])
  const [imprimindoEtiqueta, setImprimindoEtiqueta] = useState(false)
  const [preenchendoIA, setPreenchendoIA] = useState(false)
  const [mensagemIA, setMensagemIA] = useState('')
  const [tituloSugerido, setTituloSugerido] = useState('')
  const [anunciosVinculados, setAnunciosVinculados] = useState<AnuncioVinculado[]>([])
  const [carregandoAnuncios, setCarregandoAnuncios] = useState(false)
  // Quem nao tem permissao ve o campo travado com o motivo, em vez de
  // digitar, salvar e tomar uma recusa do banco.
  const podeEditarProdutos = usePermissao('editar_produtos')
  const podeEditarPrecos = usePermissao('editar_precos')
  const [gerandoEan, setGerandoEan] = useState(false)
  const [eanGerado, setEanGerado] = useState(false)

  // Imagens
  const [imagens, setImagens] = useState<ProdutoImagem[]>([])
  const [uploadando, setUploadando] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [adicionandoUrl, setAdicionandoUrl] = useState(false)
  const [erroImg, setErroImg] = useState('')

  // Visualizador em tela cheia, seleção para envio e título por imagem.
  const [visualizando, setVisualizando] = useState<number | null>(null)
  const [imgSelecionadas, setImgSelecionadas] = useState<Set<string>>(new Set())
  const [enviandoWhatsapp, setEnviandoWhatsapp] = useState(false)
  // Títulos em edição, por id. Só vão ao banco quando o produto é salvo —
  // gravar a cada tecla encheria o banco de escrita por nada.
  const [titulosImg, setTitulosImg] = useState<Record<string, string>>({})

  function tituloDe(img: { id: string; titulo?: string | null }) {
    return titulosImg[img.id] ?? img.titulo ?? ''
  }
  function alternarSelecaoImg(id: string) {
    setImgSelecionadas(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  // Grava os títulos alterados. Chamado ao abrir o envio e ao salvar o
  // produto: enviar uma legenda que ainda só existe na tela seria mentira.
  async function salvarTitulosImagens() {
    const ids = Object.keys(titulosImg)
    if (ids.length === 0) return
    const sb = createClient()
    for (const id of ids) {
      await sb.from('produto_imagens').update({ titulo: titulosImg[id].trim() || null }).eq('id', id)
    }
    setImagens(prev => prev.map(i => ids.includes(i.id) ? { ...i, titulo: titulosImg[i.id].trim() || null } : i))
    setTitulosImg({})
  }
  const fileInputRef = useRef<HTMLInputElement>(null)

  const buscarRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const sb = createClient()

  // Colunas que este modal grava e que nem toda tela carrega antes de abrir.
  // Se alguma faltar no objeto recebido, o formulário a trataria como vazia e
  // o "Salvar alterações" a gravaria como null — apagando em silêncio peso,
  // medidas, dados fiscais, código do fornecedor. Por isso o modal confere e,
  // se faltar, busca a linha inteira ele mesmo, em vez de confiar em quem o
  // chamou.
  const COLUNAS_SO_DO_MODAL = ['peso_kg', 'csosn', 'codigo_fornecedor', 'subcategoria', 'precos_quantidade']

  useEffect(() => {
    if (produto) {
      // Estado derivado do produto — chamado de novo quando a linha completa
      // chega, senão as faixas de quantidade e a data de promoção ficariam
      // com o que veio da lista (ou seja, vazias).
      const aplicar = (p: any) => {
        setForm({ ...p })
        setPromocaoInfinita(!p.promocao_fim)
        const salvas = faixasDoProduto(p)
        setFaixas([0, 1, 2].map(i => salvas[i]
          ? { qtd: String(salvas[i].qtd), preco: String(salvas[i].preco) }
          : { qtd: '', preco: '' }))
      }
      aplicar(produto)

      const faltando = COLUNAS_SO_DO_MODAL.filter(c => !(c in produto))
      if (faltando.length > 0) {
        sb.from('produtos').select('*').eq('id', produto.id).maybeSingle()
          .then(({ data }: any) => { if (data && data.id === produto.id) aplicar(data) })
      }
      setAba(abaInicial ?? 'geral')
      if (produto.tipo === 'kit') carregarKitItens(produto.id)
      carregarImagens(produto.id)
      carregarAnunciosVinculados(produto.id)
    }
  }, [produto])

  async function carregarAnunciosVinculados(produtoId: string) {
    setCarregandoAnuncios(true)
    const [{ data: diretos }, { data: variacoes }] = await Promise.all([
      sb.from('marketplace_anuncios')
        .select('id, canal_id, titulo, preco_venda, status, url_anuncio, id_externo, marketplace_canais(nome, plataforma)')
        .eq('produto_id', produtoId).eq('tem_variacao', false),
      sb.from('marketplace_anuncio_variacoes')
        .select('id, nome_variacao, preco, anuncio_id, marketplace_anuncios!inner(id, canal_id, titulo, status, url_anuncio, id_externo, marketplace_canais(nome, plataforma))')
        .eq('produto_id', produtoId),
    ])

    const lista: AnuncioVinculado[] = []
    for (const a of (diretos ?? []) as any[]) {
      const canal = Array.isArray(a.marketplace_canais) ? a.marketplace_canais[0] : a.marketplace_canais
      lista.push({
        id: a.id, canalNome: canal?.nome ?? '—', plataforma: canal?.plataforma ?? '',
        titulo: a.titulo, preco: a.preco_venda ?? 0, status: a.status, urlAnuncio: a.url_anuncio,
        canalId: a.canal_id ?? null, anuncioId: a.id, idExterno: a.id_externo ?? null,
      })
    }
    for (const v of (variacoes ?? []) as any[]) {
      const anuncio = Array.isArray(v.marketplace_anuncios) ? v.marketplace_anuncios[0] : v.marketplace_anuncios
      const canal = anuncio ? (Array.isArray(anuncio.marketplace_canais) ? anuncio.marketplace_canais[0] : anuncio.marketplace_canais) : null
      lista.push({
        id: v.id, canalNome: canal?.nome ?? '—', plataforma: canal?.plataforma ?? '',
        titulo: anuncio?.titulo ?? '—', variacaoNome: v.nome_variacao,
        preco: v.preco ?? 0, status: anuncio?.status ?? 'rascunho', urlAnuncio: anuncio?.url_anuncio ?? null,
        canalId: anuncio?.canal_id ?? null, anuncioId: anuncio?.id ?? v.anuncio_id,
        idExterno: anuncio?.id_externo ?? null,
      })
    }
    setAnunciosVinculados(lista)
    setCarregandoAnuncios(false)
  }

  const [mexendoAnuncios, setMexendoAnuncios] = useState(false)
  const [resumoAnuncios, setResumoAnuncios] = useState('')

  // Pausar ou reativar anúncios deste produto em TODOS os canais de uma vez.
  //
  // Antes era preciso entrar canal por canal. Como cada plataforma tem sua
  // própria rota e cada loja seu próprio token, o trabalho aqui é agrupar
  // por canal e disparar uma chamada por grupo — a tela junta o que a API
  // obriga a separar.
  //
  // Variações de um mesmo anúncio viram um id só: o marketplace pausa o
  // anúncio inteiro, não a variação.
  async function mudarStatusAnuncios(acao: 'pausar' | 'ativar', alvos: AnuncioVinculado[]) {
    const comCanal = alvos.filter(a => a.canalId)
    if (comCanal.length === 0) return
    setMexendoAnuncios(true); setResumoAnuncios('')

    const porCanal = new Map<string, { plataforma: string; ids: Set<string> }>()
    for (const a of comCanal) {
      const grupo = porCanal.get(a.canalId!) ?? { plataforma: a.plataforma, ids: new Set<string>() }
      grupo.ids.add(a.anuncioId)
      porCanal.set(a.canalId!, grupo)
    }

    let ok = 0
    const falhas: string[] = []
    for (const [canalId, grupo] of porCanal) {
      const rota = grupo.plataforma === 'shopee'
        ? '/api/marketplace/shopee/pausar-ativar'
        : grupo.plataforma === 'mercadolivre'
          ? '/api/marketplace/mercadolivre/pausar-ativar'
          : null
      if (!rota) { falhas.push(`${grupo.plataforma || 'canal desconhecido'}: sem integração para pausar`); continue }
      try {
        const d = await fetch(rota, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId, anuncioIds: [...grupo.ids], acao }),
        }).then(r => r.json())
        if (d.ok) ok += grupo.ids.size
        else falhas.push(d.erro ?? 'falha desconhecida')
      } catch (e: any) {
        falhas.push(e.message)
      }
    }

    const verbo = acao === 'pausar' ? 'pausado(s)' : 'reativado(s)'
    setResumoAnuncios(
      `${ok} anúncio(s) ${verbo}.` + (falhas.length > 0 ? ` Falhas: ${falhas.join('; ')}` : ''))
    setMexendoAnuncios(false)
    if (produto) carregarAnunciosVinculados(produto.id)
  }

  // Relê cada anúncio na plataforma e regrava o espelho.
  //
  // A coluna "Situação" mostra o que `marketplace_anuncios` guarda, e essa
  // tabela só é atualizada pela varredura (a cada 20 min) ou por quem
  // sincroniza à mão. Um anúncio pausado no painel do marketplace continua
  // aparecendo como Ativo aqui até isso acontecer — e "pausar/reativar" em
  // cima de uma situação errada tem resultado imprevisível.
  //
  // Por anúncio, não por variação: variações da mesma peça compartilham o
  // anúncio-pai, e sincronizá-lo uma vez já traz todas.
  async function puxarSituacaoDosCanais() {
    const porAnuncio = new Map<string, { plataforma: string; canalId: string; idExterno: string }>()
    for (const a of anunciosVinculados) {
      if (!a.canalId || !a.idExterno || porAnuncio.has(a.anuncioId)) continue
      porAnuncio.set(a.anuncioId, { plataforma: a.plataforma, canalId: a.canalId, idExterno: a.idExterno })
    }

    const semId = anunciosVinculados.filter(a => !a.idExterno).length
    if (porAnuncio.size === 0) {
      setResumoAnuncios(semId > 0
        ? 'Nenhum anúncio tem ID no canal — estes foram cadastrados à mão e nunca vieram de sincronização.'
        : 'Nenhum anúncio para consultar.')
      return
    }

    setMexendoAnuncios(true); setResumoAnuncios('')
    let ok = 0
    const falhas: string[] = []
    for (const [, item] of porAnuncio) {
      const rota = item.plataforma === 'shopee'
        ? '/api/marketplace/shopee/sync-item'
        : item.plataforma === 'mercadolivre'
          ? '/api/marketplace/mercadolivre/sync-item'
          : null
      if (!rota) { falhas.push(`${item.plataforma || 'canal desconhecido'}: sem integração para consultar`); continue }
      try {
        const d = await fetch(rota, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId: item.canalId, idExterno: item.idExterno }),
        }).then(r => r.json())
        if (d.ok) ok++
        else falhas.push(d.erro ?? 'falha desconhecida')
      } catch (e: any) {
        falhas.push(e.message)
      }
    }

    setResumoAnuncios(
      `${ok} anúncio(s) relido(s) na plataforma.`
      + (semId > 0 ? ` ${semId} sem ID no canal, fora da consulta.` : '')
      + (falhas.length > 0 ? ` Falhas: ${falhas.join('; ')}` : ''))
    setMexendoAnuncios(false)
    if (produto) carregarAnunciosVinculados(produto.id)
  }

  // Manda o estoque do ERP para os anúncios deste produto, agora.
  //
  // A conta de QUAL número enviar é do servidor (`estoqueDoSistema`), a mesma
  // que a fila automática usa — a tela não recalcula nada por conta própria,
  // senão os dois caminhos divergem e ninguém sabe qual está certo.
  async function enviarEstoqueAosCanais() {
    if (!produto) return
    setMexendoAnuncios(true); setResumoAnuncios('')
    try {
      const d = await fetch('/api/marketplaces/produto/enviar-estoque', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtoId: produto.id }),
      }).then(r => r.json())

      if (!d.ok) {
        setResumoAnuncios(`Não foi possível enviar: ${d.erro ?? 'falha desconhecida'}`)
      } else {
        // O detalhe de cada anúncio vai junto: "3 enviados" não responde
        // por que os outros dois ficaram de fora, e essa é a pergunta.
        const detalhes = (d.resultados ?? [])
          .filter((r: any) => r.situacao !== 'enviado')
          .map((r: any) => `${r.canalNome}: ${r.detalhe}`)
        setResumoAnuncios(
          `Estoque ${d.estoque} (${d.origem}) enviado a ${d.enviados} anúncio(s).`
          + (detalhes.length > 0 ? ` ${detalhes.join(' · ')}` : ''))
      }
    } catch (e: any) {
      setResumoAnuncios(`Não foi possível enviar: ${e.message}`)
    }
    setMexendoAnuncios(false)
    carregarAnunciosVinculados(produto.id)
  }

  useEffect(() => {
    Promise.all([
      sb.from('categorias').select('id, nome, pai_id').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      sb.from('marcas').select('id, nome').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
    ]).then(([cats, mks]) => {
      setCategorias(cats.data ?? [])
      setMarcas(mks.data ?? [])
    })
  }, [empresaId])

  // Produto gravado com uma categoria que hoje é SUBcategoria de outra — o que
  // acontece assim que o gestor organiza a árvore e move, por exemplo,
  // TORNEIRAS para dentro de MATERIAL HIDRÁULICO. A tela passa a exibir (e a
  // gravar) nos dois níveis, em vez de mostrar a subcategoria como se fosse
  // categoria raiz e não achá-la na lista.
  useEffect(() => {
    if (!form?.categoria || categorias.length === 0) return
    const achada = categorias.find(c => c.nome === form.categoria)
    if (!achada?.pai_id) return
    const pai = categorias.find(c => c.id === achada.pai_id)
    if (!pai) return
    setForm(prev => (prev && prev.categoria === achada.nome
      ? { ...prev, categoria: pai.nome, subcategoria: prev.subcategoria ?? achada.nome }
      : prev))
  }, [categorias, form?.categoria])

  async function carregarImagens(produtoId: string) {
    const { data } = await sb
      .from('produto_imagens')
      .select('id, url, ordem, principal, titulo')
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
      .select('id, produto_id, quantidade, controla_estoque, produtos!produto_id(nome, unidade)')
      .eq('kit_id', kitId)
    if (error) { setErro('Erro ao carregar componentes do kit: ' + error.message); return }
    setKitItens((data ?? []).map((d: any) => ({
      id: d.id,
      produto_id: d.produto_id,
      nome: d.produtos?.nome ?? '',
      unidade: d.produtos?.unidade ?? 'UN',
      quantidade: d.quantidade,
      controla_estoque: d.controla_estoque ?? true,
    })))
  }

  function campo<K extends keyof Produto>(field: K, value: Produto[K]) {
    setForm(prev => prev ? { ...prev, [field]: value } : prev)
  }

  // Produto sem código de barras do fabricante: gera um de uso interno em vez
  // de deixar o campo vazio (sem ele, etiqueta e leitura no PDV não funcionam).
  async function gerarEan() {
    setGerandoEan(true)
    try {
      const codigo = await gerarEanInternoUnico(sb, empresaId)
      campo('ean', codigo)
      setEanGerado(true)
    } finally {
      setGerandoEan(false)
    }
  }

  // `escopo` decide quais campos a resposta da IA pode tocar. 'fiscal' existe
  // porque quem está na aba Fiscal quer resolver NCM/CFOP/CST — e não que a
  // IA mexa em categoria, marca, descrição ou dimensões de passagem.
  async function preencherComIA(escopo: 'tudo' | 'fiscal' = 'tudo') {
    if (!form || !form.nome.trim()) return
    const soFiscal = escopo === 'fiscal'
    setPreenchendoIA(true); setErro(''); setMensagemIA(''); setTituloSugerido('')
    try {
      const res = await fetch('/api/produtos/ia-enriquecer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Manda também o que já está preenchido na aba Fiscal. O CEST sai da
        // tabela oficial a partir do NCM, e CFOP/CSOSN/CST de ST já gravados
        // dizem que o produto tem substituição tributária — sem isso, a IA só
        // tem o nome e responde null, que era o que acontecia.
        body: JSON.stringify({
          produtoNome: form.nome,
          produtoEan: form.ean,
          produtoNcm: form.ncm,
          produtoCfop: form.cfop,
          produtoCsosn: form.csosn,
          produtoIcmsCst: form.icms_cst,
        }),
      })
      const data = await res.json()
      if (!data.ok) { setErro(data.erro ?? 'Erro ao consultar a IA'); return }

      // Título nunca sobrescreve sozinho (nome sempre tem conteúdo, não é um
      // "campo vazio") — só aparece como sugestão com botão pra aplicar.
      if (data.titulo_sugerido && !soFiscal) setTituloSugerido(data.titulo_sugerido)

      let preenchidos = 0
      setForm(prev => {
        if (!prev) return prev
        const novo = { ...prev }
        if (!soFiscal && !novo.categoria && data.categoria) { novo.categoria = data.categoria; preenchidos++ }
        if (!soFiscal && !novo.marca && data.marca) { novo.marca = data.marca; preenchidos++ }
        if (!novo.ncm && data.ncm) { novo.ncm = data.ncm; preenchidos++ }
        if (!novo.cest && data.cest) { novo.cest = data.cest; preenchidos++ }
        if (!soFiscal && !novo.descricao_marketplace && data.descricao_marketplace) { novo.descricao_marketplace = data.descricao_marketplace; preenchidos++ }
        if (!soFiscal && novo.peso_kg == null && data.peso_kg != null) { novo.peso_kg = data.peso_kg; preenchidos++ }
        if (!soFiscal && novo.altura_cm == null && data.altura_cm != null) { novo.altura_cm = data.altura_cm; preenchidos++ }
        if (!soFiscal && novo.largura_cm == null && data.largura_cm != null) { novo.largura_cm = data.largura_cm; preenchidos++ }
        if (!soFiscal && novo.comprimento_cm == null && data.comprimento_cm != null) { novo.comprimento_cm = data.comprimento_cm; preenchidos++ }

        // Aba Fiscal. CFOP/CST/CSOSN/PIS/COFINS vêm do regime da empresa
        // (determinístico, não é palpite da IA); origem, alíquotas e IBS/CBS
        // vêm da IA. Só preenche o que está vazio — nunca sobrescreve o que
        // a contabilidade já ajustou à mão.
        const textoFiscal: (keyof typeof novo)[] = ['cfop', 'csosn', 'icms_cst', 'pis_cst', 'cofins_cst', 'ibs_cst', 'ibs_cclasstrib']
        for (const c of textoFiscal) {
          if (!novo[c] && data[c]) { (novo as any)[c] = data[c]; preenchidos++ }
        }
        const numFiscal: (keyof typeof novo)[] = ['icms_origem', 'icms_percentual', 'pis_percentual', 'cofins_percentual', 'ibs_aliquota', 'cbs_aliquota']
        for (const c of numFiscal) {
          if (novo[c] == null && data[c] != null) { (novo as any)[c] = data[c]; preenchidos++ }
        }
        return novo
      })
      // O CEST vazio tem dois motivos MUITO diferentes, e a tela precisa
      // distinguir: "este NCM nao esta na tabela de ST" e "nao deu para
      // consultar a tabela". Quando os dois aparecem iguais, um defeito de
      // infraestrutura passa por resposta fiscal — foi o que aconteceu com a
      // tabela CEST ausente do banco, e o que derrubou uma NFC-e depois.
      const avisoCest = data.cest_aviso
        ? `⚠ O CEST não foi preenchido porque a tabela oficial não pôde ser consultada `
          + `(${data.cest_aviso}). Isso NÃO quer dizer que o produto está sem substituição `
          + `tributária — quer dizer que o sistema não conseguiu conferir. `
        : ''

      setMensagemIA(avisoCest + (preenchidos > 0
        ? (soFiscal
            ? `✓ ${preenchidos} campo(s) fiscal(is) preenchido(s) — CONFIRA COM A CONTABILIDADE antes de salvar. NCM, CFOP, Origem e CST errados fazem a SEFAZ rejeitar a nota.`
            : `✓ ${preenchidos} campo(s) preenchido(s) pela IA — revise antes de salvar. Os dados fiscais estão na aba Fiscal e devem ser conferidos com a contabilidade.`)
        : 'A IA não encontrou sugestões novas — os campos já estavam preenchidos ou não há confiança suficiente.'))
    } catch {
      setErro('Erro ao consultar a IA — tente novamente.')
    } finally {
      setPreenchendoIA(false)
    }
  }

  function usarTituloSugerido() {
    campo('nome', tituloSugerido)
    setTituloSugerido('')
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

  // Recalcula custo/estoque a partir dos componentes atuais e já grava no
  // produto do kit — chamado depois de toda alteração de composição
  // (adicionar/remover/mudar quantidade), pra o kit nunca ficar desatualizado.
  async function recalcularEPersistirKit() {
    if (!form?.id) return
    const resultado = await calcularKit(sb, form.id)
    if (resultado) {
      setForm(prev => {
        if (!prev) return prev
        const mk = prev.markup ?? 0
        const venda = mk > 0 ? parseFloat((resultado.custo * (1 + mk / 100)).toFixed(2)) : prev.preco_venda
        return { ...prev, preco_custo: resultado.custo, estoque: resultado.estoque, preco_venda: venda }
      })
      await sb.from('produtos')
        .update({ preco_custo: resultado.custo, estoque: resultado.estoque, updated_at: new Date().toISOString() })
        .eq('id', form.id)
    }
  }

  async function adicionarKitItem(prod: Produto) {
    if (kitItens.find(k => k.produto_id === prod.id)) return
    const novoItem: KitItem = { produto_id: prod.id, nome: prod.nome, unidade: prod.unidade, quantidade: 1, controla_estoque: true }
    setKitItens(prev => [...prev, novoItem])
    setBuscaKit(''); setResultadosKit([])
    if (form?.id) {
      const { data, error } = await sb.from('kit_itens')
        .insert({ kit_id: form.id, produto_id: prod.id, quantidade: 1 })
        .select().single()
      if (error) { setErro('Erro ao salvar item do kit: ' + error.message); return }
      if (data) setKitItens(prev => prev.map(k => k.produto_id === prod.id ? { ...k, id: data.id } : k))
      await recalcularEPersistirKit()
    }
  }

  async function atualizarQtdKit(produtoId: string, quantidade: number) {
    setKitItens(prev => prev.map(k => k.produto_id === produtoId ? { ...k, quantidade } : k))
    if (form?.id) {
      await sb.from('kit_itens').update({ quantidade }).eq('kit_id', form.id).eq('produto_id', produtoId)
      await recalcularEPersistirKit()
    }
  }

  async function removerKitItem(produtoId: string) {
    setKitItens(prev => prev.filter(k => k.produto_id !== produtoId))
    if (form?.id) {
      await sb.from('kit_itens').delete().eq('kit_id', form.id).eq('produto_id', produtoId)
      await recalcularEPersistirKit()
    }
  }

  async function alternarControlaEstoqueKit(produtoId: string, controla: boolean) {
    setKitItens(prev => prev.map(k => k.produto_id === produtoId ? { ...k, controla_estoque: controla } : k))
    if (form?.id) {
      await sb.from('kit_itens').update({ controla_estoque: controla }).eq('kit_id', form.id).eq('produto_id', produtoId)
      await recalcularEPersistirKit()
    }
  }

  // Botão manual — útil se os componentes mudaram por fora (ex: outro
  // usuário editou o custo de um componente enquanto este modal estava
  // aberto). A automática acima já cobre o caso comum.
  async function recalcularKit() {
    setRecalculandoKit(true)
    await recalcularEPersistirKit()
    setRecalculandoKit(false)
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
    if (!form || !produto) return
    setSalvando(true); setErro('')
    // Títulos de imagem digitados nesta sessão vão junto no "Salvar
    // alterações" — o usuário não deveria precisar de dois salvamentos para
    // uma tela só.
    await salvarTitulosImagens()
    const isKit = form.tipo === 'kit'

    // Faixas de atacado: linha em branco some, faixa incompleta ou inválida
    // some junto — meia faixa gravada viraria preço zero numa venda. A ordem
    // por quantidade é garantida aqui, não na leitura.
    const faixasParaSalvar = faixas
      .map(f => ({ qtd: Math.trunc(Number(f.qtd)), preco: Number(f.preco) }))
      .filter(f => Number.isFinite(f.qtd) && f.qtd > 1 && Number.isFinite(f.preco) && f.preco > 0)
      .sort((a, b) => a.qtd - b.qtd)

    // Kits: nunca confia no que está no formulário pro custo/estoque — sempre
    // recalcula ao vivo a partir dos componentes atuais antes de gravar, pra
    // não persistir um valor obsoleto (ex: usuário editou a composição sem
    // clicar em "Recalcular").
    let precoCusto = form.preco_custo
    let estoque = form.estoque
    if (isKit) {
      const resultado = await calcularKit(sb, form.id)
      if (resultado) { precoCusto = resultado.custo; estoque = resultado.estoque }
    }
    const precoMudou = form.preco_venda !== produto.preco_venda || precoCusto !== produto.preco_custo
    // Promoção conta como mudança de preço pra sincronização: é ela que o
    // PDV cobra quando está ativa (ver vinculo.ts).
    const promocaoMudou = (form.preco_promocional ?? null) !== (produto.preco_promocional ?? null)
      || (form.promocao_ativa ?? false) !== (produto.promocao_ativa ?? false)
      || (form.promocao_inicio ?? null) !== (produto.promocao_inicio ?? null)
      || (form.promocao_fim ?? null) !== (produto.promocao_fim ?? null)

    const { error } = await sb.from('produtos').update({
      nome: form.nome,
      tipo: form.tipo,
      sku: form.sku || null,
      ean: form.ean || null,
      codigo_fornecedor: form.codigo_fornecedor || null,
      preco_venda: form.preco_venda,
      preco_custo: precoCusto,
      markup: isKit ? null : (form.markup ?? null),
      preco_promocional: form.preco_promocional ?? null,
      promocao_inicio: form.promocao_inicio ?? null,
      promocao_fim: promocaoInfinita ? null : (form.promocao_fim ?? null),
      promocao_ativa: form.promocao_ativa ?? false,
      precos_quantidade: faixasParaSalvar.length > 0 ? faixasParaSalvar : null,
      unidade: form.unidade,
      categoria: form.categoria || null,
      subcategoria: form.subcategoria || null,
      marca: form.marca || null,
      estoque,
      estoque_minimo: form.estoque_minimo,
      ativo: form.ativo,
      disponivel_pdv: form.disponivel_pdv,
      permite_fracao: form.permite_fracao,
      ncm: form.ncm || null,
      cest: form.cest || null,
      cfop: form.cfop || null,
      icms_cst: form.icms_cst || null,
      icms_origem: form.icms_origem ?? null,
      csosn: form.csosn || null,
      icms_percentual: form.icms_percentual ?? null,
      pis_cst: form.pis_cst || null,
      pis_percentual: form.pis_percentual ?? null,
      cofins_cst: form.cofins_cst || null,
      cofins_percentual: form.cofins_percentual ?? null,
      ipi_percentual: form.ipi_percentual ?? null,
      ibs_cst: form.ibs_cst || null,
      ibs_cclasstrib: form.ibs_cclasstrib || null,
      ibs_aliquota: form.ibs_aliquota ?? null,
      cbs_aliquota: form.cbs_aliquota ?? null,
      monitorar: form.monitorar ?? false,
      descricao_marketplace: form.descricao_marketplace || null,
      obs_interna: form.obs_interna || null,
      peso_kg: form.peso_kg ?? null,
      altura_cm: form.altura_cm ?? null,
      largura_cm: form.largura_cm ?? null,
      comprimento_cm: form.comprimento_cm ?? null,
      updated_at: new Date().toISOString(),
      ...(precoMudou ? { preco_atualizado_em: new Date().toISOString() } : {}),
    }).eq('id', form.id)
    if (error) { setSalvando(false); setErro(error.message); return }

    // Propaga campos de identidade pro produto vinculado numa empresa
    // parceira, se houver (nunca estoque/fiscal — ver vinculo.ts). Preço só
    // propaga se a parceria tiver "sincronizar preço" ligado.
    await sincronizarProdutoVinculado(sb, form.id, {
      nome: form.nome,
      descricao_marketplace: form.descricao_marketplace || null,
      categoria: form.categoria || null,
      subcategoria: form.subcategoria || null,
      marca: form.marca || null,
      ean: form.ean || null,
    }, (precoMudou || promocaoMudou) ? {
      ...(precoMudou ? {
        preco_venda: form.preco_venda,
        preco_custo: precoCusto,
        markup: isKit ? null : (form.markup ?? null),
      } : {}),
      ...(promocaoMudou ? {
        preco_promocional: form.preco_promocional ?? null,
        promocao_ativa: form.promocao_ativa ?? false,
        promocao_inicio: form.promocao_inicio ?? null,
        promocao_fim: promocaoInfinita ? null : (form.promocao_fim ?? null),
      } : {}),
    } : undefined)

    // Estoque editado direto no cadastro (não-kit — kit é recalculado a
    // partir dos componentes, não é uma edição deliberada do usuário) —
    // registra como ajuste manual pra aparecer no extrato de movimentação.
    if (!isKit && estoque !== produto.estoque) {
      await registrarMovimentoEstoque(sb, {
        empresaId, produtoId: form.id, produtoNome: form.nome,
        tipo: estoque > produto.estoque ? 'ajuste_entrada' : 'ajuste_saida',
        quantidade: Math.abs(estoque - produto.estoque),
        estoqueAnterior: produto.estoque, estoqueNovo: estoque,
        motivo: 'Editado no cadastro do produto', referenciaTipo: 'produto', referenciaId: form.id,
      })
    }

    if (form.tipo === 'kit' && kitItens.length > 0) {
      await sb.from('kit_itens').delete().eq('kit_id', form.id)
      const { error: kitError } = await sb.from('kit_itens').insert(
        kitItens.map(k => ({ kit_id: form.id, produto_id: k.produto_id, quantidade: k.quantidade, controla_estoque: k.controla_estoque }))
      )
      if (kitError) { setSalvando(false); setErro('Produto salvo, mas erro na composição: ' + kitError.message); return }
    }

    // Se este produto (não-kit) é componente de algum kit, o custo/estoque
    // pode ter mudado agora — propaga o recálculo pros kits que o usam.
    if (!isKit) await recalcularKitsQueUsam(sb, form.id)

    setSalvando(false)
    onSaved(); onClose()
  }

  if (!produto || !form) return null

  const abaAtiva  = 'border-b-2 border-blue-600 text-blue-600 font-medium'
  const abaInativa = 'border-b-2 border-transparent text-gray-500 hover:text-gray-700'

  const markupCalculado = form.preco_custo > 0 && form.preco_venda > 0
    ? (((form.preco_venda - form.preco_custo) / form.preco_custo) * 100) : 0

  const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  // ── Categoria → subcategoria ──
  // A tabela `categorias` sempre teve `pai_id`; o que faltava era o cadastro
  // do produto enxergar os dois níveis em vez de uma lista achatada.
  const categoriasRaiz = categorias.filter(c => !c.pai_id)
  const categoriaAtual = categoriasRaiz.find(c => c.nome === form.categoria) ?? null
  const subcategoriasDaCategoria = categoriaAtual
    ? categorias.filter(c => c.pai_id === categoriaAtual.id)
    : []

  /**
   * Cria uma subcategoria dentro da categoria escolhida, sem sair da tela.
   *
   * Existe porque o caminho contrário — abrir Cadastros → Categorias, criar,
   * voltar, reabrir o produto — é o que faz o operador desistir e deixar o
   * produto na categoria genérica.
   */
  async function criarSubcategoria() {
    if (!categoriaAtual) return
    const nome = prompt(`Nova subcategoria dentro de "${categoriaAtual.nome}":`)?.trim()
    if (!nome) return

    const jaExiste = categorias.find(c => c.pai_id === categoriaAtual.id && c.nome.toLowerCase() === nome.toLowerCase())
    if (jaExiste) { campo('subcategoria', jaExiste.nome); return }

    setCriandoSub(true)
    const { data, error } = await sb.from('categorias')
      .insert({ empresa_id: empresaId, nome, pai_id: categoriaAtual.id, ativo: true })
      .select('id, nome, pai_id').single()
    setCriandoSub(false)
    if (error) { setErro(`Não foi possível criar a subcategoria: ${error.message}`); return }
    setCategorias(prev => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)))
    campo('subcategoria', data.nome)
  }

  // ── Promoção: preço, desconto e markup são o mesmo número visto de três
  // ângulos. O preço é o que fica gravado; os outros dois são calculados a
  // partir dele e, quando editados, viram preço de volta. Assim não existe
  // estado duplicado para sair de sincronia.
  const precoPromo = form.preco_promocional ?? null
  const descontoPromo = precoPromo != null && form.preco_venda > 0
    ? ((form.preco_venda - precoPromo) / form.preco_venda) * 100 : null
  const markupPromo = precoPromo != null && form.preco_custo > 0
    ? ((precoPromo - form.preco_custo) / form.preco_custo) * 100 : null
  const lucroPromo = precoPromo != null && form.preco_custo > 0
    ? precoPromo - form.preco_custo : null

  function aplicarDescontoPromo(desconto: number) {
    if (!Number.isFinite(desconto) || form!.preco_venda <= 0) { campo('preco_promocional', null); return }
    const preco = form!.preco_venda * (1 - desconto / 100)
    campo('preco_promocional', preco > 0 ? parseFloat(preco.toFixed(2)) : null)
  }

  function aplicarMarkupPromo(markup: number) {
    if (!Number.isFinite(markup) || form!.preco_custo <= 0) { campo('preco_promocional', null); return }
    const preco = form!.preco_custo * (1 + markup / 100)
    campo('preco_promocional', preco > 0 ? parseFloat(preco.toFixed(2)) : null)
  }

  function alterarFaixa(indice: number, chave: 'qtd' | 'preco', valor: string) {
    setFaixas(atual => atual.map((f, i) => (i === indice ? { ...f, [chave]: valor } : f)))
  }

  /** Preencher a faixa pelo markup, como no preço promocional acima. */
  function aplicarMarkupFaixa(indice: number, markup: number) {
    if (!Number.isFinite(markup) || form!.preco_custo <= 0) return
    const preco = form!.preco_custo * (1 + markup / 100)
    alterarFaixa(indice, 'preco', preco > 0 ? preco.toFixed(2) : '')
  }

  const abas: { key: Aba; label: string; show?: boolean }[] = [
    { key: 'geral',    label: 'Geral' },
    { key: 'preco',    label: 'Preço & Markup' },
    { key: 'promocao', label: 'Promoção' },
    { key: 'imagens',  label: `Imagens${imagens.length > 0 ? ` (${imagens.length})` : ''}` },
    { key: 'kit',      label: 'Composição', show: form.tipo === 'kit' },
    { key: 'fiscal',   label: 'Fiscal' },
    { key: 'anuncios', label: `Anúncios${anunciosVinculados.length > 0 ? ` (${anunciosVinculados.length})` : ''}` },
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
              <div className="flex gap-5 py-1 flex-wrap">
                {[
                  { field: 'ativo' as const,          label: 'Ativo' },
                  { field: 'disponivel_pdv' as const,  label: 'Disponível no PDV' },
                  { field: 'permite_fracao' as const,  label: 'Permite fração' },
                  { field: 'monitorar' as const,       label: '👁 Monitorar produto' },
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
              {form.monitorar && (
                <p className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 -mt-1">
                  Você receberá um alerta no WhatsApp do gestor a cada venda, devolução ou baixa de estoque deste produto, com quem comprou e o saldo atual.
                  Configure o número em Configurações → WhatsApp / Z-API.
                </p>
              )}

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
                  <div className="relative">
                    <input value={form.ean ?? ''} onChange={e => campo('ean', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-9 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                    {!form.ean?.trim() && (
                      <button type="button" onClick={gerarEan} disabled={gerandoEan}
                        title="Gerar um código de uso interno (prefixo 2, válido para leitor e etiqueta)"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 px-1.5 py-1 text-sm text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50">
                        {gerandoEan ? '…' : '⚄'}
                      </button>
                    )}
                  </div>
                  {eanGerado && (
                    <p className="text-[11px] text-blue-700 mt-1">
                      Código de uso interno gerado — serve para leitor e etiqueta, mas não é um GTIN registrado na GS1.
                    </p>
                  )}
                </div>
              </div>

              {/* Preencher com IA */}
              <div>
                <button type="button" onClick={() => preencherComIA()} disabled={preenchendoIA || !form.nome.trim()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 border border-violet-200 text-violet-700 text-sm font-medium rounded-lg transition-colors">
                  {preenchendoIA ? '✨ Pensando...' : '✨ Preencher com IA (título, categoria, marca, NCM, descrição, dimensões...)'}
                </button>
                {mensagemIA && (
                  <p className="text-xs text-violet-600 mt-1.5">{mensagemIA}</p>
                )}
                {tituloSugerido && (
                  <div className="mt-2 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2.5">
                    <p className="text-xs text-violet-700 mb-1.5">
                      <span className="font-medium">Título sugerido:</span> {tituloSugerido}
                    </p>
                    <div className="flex gap-2">
                      <button type="button" onClick={usarTituloSugerido}
                        className="px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium rounded-lg transition-colors">
                        Usar este título
                      </button>
                      <button type="button" onClick={() => setTituloSugerido('')}
                        className="px-3 py-1 border border-violet-300 text-violet-600 text-xs rounded-lg hover:bg-violet-100 transition-colors">
                        Ignorar
                      </button>
                    </div>
                  </div>
                )}
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

              {/* Categoria → Subcategoria + Marca */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Categoria</label>
                  <select value={form.categoria ?? ''}
                    onChange={e => {
                      // Trocar a categoria zera a subcategoria: subcategoria de
                      // outra categoria não faz sentido nenhum e viraria lixo
                      // silencioso no cadastro.
                      setForm(prev => prev ? { ...prev, categoria: e.target.value, subcategoria: null } : prev)
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500">
                    <option value="">— Sem categoria —</option>
                    {categoriasRaiz.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Subcategoria
                    {form.categoria && subcategoriasDaCategoria.length === 0 && (
                      <span className="text-gray-400 font-normal"> — nenhuma cadastrada em {form.categoria}</span>
                    )}
                  </label>
                  <div className="flex gap-1.5">
                    <select value={form.subcategoria ?? ''} onChange={e => campo('subcategoria', e.target.value || null)}
                      disabled={!form.categoria}
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400">
                      <option value="">{form.categoria ? '— Sem subcategoria —' : 'Escolha a categoria antes'}</option>
                      {subcategoriasDaCategoria.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                      {/* A subcategoria gravada pode não existir mais na tabela
                          (renomeada, desativada). Mostrar mesmo assim evita que
                          salvar o produto apague a classificação sem avisar. */}
                      {form.subcategoria && !subcategoriasDaCategoria.some(c => c.nome === form.subcategoria) && (
                        <option value={form.subcategoria}>{form.subcategoria} (fora da lista)</option>
                      )}
                    </select>
                    <button type="button" onClick={criarSubcategoria} disabled={!form.categoria || criandoSub}
                      title="Criar uma subcategoria dentro desta categoria"
                      className="px-2.5 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                      {criandoSub ? '…' : '+'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
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

              {/* Peso e dimensões */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Peso e dimensões (embalagem)</label>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Peso (kg)</label>
                    <input type="number" step="0.001" min="0" value={form.peso_kg ?? ''}
                      onChange={e => campo('peso_kg', e.target.value === '' ? null : parseFloat(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Altura (cm)</label>
                    <input type="number" step="0.01" min="0" value={form.altura_cm ?? ''}
                      onChange={e => campo('altura_cm', e.target.value === '' ? null : parseFloat(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Largura (cm)</label>
                    <input type="number" step="0.01" min="0" value={form.largura_cm ?? ''}
                      onChange={e => campo('largura_cm', e.target.value === '' ? null : parseFloat(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">Comprimento (cm)</label>
                    <input type="number" step="0.01" min="0" value={form.comprimento_cm ?? ''}
                      onChange={e => campo('comprimento_cm', e.target.value === '' ? null : parseFloat(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1">Usado no cálculo de frete e no envio de anúncios pra Shopee/Mercado Livre.</p>
              </div>

              {/* Descrição para marketplace/site */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Descrição para Site / Marketplace</label>
                <textarea value={form.descricao_marketplace ?? ''} onChange={e => campo('descricao_marketplace', e.target.value)}
                  rows={4} placeholder="Texto de apresentação do produto, enviado ao publicar em Shopee, Mercado Livre etc."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 resize-y" />
              </div>

              {/* Obs interna */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Observação Interna</label>
                <textarea value={form.obs_interna ?? ''} onChange={e => campo('obs_interna', e.target.value)}
                  rows={3} placeholder="Anotações visíveis só pra equipe — não aparece no PDV nem em anúncios."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 resize-y" />
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
                  {podeEditarPrecos
                    ? <span className="text-gray-400 font-normal ml-1">— ou defina manualmente</span>
                    : <span className="text-amber-700 font-normal ml-1">— você não tem permissão para alterar preço</span>}
                </label>
                <input type="number" step="0.01" value={form.preco_venda} disabled={!podeEditarPrecos}
                  onChange={e => {
                    const venda = parseFloat(e.target.value) || 0
                    const custo = form.preco_custo ?? 0
                    const mk = custo > 0 ? ((venda - custo) / custo) * 100 : 0
                    setForm(prev => prev ? { ...prev, preco_venda: venda, markup: parseFloat(mk.toFixed(4)) } : prev)
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 font-mono text-base disabled:bg-gray-100 disabled:text-gray-400" />
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
                    {/* Três formas de dizer a mesma coisa. Quem pensa "20% off"
                        não deveria abrir a calculadora, e quem pensa em markup
                        precisa ver se a promoção ainda paga o custo. */}
                    <label className="block text-xs font-medium text-gray-600 mb-1">Preço promocional</label>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <input type="number" step="0.01"
                          value={form.preco_promocional ?? ''}
                          onChange={e => campo('preco_promocional', parseFloat(e.target.value) || null)}
                          placeholder={form.preco_venda.toFixed(2)}
                          className="w-full border border-orange-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-orange-500 font-mono text-base" />
                        <p className="text-[11px] text-gray-400 mt-0.5">R$</p>
                      </div>
                      <div>
                        <input type="number" step="0.1"
                          value={descontoPromo == null ? '' : descontoPromo.toFixed(1)}
                          onChange={e => aplicarDescontoPromo(parseFloat(e.target.value))}
                          placeholder="0,0"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-orange-500 font-mono text-base" />
                        <p className="text-[11px] text-gray-400 mt-0.5">% desconto</p>
                      </div>
                      <div>
                        <input type="number" step="0.1"
                          value={markupPromo == null ? '' : markupPromo.toFixed(1)}
                          onChange={e => aplicarMarkupPromo(parseFloat(e.target.value))}
                          placeholder="—"
                          disabled={!(form.preco_custo > 0)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-orange-500 font-mono text-base disabled:bg-gray-100 disabled:text-gray-400" />
                        <p className="text-[11px] text-gray-400 mt-0.5">% markup</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {[5, 10, 15, 20, 30].map(d => (
                        <button key={d} type="button" onClick={() => aplicarDescontoPromo(d)}
                          className="px-2.5 py-1 text-xs rounded-lg border border-orange-200 text-orange-700 hover:bg-orange-50">
                          -{d}%
                        </button>
                      ))}
                    </div>
                    <p className="text-xs mt-2">
                      <span className="text-gray-500">Normal {fmtBRL(form.preco_venda)}</span>
                      {form.preco_custo > 0 && <span className="text-gray-500"> · custo {fmtBRL(form.preco_custo)}</span>}
                      {form.preco_promocional != null && form.preco_promocional > 0 && (
                        <>
                          {' · '}
                          <span className={lucroPromo != null && lucroPromo <= 0 ? 'text-red-600 font-semibold' : 'text-emerald-600'}>
                            {lucroPromo == null
                              ? 'sem custo cadastrado — não dá para saber o lucro'
                              : `lucro ${fmtBRL(lucroPromo)} por unidade`}
                          </span>
                        </>
                      )}
                    </p>
                    {form.preco_promocional != null && form.preco_promocional >= form.preco_venda && (
                      <p className="text-xs text-red-600 mt-1">
                        O preço promocional não é menor que o normal — o sistema ignora a promoção assim e cobra o preço normal.
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

              {/* ── Preço por quantidade (atacado) ──
                  Fica fora do interruptor de propósito: promoção é campanha
                  com data, atacado é política de venda e vale sempre. */}
              <div className="pt-5 border-t border-gray-200">
                <p className="text-sm font-medium text-gray-900">Preço por quantidade</p>
                <p className="text-xs text-gray-500 mb-3">
                  Quem leva mais paga menos por unidade. Vale sempre, mesmo sem promoção ativa,
                  e o PDV troca o preço sozinho quando a quantidade alcança a faixa.
                </p>

                <div className="space-y-2">
                  {faixas.map((f, i) => {
                    const qtd = Number(f.qtd)
                    const preco = Number(f.preco)
                    const valida = qtd > 1 && preco > 0
                    const mk = valida && form.preco_custo > 0
                      ? ((preco - form.preco_custo) / form.preco_custo) * 100 : null
                    const desc = valida && form.preco_venda > 0
                      ? ((form.preco_venda - preco) / form.preco_venda) * 100 : null
                    return (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-gray-500 w-14">Nível {i + 1}</span>
                        <span className="text-xs text-gray-500">a partir de</span>
                        <input type="number" min="2" step="1" value={f.qtd}
                          onChange={e => alterarFaixa(i, 'qtd', e.target.value)}
                          placeholder="qtd"
                          className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500" />
                        <span className="text-xs text-gray-500">{form.unidade} →</span>
                        <input type="number" step="0.01" value={f.preco}
                          onChange={e => alterarFaixa(i, 'preco', e.target.value)}
                          placeholder="R$ por unidade"
                          className="w-32 border border-gray-300 rounded-lg px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500" />
                        {form.preco_custo > 0 && (
                          <input type="number" step="0.1"
                            value={mk == null ? '' : mk.toFixed(1)}
                            onChange={e => aplicarMarkupFaixa(i, parseFloat(e.target.value))}
                            placeholder="markup %"
                            title="Markup desta faixa — digite para calcular o preço a partir do custo"
                            className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500" />
                        )}
                        {valida && (
                          <span className="text-xs text-gray-500">
                            {desc != null && desc > 0 && <span className="text-orange-600">-{desc.toFixed(1)}% </span>}
                            {mk != null && (
                              <span className={mk <= 0 ? 'text-red-600 font-semibold' : ''}>
                                · lucro {fmtBRL(preco - form.preco_custo)}/un
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>

                {(() => {
                  // Faixa que cobra mais caro que uma faixa menor é erro de
                  // digitação, e o PDV cobraria o menor preço mesmo assim —
                  // melhor avisar aqui do que deixar a tabela mentindo.
                  const validas = faixas
                    .map(f => ({ qtd: Number(f.qtd), preco: Number(f.preco) }))
                    .filter(f => f.qtd > 1 && f.preco > 0)
                    .sort((a, b) => a.qtd - b.qtd)
                  const foraDeOrdem = validas.some((f, i) => i > 0 && f.preco >= validas[i - 1].preco)
                  const acimaDoNormal = validas.some(f => form.preco_venda > 0 && f.preco >= form.preco_venda)
                  if (!foraDeOrdem && !acimaDoNormal) return null
                  return (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
                      {acimaDoNormal
                        ? 'Alguma faixa está com preço igual ou maior que o preço normal — quem leva mais pagaria mais.'
                        : 'As faixas não estão em ordem decrescente de preço: uma quantidade maior ficou mais cara que uma menor.'}
                    </p>
                  )
                })()}

                <p className="text-[11px] text-gray-400 mt-2">
                  Deixe em branco as faixas que não usar. O markup é calculado sobre o custo atual
                  ({form.preco_custo > 0 ? fmtBRL(form.preco_custo) : 'não cadastrado'}) — muda sozinho se o custo mudar.
                </p>
              </div>
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
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-gray-500 mr-auto">
                      {imagens.length} imagem(ns) · Clique na foto para ver inteira · A primeira é a principal
                    </p>
                    {imgSelecionadas.size > 0 && (
                      <>
                        <span className="text-xs font-medium text-blue-700">
                          {imgSelecionadas.size} selecionada(s)
                        </span>
                        <button
                          onClick={async () => { await salvarTitulosImagens(); setEnviandoWhatsapp(true) }}
                          className={botao('secundario', 'sm')}>
                          Enviar por WhatsApp
                        </button>
                        <button onClick={() => setImgSelecionadas(new Set())} className={botao('sutil', 'sm')}>
                          Limpar
                        </button>
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {imagens.map((img, idx) => (
                      <div key={img.id} className={`relative group rounded-xl overflow-hidden border-2 transition-colors ${
                        imgSelecionadas.has(img.id) ? 'border-blue-600' : img.principal ? 'border-blue-400' : 'border-gray-200'
                      }`}>
                        {/* Clicar na foto abre em tela cheia. A miniatura é
                            cortada para caber na grade; não dá para conferir
                            uma imagem olhando um recorte dela. */}
                        <img src={img.url} alt={`Imagem ${idx + 1}`}
                          onClick={() => setVisualizando(idx)}
                          title="Clique para ver a imagem inteira"
                          className="w-full h-32 object-cover bg-gray-100 cursor-zoom-in" />
                        {/* Seleção para envio. Fora do overlay de ações, que
                            só aparece no hover — a marca de selecionado
                            precisa ficar visível o tempo todo. */}
                        <label onClick={e => e.stopPropagation()}
                          className="absolute top-2 right-2 z-10 w-6 h-6 rounded-md bg-white/90 border border-gray-300 flex items-center justify-center cursor-pointer shadow-sm">
                          <input type="checkbox" checked={imgSelecionadas.has(img.id)}
                            onChange={() => alternarSelecaoImg(img.id)}
                            className="w-4 h-4 accent-blue-600 cursor-pointer" />
                        </label>
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
                        <div className="absolute bottom-[3.4rem] right-1.5 bg-black/50 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold">
                          {idx + 1}
                        </div>
                        {/* Título: vira a legenda da foto no envio por
                            WhatsApp. Fica fora do overlay de hover porque
                            precisa ser digitável, não só visível. */}
                        <div className="bg-white px-2 py-1.5 border-t border-gray-100">
                          <input
                            value={tituloDe(img)}
                            onChange={e => setTitulosImg(t => ({ ...t, [img.id]: e.target.value }))}
                            placeholder="Título"
                            title="Aparece como legenda ao enviar esta imagem por WhatsApp"
                            className="w-full text-xs text-gray-700 placeholder-gray-400 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400" />
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
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-gray-600">Defina os produtos que compõem este kit. O preço do kit é definido manualmente na aba <strong>Preço</strong>.</p>
                {kitItens.length > 0 && (
                  <button onClick={recalcularKit} disabled={recalculandoKit}
                    className="flex-shrink-0 text-xs px-3 py-1.5 border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors whitespace-nowrap">
                    {recalculandoKit ? 'Recalculando...' : '↻ Recalcular a partir dos componentes'}
                  </button>
                )}
              </div>
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
                        <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-600">Controla estoque</th>
                        <th className="w-12 px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {kitItens.map(item => (
                        <tr key={item.produto_id} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-gray-900">{item.nome}
                            <span className="text-gray-400 text-xs ml-1">{item.unidade}</span>
                            {!item.controla_estoque && (
                              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600 font-medium align-middle">∞ sempre disponível</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <div className="inline-flex items-center gap-1.5">
                              <button type="button"
                                onClick={() => atualizarQtdKit(item.produto_id, Math.max(0.0001, parseFloat((item.quantidade - 1).toFixed(4))))}
                                disabled={item.quantidade <= 0.0001}
                                className="w-6 h-6 flex items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                                −
                              </button>
                              <input type="number" min="0.0001" step="0.0001" value={item.quantidade}
                                onChange={e => atualizarQtdKit(item.produto_id, Math.max(0.0001, parseFloat(e.target.value) || 0.0001))}
                                className="w-16 border border-gray-300 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-blue-500" />
                              <button type="button"
                                onClick={() => atualizarQtdKit(item.produto_id, parseFloat((item.quantidade + 1).toFixed(4)))}
                                className="w-6 h-6 flex items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors">
                                +
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none" title="Desmarque para componentes baratos/abundantes (ex: parafusos, buchas) que não limitam a montagem do kit nem têm baixa registrada">
                              <input type="checkbox" checked={item.controla_estoque}
                                onChange={e => alternarControlaEstoqueKit(item.produto_id, e.target.checked)}
                                className="w-4 h-4 accent-blue-600" />
                            </label>
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
              {/* IA restrita ao fiscal. Quem abre esta aba quer resolver
                  NCM/CFOP/CST — não que a IA mexa em categoria, marca,
                  descrição ou dimensões de passagem. */}
              <div className="flex items-center justify-between gap-3 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-violet-900">Preencher os dados fiscais com IA</p>
                  <p className="text-[11px] text-violet-700 mt-0.5">
                    Deduz NCM, CEST e Origem pelo nome do produto; CFOP e os CST vêm do regime tributário
                    da empresa. Só preenche campo vazio — nunca sobrescreve o que já está aí.
                  </p>
                </div>
                <button type="button" onClick={() => preencherComIA('fiscal')}
                  disabled={preenchendoIA || !form.nome?.trim()}
                  title={!form.nome?.trim() ? 'O produto precisa de um nome para a IA deduzir os dados' : undefined}
                  className="flex-shrink-0 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-xs font-medium rounded-lg">
                  {preenchendoIA ? 'Consultando...' : '✨ Preencher fiscal'}
                </button>
              </div>

              {mensagemIA && (
                <p className="text-xs text-violet-800 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">{mensagemIA}</p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">NCM</label>
                  <input value={form.ncm ?? ''} onChange={e => campo('ncm', e.target.value)}
                    placeholder="Obrigatório para emitir NFC-e"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">CEST</label>
                  <input value={form.cest ?? ''} onChange={e => campo('cest', e.target.value)}
                    placeholder="Se aplicável (substituição tributária)"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">CFOP</label>
                  <input value={form.cfop ?? ''} onChange={e => campo('cfop', e.target.value)}
                    placeholder="Ex: 5102"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Origem</label>
                  <select value={form.icms_origem ?? ''} onChange={e => campo('icms_origem', e.target.value === '' ? null : parseInt(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500">
                    <option value="">—</option>
                    <option value="0">0 - Nacional</option>
                    <option value="1">1 - Estrangeira - Importação direta</option>
                    <option value="2">2 - Estrangeira - Mercado interno</option>
                    <option value="3">3 - Nacional - Conteúdo importado &gt; 40%</option>
                    <option value="4">4 - Nacional - Processo produtivo básico</option>
                    <option value="5">5 - Nacional - Conteúdo importado ≤ 40%</option>
                    <option value="6">6 - Estrangeira - Importação direta, sem similar nacional</option>
                    <option value="7">7 - Estrangeira - Mercado interno, sem similar nacional</option>
                    <option value="8">8 - Nacional - Conteúdo importado &gt; 70%</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">CST ICMS</label>
                  <input value={form.icms_cst ?? ''} onChange={e => campo('icms_cst', e.target.value)}
                    placeholder="Ex: 00, 20, 60..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">CSOSN</label>
                  <input value={form.csosn ?? ''} onChange={e => campo('csosn', e.target.value)}
                    placeholder="Ex: 102, 500... (Simples Nacional)"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">ICMS %</label>
                  <input type="number" step="0.0001" min="0" value={form.icms_percentual ?? ''}
                    onChange={e => campo('icms_percentual', e.target.value === '' ? null : parseFloat(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">CST PIS</label>
                  <input value={form.pis_cst ?? ''} onChange={e => campo('pis_cst', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">PIS %</label>
                  <input type="number" step="0.0001" min="0" value={form.pis_percentual ?? ''}
                    onChange={e => campo('pis_percentual', e.target.value === '' ? null : parseFloat(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">CST COFINS</label>
                  <input value={form.cofins_cst ?? ''} onChange={e => campo('cofins_cst', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">COFINS %</label>
                  <input type="number" step="0.0001" min="0" value={form.cofins_percentual ?? ''}
                    onChange={e => campo('cofins_percentual', e.target.value === '' ? null : parseFloat(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">IPI %</label>
                  <input type="number" step="0.0001" min="0" value={form.ipi_percentual ?? ''}
                    onChange={e => campo('ipi_percentual', e.target.value === '' ? null : parseFloat(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <p className="text-xs text-gray-400">
                NCM, CFOP, Origem, CST ICMS/CSOSN e CST de PIS/COFINS são usados de verdade na emissão de NFC-e — a SEFAZ rejeita a nota
                se vierem errados. Os percentuais (ICMS/PIS/COFINS/IPI) ficam guardados aqui pra referência e uso futuro.
                Confirme com a contabilidade antes de basear apuração real neles.
              </p>

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
            </div>
          )}

          {/* ── ABA ANÚNCIOS ── */}
          {aba === 'anuncios' && (
            <div className="space-y-4">
              {carregandoAnuncios ? (
                <div className="text-center py-10 text-gray-400 text-sm">Carregando...</div>
              ) : anunciosVinculados.length === 0 ? (
                <div className="text-center py-10 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
                  <p className="text-3xl mb-2">🛍️</p>
                  <p className="text-sm">Nenhum anúncio de marketplace vinculado a este produto ainda.</p>
                  <p className="text-xs mt-1">Vincule em Marketplaces → Anúncios, usando o botão "Mapear".</p>
                </div>
              ) : (
                <>
                {/* Pausar em todos os canais de uma vez — antes era preciso
                    entrar canal por canal para tirar um produto do ar. */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-medium text-blue-900">
                      {anunciosVinculados.length} anúncio(s) em {new Set(anunciosVinculados.map(a => a.canalNome)).size} canal(is)
                    </p>
                    <p className="text-xs text-blue-700 mt-0.5">
                      {anunciosVinculados.filter(a => a.status === 'ativo').length} ativo(s) ·{' '}
                      {anunciosVinculados.filter(a => a.status === 'pausado').length} pausado(s)
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {/* Ler o canal e escrever no canal ficam juntos e antes
                        dos de pausar: é a ordem em que o operador precisa
                        deles — conferir a situação de verdade antes de agir
                        sobre ela. */}
                    <button type="button" disabled={mexendoAnuncios}
                      onClick={puxarSituacaoDosCanais}
                      title="Relê cada anúncio na plataforma e atualiza a coluna Situação. A varredura automática só passa a cada 20 minutos."
                      className="px-3 py-1.5 text-xs rounded-lg border border-blue-300 text-blue-700 bg-white hover:bg-blue-50 disabled:opacity-40">
                      ↻ Puxar situação dos canais
                    </button>
                    <button type="button" disabled={mexendoAnuncios}
                      onClick={enviarEstoqueAosCanais}
                      title="Envia o estoque do sistema para os anúncios deste produto agora, sem esperar a fila. Não mexe no preço."
                      className="px-3 py-1.5 text-xs rounded-lg border border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-50 disabled:opacity-40">
                      ⇧ Enviar estoque aos canais
                    </button>
                    <button type="button" disabled={mexendoAnuncios}
                      onClick={() => mudarStatusAnuncios('pausar', anunciosVinculados.filter(a => a.status === 'ativo'))}
                      title="Tira o produto do ar em todos os canais de uma vez"
                      className="px-3 py-1.5 text-xs rounded-lg bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-40">
                      {mexendoAnuncios ? 'Aguarde...' : '⏸ Pausar em todos os canais'}
                    </button>
                    <button type="button" disabled={mexendoAnuncios}
                      onClick={() => mudarStatusAnuncios('ativar', anunciosVinculados.filter(a => a.status === 'pausado'))}
                      className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-40">
                      ▶ Reativar todos
                    </button>
                  </div>
                </div>
                {resumoAnuncios && (
                  <p className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700">{resumoAnuncios}</p>
                )}

                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-600">Canal</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-600">Anúncio</th>
                        <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-600">Preço no canal</th>
                        <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-600">Situação</th>
                        <th className="px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {anunciosVinculados.map(a => {
                        const st = STATUS_ANUNCIO[a.status] ?? { label: a.status, cls: 'bg-gray-100 text-gray-500' }
                        return (
                          <tr key={a.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2.5 text-gray-900">
                              {PLATAFORMA_LABEL[a.plataforma] ?? (a.plataforma || '—')}
                              <span className="text-gray-400 text-xs block">{a.canalNome}</span>
                            </td>
                            <td className="px-4 py-2.5 text-gray-700">
                              {a.urlAnuncio ? (
                                <a href={a.urlAnuncio} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{a.titulo}</a>
                              ) : a.titulo}
                              {a.variacaoNome && <span className="text-gray-400 text-xs block">{a.variacaoNome}</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-gray-900">
                              {a.preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>
                            </td>
                            <td className="px-4 py-2.5 text-right whitespace-nowrap">
                              {a.canalId && (a.status === 'ativo' || a.status === 'pausado') && (
                                <button type="button" disabled={mexendoAnuncios}
                                  onClick={() => mudarStatusAnuncios(a.status === 'ativo' ? 'pausar' : 'ativar', [a])}
                                  className="text-xs text-gray-500 hover:text-blue-700 disabled:opacity-40">
                                  {a.status === 'ativo' ? 'pausar' : 'reativar'}
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                </>
              )}
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
            <button onClick={() => setImprimindoEtiqueta(true)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
              🏷 Imprimir Etiqueta
            </button>
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button onClick={salvar} disabled={salvando || (!podeEditarProdutos && !podeEditarPrecos)}
              title={!podeEditarProdutos && !podeEditarPrecos ? 'Você não tem permissão para editar produtos' : undefined}
              className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors font-medium">
              {salvando ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </div>
      </div>

      {imprimindoEtiqueta && (
        <ImprimirEtiquetaModal
          produtos={[{
            id: form.id, nome: form.nome, sku: form.sku, ean: form.ean,
            preco_venda: form.preco_venda, preco_promocional: form.preco_promocional ?? null,
            promocao_ativa: form.promocao_ativa ?? false,
            promocao_inicio: form.promocao_inicio ?? null,
            promocao_fim: promocaoInfinita ? null : (form.promocao_fim ?? null),
            marca: form.marca, unidade: form.unidade, categoria: form.categoria,
            estoque: form.estoque,
          }]}
          empresaId={empresaId}
          onClose={() => setImprimindoEtiqueta(false)}
        />
      )}
      {visualizando !== null && (
        <VisualizadorImagem
          imagens={imagens.map(i => ({ id: i.id, url: i.url, titulo: tituloDe(i) }))}
          indice={visualizando}
          onFechar={() => setVisualizando(null)}
          onNavegar={setVisualizando}
        />
      )}

      {enviandoWhatsapp && (
        <EnviarImagensWhatsappModal
          imagens={imagens.filter(i => imgSelecionadas.has(i.id)).map(i => ({ id: i.id, url: i.url, titulo: tituloDe(i) }))}
          nomeProduto={form.nome ?? ''}
          onFechar={() => setEnviandoWhatsapp(false)}
        />
      )}
    </div>
  )
}
