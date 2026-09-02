'use client'

import { useState, useEffect } from 'react'
import AskVargas from '@/components/dashboard/AskVargas'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import AnuncioDetalheModal from './AnuncioDetalheModal'
import MapearAnuncioModal from './MapearAnuncioModal'
import EditarAnuncioModal from './EditarAnuncioModal'
import MapeamentoRapidoModal from './MapeamentoRapidoModal'
import EnriquecerProdutoModal from './EnriquecerProdutoModal'
import EnviarPrecoEstoqueModal from './EnviarPrecoEstoqueModal'
import CriarAnuncioShopeeModal from './CriarAnuncioShopeeModal'
import CriarAnuncioMercadoLivreModal from './CriarAnuncioMercadoLivreModal'
import CriarAnuncioNuvemshopModal from './CriarAnuncioNuvemshopModal'
import { fmt, temDivergencia } from './utils'
import { calcularKit } from '@/lib/produtos/kit'
import { calcularPrecoParaMargem } from '@/lib/shopee/comissao'
import { calcular as calcularPreco, saudeDaMargem, ROTULO_SAUDE } from '@/lib/precificacao/motor'
import { FALTAS_CATALOGO } from '@/lib/marketplace/qualidade'

// Saúde da precificação do anúncio: pega o preço que está no ar, desconta
// tudo que o canal cobra (as taxas configuradas em Precificação) e mostra o
// que realmente sobra. Usa o mesmo motor da tela de simulação — não existe
// uma segunda conta que possa divergir dela.
function SaudeDoAnuncio({ anuncio, cfg }: { anuncio: any; cfg: any }) {
  if (!cfg) return null
  const custo = Number(anuncio.produtos?.preco_custo ?? 0)
  const preco = Number(anuncio.preco_promocional || anuncio.preco_venda || 0)
  if (!(custo > 0) || !(preco > 0)) return null

  const r = calcularPreco({ cfg, custoProduto: custo, objetivo: { tipo: 'preco', valor: preco } })
  const s = ROTULO_SAUDE[saudeDaMargem(r.margemLiquida, cfg.faixasSaude)]
  return (
    <p className="text-xs text-gray-400 mt-0.5" title={`Lucro estimado ${r.lucro.toFixed(2)} · deduções ${r.totalDeducoes.toFixed(2)}`}>
      {s.emoji} {r.margemLiquida.toFixed(0)}% de margem
    </p>
  )
}

// Qualidade do anúncio — a coluna prometida no CONTINUIDADE.
//
// `health` (0-1) é o índice OFICIAL do Mercado Livre; só existe pra ML e vem
// pronto na sincronização. `score` (0-100) é o checklist NOSSO, calculado
// igual nas duas plataformas. MEDIDO contra produção: os dois números não se
// correlacionam (health ≥0,80 dá score médio 56; abaixo de 0,80 dá 54) — por
// isso aparecem em linhas separadas, nunca somados ou misturados numa "nota
// única" que faria parecer que um prevê o outro.
function faixaScore(score: number): { cor: string; label: string } {
  if (score <= 40) return { cor: 'text-red-600', label: 'Ruim' }
  if (score <= 60) return { cor: 'text-orange-600', label: 'Regular' }
  if (score <= 80) return { cor: 'text-amber-600', label: 'Bom' }
  return { cor: 'text-emerald-600', label: 'Ótimo' }
}

function QualidadeColuna({ anuncio }: { anuncio: any }) {
  if (anuncio.qualidade_em == null) {
    return <span className="text-xs text-gray-300">—</span>
  }
  const score = Number(anuncio.qualidade_score ?? 0)
  const f = faixaScore(score)
  const faltas: string[] = anuncio.qualidade_faltas ?? []
  return (
    <div className="text-xs leading-tight">
      {anuncio.qualidade_health != null && (
        <div className="text-gray-700" title="Índice oficial do Mercado Livre">
          {Math.round(Number(anuncio.qualidade_health) * 100)}% <span className="text-gray-400">ML</span>
        </div>
      )}
      <div className={f.cor} title={`Checklist do sistema: ${faltas.length} pendência(s)`}>
        {score} <span className="text-gray-400">checklist</span>
      </div>
    </div>
  )
}

function arredondar(valor: number, regra: string): number {
  if (regra === 'cima_inteiro') return Math.ceil(valor)
  if (regra === 'terminar_90' || regra === 'terminar_99') {
    const base = Math.floor(valor)
    const decimal = regra === 'terminar_90' ? 0.90 : 0.99
    return parseFloat((base + decimal).toFixed(2))
  }
  return Math.round(valor * 100) / 100
}

const STATUS_CORES: Record<string, string> = {
  rascunho: 'bg-gray-100 text-gray-600',
  ativo:    'bg-green-100 text-green-700',
  pausado:  'bg-yellow-100 text-yellow-700',
  encerrado:'bg-red-100 text-red-600',
  erro:     'bg-red-100 text-red-700',
}
const STATUS_LABELS: Record<string, string> = {
  rascunho: 'Rascunho', ativo: 'Ativo', pausado: 'Pausado', encerrado: 'Encerrado', erro: 'Erro',
}

// Tipo de anúncio do Mercado Livre (listing_type_id) — não é uma coluna
// própria, vem embutido em dados_brutos (já sincronizado no catálogo).
const ML_TIPO_ANUNCIO_LABELS: Record<string, string> = {
  gold_pro: 'Premium',
  gold_special: 'Clássico',
  gold_premium: 'Premium',
  gold: 'Clássico',
  silver: 'Clássico',
  bronze: 'Clássico',
  free: 'Grátis',
}
function tipoAnuncioML(a: any): string | null {
  // `listing_type` vem extraído de dados_brutos pela consulta da página — o
  // blob inteiro não é carregado (era 85% do peso da listagem). O acesso
  // direto a dados_brutos fica como reserva para quem receber o anúncio por
  // outro caminho, sem a extração.
  const listingType = a.listing_type ?? a.dados_brutos?.listing_type_id
  if (!listingType) return null
  return ML_TIPO_ANUNCIO_LABELS[listingType] ?? listingType
}

// Lista as variações do anúncio (nome, ou SKU como fallback quando o nome
// não veio no sync) pra exibir na listagem — antes só mostrava o badge
// genérico "Com variações", sem dizer qual.
function nomesVariacoes(a: any): string {
  const nomes = (a.marketplace_anuncio_variacoes ?? [])
    .map((v: any) => v.nome_variacao || v.sku_variacao)
    .filter(Boolean)
  return nomes.join(' · ')
}

// Um anúncio com variações nunca usa o produto_id do PRÓPRIO anúncio na hora
// de baixar estoque de um pedido — cada variação tem seu vínculo próprio (ver
// resolverVinculoItem em src/lib/mercadolivre/orders.ts e equivalente na
// Shopee). Então "mapeado" pra esse tipo de anúncio significa TODAS as
// variações terem produto vinculado, não o campo produto_id do anúncio em
// si (que fica vazio de propósito e não precisa ser preenchido).
function estaMapeado(a: any): boolean {
  if (a.tem_variacao) {
    const variacoes = a.marketplace_anuncio_variacoes ?? []
    return variacoes.length > 0 && variacoes.every((v: any) => !!v.produto_id)
  }
  return !!a.produto_id
}

const FACETAS: { key: string; label: string }[] = [
  { key: 'mapeado', label: 'Mapeado' },
  { key: 'nao_mapeado', label: 'Não mapeado' },
  { key: 'sem_sku', label: 'Sem SKU' },
  { key: 'sem_estoque', label: 'Sem estoque' },
  { key: 'com_variacao', label: 'Com variações' },
  { key: 'divergente', label: 'Divergente' },
  { key: 'qualidade_ruim', label: 'Qualidade ruim' },
  { key: 'qualidade_boa', label: 'Qualidade ótima' },
]

export default function AnunciosClient({ canal, canais = [], anuncios: anunciosIniciais, produtos, empresaId, qInicial, statusInicial, tagInicial = '', faltaInicial = '', facetasIniciais = [], operador, regras = [], depositos = [], configPreco }: {
  canal: any; canais?: { id: string; nome: string; plataforma?: string; ativo?: boolean }[]; anuncios: any[]; produtos: any[]; empresaId: string; qInicial: string; statusInicial: string; operador: string
  tagInicial?: string; faltaInicial?: string; facetasIniciais?: string[]
  regras?: any[]; depositos?: { id: string; nome: string }[]
  configPreco?: any
}) {
  const router = useRouter()
  // Rota da plataforma do canal. Shopee e Mercado Livre expõem os MESMOS
  // recursos, com o mesmo formato de corpo — o que faltava era escolher o
  // caminho em vez de deixar '/shopee/' fixo no código. Era só isso que
  // impedia o ML de ter atualizar/enviar/pausar/ativar e as regras em massa.
  const plataforma: string = canal.plataforma
  const ehML = plataforma === 'mercadolivre'
  const nomeCanalPlataforma = ehML ? 'Mercado Livre' : 'Shopee'
  const nomeCurto = ehML ? 'ML' : 'Shopee'
  // Preposição certa: "na Shopee", "no Mercado Livre".
  const preposicao = ehML ? 'no' : 'na'
  function rotaCanal(recurso: string) {
    return `/api/marketplace/${ehML ? 'mercadolivre' : 'shopee'}/${recurso}`
  }
  // Plataformas que já têm módulo de escrita. Nuvemshop ainda não tem, então
  // os botões de envio não aparecem para ela — melhor ausente do que
  // presente e falhando.
  const temEscrita = plataforma === 'shopee' || ehML

  const [anuncios, setAnuncios] = useState(anunciosIniciais)
  // anunciosIniciais só vale como valor inicial do useState — sem isso,
  // router.refresh() (ex: depois de sincronizar) atualiza os dados no
  // servidor mas o estado local do client component nunca pega o valor
  // novo, então a listagem parecia "travada" mesmo com o catálogo já
  // sincronizado por baixo (mesmo bug já visto antes na tela de Pedidos).
  useEffect(() => { setAnuncios(anunciosIniciais) }, [anunciosIniciais])
  const [q, setQ] = useState(qInicial)
  const [statusFiltro, setStatusFiltro] = useState(statusInicial)
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<any | null>(null)
  // Editar um anúncio que já existe é outro problema de tela: fotos, ordem,
  // ficha técnica e variações não cabem no formulário de criação manual — e
  // precisam ir para o marketplace, não só para a tabela. Modal próprio.
  const [editorAberto, setEditorAberto] = useState<any | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [buscaProd, setBuscaProd] = useState('')
  const [sincronizando, setSincronizando] = useState(false)
  const [perguntarAberto, setPerguntarAberto] = useState(false)
  const [resumoSync, setResumoSync] = useState('')
  const [facetas, setFacetas] = useState<Set<string>>(new Set(facetasIniciais))
  const [tagFiltro, setTagFiltro] = useState(tagInicial)
  // Filtro por falta específica de qualidade — separado das facetas porque é
  // um seletor de valor (qual falta), não um interruptor liga/desliga.
  const [faltaFiltro, setFaltaFiltro] = useState(faltaInicial)
  // Os filtros como query string.
  //
  // Trocar de canal é uma NAVEGAÇÃO — o estado deste componente morre nela, e
  // era por isso que a busca e os filtros voltavam do zero do outro lado.
  // Levando-os na URL, quem escolhe outro canal continua vendo o mesmo
  // recorte, que é o que se quer ao comparar duas contas do mesmo
  // marketplace: "como está 'corrente' aqui, e como está lá?".
  function filtrosNaUrl(): string {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (statusFiltro) p.set('status', statusFiltro)
    if (tagFiltro) p.set('tag', tagFiltro)
    if (faltaFiltro) p.set('falta', faltaFiltro)
    if (facetas.size > 0) p.set('facetas', [...facetas].join(','))
    const s = p.toString()
    return s ? `?${s}` : ''
  }

  const temFiltroAtivo = !!(q || statusFiltro || tagFiltro || faltaFiltro || facetas.size > 0)
  const urlTemFiltro = !!(qInicial || statusInicial || tagInicial || faltaInicial || facetasIniciais.length)

  function limparFiltros() {
    setQ(''); setStatusFiltro(''); setTagFiltro(''); setFaltaFiltro(''); setFacetas(new Set())
    // A URL também precisa esquecer, senão ela passa a contradizer a tela:
    // recarregar a página (ou reabrir o link) traria de volta exatamente os
    // filtros que o botão acabou de limpar. `replace` e não `push` porque
    // limpar não é um lugar para onde voltar com o botão do navegador.
    if (urlTemFiltro) router.replace(`/dashboard/marketplaces/${canal.id}/anuncios`)
  }

  const [detalheAberto, setDetalheAberto] = useState<any | null>(null)
  const [mapeandoAberto, setMapeandoAberto] = useState<any | null>(null)
  const [enriquecendoAberto, setEnriquecendoAberto] = useState<any | null>(null)
  const [enviandoPrecoAberto, setEnviandoPrecoAberto] = useState<any | null>(null)
  const [criarAnuncioShopeeAberto, setCriarAnuncioShopeeAberto] = useState(false)
  const [criarAnuncioMLAberto, setCriarAnuncioMLAberto] = useState(false)
  const [criarAnuncioNuvemshopAberto, setCriarAnuncioNuvemshopAberto] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [mapeamentoRapido, setMapeamentoRapido] = useState<string[] | null>(null)
  // Replicação em massa pra outra conta do MESMO marketplace.
  const [replicarAberto, setReplicarAberto] = useState(false)
  const [replicarDestino, setReplicarDestino] = useState('')
  const [replicando, setReplicando] = useState(false)
  const [replicarResultado, setReplicarResultado] = useState<any | null>(null)
  const [previewMassa, setPreviewMassa] = useState<{ encontrados: any[]; naoEncontrados: any[] } | null>(null)
  const [aplicandoMassa, setAplicandoMassa] = useState(false)
  const [pagina, setPagina] = useState(1)
  const ITENS_POR_PAGINA = 100

  // Envio de preço/estoque em massa para a Shopee
  const [opcoesMassaPreco, setOpcoesMassaPreco] = useState<{
    modoPreco: 'nao' | 'fixo' | 'percentual' | 'formula' | 'shopee_liquido' | 'produto'; valorPreco: string; arredondamento: string
    considerarPix: boolean; valorEmbalagem: string; percentualImposto: string
    modoEstoque: 'nao' | 'fixo' | 'produto' | 'deposito'; valorEstoque: string; depositoId: string
    estoqueComplementar: string; estoqueRisco: string
  } | null>(null)
  const [regraSelecionadaId, setRegraSelecionadaId] = useState('')
  const [previewMassaPreco, setPreviewMassaPreco] = useState<{
    aplicaveis: { anuncio: any; precoNovo?: number; estoqueNovo?: number; paraPausar?: boolean }[]
    pulados: { anuncio: any; motivo: string }[]
  } | null>(null)
  const [enviandoMassaPreco, setEnviandoMassaPreco] = useState(false)
  const [resumoMassaPreco, setResumoMassaPreco] = useState('')

  // Pausar/ativar em massa na Shopee
  const [pausandoAtivando, setPausandoAtivando] = useState(false)
  const [resumoPausarAtivar, setResumoPausarAtivar] = useState('')

  // Estoque do sistema → estoque do marketplace (só estoque, sem preço)
  const [sincEstoqueEnviando, setSincEstoqueEnviando] = useState(false)
  const [sincEstoqueResumo, setSincEstoqueResumo] = useState('')

  // Sincronizar só os selecionados (em vez do catálogo inteiro) — duas
  // direções: puxar da Shopee (atualizar aqui) e mandar pra Shopee (enviar
  // o que já está salvo aqui, sem regra/fórmula nenhuma).
  const [sincronizandoSelecionados, setSincronizandoSelecionados] = useState(false)
  const [resumoSincSelecionados, setResumoSincSelecionados] = useState('')
  const [enviandoSelecionados, setEnviandoSelecionados] = useState(false)
  const [resumoEnvioSelecionados, setResumoEnvioSelecionados] = useState('')

  function toggleSelecionado(id: string) {
    setSelecionados(prev => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id); else novo.add(id)
      return novo
    })
  }

  // Só canais da mesma plataforma e diferentes do atual: replicar pra outra
  // plataforma exigiria adivinhar categoria e atributos item a item, o que em
  // massa e sem revisão é o que estraga catálogo.
  const canaisDestino = canais.filter(c => c.id !== canal.id && (c.plataforma ?? canal.plataforma) === canal.plataforma && c.ativo !== false)

  async function replicarSelecionados() {
    if (!replicarDestino || selecionados.size === 0) return
    setReplicando(true); setReplicarResultado(null)
    try {
      const resp = await fetch('/api/marketplaces/anuncios/replicar-massa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anuncioIds: Array.from(selecionados), canalDestinoId: replicarDestino }),
      })
      const data = await resp.json()
      if (!data.ok) { setReplicarResultado({ erro: data.erro ?? 'Erro ao replicar' }); return }
      setReplicarResultado(data)
    } catch (e: any) {
      setReplicarResultado({ erro: e?.message ?? 'Erro ao replicar' })
    } finally {
      setReplicando(false)
    }
  }

  async function prepararMapeamentoMassa() {
    const sb = createClient()
    const alvos = filtrados.filter(a => selecionados.has(a.id) && a.sku_canal)
    const skus = [...new Set(alvos.map(a => a.sku_canal))]
    const { data: candidatos } = skus.length > 0
      ? await sb.from('produtos').select('id, nome, sku, preco_venda, estoque').eq('empresa_id', empresaId).eq('ativo', true).in('sku', skus)
      : { data: [] as any[] }

    const encontrados: any[] = []
    const naoEncontrados: any[] = []
    for (const a of filtrados.filter(a => selecionados.has(a.id))) {
      const match = a.sku_canal ? candidatos?.find(c => c.sku === a.sku_canal) : null
      if (match) encontrados.push({ anuncio: a, produto: match })
      else naoEncontrados.push(a)
    }
    setPreviewMassa({ encontrados, naoEncontrados })
  }

  async function confirmarMapeamentoMassa() {
    if (!previewMassa) return
    setAplicandoMassa(true)
    const sb = createClient()
    for (const { anuncio, produto } of previewMassa.encontrados) {
      await sb.from('marketplace_anuncios').update({ produto_id: produto.id }).eq('id', anuncio.id)
    }
    if (previewMassa.encontrados.length > 0) {
      await sb.from('marketplace_mapeamentos').upsert(
        previewMassa.encontrados.map(({ anuncio, produto }) => ({
          empresa_id: empresaId, canal_id: canal.id, nivel: 'anuncio', chave: anuncio.sku_canal,
          anuncio_id: anuncio.id, produto_id: produto.id,
          produto_nome_snapshot: produto.nome, produto_sku_snapshot: produto.sku,
          metodo: 'automatico_sku', operador, updated_at: new Date().toISOString(),
        })),
        { onConflict: 'empresa_id,canal_id,nivel,chave' }
      )
    }
    setAnuncios(prev => prev.map(a => {
      const match = previewMassa.encontrados.find((e: any) => e.anuncio.id === a.id)
      return match ? { ...a, produto_id: match.produto.id, produtos: match.produto } : a
    }))
    setSelecionados(new Set())
    setPreviewMassa(null)
    setAplicandoMassa(false)
  }

  function aplicarRegraSalva(regraId: string) {
    setRegraSelecionadaId(regraId)
    const regra = regras.find(r => r.id === regraId)
    if (!regra) return
    const novasOpcoes = {
      modoPreco: regra.modo_preco, valorPreco: regra.valor_preco != null ? String(regra.valor_preco) : '',
      arredondamento: regra.arredondamento,
      considerarPix: regra.considerar_subsidio_pix ?? false,
      valorEmbalagem: regra.valor_embalagem != null && regra.valor_embalagem !== 0 ? String(regra.valor_embalagem) : '',
      percentualImposto: regra.percentual_imposto != null && regra.percentual_imposto !== 0 ? String(regra.percentual_imposto) : '',
      modoEstoque: regra.modo_estoque, valorEstoque: regra.valor_estoque != null ? String(regra.valor_estoque) : '',
      depositoId: regra.deposito_id ?? '',
      estoqueComplementar: regra.estoque_complementar != null && regra.estoque_complementar !== 0 ? String(regra.estoque_complementar) : '',
      estoqueRisco: regra.estoque_risco != null ? String(regra.estoque_risco) : '',
    }
    setOpcoesMassaPreco(novasOpcoes)
    prepararPreviewMassaPreco(novasOpcoes)
  }

  async function prepararPreviewMassaPreco(opcoesForcadas?: typeof opcoesMassaPreco) {
    const opcoes = opcoesForcadas ?? opcoesMassaPreco
    if (!opcoes) return
    const { modoPreco, valorPreco, arredondamento, considerarPix, valorEmbalagem, percentualImposto, modoEstoque, valorEstoque, depositoId, estoqueComplementar, estoqueRisco } = opcoes
    const embalagem = parseFloat(valorEmbalagem) || 0
    const imposto = parseFloat(percentualImposto) || 0
    const complementar = parseInt(estoqueComplementar) || 0
    const risco = estoqueRisco !== '' ? parseInt(estoqueRisco) : null
    const aplicaveis: { anuncio: any; precoNovo?: number; estoqueNovo?: number; paraPausar?: boolean }[] = []
    const pulados: { anuncio: any; motivo: string }[] = []

    const alvos = filtrados.filter(a => selecionados.has(a.id))

    // Estoque por depósito — busca em lote pra todos os produtos vinculados,
    // em vez de uma query por anúncio.
    let estoquePorDeposito = new Map<string, number>()
    if (modoEstoque === 'deposito' && depositoId) {
      const produtoIds = [...new Set(alvos.map(a => a.produtos?.id).filter(Boolean))]
      if (produtoIds.length > 0) {
        const sb = createClient()
        const { data } = await sb.from('produto_estoque').select('produto_id, quantidade')
          .eq('deposito_id', depositoId).in('produto_id', produtoIds)
        estoquePorDeposito = new Map((data ?? []).map((r: any) => [r.produto_id, r.quantidade]))
      }
    }

    // Kits: custo/estoque gravados no produto ficam obsoletos (nunca são
    // recalculados ao editar a composição) — busca ao vivo pra não enviar
    // valor velho pra Shopee.
    const kitsCalculados = new Map<string, { custo: number; estoque: number }>()
    const idsKit = Array.from(new Set<string>(alvos.filter(a => a.produtos?.tipo === 'kit').map(a => String(a.produtos.id))))
    if (idsKit.length > 0) {
      const sb = createClient()
      for (const kitId of idsKit) {
        const resultado = await calcularKit(sb, kitId, modoEstoque === 'deposito' ? (depositoId || null) : null)
        if (resultado) kitsCalculados.set(kitId, resultado)
      }
    }

    for (const a of alvos) {
      if (a.tem_variacao) { pulados.push({ anuncio: a, motivo: 'Possui variações — envie individualmente' }); continue }
      if (!a.id_externo) { pulados.push({ anuncio: a, motivo: 'Sem ID externo (não veio de sincronização)' }); continue }

      const kitInfo = a.produtos?.tipo === 'kit' ? kitsCalculados.get(a.produtos.id) : undefined
      const custoProduto = kitInfo ? kitInfo.custo : a.produtos?.preco_custo
      const estoqueProduto = kitInfo ? kitInfo.estoque : a.produtos?.estoque

      let precoNovo: number | undefined
      if (modoPreco === 'fixo') precoNovo = parseFloat(valorPreco) || 0
      else if (modoPreco === 'percentual') precoNovo = arredondar(a.preco_venda * (1 + (parseFloat(valorPreco) || 0) / 100), arredondamento)
      else if (modoPreco === 'formula') {
        if (!custoProduto || custoProduto <= 0) { pulados.push({ anuncio: a, motivo: 'Produto vinculado sem custo cadastrado (necessário para "Fórmula")' }); continue }
        precoNovo = arredondar((custoProduto + embalagem) * (1 + (parseFloat(valorPreco) || 0) / 100), arredondamento)
      } else if (modoPreco === 'shopee_liquido') {
        if (!custoProduto || custoProduto <= 0) { pulados.push({ anuncio: a, motivo: 'Produto vinculado sem custo cadastrado (necessário para "Margem líquida")' }); continue }
        precoNovo = arredondar(calcularPrecoParaMargem(custoProduto + embalagem, parseFloat(valorPreco) || 0, considerarPix, imposto), arredondamento)
      } else if (modoPreco === 'produto') {
        if (!a.produtos) { pulados.push({ anuncio: a, motivo: 'Sem produto vinculado (necessário para "Do produto vinculado")' }); continue }
        precoNovo = arredondar(a.produtos.preco_venda, arredondamento)
      }

      let estoqueNovo: number | undefined
      if (modoEstoque === 'fixo') estoqueNovo = parseInt(valorEstoque) || 0
      else if (modoEstoque === 'produto') {
        if (!a.produtos) { pulados.push({ anuncio: a, motivo: 'Sem produto vinculado (necessário para "Do produto vinculado")' }); continue }
        estoqueNovo = estoqueProduto ?? 0
      } else if (modoEstoque === 'deposito') {
        if (!depositoId) { pulados.push({ anuncio: a, motivo: 'Nenhum depósito selecionado' }); continue }
        if (!a.produtos) { pulados.push({ anuncio: a, motivo: 'Sem produto vinculado (necessário para "Depósito")' }); continue }
        estoqueNovo = kitInfo ? kitInfo.estoque : (estoquePorDeposito.get(a.produtos.id) ?? 0)
      }
      if (estoqueNovo !== undefined && complementar !== 0) estoqueNovo = estoqueNovo + complementar

      if (precoNovo === undefined && estoqueNovo === undefined) { pulados.push({ anuncio: a, motivo: 'Nenhuma alteração selecionada' }); continue }
      const paraPausar = estoqueNovo !== undefined && risco !== null && estoqueNovo <= risco
      aplicaveis.push({ anuncio: a, precoNovo, estoqueNovo, paraPausar })
    }

    setPreviewMassaPreco({ aplicaveis, pulados })
  }

  async function confirmarMassaPreco() {
    if (!previewMassaPreco) return
    setEnviandoMassaPreco(true)
    const sb = createClient()
    let sucesso = 0, falha = 0
    const idsParaPausar: string[] = []

    for (const { anuncio, precoNovo, estoqueNovo, paraPausar } of previewMassaPreco.aplicaveis) {
      const updates: Record<string, any> = { updated_at: new Date().toISOString() }
      if (precoNovo !== undefined) updates.preco_venda = precoNovo
      if (estoqueNovo !== undefined) updates.estoque_reservado = estoqueNovo
      await sb.from('marketplace_anuncios').update(updates).eq('id', anuncio.id)

      try {
        const resp = await fetch(rotaCanal('push'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId: canal.id, anuncioId: anuncio.id }),
        })
        const data = await resp.json()
        if (data.ok) {
          sucesso++
          setAnuncios(prev => prev.map(a => a.id === anuncio.id ? { ...a, ...updates } : a))
          if (paraPausar) idsParaPausar.push(anuncio.id)
        } else {
          falha++
        }
      } catch {
        falha++
      }
    }

    let resumoPausa = ''
    if (idsParaPausar.length > 0) {
      try {
        const resp = await fetch(rotaCanal('pausar-ativar'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId: canal.id, anuncioIds: idsParaPausar, acao: 'pausar' }),
        })
        const data = await resp.json()
        if (data.atualizados?.length > 0) {
          setAnuncios(prev => prev.map(a => data.atualizados.includes(a.id) ? { ...a, status: 'pausado' } : a))
        }
        resumoPausa = ` · Pausados (estoque de risco): ${data.atualizados?.length ?? 0}`
      } catch {
        resumoPausa = ' · Falha ao pausar por estoque de risco'
      }
    }

    setResumoMassaPreco(`Enviados: ${sucesso} · Falharam: ${falha} · Pulados: ${previewMassaPreco.pulados.length}${resumoPausa}`)
    setSelecionados(new Set())
    setPreviewMassaPreco(null)
    setOpcoesMassaPreco(null)
    setEnviandoMassaPreco(false)
  }

  // Chama sync-item (o mesmo usado no modal de detalhe pra resincronizar um
  // anúncio) um a um pros selecionados — sequencial com um pequeno intervalo
  // entre chamadas, em vez de disparar tudo de uma vez, pra não estourar
  // limite de taxa da Shopee com uma seleção grande.
  async function sincronizarSelecionados() {
    const alvos = filtrados.filter(a => selecionados.has(a.id))
    if (alvos.length === 0) return
    setSincronizandoSelecionados(true); setResumoSincSelecionados('')
    let sucesso = 0, falha = 0, semIdExterno = 0
    const erros: string[] = []

    for (const a of alvos) {
      if (!a.id_externo) { semIdExterno++; continue }
      try {
        const resp = await fetch(rotaCanal('sync-item'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId: canal.id, idExterno: a.id_externo }),
        })
        const data = await resp.json()
        if (data.ok) {
          sucesso++
          setAnuncios(prev => prev.map(x => x.id === data.anuncio.id ? data.anuncio : x))
        } else {
          falha++
          if (data.erro) erros.push(data.erro)
        }
      } catch (e: any) {
        falha++
        erros.push(e.message ?? 'falha de rede')
      }
      await new Promise(r => setTimeout(r, 150))
    }

    const partes = [`${sucesso} sincronizado(s)`]
    if (falha > 0) partes.push(`${falha} falha(s)${erros[0] ? `: ${erros[0]}` : ''}`)
    if (semIdExterno > 0) partes.push(`${semIdExterno} ignorado(s) (sem ID externo)`)
    setResumoSincSelecionados(partes.join(' · '))
    setSelecionados(new Set())
    setSincronizandoSelecionados(false)
  }

  // ── Estoque do sistema → estoque do marketplace ───────────────────────────
  //
  // Diferente do "Enviar p/ Shopee" logo abaixo, que manda o que já está
  // salvo na linha do anúncio: aqui a origem é o ESTOQUE DO PRODUTO no
  // sistema. É o botão para usar depois de uma entrada de mercadoria, de um
  // inventário ou de uma venda por fora — quando o número certo está no
  // cadastro e o marketplace ficou para trás.
  //
  // Nenhuma regra de preço entra nisso: preço não é tocado.
  function rotaPush() {
    return canal.plataforma === 'mercadolivre'
      ? '/api/marketplace/mercadolivre/push'
      : '/api/marketplace/shopee/push'
  }

  async function sincronizarEstoqueSelecionados() {
    const alvos = filtrados.filter(a => selecionados.has(a.id))
    if (alvos.length === 0) return

    setSincEstoqueResumo('')
    const sb = createClient()

    // Kit não tem estoque próprio: o que vale é quantos kits dá para montar
    // com os componentes. O número gravado em `produtos.estoque` do kit pode
    // estar velho, então recalcula — mesma cautela do envio com regra.
    const kitsCalculados = new Map<string, { custo: number; estoque: number }>()
    const idsKit = Array.from(new Set<string>(
      alvos.filter(a => a.produtos?.tipo === 'kit').map(a => String(a.produtos.id)),
    ))
    for (const kitId of idsKit) {
      const r = await calcularKit(sb, kitId)
      if (r) kitsCalculados.set(kitId, r)
    }

    const aplicaveis: { anuncio: any; estoqueNovo: number }[] = []
    const pulados: { anuncio: any; motivo: string }[] = []

    for (const a of alvos) {
      if (!a.produtos) { pulados.push({ anuncio: a, motivo: 'Sem produto vinculado' }); continue }
      if (a.tem_variacao) { pulados.push({ anuncio: a, motivo: 'Possui variações — envie individualmente' }); continue }
      if (!a.id_externo) { pulados.push({ anuncio: a, motivo: 'Sem ID externo (não veio de sincronização)' }); continue }

      const kit = a.produtos.tipo === 'kit' ? kitsCalculados.get(String(a.produtos.id)) : undefined
      const estoqueNovo = Math.max(0, Math.floor(Number(kit ? kit.estoque : a.produtos.estoque ?? 0)))

      // Já igual não vira chamada de API: além de inútil, gasta cota de
      // requisição do marketplace numa seleção grande.
      if (estoqueNovo === Number(a.estoque_reservado ?? -1)) {
        pulados.push({ anuncio: a, motivo: `Já está com ${estoqueNovo}` })
        continue
      }
      aplicaveis.push({ anuncio: a, estoqueNovo })
    }

    if (aplicaveis.length === 0) {
      setSincEstoqueResumo(
        pulados.length > 0
          ? `Nada a enviar. ${pulados.length} anúncio(s) ignorado(s): ${[...new Set(pulados.map(p => p.motivo))].join(' · ')}`
          : 'Nada a enviar.',
      )
      return
    }

    const nomeCanal = canal.plataforma === 'mercadolivre' ? 'Mercado Livre' : 'Shopee'
    const amostra = aplicaveis.slice(0, 5)
      .map(x => `• ${(x.anuncio.titulo ?? '').slice(0, 40)}: ${x.anuncio.estoque_reservado ?? 0} → ${x.estoqueNovo}`)
      .join('\n')
    const ok = confirm(
      `Enviar o estoque do sistema para ${nomeCanal} em ${aplicaveis.length} anúncio(s)?\n\n` +
      `${amostra}${aplicaveis.length > 5 ? `\n• ...e mais ${aplicaveis.length - 5}` : ''}\n\n` +
      `${pulados.length > 0 ? `${pulados.length} ignorado(s).\n` : ''}` +
      `O preço não é alterado.`,
    )
    if (!ok) return

    setSincEstoqueEnviando(true)
    let sucesso = 0, falha = 0
    const erros: string[] = []

    for (const { anuncio, estoqueNovo } of aplicaveis) {
      // Grava aqui antes de mandar: a rota de push lê a linha do anúncio.
      await sb.from('marketplace_anuncios')
        .update({ estoque_reservado: estoqueNovo, updated_at: new Date().toISOString() })
        .eq('id', anuncio.id)

      try {
        const resp = await fetch(rotaPush(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId: canal.id, anuncioId: anuncio.id }),
        })
        const data = await resp.json()
        if (data.ok) {
          sucesso++
          setAnuncios(prev => prev.map(x => x.id === anuncio.id ? { ...x, estoque_reservado: estoqueNovo } : x))
        } else {
          falha++
          if (data.erro) erros.push(data.erro)
        }
      } catch (e: any) {
        falha++
        erros.push(e.message ?? 'falha de rede')
      }
      // Intervalo curto entre chamadas — seleção grande estoura o limite de
      // requisições do marketplace se disparar tudo de uma vez.
      await new Promise(r => setTimeout(r, 150))
    }

    const partes = [`${sucesso} enviado(s)`]
    if (falha > 0) partes.push(`${falha} falha(s)${erros[0] ? `: ${erros[0]}` : ''}`)
    if (pulados.length > 0) partes.push(`${pulados.length} ignorado(s)`)
    setSincEstoqueResumo(partes.join(' · '))
    setSincEstoqueEnviando(false)
    setSelecionados(new Set())
  }

  // Sistema → Shopee: manda o preço/estoque que JÁ está salvo aqui, sem
  // aplicar regra/fórmula nenhuma (isso é o botão "Atualizar preço/estoque
  // na Shopee", separado). Mesma rota usada no envio individual
  // (EnviarPrecoEstoqueModal), só que sem abrir modal por item.
  async function enviarSelecionadosParaShopee() {
    const alvos = filtrados.filter(a => selecionados.has(a.id))
    if (alvos.length === 0) return
    if (!confirm(`Enviar preço/estoque atuais de ${alvos.length} anúncio(s) para ${nomeCanalPlataforma}?`)) return

    setEnviandoSelecionados(true); setResumoEnvioSelecionados('')
    let sucesso = 0, falha = 0, semIdExterno = 0
    const erros: string[] = []

    for (const a of alvos) {
      if (!a.id_externo) { semIdExterno++; continue }
      try {
        const resp = await fetch(rotaCanal('push'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId: canal.id, anuncioId: a.id }),
        })
        const data = await resp.json()
        if (data.ok) {
          sucesso++
          setAnuncios(prev => prev.map(x => x.id === a.id ? { ...x, ultima_atualizacao: new Date().toISOString(), sincronizado_em: new Date().toISOString() } : x))
        } else {
          falha++
          const msg = [data.erroPreco, data.erroEstoque, data.erro].filter(Boolean)[0]
          if (msg) erros.push(msg)
        }
      } catch (e: any) {
        falha++
        erros.push(e.message ?? 'falha de rede')
      }
      await new Promise(r => setTimeout(r, 150))
    }

    const partes = [`${sucesso} enviado(s)`]
    if (falha > 0) partes.push(`${falha} falha(s)${erros[0] ? `: ${erros[0]}` : ''}`)
    if (semIdExterno > 0) partes.push(`${semIdExterno} ignorado(s) (sem ID externo)`)
    setResumoEnvioSelecionados(partes.join(' · '))
    setSelecionados(new Set())
    setEnviandoSelecionados(false)
  }

  async function pausarOuAtivarSelecionados(acao: 'pausar' | 'ativar') {
    const ids = filtrados.filter(a => selecionados.has(a.id)).map(a => a.id)
    if (ids.length === 0) return
    const verbo = acao === 'pausar' ? 'pausar' : 'ativar'
    if (!confirm(`${verbo === 'pausar' ? 'Pausar' : 'Ativar'} ${ids.length} anúncio(s) ${preposicao} ${nomeCanalPlataforma}? Isso muda a visibilidade pros clientes imediatamente.`)) return

    setPausandoAtivando(true); setResumoPausarAtivar('')
    try {
      const resp = await fetch(rotaCanal('pausar-ativar'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canalId: canal.id, anuncioIds: ids, acao }),
      })
      const data = await resp.json()
      if (data.atualizados?.length > 0) {
        const novoStatus = acao === 'pausar' ? 'pausado' : 'ativo'
        setAnuncios(prev => prev.map(a => data.atualizados.includes(a.id) ? { ...a, status: novoStatus } : a))
      }
      const partes = [`${data.atualizados?.length ?? 0} ${verbo === 'pausar' ? 'pausado(s)' : 'ativado(s)'}`]
      if (data.falhasCount > 0) partes.push(`${data.falhasCount} falha(s)${data.erros?.[0] ? `: ${data.erros[0]}` : ''}`)
      if (data.semIdExterno > 0) partes.push(`${data.semIdExterno} ignorado(s) (sem ID externo)`)
      if (!data.ok && !data.atualizados) partes.push(data.erro ?? 'Falha ao atualizar')
      setResumoPausarAtivar(partes.join(' · '))
      setSelecionados(new Set())
    } catch (e: any) {
      setResumoPausarAtivar(`Erro: ${e.message ?? 'falha ao atualizar status'}`)
    } finally {
      setPausandoAtivando(false)
    }
  }

  function alternarFaceta(key: string) {
    setFacetas(prev => {
      const novo = new Set(prev)
      if (novo.has(key)) novo.delete(key); else novo.add(key)
      return novo
    })
  }

  const formVazio = {
    produto_id: '', titulo: '', descricao: '', preco_venda: '',
    preco_promocional: '', promo_inicio: '', promo_fim: '',
    estoque_reservado: '0', id_externo: '', url_anuncio: '', sku_canal: '', status: 'rascunho',
  }
  const [form, setForm] = useState(formVazio)

  function f(k: string, v: any) { setForm(p => ({ ...p, [k]: v })) }

  function abrirNovo() {
    setEditando(null); setForm(formVazio); setBuscaProd(''); setModal(true)
  }

  function abrirEditar(a: any) {
    setEditorAberto(a)
  }

  function selecionarProduto(p: any) {
    const precoSugerido = (p.preco_venda * (1 + (canal.markup_canal ?? 0) / 100)).toFixed(2)
    f('produto_id', p.id)
    f('titulo', p.nome)
    f('preco_venda', precoSugerido)
    f('sku_canal', p.sku ?? '')
    setBuscaProd(p.nome)
  }

  async function salvar() {
    if (!form.titulo.trim()) { setErro('Título obrigatório.'); return }
    if (!form.preco_venda || parseFloat(form.preco_venda) <= 0) { setErro('Preço de venda obrigatório.'); return }
    setSalvando(true); setErro('')
    const sb = createClient()
    const payload = {
      empresa_id: empresaId,
      canal_id: canal.id,
      produto_id: form.produto_id || null,
      titulo: form.titulo.trim(),
      descricao: form.descricao || null,
      preco_venda: parseFloat(form.preco_venda),
      preco_promocional: form.preco_promocional ? parseFloat(form.preco_promocional) : null,
      promo_inicio: form.promo_inicio || null,
      promo_fim: form.promo_fim || null,
      estoque_reservado: parseInt(form.estoque_reservado) || 0,
      id_externo: form.id_externo || null,
      url_anuncio: form.url_anuncio || null,
      sku_canal: form.sku_canal || null,
      status: form.status,
    }

    if (editando) {
      const { data, error } = await sb.from('marketplace_anuncios').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editando.id).select('*, produtos(id,nome,sku,preco_venda,estoque,tipo,tags)').single()
      if (error) { setErro(error.message); setSalvando(false); return }
      setAnuncios(prev => prev.map(a => a.id === editando.id ? data : a))
    } else {
      const { data, error } = await sb.from('marketplace_anuncios').insert(payload).select('*, produtos(id,nome,sku,preco_venda,estoque,tipo,tags)').single()
      if (error) { setErro(error.message); setSalvando(false); return }
      setAnuncios(prev => [data, ...prev])
    }
    setSalvando(false)
    setModal(false)
    router.refresh()
  }

  async function sincronizar() {
    setSincronizando(true); setResumoSync(''); setErro('')
    try {
      // Uma rota por plataforma: a Nuvemshop também tem `sync` desde a
      // importação do catálogo, e mandá-la para a rota da Shopee só produzia
      // "canal não encontrado".
      const PLATAFORMAS_COM_SYNC = ['shopee', 'mercadolivre', 'nuvemshop']
      const endpoint = `/api/marketplace/${PLATAFORMAS_COM_SYNC.includes(canal.plataforma) ? canal.plataforma : 'shopee'}/sync`
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canalId: canal.id }),
      })
      const data = await resp.json()
      if (!data.ok) { setErro(data.erro ?? 'Erro ao sincronizar'); return }
      setResumoSync(
        `Encontrados: ${data.totalFound} · Sincronizados: ${data.upserted} · Falharam: ${data.failedCount}` +
        (data.truncated ? ' · Catálogo maior que o limite — sincronize novamente para continuar' : '') +
        ' · dados importados serão sobrescritos a cada sincronização'
      )
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao sincronizar')
    } finally {
      setSincronizando(false)
      router.refresh()
    }
  }

  async function excluir(id: string) {
    if (!confirm('Excluir este anúncio?')) return
    const sb = createClient()
    await sb.from('marketplace_anuncios').delete().eq('id', id)
    setAnuncios(prev => prev.filter(a => a.id !== id))
  }

  // Trocar entre ativo/pausado num anúncio Shopee ou Mercado Livre já
  // sincronizado precisa refletir no marketplace de verdade — esse dropdown
  // historicamente só mudava a coluna local (nada avisava o marketplace),
  // então o anúncio continuava do jeito que estava lá mesmo depois de
  // "pausar" aqui. rascunho/encerrado não têm equivalente em
  // unlist_item/status, continuam só locais.
  async function alterarStatus(id: string, novoStatus: string) {
    const anuncio = anuncios.find(a => a.id === id)
    const ehTogglePausarAtivar = (novoStatus === 'pausado' || novoStatus === 'ativo')
      && (anuncio?.status === 'pausado' || anuncio?.status === 'ativo')
    const plataformaComEscrita = canal.plataforma === 'shopee' || canal.plataforma === 'mercadolivre'

    if (plataformaComEscrita && ehTogglePausarAtivar && anuncio?.id_externo) {
      const acao = novoStatus === 'pausado' ? 'pausar' : 'ativar'
      const nomePlataforma = canal.plataforma === 'mercadolivre' ? 'Mercado Livre' : 'Shopee'
      try {
        const resp = await fetch(`/api/marketplace/${canal.plataforma}/pausar-ativar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId: canal.id, anuncioIds: [id], acao }),
        })
        const data = await resp.json()
        if (data.atualizados?.length > 0) {
          setAnuncios(prev => prev.map(a => a.id === id ? { ...a, status: novoStatus } : a))
        } else {
          alert(`Não foi possível ${acao} n${canal.plataforma === 'mercadolivre' ? 'o' : 'a'} ${nomePlataforma}: ${data.erros?.[0] ?? data.erro ?? 'erro desconhecido'}`)
        }
      } catch (e: any) {
        alert(`Erro ao ${acao} n${canal.plataforma === 'mercadolivre' ? 'o' : 'a'} ${nomePlataforma}: ${e.message ?? 'falha de rede'}`)
      }
      return
    }

    const sb = createClient()
    await sb.from('marketplace_anuncios').update({ status: novoStatus }).eq('id', id)
    setAnuncios(prev => prev.map(a => a.id === id ? { ...a, status: novoStatus } : a))
  }

  const tagsDisponiveis = Array.from(new Set<string>(anuncios.flatMap(a => (a.produtos?.tags ?? []) as string[]))).sort()

  const filtrados = anuncios.filter(a => {
    const matchQ = !q || a.titulo.toLowerCase().includes(q.toLowerCase())
    const matchS = !statusFiltro || a.status === statusFiltro
    const matchTag = !tagFiltro || (a.produtos?.tags ?? []).includes(tagFiltro)
    const matchFalta = !faltaFiltro || (a.qualidade_faltas ?? []).includes(faltaFiltro)
    if (!matchQ || !matchS || !matchTag || !matchFalta) return false

    for (const faceta of facetas) {
      if (faceta === 'mapeado' && !estaMapeado(a)) return false
      if (faceta === 'nao_mapeado' && estaMapeado(a)) return false
      if (faceta === 'sem_sku' && a.sku_canal) return false
      if (faceta === 'sem_estoque' && (a.estoque_externo ?? null) !== 0) return false
      if (faceta === 'com_variacao' && !a.tem_variacao) return false
      if (faceta === 'divergente' && !temDivergencia(a)) return false
      if (faceta === 'qualidade_ruim' && !(a.qualidade_em != null && Number(a.qualidade_score ?? 100) <= 40)) return false
      if (faceta === 'qualidade_boa' && !(a.qualidade_em != null && Number(a.qualidade_score ?? 0) > 80)) return false
    }
    return true
  })

  // Renderizar 2000+ linhas de uma vez deixa a tela pesada — pagina o que é
  // exibido, mas mantém "selecionar todos" e ações em massa operando sobre
  // `filtrados` inteiro (todas as páginas), não só a página visível.
  useEffect(() => { setPagina(1) }, [q, statusFiltro, tagFiltro, faltaFiltro, facetas])
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / ITENS_POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const paginados = filtrados.slice((paginaAtual - 1) * ITENS_POR_PAGINA, paginaAtual * ITENS_POR_PAGINA)

  // Busca produto ao vivo no banco (não filtra a lista inicial, que é só um
  // fallback pequeno) — evita não achar produtos fora de uma janela limitada
  // e permite localizar por qualquer palavra do nome/SKU, não só um trecho
  // contíguo exato.
  const [produtosFiltrados, setProdutosFiltrados] = useState<any[]>([])
  useEffect(() => {
    if (!modal) { setProdutosFiltrados([]); return }
    const termo = buscaProd.trim()
    if (termo.length < 2) { setProdutosFiltrados([]); return }
    let ativo = true
    const timer = setTimeout(async () => {
      const sb = createClient()
      const palavras = termo.toLowerCase().split(/\s+/).map(p => p.replace(/[,()%]/g, '')).filter(Boolean)
      let query = sb.from('produtos')
        .select('id, nome, sku, preco_venda, preco_custo, estoque, ativo')
        .eq('empresa_id', empresaId).eq('ativo', true).order('nome').limit(8)
      for (const palavra of palavras) {
        query = query.or(`nome.ilike.%${palavra}%,sku.ilike.%${palavra}%`)
      }
      const { data } = await query
      if (ativo) setProdutosFiltrados(data ?? [])
    }, 250)
    return () => { ativo = false; clearTimeout(timer) }
  }, [buscaProd, modal, empresaId])

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <a href="/dashboard/marketplaces" className="hover:text-gray-600">marketplaces</a><span>›</span>
        <a href={`/dashboard/marketplaces/${canal.id}`} className="hover:text-gray-600">{canal.nome}</a><span>›</span>
        <span className="text-gray-600 font-medium">anúncios</span>
      </div>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Anúncios — {canal.nome}</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {anuncios.length} anúncio(s) cadastrados
            {filtrados.length !== anuncios.length && ` · ${filtrados.length} nos filtros atuais`}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {canais.length > 1 && (
            <select value={canal.id} onChange={e => router.push(`/dashboard/marketplaces/${e.target.value}/anuncios${filtrosNaUrl()}`)}
              title="Troca de canal mantendo a busca e os filtros atuais"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
              {canais.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          )}
          {canal.plataforma === 'shopee' && (
            <a href={`/dashboard/marketplaces/${canal.id}/promocoes`}
              className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium rounded-lg">
              🏷️ Promoções
            </a>
          )}
          {(canal.plataforma === 'shopee' || canal.plataforma === 'mercadolivre' || canal.plataforma === 'nuvemshop') && (
            <button onClick={sincronizar} disabled={sincronizando}
              className="px-4 py-2 border border-blue-300 text-blue-600 text-sm font-medium rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors">
              {sincronizando ? 'Sincronizando...' : '↺ Sincronizar agora'}
            </button>
          )}
          {canal.plataforma === 'shopee' && (
            <button onClick={() => setCriarAnuncioShopeeAberto(true)}
              title="Cria um anúncio de verdade na Shopee via API, a partir de um produto do catálogo"
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg transition-colors">
              Publicar na Shopee
            </button>
          )}
          {canal.plataforma === 'mercadolivre' && (
            <button onClick={() => setCriarAnuncioMLAberto(true)}
              title="Cria um anúncio de verdade no Mercado Livre via API, a partir de um produto do catálogo"
              className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-medium rounded-lg transition-colors">
              Publicar no Mercado Livre
            </button>
          )}
          {canal.plataforma === 'nuvemshop' && (
            <button onClick={() => setCriarAnuncioNuvemshopAberto(true)}
              title="Cria o produto de verdade na loja Nuvemshop via API, a partir de um produto do catálogo"
              className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium rounded-lg transition-colors">
              Publicar na Nuvemshop
            </button>
          )}
          <button onClick={abrirNovo}
            title="Só registra localmente um anúncio que você já criou manualmente na Shopee/ML — não chama a API"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
            + Novo anúncio
          </button>
        </div>
      </div>

      {/* PERGUNTE AO VARGAS — ANUNCIOS.
          Recolhido por padrao: esta tela ja abre com muita coisa, e quem vem
          aqui na maioria das vezes vem editar anuncio, nao perguntar. O
          contexto nao viaja daqui — a rota monta a partir do canal, entao o
          botao so precisa do id. */}
      <div className="mb-4">
        {perguntarAberto ? (
          <AskVargas
            context={{ canalId: canal.id }}
            endpoint="/api/marketplaces/perguntar"
            descricao={`Pergunte sobre os anúncios e campanhas de ${canal.nome}. As respostas dizem de onde veio cada número — e o que não dá para responder com os dados desta tela.`}
            exemplo="Ex.: Quantos anúncios estão sem produto vinculado?"
            perguntasSugeridas={[
              'Quantos anúncios estão sem produto vinculado?',
              'Os preços deste canal usam comissão medida ou configurada?',
              'De quando são os dados desta tela?',
            ]}
          />
        ) : (
          <button onClick={() => setPerguntarAberto(true)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100">
            ✦ Pergunte ao Vargas
          </button>
        )}
      </div>

      {resumoSync && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 text-xs px-4 py-2.5 rounded-lg mb-4">{resumoSync}</div>
      )}
      {erro && !modal && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-2.5 rounded-lg mb-4">{erro}</div>
      )}

      {/* Filtros */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por título..."
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 w-64 bg-white" />
        <div className="flex gap-1">
          {[['', 'Todos'], ['ativo', 'Ativos'], ['pausado', 'Pausados'], ['rascunho', 'Rascunhos'], ['encerrado', 'Encerrados']].map(([s, l]) => (
            <button key={s} onClick={() => setStatusFiltro(s)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${statusFiltro === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
              {l}
            </button>
          ))}
        </div>
        {tagsDisponiveis.length > 0 && (
          <select value={tagFiltro} onChange={e => setTagFiltro(e.target.value)}
            className="border border-gray-300 rounded-lg px-2.5 py-2 text-xs text-gray-600 focus:outline-none focus:border-blue-500 bg-white">
            <option value="">Todas as tags</option>
            {tagsDisponiveis.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <select value={faltaFiltro} onChange={e => setFaltaFiltro(e.target.value)}
          title="Anúncios com esta pendência de qualidade"
          className="border border-gray-300 rounded-lg px-2.5 py-2 text-xs text-gray-600 focus:outline-none focus:border-blue-500 bg-white">
          <option value="">Qualidade: qualquer falta</option>
          {Object.values(FALTAS_CATALOGO).map(f => (
            <option key={f.codigo} value={f.codigo}>Falta: {f.titulo}</option>
          ))}
        </select>
        {/* Só aparece quando há o que limpar: botão morto ao lado de campo
            vazio é ruído, e some justamente quando some a dúvida. Zera tudo
            de uma vez — busca, status, tag, falta e as facetas de baixo. */}
        {temFiltroAtivo && (
          <button type="button" onClick={limparFiltros}
            title="Zera a busca e todos os filtros desta tela"
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
            ⊗ limpar filtros
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <span className="text-xs text-gray-400 mr-1">Filtrar:</span>
        {FACETAS.map(fac => (
          <button key={fac.key} onClick={() => alternarFaceta(fac.key)}
            className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${facetas.has(fac.key) ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
            {fac.label}
          </button>
        ))}
        {/* Escopo desta linha só. Convive com o "limpar filtros" de cima,
            que zera tudo — daí o rótulo dizer o que cada um alcança. */}
        {facetas.size > 0 && (
          <button onClick={() => setFacetas(new Set())} className="text-xs text-gray-400 hover:text-gray-600 ml-1">✕ limpar estes</button>
        )}
      </div>

      {selecionados.size > 0 && (
        <div className="flex items-center gap-3 bg-purple-50 border border-purple-200 rounded-xl px-4 py-2.5 mb-4">
          <span className="text-sm text-purple-700 font-medium">{selecionados.size} selecionado(s)</span>
          {temEscrita && (
            <button onClick={sincronizarSelecionados} disabled={sincronizandoSelecionados}
              title={`Puxa d${ehML ? "o" : "a"} ${nomeCanalPlataforma} para o sistema: status, preço, estoque, imagens...`}
              className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg">
              {sincronizandoSelecionados ? 'Atualizando...' : `⇣ Atualizar d${ehML ? 'o' : 'a'} ${nomeCurto}`}
            </button>
          )}
          {temEscrita && (
            <button onClick={enviarSelecionadosParaShopee} disabled={enviandoSelecionados}
              title={`Manda o preço/estoque que já está salvo aqui para ${nomeCanalPlataforma}`}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg">
              {enviandoSelecionados ? 'Enviando...' : `⇡ Enviar p/ ${nomeCurto}`}
            </button>
          )}
          {/* Vale para Shopee e Mercado Livre — as duas têm rota de push. */}
          <button onClick={sincronizarEstoqueSelecionados} disabled={sincEstoqueEnviando}
            title="Pega o estoque do produto no sistema e manda para o anúncio. O preço não é alterado."
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg">
            {sincEstoqueEnviando ? 'Enviando estoque...' : '📦 Sincronizar estoque'}
          </button>
          <button onClick={() => setMapeamentoRapido(filtrados.filter(a => selecionados.has(a.id)).map(a => a.id))}
            title="Sugere um produto para cada anúncio e deixa você conferir linha a linha antes de aplicar"
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded-lg">
            ⚡ Mapeamento rápido
          </button>
          <button onClick={prepararMapeamentoMassa}
            title="Casa apenas SKU idêntico, tudo de uma vez, sem conferência linha a linha"
            className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-600 border border-slate-300 text-xs font-medium rounded-lg">
            Mapear por SKU exato
          </button>
          {canaisDestino.length > 0 && (
            <button onClick={() => { setReplicarAberto(true); setReplicarResultado(null); setReplicarDestino(canaisDestino[0].id) }}
              title="Cria os mesmos anúncios em outra conta deste marketplace"
              className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium rounded-lg">
              ⧉ Replicar p/ outro canal
            </button>
          )}
          {temEscrita && (
            <button onClick={() => { setRegraSelecionadaId(''); setOpcoesMassaPreco({ modoPreco: 'nao', valorPreco: '', arredondamento: 'nenhum', considerarPix: false, valorEmbalagem: '', percentualImposto: '', modoEstoque: 'nao', valorEstoque: '', depositoId: '', estoqueComplementar: '', estoqueRisco: '' }) }}
              className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-medium rounded-lg">
              Atualizar preço/estoque {preposicao} {nomeCanalPlataforma}
            </button>
          )}
          {temEscrita && (
            <a href={`/dashboard/marketplaces/${canal.id}/regras`}
              className="px-3 py-1.5 border border-gray-300 text-gray-600 hover:bg-gray-50 text-xs font-medium rounded-lg">
              Gerenciar regras
            </a>
          )}
          {temEscrita && (
            <button onClick={() => pausarOuAtivarSelecionados('pausar')} disabled={pausandoAtivando}
              className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg">
              Pausar
            </button>
          )}
          {temEscrita && (
            <button onClick={() => pausarOuAtivarSelecionados('ativar')} disabled={pausandoAtivando}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg">
              Ativar
            </button>
          )}
          <button onClick={() => setSelecionados(new Set())} className="text-xs text-purple-400 hover:text-purple-600 ml-auto">✕ limpar seleção</button>
        </div>
      )}

      {resumoMassaPreco && (
        <div className="bg-orange-50 border border-orange-200 text-orange-700 text-xs px-4 py-2.5 rounded-lg mb-4 flex items-center justify-between">
          <span>{resumoMassaPreco}</span>
          <button onClick={() => setResumoMassaPreco('')} className="text-orange-400 hover:text-orange-600">✕</button>
        </div>
      )}

      {resumoPausarAtivar && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 text-xs px-4 py-2.5 rounded-lg mb-4 flex items-center justify-between">
          <span>{resumoPausarAtivar}</span>
          <button onClick={() => setResumoPausarAtivar('')} className="text-yellow-500 hover:text-yellow-700">✕</button>
        </div>
      )}

      {resumoSincSelecionados && (
        <div className="bg-cyan-50 border border-cyan-200 text-cyan-700 text-xs px-4 py-2.5 rounded-lg mb-4 flex items-center justify-between">
          <span>{resumoSincSelecionados}</span>
          <button onClick={() => setResumoSincSelecionados('')} className="text-cyan-500 hover:text-cyan-700">✕</button>
        </div>
      )}

      {resumoEnvioSelecionados && (
        <div className="bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs px-4 py-2.5 rounded-lg mb-4 flex items-center justify-between">
          <span>{resumoEnvioSelecionados}</span>
          <button onClick={() => setResumoEnvioSelecionados('')} className="text-indigo-500 hover:text-indigo-700">✕</button>
        </div>
      )}

      {sincEstoqueResumo && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs px-4 py-2.5 rounded-lg mb-4 flex items-center justify-between">
          <span>{sincEstoqueResumo}</span>
          <button onClick={() => setSincEstoqueResumo('')} className="text-emerald-500 hover:text-emerald-700">✕</button>
        </div>
      )}

      {/* ── Cards (celular) ──────────────────────────────────────────────
          A tabela tem 7 colunas e não cabe num celular nem com rolagem: pra
          mapear é preciso ver foto, título e produto vinculado ao mesmo
          tempo, e rolando pro lado some justamente a foto.
          Aqui cada anúncio é um cartão focado no que trava o trabalho —
          está vinculado ou não — com o botão Mapear à mão. É a MESMA lista
          (`paginados`) e os MESMOS handlers da tabela; nada foi duplicado
          em lógica, só a apresentação. */}
      <div className="md:hidden space-y-2">
        {paginados.length > 0 && (
          <label className="flex items-center gap-2 px-1 pb-1 text-xs text-gray-500">
            <input type="checkbox"
              checked={filtrados.length > 0 && filtrados.every(x => selecionados.has(x.id))}
              onChange={e => setSelecionados(e.target.checked ? new Set(filtrados.map(x => x.id)) : new Set())}
              className="w-4 h-4 accent-purple-600" />
            Selecionar todos os {filtrados.length} filtrados
          </label>
        )}

        {paginados.map(a => (
          <div key={a.id}
            className={`bg-white border rounded-xl p-3 ${
              selecionados.has(a.id) ? 'border-purple-300 ring-1 ring-purple-100' : 'border-gray-200'
            }`}>
            <div className="flex gap-3">
              <input type="checkbox" checked={selecionados.has(a.id)} onChange={() => toggleSelecionado(a.id)}
                className="w-5 h-5 mt-0.5 accent-purple-600 flex-shrink-0" />
              {a.imagens?.[0] ? (
                <img src={a.imagens[0]} alt="" className="w-14 h-14 flex-shrink-0 rounded-lg object-cover border border-gray-200" />
              ) : (
                <div className="w-14 h-14 flex-shrink-0 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300">📷</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900 leading-snug line-clamp-2">{a.titulo}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {a.sku_canal ? `SKU ${a.sku_canal}` : 'sem SKU no canal'} · {fmt(a.preco_venda)}
                </p>
                {a.qualidade_em != null && (
                  <p className="text-xs mt-0.5">
                    {a.qualidade_health != null && <span className="text-gray-500">{Math.round(Number(a.qualidade_health) * 100)}% ML · </span>}
                    <span className={faixaScore(Number(a.qualidade_score ?? 0)).cor}>{a.qualidade_score} checklist</span>
                  </p>
                )}
              </div>
            </div>

            {/* O estado do vínculo é a informação que decide a próxima ação,
                então ganha linha própria em vez de virar mais uma etiqueta. */}
            <div className="mt-2.5 pt-2.5 border-t border-gray-100 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                {estaMapeado(a) ? (
                  <p className="text-xs text-emerald-700 truncate">
                    ✓ {a.produtos?.nome ?? 'Vinculado por variação'}
                    {a.produtos?.sku && <span className="text-emerald-600/70"> · {a.produtos.sku}</span>}
                  </p>
                ) : (
                  <p className="text-xs text-gray-500">Não vinculado a nenhum produto</p>
                )}
                {temDivergencia(a) && <p className="text-xs text-amber-700 mt-0.5">⚠ Diverge do produto</p>}
              </div>
              <button onClick={() => setMapeandoAberto(a)}
                className={`text-xs px-3 h-8 rounded-lg flex-shrink-0 ${
                  estaMapeado(a)
                    ? 'border border-gray-200 text-gray-600'
                    : 'bg-purple-600 text-white font-medium'
                }`}>
                {estaMapeado(a) ? 'Trocar' : 'Mapear'}
              </button>
            </div>
          </div>
        ))}

        {paginados.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-10">Nenhum anúncio com os filtros atuais.</p>
        )}
      </div>

      {/* ── Tabela (desktop) — inalterada ────────────────────────────────── */}
      <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 w-10">
                <input type="checkbox"
                  checked={filtrados.length > 0 && filtrados.every(a => selecionados.has(a.id))}
                  onChange={e => setSelecionados(e.target.checked ? new Set(filtrados.map(a => a.id)) : new Set())}
                  className="w-4 h-4 accent-purple-600" />
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Título / Produto</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">SKU canal</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-24">Qualidade</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">Estoque</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-24">Vendas</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Preço venda</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Preço promo</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">Status</th>
              <th className="px-4 py-3 w-28"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paginados.map(a => (
              <tr key={a.id} className={`group hover:bg-gray-50 transition-colors ${temDivergencia(a) ? 'border-l-2 border-amber-300' : ''}`}>
                <td className="px-4 py-3">
                  <input type="checkbox" checked={selecionados.has(a.id)} onChange={() => toggleSelecionado(a.id)}
                    className="w-4 h-4 accent-purple-600" />
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    {a.imagens?.[0] ? (
                      <img src={a.imagens[0]} alt="" className="w-20 h-20 flex-shrink-0 rounded-lg object-cover bg-white border border-gray-200" />
                    ) : (
                      <div className="w-20 h-20 flex-shrink-0 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300 text-2xl">📷</div>
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">{a.titulo}</p>
                      {a.produtos && <p className="text-xs text-gray-400">{a.produtos.sku} · Preço base: {fmt(a.produtos.preco_venda)}</p>}
                      {(a.marca_externa || a.categoria_externa) && (
                        <p className="text-xs text-gray-400">
                          {a.marca_externa}{a.marca_externa && a.categoria_externa && ' · '}{a.categoria_externa && `Categoria ${a.categoria_externa}`}
                        </p>
                      )}
                      {a.tem_variacao && (a.marketplace_anuncio_variacoes?.length ?? 0) > 0 && (
                        <p className="text-xs text-purple-500 truncate max-w-xs" title={nomesVariacoes(a)}>
                          {nomesVariacoes(a)}
                        </p>
                      )}
                      <div className="flex gap-1 flex-wrap mt-0.5">
                        {canal.plataforma === 'mercadolivre' && tipoAnuncioML(a) && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full border ${tipoAnuncioML(a) === 'Premium' ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-sky-700 bg-sky-50 border-sky-200'}`}>
                            {tipoAnuncioML(a)}
                          </span>
                        )}
                        {a.tem_variacao && <span className="text-xs text-purple-600 bg-purple-50 border border-purple-100 px-1.5 py-0.5 rounded-full">Com variações</span>}
                        {!estaMapeado(a) && <span className="text-xs text-gray-500 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded-full">Não vinculado</span>}
                        {temDivergencia(a) && <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">⚠ Diverge do produto</span>}
                        {(a.produtos?.tags ?? []).map((t: string) => (
                          <span key={t} className="text-xs text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded-full">{t}</span>
                        ))}
                      </div>
                      {a.id_externo && <p className="text-xs text-gray-400 font-mono">ID: {a.id_externo}</p>}
                      {a.url_anuncio && (
                        <a href={a.url_anuncio} target="_blank" rel="noreferrer"
                          className="text-xs text-blue-500 hover:underline">Ver no marketplace ↗</a>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500 font-mono">{a.sku_canal || '—'}</td>
                <td className="px-4 py-3">
                  <button onClick={() => setDetalheAberto(a)} className="text-left hover:opacity-70" title="Ver pendências de qualidade">
                    <QualidadeColuna anuncio={a} />
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <p className="text-gray-900 font-mono text-sm">{a.estoque_reservado ?? 0}</p>
                  {a.produtos && <p className="text-xs text-gray-400">estoque: {a.produtos.estoque ?? 0}</p>}
                </td>
                <td className="px-4 py-3 text-right text-gray-600 font-mono text-sm">{a.vendas ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <p className="font-semibold text-gray-900">{fmt(a.preco_venda)}</p>
                  <SaudeDoAnuncio anuncio={a} cfg={configPreco} />
                </td>
                <td className="px-4 py-3 text-right">
                  {a.preco_promocional ? (
                    <div>
                      <p className="text-green-600 font-semibold">{fmt(a.preco_promocional)}</p>
                      {a.promo_fim && <p className="text-xs text-gray-400">até {new Date(a.promo_fim + 'T00:00:00').toLocaleDateString('pt-BR')}</p>}
                    </div>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-center">
                  <select value={a.status} onChange={e => alterarStatus(a.id, e.target.value)}
                    className={`text-xs font-medium px-2 py-0.5 rounded-full border-0 cursor-pointer focus:outline-none ${STATUS_CORES[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setMapeandoAberto(a)}
                      className={`text-xs font-medium ${!a.produtos ? 'text-purple-600 hover:text-purple-800' : 'text-gray-500 hover:text-gray-700'}`}>
                      Mapear
                    </button>
                    {a.produtos && (
                      <button onClick={() => setEnriquecendoAberto(a)} className="text-xs text-emerald-600 hover:text-emerald-800 font-medium">Enriquecer</button>
                    )}
                    {(canal.plataforma === 'shopee' || canal.plataforma === 'mercadolivre') && a.id_externo && (
                      <button onClick={() => setEnviandoPrecoAberto(a)} className="text-xs text-orange-600 hover:text-orange-800 font-medium">
                        Enviar p/ {canal.plataforma === 'mercadolivre' ? 'ML' : 'Shopee'}
                      </button>
                    )}
                    <button onClick={() => setDetalheAberto(a)} className="text-xs text-gray-600 hover:text-gray-900 font-medium">Detalhes</button>
                    <button onClick={() => abrirEditar(a)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Editar</button>
                    <button onClick={() => excluir(a.id)} className="text-xs text-red-500 hover:text-red-700">Excluir</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr><td colSpan={10} className="py-12 text-center text-gray-400">
                {anuncios.length === 0 ? 'Nenhum anúncio cadastrado.' : 'Nenhum anúncio encontrado para os filtros aplicados.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {filtrados.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
          <span>
            Mostrando {(paginaAtual - 1) * ITENS_POR_PAGINA + 1}–{Math.min(paginaAtual * ITENS_POR_PAGINA, filtrados.length)} de {filtrados.length}
          </span>
          {totalPaginas > 1 && (
            <div className="flex items-center gap-2">
              <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={paginaAtual === 1}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-xs font-medium hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white">
                ← Anterior
              </button>
              <span className="text-xs text-gray-500">Página {paginaAtual} de {totalPaginas}</span>
              <button onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={paginaAtual === totalPaginas}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-xs font-medium hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white">
                Próxima →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modal anúncio */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h2 className="text-lg font-semibold text-gray-900">{editando ? 'Editar Anúncio' : 'Novo Anúncio'}</h2>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              {/* Produto */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Produto vinculado <span className="text-gray-400">(opcional)</span></label>
                <div className="relative">
                  <input value={buscaProd} onChange={e => { setBuscaProd(e.target.value); if (form.produto_id) f('produto_id', '') }}
                    placeholder="Buscar produto do sistema..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  {produtosFiltrados.length > 0 && !form.produto_id && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-10 overflow-hidden">
                      {produtosFiltrados.map(p => (
                        <button key={p.id} onClick={() => selecionarProduto(p)}
                          className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-gray-100 last:border-0">
                          <p className="text-sm font-medium text-gray-900">{p.nome}</p>
                          <p className="text-xs text-gray-400">{p.sku} · Venda: {fmt(p.preco_venda)} · Estoque: {p.estoque}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {form.produto_id && (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-green-600 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">✓ {buscaProd}</span>
                    <button onClick={() => { f('produto_id', ''); setBuscaProd('') }} className="text-xs text-gray-400 hover:text-gray-600">remover</button>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Título do anúncio *</label>
                <input value={form.titulo} onChange={e => f('titulo', e.target.value)}
                  placeholder="Título que aparecerá no marketplace"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Descrição</label>
                <textarea value={form.descricao} onChange={e => f('descricao', e.target.value)} rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none" />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Preço de venda (R$) *</label>
                  <input type="number" step="0.01" value={form.preco_venda} onChange={e => f('preco_venda', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Preço promocional</label>
                  <input type="number" step="0.01" value={form.preco_promocional} onChange={e => f('preco_promocional', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Estoque reservado</label>
                  <input type="number" value={form.estoque_reservado} onChange={e => f('estoque_reservado', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>

              {form.preco_promocional && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Início promoção</label>
                    <input type="date" value={form.promo_inicio} onChange={e => f('promo_inicio', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Fim promoção</label>
                    <input type="date" value={form.promo_fim} onChange={e => f('promo_fim', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">SKU no canal</label>
                  <input value={form.sku_canal} onChange={e => f('sku_canal', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">ID externo</label>
                  <input value={form.id_externo} onChange={e => f('id_externo', e.target.value)}
                    placeholder="ID do anúncio na plataforma"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                  <select value={form.status} onChange={e => f('status', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                    {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">URL do anúncio</label>
                <input type="url" value={form.url_anuncio} onChange={e => f('url_anuncio', e.target.value)}
                  placeholder="https://..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>

              {erro && <p className="text-sm text-red-600">{erro}</p>}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setModal(false)} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={salvar} disabled={salvando}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {salvando ? 'Salvando...' : editando ? 'Salvar alterações' : 'Criar anúncio'}
              </button>
            </div>
          </div>
        </div>
      )}

      {detalheAberto && (
        <AnuncioDetalheModal
          anuncio={detalheAberto}
          canal={canal}
          regras={regras}
          onClose={() => setDetalheAberto(null)}
          onAtualizado={(anuncioAtualizado) => {
            setAnuncios(prev => prev.map(a => a.id === anuncioAtualizado.id ? anuncioAtualizado : a))
            setDetalheAberto(anuncioAtualizado)
          }}
          // Resolver uma pendência de qualidade quase sempre significa sair
          // deste modal e entrar noutro — editar título/descrição no sistema,
          // ou vincular produto. Fechar aqui e abrir lá em vez de empilhar
          // dois overlays fixos um sobre o outro.
          onEditar={() => { const a = detalheAberto; setDetalheAberto(null); abrirEditar(a) }}
          onMapear={() => { const a = detalheAberto; setDetalheAberto(null); setMapeandoAberto(a) }}
        />
      )}

      {editorAberto && (
        <EditarAnuncioModal
          anuncio={editorAberto}
          canal={canal}
          empresaId={empresaId}
          produtos={produtos}
          onClose={() => setEditorAberto(null)}
          onSalvo={(anuncioAtualizado) => {
            setAnuncios(prev => prev.map(a => a.id === anuncioAtualizado.id ? { ...a, ...anuncioAtualizado } : a))
            setEditorAberto((atual: any) => (atual ? { ...atual, ...anuncioAtualizado } : atual))
          }}
        />
      )}

      {mapeandoAberto && (
        <MapearAnuncioModal
          anuncio={mapeandoAberto}
          canal={canal}
          empresaId={empresaId}
          operador={operador}
          onClose={() => setMapeandoAberto(null)}
          onAtualizado={(anuncioAtualizado) => {
            setAnuncios(prev => prev.map(a => a.id === anuncioAtualizado.id ? anuncioAtualizado : a))
            setMapeandoAberto(anuncioAtualizado)
          }}
        />
      )}

      {mapeamentoRapido && (
        <MapeamentoRapidoModal
          anuncioIds={mapeamentoRapido}
          empresaId={empresaId}
          onFechar={() => setMapeamentoRapido(null)}
          onAplicado={(mapa) => {
            // Reflete na listagem sem recarregar a página — mesma abordagem
            // do mapeamento individual logo acima.
            setAnuncios(prev => prev.map(a => mapa[a.id]
              ? { ...a, produto_id: mapa[a.id].id, produtos: { ...(a.produtos ?? {}), ...mapa[a.id], preco_venda: mapa[a.id].precoVenda, estoque: mapa[a.id].estoque } }
              : a))
            setSelecionados(new Set())
          }}
        />
      )}

      {criarAnuncioShopeeAberto && (
        <CriarAnuncioShopeeModal
          canal={{ id: canal.id, nome: canal.nome }}
          empresaId={empresaId}
          onClose={() => setCriarAnuncioShopeeAberto(false)}
          onCriado={() => router.refresh()}
        />
      )}

      {criarAnuncioMLAberto && (
        <CriarAnuncioMercadoLivreModal
          canal={{ id: canal.id, nome: canal.nome }}
          empresaId={empresaId}
          onClose={() => setCriarAnuncioMLAberto(false)}
          onCriado={() => router.refresh()}
        />
      )}

      {criarAnuncioNuvemshopAberto && (
        <CriarAnuncioNuvemshopModal
          canal={{ id: canal.id, nome: canal.nome }}
          empresaId={empresaId}
          onClose={() => setCriarAnuncioNuvemshopAberto(false)}
          onCriado={() => router.refresh()}
        />
      )}

      {enriquecendoAberto && (
        <EnriquecerProdutoModal
          anuncio={enriquecendoAberto}
          empresaId={empresaId}
          operador={operador}
          onClose={() => setEnriquecendoAberto(null)}
          onAtualizado={(anuncioAtualizado) => {
            setAnuncios(prev => prev.map(a => a.id === anuncioAtualizado.id ? anuncioAtualizado : a))
            setEnriquecendoAberto(anuncioAtualizado)
          }}
        />
      )}

      {enviandoPrecoAberto && (
        <EnviarPrecoEstoqueModal
          anuncio={enviandoPrecoAberto}
          canal={canal}
          onClose={() => setEnviandoPrecoAberto(null)}
          onEnviado={(anuncioAtualizado) => {
            setAnuncios(prev => prev.map(a => a.id === anuncioAtualizado.id ? anuncioAtualizado : a))
          }}
        />
      )}

      {opcoesMassaPreco && !previewMassaPreco && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpcoesMassaPreco(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h2 className="text-lg font-semibold text-gray-900">Atualizar preço/estoque na Shopee</h2>
              <button onClick={() => setOpcoesMassaPreco(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-5 space-y-5">
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                ⚠️ Só se aplica a anúncios sem variação. Anúncios com variação devem ser enviados individualmente.
              </div>
              {regras.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Usar regra salva</label>
                  <select value={regraSelecionadaId} onChange={e => e.target.value ? aplicarRegraSalva(e.target.value) : setRegraSelecionadaId('')}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500">
                    <option value="">Configurar manualmente...</option>
                    {regras.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">Escolher uma regra já preenche as opções abaixo e mostra a prévia direto.</p>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-gray-600 mb-2">Preço de venda</p>
                <div className="space-y-2">
                  {/* "Margem líquida" usa a tabela de comissão da SHOPEE
                      (calcularPrecoParaMargem, em lib/shopee/comissao.ts).
                      Aplicá-la a um anúncio do Mercado Livre daria um preço
                      calculado com a comissão errada — some do menu em vez de
                      entregar número furado. Para o ML, o caminho com a
                      comissão e o frete corretos é a tela de Gestão de Preços,
                      que usa o motor completo. */}
                  {[
                    ['nao', 'Não alterar'],
                    ['fixo', 'Valor fixo (R$)'],
                    ['percentual', 'Ajuste percentual sobre o atual (%)'],
                    ['formula', 'Fórmula: custo do produto vinculado × markup (%)'],
                    ...(ehML ? [] : [['shopee_liquido', 'Margem líquida sobre custo (considera comissão + taxas da Shopee)']]),
                    ['produto', 'Usar preço do produto vinculado'],
                  ].map(([v, l]) => (
                    <label key={v} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input type="radio" name="modoPreco" checked={opcoesMassaPreco.modoPreco === v}
                        onChange={() => setOpcoesMassaPreco(p => p ? { ...p, modoPreco: v as any } : p)} className="accent-orange-600" />
                      {l}
                    </label>
                  ))}
                  {(opcoesMassaPreco.modoPreco === 'fixo' || opcoesMassaPreco.modoPreco === 'percentual' || opcoesMassaPreco.modoPreco === 'formula' || opcoesMassaPreco.modoPreco === 'shopee_liquido') && (
                    <input type="number" step="0.01" value={opcoesMassaPreco.valorPreco}
                      onChange={e => setOpcoesMassaPreco(p => p ? { ...p, valorPreco: e.target.value } : p)}
                      placeholder={opcoesMassaPreco.modoPreco === 'fixo' ? 'Ex: 49.90' : opcoesMassaPreco.modoPreco === 'formula' ? 'Markup, ex: 40' : opcoesMassaPreco.modoPreco === 'shopee_liquido' ? 'Margem desejada, ex: 30' : 'Ex: 10 ou -5'}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm ml-6" style={{ width: 'calc(100% - 1.5rem)' }} />
                  )}
                  {opcoesMassaPreco.modoPreco === 'shopee_liquido' && (
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer ml-6">
                      <input type="checkbox" checked={opcoesMassaPreco.considerarPix}
                        onChange={e => setOpcoesMassaPreco(p => p ? { ...p, considerarPix: e.target.checked } : p)} className="w-4 h-4 accent-orange-600" />
                      Considerar subsídio Pix (5% a 8% adicional)
                    </label>
                  )}
                  {(opcoesMassaPreco.modoPreco === 'formula' || opcoesMassaPreco.modoPreco === 'shopee_liquido') && (
                    <div className="ml-6 grid grid-cols-2 gap-2" style={{ width: 'calc(100% - 1.5rem)' }}>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Valor da embalagem (R$)</label>
                        <input type="number" step="0.01" value={opcoesMassaPreco.valorEmbalagem}
                          onChange={e => setOpcoesMassaPreco(p => p ? { ...p, valorEmbalagem: e.target.value } : p)}
                          placeholder="Ex: 2.50" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                      </div>
                      {opcoesMassaPreco.modoPreco === 'shopee_liquido' && (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Imposto (%)</label>
                          <input type="number" step="0.01" value={opcoesMassaPreco.percentualImposto}
                            onChange={e => setOpcoesMassaPreco(p => p ? { ...p, percentualImposto: e.target.value } : p)}
                            placeholder="Ex: 6" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                        </div>
                      )}
                    </div>
                  )}
                  {(opcoesMassaPreco.modoPreco === 'percentual' || opcoesMassaPreco.modoPreco === 'formula' || opcoesMassaPreco.modoPreco === 'shopee_liquido' || opcoesMassaPreco.modoPreco === 'produto') && (
                    <select value={opcoesMassaPreco.arredondamento} onChange={e => setOpcoesMassaPreco(p => p ? { ...p, arredondamento: e.target.value } : p)}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm ml-6" style={{ width: 'calc(100% - 1.5rem)' }}>
                      <option value="nenhum">Sem arredondamento</option>
                      <option value="terminar_90">Terminar em ,90</option>
                      <option value="terminar_99">Terminar em ,99</option>
                      <option value="cima_inteiro">Arredondar para cima (inteiro)</option>
                    </select>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-600 mb-2">Estoque</p>
                <div className="space-y-2">
                  {[['nao', 'Não alterar'], ['fixo', 'Valor fixo'], ['produto', 'Usar estoque do produto vinculado'], ['deposito', 'Usar estoque de um depósito específico']].map(([v, l]) => (
                    <label key={v} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input type="radio" name="modoEstoque" checked={opcoesMassaPreco.modoEstoque === v}
                        onChange={() => setOpcoesMassaPreco(p => p ? { ...p, modoEstoque: v as any } : p)} className="accent-orange-600" />
                      {l}
                    </label>
                  ))}
                  {opcoesMassaPreco.modoEstoque === 'fixo' && (
                    <input type="number" value={opcoesMassaPreco.valorEstoque}
                      onChange={e => setOpcoesMassaPreco(p => p ? { ...p, valorEstoque: e.target.value } : p)}
                      placeholder="Ex: 10"
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm ml-6" style={{ width: 'calc(100% - 1.5rem)' }} />
                  )}
                  {opcoesMassaPreco.modoEstoque === 'deposito' && (
                    <select value={opcoesMassaPreco.depositoId} onChange={e => setOpcoesMassaPreco(p => p ? { ...p, depositoId: e.target.value } : p)}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm ml-6" style={{ width: 'calc(100% - 1.5rem)' }}>
                      <option value="">Selecione um depósito</option>
                      {depositos.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
                    </select>
                  )}
                  {opcoesMassaPreco.modoEstoque !== 'nao' && (
                    <div className="ml-6 grid grid-cols-2 gap-2" style={{ width: 'calc(100% - 1.5rem)' }}>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Estoque complementar</label>
                        <input type="number" value={opcoesMassaPreco.estoqueComplementar}
                          onChange={e => setOpcoesMassaPreco(p => p ? { ...p, estoqueComplementar: e.target.value } : p)}
                          placeholder="Ex: 5" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Estoque de risco</label>
                        <input type="number" value={opcoesMassaPreco.estoqueRisco}
                          onChange={e => setOpcoesMassaPreco(p => p ? { ...p, estoqueRisco: e.target.value } : p)}
                          placeholder="Ex: 2" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setOpcoesMassaPreco(null)} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={() => prepararPreviewMassaPreco()}
                disabled={opcoesMassaPreco.modoPreco === 'nao' && opcoesMassaPreco.modoEstoque === 'nao'}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                Ver prévia
              </button>
            </div>
          </div>
        </div>
      )}

      {previewMassaPreco && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setPreviewMassaPreco(null); setOpcoesMassaPreco(null) }} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[80vh] overflow-y-auto flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h2 className="text-lg font-semibold text-gray-900">Prévia — envio para a Shopee</h2>
              <button onClick={() => { setPreviewMassaPreco(null); setOpcoesMassaPreco(null) }} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-sm text-gray-600">
                <span className="text-emerald-600 font-medium">{previewMassaPreco.aplicaveis.length} será(ão) enviado(s)</span>
                {' · '}
                <span className="text-gray-400">{previewMassaPreco.pulados.length} pulado(s)</span>
              </p>
              {previewMassaPreco.aplicaveis.length > 0 && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  {previewMassaPreco.aplicaveis.map(({ anuncio, precoNovo, estoqueNovo, paraPausar }) => (
                    <div key={anuncio.id} className="px-4 py-2.5 border-b border-gray-100 last:border-0 text-sm">
                      <p className="text-gray-800 truncate">{anuncio.titulo}</p>
                      <p className="text-xs text-gray-500">
                        {precoNovo !== undefined && <>Preço: {fmt(anuncio.preco_venda)} → <span className="text-emerald-600 font-medium">{fmt(precoNovo)}</span></>}
                        {precoNovo !== undefined && estoqueNovo !== undefined && ' · '}
                        {estoqueNovo !== undefined && <>Estoque: {anuncio.estoque_reservado ?? 0} → <span className="text-emerald-600 font-medium">{estoqueNovo}</span></>}
                      </p>
                      {paraPausar && (
                        <p className="text-xs text-red-600 font-medium mt-0.5">⚠️ Estoque de risco atingido — anúncio será pausado</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {previewMassaPreco.pulados.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Pulados:</p>
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    {previewMassaPreco.pulados.map(({ anuncio, motivo }) => (
                      <div key={anuncio.id} className="px-4 py-2 border-b border-gray-100 last:border-0 text-xs text-gray-500">{anuncio.titulo} — {motivo}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setPreviewMassaPreco(null)} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Voltar</button>
              <button onClick={confirmarMassaPreco} disabled={enviandoMassaPreco || previewMassaPreco.aplicaveis.length === 0}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {enviandoMassaPreco ? 'Enviando...' : `Enviar para a Shopee (${previewMassaPreco.aplicaveis.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewMassa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPreviewMassa(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-y-auto flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h2 className="text-lg font-semibold text-gray-900">Mapear em massa por SKU</h2>
              <button onClick={() => setPreviewMassa(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-sm text-gray-600">
                <span className="text-emerald-600 font-medium">{previewMassa.encontrados.length} encontrado(s)</span>
                {' · '}
                <span className="text-gray-400">{previewMassa.naoEncontrados.length} sem produto com SKU correspondente</span>
              </p>
              {previewMassa.encontrados.length > 0 && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  {previewMassa.encontrados.map(({ anuncio, produto }: any) => (
                    <div key={anuncio.id} className="px-4 py-2.5 border-b border-gray-100 last:border-0 text-sm">
                      <p className="text-gray-700">{anuncio.titulo}</p>
                      <p className="text-emerald-700 font-medium mt-0.5">→ {produto.nome}</p>
                    </div>
                  ))}
                </div>
              )}
              {previewMassa.naoEncontrados.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Sem correspondência (não serão alterados):</p>
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    {previewMassa.naoEncontrados.map((a: any) => (
                      <div key={a.id} className="px-4 py-2 border-b border-gray-100 last:border-0 text-xs text-gray-500">{a.titulo} — SKU: {a.sku_canal || '—'}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setPreviewMassa(null)} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={confirmarMapeamentoMassa} disabled={aplicandoMassa || previewMassa.encontrados.length === 0}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {aplicandoMassa ? 'Aplicando...' : `Confirmar mapeamento (${previewMassa.encontrados.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replicação em massa pra outra conta do mesmo marketplace */}
      {replicarAberto && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !replicando && setReplicarAberto(false)}>
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <p className="text-base font-semibold text-gray-900">⧉ Replicar {selecionados.size} anúncio(s) para outro canal</p>

            {!replicarResultado ? (
              <>
                <label className="block text-xs font-medium text-gray-600 mt-4 mb-1">Canal de destino</label>
                <select value={replicarDestino} onChange={e => setReplicarDestino(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                  {canaisDestino.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>

                <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 space-y-1.5">
                  <p className="text-xs font-medium text-gray-700">O que é copiado</p>
                  <p className="text-xs text-gray-600">✓ Título, descrição e categoria de cada anúncio</p>
                  <p className="text-xs text-gray-600">✓ Imagens e preço vêm do cadastro do produto, não do anúncio de origem</p>
                  {canal.plataforma === 'mercadolivre'
                    ? <p className="text-xs text-gray-600">✓ Atributos compatíveis com a categoria de destino</p>
                    : <p className="text-xs text-gray-600">✗ Atributos não vêm (a sincronização da Shopee não os traz) — categoria que exige atributo obrigatório falha aqui e precisa do fluxo individual</p>}
                  <p className="text-xs text-gray-500 pt-1">São pulados: anúncio sem produto vinculado, produto sem imagem ou sem preço, anúncio com variação, e produto que já tem anúncio no destino.</p>
                  {selecionados.size > 15 && (
                    <p className="text-xs text-amber-700 pt-1">⚠️ São processados 15 por vez. Os {selecionados.size - 15} restantes ficam de fora deste lote — repita a operação depois.</p>
                  )}
                </div>

                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setReplicarAberto(false)} disabled={replicando}
                    className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
                  <button onClick={replicarSelecionados} disabled={replicando || !replicarDestino}
                    className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                    {replicando ? 'Replicando... (pode levar alguns minutos)' : 'Replicar agora'}
                  </button>
                </div>
              </>
            ) : replicarResultado.erro ? (
              <>
                <p className="text-sm text-red-600 mt-4">{replicarResultado.erro}</p>
                <button onClick={() => setReplicarAberto(false)} className="mt-4 px-4 py-2 bg-gray-600 text-white text-sm rounded-lg">Fechar</button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-700 mt-4">
                  <strong className="text-emerald-700">{replicarResultado.resultados.filter((r: any) => r.ok).length} criado(s)</strong>
                  {replicarResultado.resultados.some((r: any) => !r.ok) && <> · <strong className="text-red-600">{replicarResultado.resultados.filter((r: any) => !r.ok).length} não criado(s)</strong></>}
                  {replicarResultado.naoProcessados > 0 && <> · {replicarResultado.naoProcessados} fora deste lote</>}
                </p>
                <div className="mt-3 space-y-1.5 max-h-80 overflow-y-auto">
                  {replicarResultado.resultados.map((r: any) => (
                    <div key={r.anuncioId} className={`px-3 py-2 rounded-lg border text-xs ${r.ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                      <p className={r.ok ? 'text-emerald-800' : 'text-red-800'}>{r.ok ? '✓' : '✗'} {r.titulo}</p>
                      {!r.ok && <p className="text-red-600 mt-0.5">{r.erro}</p>}
                    </div>
                  ))}
                </div>
                <button onClick={() => { setReplicarAberto(false); setSelecionados(new Set()); router.refresh() }}
                  className="mt-4 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg">Fechar e atualizar</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
