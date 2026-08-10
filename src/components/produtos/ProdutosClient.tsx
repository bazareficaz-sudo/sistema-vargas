'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePermissao } from '@/contexts/PlanContext'
import EditarProdutoModal from './EditarProdutoModal'
import SeloCanais, { type ContagemCanais } from '@/components/marketplaces/SeloCanais'
import DuplicarProdutoModal from './DuplicarProdutoModal'
import AcoesEmMassaModal from './AcoesEmMassaModal'
import AdicionarImagemMassaModal from './AdicionarImagemMassaModal'
import CriarKitModal from './CriarKitModal'
import NovoProdutoModal from './NovoProdutoModal'
import ImportarProdutoUrlModal from './ImportarProdutoUrlModal'
import GerenciarTagsModal from './GerenciarTagsModal'
import ImprimirEtiquetaModal from '@/components/etiquetas/ImprimirEtiquetaModal'
import EstoqueDetalhadoModal from './EstoqueDetalhadoModal'
import UnificarProdutosModal from './UnificarProdutosModal'
import CriarAnuncioShopeeModal from '@/components/marketplaces/CriarAnuncioShopeeModal'
import { sincronizarProdutoVinculado } from '@/lib/produtos/vinculo'
import { botao, SEPARADOR } from '@/components/ui/botao'

type Produto = {
  id: string
  nome: string
  sku: string | null
  ean: string | null
  preco_venda: number
  preco_custo: number
  preco_promocional: number | null
  promocao_ativa: boolean
  promocao_inicio: string | null
  promocao_fim: string | null
  unidade: string
  categoria: string | null
  marca: string | null
  estoque: number
  estoque_minimo: number
  ativo: boolean
  disponivel_pdv: boolean
  permite_fracao: boolean
  ncm: string | null
  tipo: string
  ibs_cst?: string | null
  ibs_cclasstrib?: string | null
  ibs_aliquota?: number | null
  cbs_aliquota?: number | null
  tags?: string[] | null
}

type Categoria = { id: string; nome: string; pai_id: string | null }
type Marca = { id: string; nome: string }

type Props = {
  produtos: Produto[]
  imagensMap?: Record<string, string>
  total: number
  totalAtivos: number
  totalInativos: number
  totalTodos?: number
  totalSimples: number
  totalKits: number
  totalEmPromocao: number
  pagina: number
  totalPaginas: number
  q: string
  abaAtiva: string
  promoFiltro: boolean
  apenasAtivos: boolean
  empresaId: string
  // Anúncios por produto, agrupados por plataforma — alimenta o selo de
  // canais na linha.
  anunciosMap?: Record<string, ContagemCanais>
  // Produto a abrir já no cadastro, vindo por link de outra tela.
  abrirProdutoId?: string
  abrirProdutoAba?: string
  categoriasRaiz: Categoria[]
  categoriasTodas: Categoria[]
  marcas: Marca[]
  marcaFiltro: string
  categoriaFiltro: string
  subcategoriaFiltro: string
  estoqueFiltro: string
  imagemFiltro: string
  ncmFiltro: string
  tagFiltro: string
  entradaFiltro: string
  entradasCasadas?: { rotulo: string; origem: 'manual' | 'xml' }[]
  tagsDisponiveis: string[]
  canaisShopee?: { id: string; nome: string }[]
}

function calcMarkup(produto: Produto): number | null {
  if (!(produto.preco_custo > 0) || !(produto.preco_venda > 0)) return null
  return ((produto.preco_venda - produto.preco_custo) / produto.preco_custo) * 100
}

const ABAS = [
  { key: 'todos',    label: 'todos' },
  { key: 'simples',  label: 'simples' },
  { key: 'kit',      label: 'kits' },
  { key: 'generico', label: 'genéricos' },
  { key: 'insumo',   label: 'insumos' },
  { key: 'brinde',   label: 'brindes' },
]

export default function ProdutosClient({
  produtos: inicial, imagensMap = {}, total, totalTodos, totalSimples, totalKits, totalEmPromocao,
  pagina, totalPaginas, q: qInicial, abaAtiva: abaInicial, promoFiltro: promoInicial, apenasAtivos: apenasAtivosInicial, empresaId,
  anunciosMap, abrirProdutoId, abrirProdutoAba,
  categoriasRaiz, categoriasTodas, marcas,
  marcaFiltro: marcaInicial, categoriaFiltro: categoriaInicial, subcategoriaFiltro: subcategoriaInicial,
  estoqueFiltro: estoqueInicial, imagemFiltro: imagemInicial, ncmFiltro: ncmInicial,
  tagFiltro: tagInicial, entradaFiltro: entradaInicial, entradasCasadas = [], tagsDisponiveis, canaisShopee = [],
}: Props) {
  const router = useRouter()
  const [produtos, setProdutos] = useState(inicial)
  // O banco recusa a gravacao de quem nao tem permissao (trigger). Aqui a
  // tela some com o botao antes disso, pra pessoa nao esbarrar num erro.
  const podeEditarProdutos = usePermissao('editar_produtos')
  const podeExcluir = usePermissao('excluir_cadastros')
  const podeEditarPrecos = usePermissao('editar_precos')
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [editando, setEditando] = useState<Produto | null>(null)
  // Aba em que o cadastro abre — o selo de canais leva direto para Anúncios,
  // o link vindo de Vendas leva para Fiscal.
  const [abaModal, setAbaModal] = useState<'fiscal' | 'anuncios' | undefined>(undefined)

  // Chegou por link com ?editar=<id>: abre o cadastro daquele produto na
  // hora. Busca por id em vez de procurar na página atual — o produto pode
  // estar em qualquer página, ou nem passar pelos filtros vigentes.
  useEffect(() => {
    if (!abrirProdutoId) return
    let cancelado = false
    ;(async () => {
      const naPagina = produtos.find(p => p.id === abrirProdutoId)
      if (naPagina) { setEditando(naPagina); return }
      const sb = createClient()
      const { data } = await sb.from('produtos').select('*')
        .eq('id', abrirProdutoId).eq('empresa_id', empresaId).maybeSingle()
      if (!cancelado && data) setEditando(data as Produto)
    })()
    return () => { cancelado = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirProdutoId])
  const [duplicando, setDuplicando] = useState<Produto | null>(null)
  const [criandoKit, setCriandoKit] = useState<Produto | null>(null)
  const [criandoAnuncioShopee, setCriandoAnuncioShopee] = useState<Produto | null>(null)
  const [criandoNovo, setCriandoNovo] = useState(false)
  const [importandoUrl, setImportandoUrl] = useState(false)
  const [acoesEmMassa, setAcoesEmMassa] = useState(false)
  const [imagemEmMassa, setImagemEmMassa] = useState(false)
  const [nomeEditando, setNomeEditando] = useState<string | null>(null)
  const [nomeValor, setNomeValor] = useState('')
  const [copiado, setCopiado] = useState<string | null>(null)
  const cancelandoNomeRef = useRef(false)
  const [q, setQ] = useState(qInicial)
  const [aba, setAba] = useState(abaInicial)
  const [promo, setPromo] = useState(promoInicial)
  const [apenasAtivos, setApenasAtivos] = useState(apenasAtivosInicial)
  const [mostrarFiltros, setMostrarFiltros] = useState(false)
  const [marcaF, setMarcaF] = useState(marcaInicial)
  const [categoriaF, setCategoriaF] = useState(categoriaInicial)
  const [subcategoriaF, setSubcategoriaF] = useState(subcategoriaInicial)
  const [estoqueF, setEstoqueF] = useState(estoqueInicial)
  const [imagemF, setImagemF] = useState(imagemInicial)
  const [ncmF, setNcmF] = useState(ncmInicial)
  const [tagF, setTagF] = useState(tagInicial)
  const [entradaF, setEntradaF] = useState(entradaInicial)
  const [gerenciandoTags, setGerenciandoTags] = useState(false)
  const [imprimindoEtiquetas, setImprimindoEtiquetas] = useState(false)
  const [unificando, setUnificando] = useState(false)
  const [enviandoPrecos, setEnviandoPrecos] = useState(false)
  const [vendoEstoque, setVendoEstoque] = useState<Produto | null>(null)

  // Sincroniza quando o servidor traz novos dados (navegação entre abas/busca)
  useEffect(() => { setProdutos(inicial) }, [inicial])
  useEffect(() => { setQ(qInicial) }, [qInicial])
  useEffect(() => { setAba(abaInicial) }, [abaInicial])
  useEffect(() => { setPromo(promoInicial) }, [promoInicial])
  useEffect(() => { setApenasAtivos(apenasAtivosInicial) }, [apenasAtivosInicial])
  useEffect(() => { setMarcaF(marcaInicial) }, [marcaInicial])
  useEffect(() => { setCategoriaF(categoriaInicial) }, [categoriaInicial])
  useEffect(() => { setSubcategoriaF(subcategoriaInicial) }, [subcategoriaInicial])
  useEffect(() => { setEstoqueF(estoqueInicial) }, [estoqueInicial])
  useEffect(() => { setImagemF(imagemInicial) }, [imagemInicial])
  useEffect(() => { setNcmF(ncmInicial) }, [ncmInicial])
  useEffect(() => { setTagF(tagInicial) }, [tagInicial])
  useEffect(() => { setEntradaF(entradaInicial) }, [entradaInicial])

  const subcategoriasDisponiveis = categoriaF
    ? categoriasTodas.filter(c => c.pai_id && categoriasTodas.find(r => r.id === c.pai_id)?.nome === categoriaF)
    : []

  const filtrosAtivos = [marcaF, categoriaF, subcategoriaF, estoqueF, imagemF, ncmF, tagF, entradaF].filter(Boolean).length

  function navegar(params: Record<string, string>) {
    const sp = new URLSearchParams({
      q, aba, pagina: String(pagina), promo: promo ? '1' : '', ativos: apenasAtivos ? '1' : '0',
      marca: marcaF, categoria: categoriaF, subcategoria: subcategoriaF, estoque: estoqueF, imagem: imagemF, ncm: ncmF,
      tag: tagF, entrada: entradaF,
      ...params,
    })
    router.push(`/dashboard/produtos?${sp.toString()}`)
  }

  function limparFiltrosAvancados() {
    setMarcaF(''); setCategoriaF(''); setSubcategoriaF(''); setEstoqueF(''); setImagemF(''); setNcmF(''); setTagF(''); setEntradaF('')
    navegar({ marca: '', categoria: '', subcategoria: '', estoque: '', imagem: '', ncm: '', tag: '', entrada: '', pagina: '1' })
  }

  function buscar(e: React.FormEvent) {
    e.preventDefault()
    navegar({ q, pagina: '1' })
  }

  function toggleAll(checked: boolean) {
    setSelecionados(checked ? new Set(produtos.map(p => p.id)) : new Set())
  }

  function toggleOne(id: string) {
    setSelecionados(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function iniciarEdicaoNome(produto: Produto) {
    setNomeEditando(produto.id)
    setNomeValor(produto.nome)
  }

  function cancelarEdicaoNome() {
    cancelandoNomeRef.current = true
    setNomeEditando(null)
  }

  async function salvarNome(id: string) {
    if (cancelandoNomeRef.current) { cancelandoNomeRef.current = false; return }
    setNomeEditando(null)
    const valor = nomeValor.trim()
    const atual = produtos.find(p => p.id === id)
    if (!valor || !atual || atual.nome === valor) return
    const sb = createClient()
    const { error } = await sb.from('produtos').update({ nome: valor, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) return
    await sincronizarProdutoVinculado(sb, id, { nome: valor })
    setProdutos(prev => prev.map(p => p.id === id ? { ...p, nome: valor } : p))
  }

  // Ativo/PDV agora só são alterados dentro do cadastro do produto
  // (EditarProdutoModal) — removidos daqui pra não duplicar o controle.

  async function copiar(id: string, campo: string, valor: string) {
    try {
      await navigator.clipboard.writeText(valor)
      setCopiado(`${id}-${campo}`)
      setTimeout(() => setCopiado(null), 1200)
    } catch { /* clipboard indisponível — ignora silenciosamente */ }
  }

  async function ativarSelecionados(ativo: boolean) {
    if (selecionados.size === 0) return
    const sb = createClient()
    const { error } = await sb.from('produtos').update({ ativo, updated_at: new Date().toISOString() }).in('id', [...selecionados])
    if (error) { alert(`Não foi possível atualizar: ${error.message}`); return }
    setProdutos(prev => prev.map(p => selecionados.has(p.id) ? { ...p, ativo } : p))
    setSelecionados(new Set())
  }

  const onSaved = useCallback(() => {
    router.refresh()
  }, [router])

  // Leva os produtos selecionados pra tela de Gestão de Preços já filtrada
  // por eles (mesmo padrão de ?ids=/&origem= já usado a partir da Entrada
  // XML) — inclui também os kits que usam algum deles como componente,
  // já que o preço do kit costuma precisar ser revisado junto.
  async function abrirGestaoPrecos() {
    if (selecionados.size === 0) return
    setEnviandoPrecos(true)
    const sb = createClient()
    const idsSelecionados = [...selecionados]
    const { data: kits } = await sb.from('kit_itens').select('kit_id').in('produto_id', idsSelecionados)
    const kitIds = Array.from(new Set((kits ?? []).map(k => k.kit_id as string)))
    const todosIds = Array.from(new Set([...idsSelecionados, ...kitIds]))
    router.push(`/dashboard/precos?ids=${todosIds.join(',')}&origem=${encodeURIComponent('Produtos selecionados')}`)
  }

  const abaCounts: Record<string, number> = {
    todos: totalTodos ?? total,
    simples: totalSimples,
    kit: totalKits,
    generico: 0,
    insumo: 0,
    brinde: 0,
  }

  return (
    <>
      <EditarProdutoModal produto={editando}
        onClose={() => { setEditando(null); setAbaModal(undefined) }}
        onSaved={onSaved} empresaId={empresaId}
        abaInicial={abaModal ?? (abrirProdutoAba === 'fiscal' ? 'fiscal' : abrirProdutoAba === 'anuncios' ? 'anuncios' : undefined)} />
      {duplicando && (
        <DuplicarProdutoModal
          produto={duplicando}
          empresaId={empresaId}
          onClose={() => setDuplicando(null)}
          onDuplicado={() => { setDuplicando(null); router.refresh() }}
        />
      )}
      {criandoKit && (
        <CriarKitModal
          produto={criandoKit}
          empresaId={empresaId}
          onClose={() => setCriandoKit(null)}
          onCriado={() => { setCriandoKit(null); router.refresh() }}
        />
      )}
      {criandoAnuncioShopee && (
        <CriarAnuncioShopeeModal
          canais={canaisShopee}
          empresaId={empresaId}
          produtoIdInicial={criandoAnuncioShopee.id}
          onClose={() => setCriandoAnuncioShopee(null)}
          onCriado={() => router.refresh()}
        />
      )}
      {criandoNovo && (
        <NovoProdutoModal
          empresaId={empresaId}
          categoriasRaiz={categoriasRaiz}
          categoriasTodas={categoriasTodas}
          marcas={marcas}
          onClose={() => setCriandoNovo(false)}
          onCriado={() => { setCriandoNovo(false); router.refresh() }}
        />
      )}
      {importandoUrl && (
        <ImportarProdutoUrlModal
          empresaId={empresaId}
          categoriasRaiz={categoriasRaiz}
          categoriasTodas={categoriasTodas}
          marcas={marcas}
          onClose={() => setImportandoUrl(false)}
          onImportado={(produto) => { setImportandoUrl(false); setEditando(produto); router.refresh() }}
        />
      )}
      {acoesEmMassa && (
        <AcoesEmMassaModal
          ids={[...selecionados]}
          categoriasRaiz={categoriasRaiz}
          categoriasTodas={categoriasTodas}
          marcas={marcas}
          onClose={() => setAcoesEmMassa(false)}
          onAplicado={() => { setAcoesEmMassa(false); setSelecionados(new Set()); router.refresh() }}
        />
      )}
      {imagemEmMassa && (
        <AdicionarImagemMassaModal
          ids={[...selecionados]}
          empresaId={empresaId}
          onClose={() => setImagemEmMassa(false)}
          onAplicado={() => { setImagemEmMassa(false); setSelecionados(new Set()); router.refresh() }}
        />
      )}
      {gerenciandoTags && (
        <GerenciarTagsModal
          produtos={produtos.filter(p => selecionados.has(p.id)).map(p => ({ id: p.id, tags: p.tags ?? [] }))}
          tagsExistentes={tagsDisponiveis}
          onClose={() => setGerenciandoTags(false)}
          onAplicado={() => { setGerenciandoTags(false); setSelecionados(new Set()); router.refresh() }}
        />
      )}
      {imprimindoEtiquetas && (
        <ImprimirEtiquetaModal
          produtos={produtos.filter(p => selecionados.has(p.id)).map(p => ({
            id: p.id, nome: p.nome, sku: p.sku, ean: p.ean,
            preco_venda: p.preco_venda, preco_promocional: p.preco_promocional ?? null,
            marca: p.marca, unidade: p.unidade, categoria: p.categoria,
            estoque: p.estoque,
          }))}
          empresaId={empresaId}
          onClose={() => setImprimindoEtiquetas(false)}
        />
      )}
      {unificando && (
        <UnificarProdutosModal
          ids={[...selecionados]}
          onClose={() => setUnificando(false)}
          onUnificado={() => { setUnificando(false); setSelecionados(new Set()); router.refresh() }}
        />
      )}
      {vendoEstoque && (
        <EstoqueDetalhadoModal
          produto={vendoEstoque}
          empresaId={empresaId}
          onAtualizado={(novoEstoque) => setProdutos(prev => prev.map(p => p.id === vendoEstoque.id ? { ...p, estoque: novoEstoque } : p))}
          onClose={() => setVendoEstoque(null)}
        />
      )}

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span className="hover:text-gray-600 cursor-pointer">início</span>
        <span>›</span>
        <span className="hover:text-gray-600 cursor-pointer">cadastros</span>
        <span>›</span>
        <span className="text-gray-600 font-medium">produtos</span>
      </div>

      {/* Cabeçalho: título e as ações que existem SEMPRE. As ações de
          seleção saíram daqui — dividiam a linha com o título e, com 8
          botões, espremiam tudo até o texto quebrar em duas linhas. */}
      <div className="flex items-center justify-between gap-4 mb-5">
        <h1 className="text-gray-900 text-xl font-semibold">Produtos</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setImportandoUrl(true)} className={botao('secundario')}>
            Importar de URL
          </button>
          {podeEditarProdutos && (
            <button onClick={() => setCriandoNovo(true)} className={botao('primario')}>
              Novo produto
            </button>
          )}
        </div>
      </div>

      {/* Barra de ações da seleção.
          Faixa própria, largura inteira, que só existe quando há seleção.
          Agrupada por assunto e separada por divisórias em vez de por cor:
          antes eram oito cores diferentes (verde, vermelho, azul, roxo, teal,
          índigo, esmeralda, âmbar) para oito ações de mesma importância, o
          que não hierarquiza nada e polui tudo. Aqui a cor só marca o que é
          destrutivo. */}
      {selecionados.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-blue-50/60 border border-blue-200 rounded-xl px-4 py-3 mb-4">
          <span className="text-sm font-medium text-blue-900 mr-1">
            {selecionados.size} {selecionados.size === 1 ? 'produto selecionado' : 'produtos selecionados'}
          </span>

          {podeEditarProdutos && (
            <button onClick={() => setAcoesEmMassa(true)} className={botao('secundario', 'sm')}>
              Editar em massa
            </button>
          )}
          <button onClick={() => setImagemEmMassa(true)} className={botao('secundario', 'sm')}>
            Adicionar imagem
          </button>
          <button onClick={() => setGerenciandoTags(true)} className={botao('secundario', 'sm')}>
            Gerenciar tags
          </button>

          <span className={SEPARADOR} />

          <button onClick={() => setImprimindoEtiquetas(true)} className={botao('secundario', 'sm')}>
            Emitir etiquetas
          </button>
          {podeEditarPrecos && (
            <button onClick={abrirGestaoPrecos} disabled={enviandoPrecos} className={botao('secundario', 'sm')}>
              {enviandoPrecos ? 'Abrindo…' : 'Gestão de preços'}
            </button>
          )}
          {/* Só faz sentido com 2 a 5 produtos; some fora disso em vez de
              aparecer desabilitado sem explicação. */}
          {selecionados.size >= 2 && selecionados.size <= 5 && (
            <button onClick={() => setUnificando(true)} className={botao('secundario', 'sm')}>
              Unificar cadastro
            </button>
          )}

          {podeExcluir && (
            <>
              <span className={SEPARADOR} />
              <button onClick={() => ativarSelecionados(true)} className={botao('secundario', 'sm')}>
                Ativar
              </button>
              <button onClick={() => ativarSelecionados(false)} className={botao('perigo', 'sm')}>
                Desativar
              </button>
            </>
          )}

          <button onClick={() => setSelecionados(new Set())}
            className={botao('sutil', 'sm', 'ml-auto')}>
            Limpar seleção
          </button>
        </div>
      )}

      {/* Barra de busca e filtros */}
      <form onSubmit={buscar} className="flex items-center gap-2 mb-0">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Pesquise por nome, código (SKU) ou GTIN/EAN"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 bg-white"
          />
        </div>
        <button type="submit" className={botao('secundario')}>
          Buscar
        </button>
        <div className="flex items-center gap-1 ml-2">
          <button
            type="button"
            onClick={() => {
              const next = !apenasAtivos
              setApenasAtivos(next)
              navegar({ ativos: next ? '1' : '0', pagina: '1' })
            }}
            className={`px-3 py-1.5 text-xs rounded-full border transition-colors flex items-center gap-1.5 ${
              apenasAtivos
                ? 'border-blue-500 text-blue-600 bg-blue-50 font-medium'
                : 'border-gray-300 text-gray-500 bg-white hover:bg-gray-50 line-through'
            }`}
          >
            {apenasAtivos ? '✓ ' : ''}produtos ativos
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !promo
              setPromo(next)
              navegar({ promo: next ? '1' : '', pagina: '1' })
            }}
            className={`px-3 py-1.5 text-xs rounded-full border transition-colors flex items-center gap-1.5 ${
              promo
                ? 'border-orange-400 text-orange-600 bg-orange-50 font-medium'
                : 'border-gray-300 text-gray-600 bg-white hover:bg-gray-50'
            }`}
          >
            <span>🏷</span>
            em promoção
            {totalEmPromocao > 0 && (
              <span className={`text-xs font-semibold ${promo ? 'text-orange-500' : 'text-gray-400'}`}>
                {totalEmPromocao}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setMostrarFiltros(v => !v)}
            className={`px-3 py-1.5 text-xs rounded-full border transition-colors flex items-center gap-1.5 ${
              mostrarFiltros || filtrosAtivos > 0
                ? 'border-blue-500 text-blue-600 bg-blue-50 font-medium'
                : 'border-gray-300 text-gray-600 bg-white hover:bg-gray-50'
            }`}
          >
            ⚙ filtros
            {filtrosAtivos > 0 && (
              <span className="min-w-[16px] h-4 px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">
                {filtrosAtivos}
              </span>
            )}
          </button>
          <button type="button" onClick={() => { setQ(''); setPromo(false); limparFiltrosAvancados() }}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
            ⊗ limpar filtros
          </button>
        </div>
      </form>

      {/* Painel de filtros avançados */}
      {mostrarFiltros && (
        <div className="flex flex-wrap items-end gap-3 mt-3 p-3 border border-gray-200 rounded-xl bg-white">
          <div>
            <label className="block text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1">Marca</label>
            <select
              value={marcaF}
              onChange={e => { const v = e.target.value; setMarcaF(v); navegar({ marca: v, pagina: '1' }) }}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500 bg-white min-w-[140px]"
            >
              <option value="">Todas</option>
              {marcas.map(m => <option key={m.id} value={m.nome}>{m.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1">Categoria</label>
            <select
              value={categoriaF}
              onChange={e => {
                const v = e.target.value
                setCategoriaF(v); setSubcategoriaF('')
                navegar({ categoria: v, subcategoria: '', pagina: '1' })
              }}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500 bg-white min-w-[140px]"
            >
              <option value="">Todas</option>
              {categoriasRaiz.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1">Subcategoria</label>
            <select
              value={subcategoriaF}
              disabled={subcategoriasDisponiveis.length === 0}
              onChange={e => { const v = e.target.value; setSubcategoriaF(v); navegar({ subcategoria: v, pagina: '1' }) }}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500 bg-white min-w-[140px] disabled:bg-gray-100 disabled:text-gray-400"
            >
              <option value="">Todas</option>
              {subcategoriasDisponiveis.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
            </select>
          </div>

          {[
            { label: 'Estoque', valor: estoqueF, set: setEstoqueF, campo: 'estoque', opcoes: [{ v: 'com', l: 'Com estoque' }, { v: 'sem', l: 'Sem estoque' }] },
            { label: 'Imagem', valor: imagemF, set: setImagemF, campo: 'imagem', opcoes: [{ v: 'com', l: 'Com imagem' }, { v: 'sem', l: 'Sem imagem' }] },
            { label: 'NCM', valor: ncmF, set: setNcmF, campo: 'ncm', opcoes: [{ v: 'com', l: 'Com NCM' }, { v: 'sem', l: 'Sem NCM' }] },
          ].map(grupo => (
            <div key={grupo.campo}>
              <label className="block text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1">{grupo.label}</label>
              <div className="flex items-center gap-1">
                {grupo.opcoes.map(op => (
                  <button
                    key={op.v}
                    type="button"
                    onClick={() => {
                      const next = grupo.valor === op.v ? '' : op.v
                      grupo.set(next)
                      navegar({ [grupo.campo]: next, pagina: '1' })
                    }}
                    className={`px-2.5 py-1.5 text-xs rounded-full border transition-colors ${
                      grupo.valor === op.v
                        ? 'border-blue-500 text-blue-600 bg-blue-50 font-medium'
                        : 'border-gray-300 text-gray-500 bg-white hover:bg-gray-50'
                    }`}
                  >
                    {op.l}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div>
            <label className="block text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1">Tag</label>
            <select
              value={tagF}
              onChange={e => { const v = e.target.value; setTagF(v); navegar({ tag: v, pagina: '1' }) }}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500 bg-white min-w-[140px]"
            >
              <option value="">Todas</option>
              {tagsDisponiveis.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1">Entrada (nº ou NF)</label>
            <input
              value={entradaF}
              onChange={e => setEntradaF(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') navegar({ entrada: entradaF.trim(), pagina: '1' }) }}
              onBlur={() => navegar({ entrada: entradaF.trim(), pagina: '1' })}
              placeholder="Ex: ENT-000001 ou 1875614"
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500 bg-white min-w-[160px]"
            />
            {/* Quando mais de uma entrada casa com o termo, os produtos "a
                mais" precisam de explicação — senão parecem produto errado
                na lista. */}
            {entradaInicial && entradasCasadas.length > 0 && (
              <p className={`text-[10px] mt-1 max-w-[220px] ${entradasCasadas.length > 1 ? 'text-amber-700' : 'text-gray-400'}`}>
                {entradasCasadas.length === 1
                  ? `Entrada ${entradasCasadas[0].rotulo}${entradasCasadas[0].origem === 'xml' ? ' (XML)' : ''}`
                  : `${entradasCasadas.length} entradas casaram: ${entradasCasadas.map(e => e.rotulo).join(', ')}. Digite o número completo para filtrar só uma.`}
              </p>
            )}
            {entradaInicial && entradasCasadas.length === 0 && (
              <p className="text-[10px] mt-1 text-amber-700 max-w-[220px]">
                Nenhuma entrada encontrada com “{entradaInicial}”.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Abas */}
      <div className="flex items-end gap-6 border-b border-gray-200 mt-4 mb-0">
        {ABAS.map(a => (
          <button
            key={a.key}
            onClick={() => { setAba(a.key); navegar({ aba: a.key, pagina: '1' }) }}
            className={`pb-3 text-sm flex items-center gap-1.5 border-b-2 transition-colors ${
              aba === a.key
                ? 'border-blue-600 text-blue-600 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {a.label}
            <span className={`text-xs font-semibold ${aba === a.key ? 'text-blue-600' : 'text-gray-400'}`}>
              {(abaCounts[a.key] ?? 0).toLocaleString('pt-BR')}
            </span>
          </button>
        ))}
      </div>

      {/* Tabela */}
      <div className="border border-gray-200 rounded-b-xl overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="w-10 px-4 py-3">
                <input type="checkbox"
                  checked={selecionados.size === produtos.length && produtos.length > 0}
                  onChange={e => toggleAll(e.target.checked)}
                  className="w-4 h-4 accent-blue-600" />
              </th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Descrição</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Código / GTIN-EAN</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Unidade</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Preço</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Custo</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Markup</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Marca</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Estoque</th>
              <th className="w-28 px-2 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {produtos.map(p => (
              <tr key={p.id} className={`hover:bg-blue-50/30 transition-colors group ${selecionados.has(p.id) ? 'bg-blue-50/50' : ''}`}>
                <td className="px-4 py-2.5">
                  <input type="checkbox" checked={selecionados.has(p.id)} onChange={() => toggleOne(p.id)}
                    className="w-4 h-4 accent-blue-600" />
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    {imagensMap[p.id] ? (
                      <img src={imagensMap[p.id]} alt={p.nome}
                        onClick={() => setEditando(p)}
                        className="w-9 h-9 rounded-lg object-cover border border-gray-200 flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity" />
                    ) : (
                      <div className="w-9 h-9 rounded-lg border border-dashed border-gray-200 flex items-center justify-center flex-shrink-0 text-gray-300 text-sm select-none">
                        📷
                      </div>
                    )}
                    {nomeEditando === p.id ? (
                      <input
                        autoFocus
                        value={nomeValor}
                        onChange={e => setNomeValor(e.target.value)}
                        onBlur={() => salvarNome(p.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                          if (e.key === 'Escape') cancelarEdicaoNome()
                        }}
                        className="text-sm text-gray-900 font-medium border border-blue-400 rounded-md px-1.5 py-0.5 focus:outline-none flex-1 min-w-[260px]"
                      />
                    ) : (
                      <>
                        <button onClick={() => iniciarEdicaoNome(p)} title="Clique para editar o nome"
                          className="text-left text-gray-900 hover:text-blue-600 font-medium block transition-colors break-words">
                          {p.nome}
                        </button>
                        {/* Mesmo atalho que já existe no SKU e no EAN — o nome
                            é o que mais se copia, para colar em anúncio,
                            pesquisa de fornecedor e conversa com cliente. */}
                        <button onClick={() => copiar(p.id, 'nome', p.nome)} title="Copiar nome"
                          className="text-gray-300 hover:text-blue-600 transition-colors leading-none shrink-0">
                          {copiado === `${p.id}-nome` ? '✓' : '⧉'}
                        </button>
                        {/* Em quais canais o produto está anunciado. Clicar
                            abre a lista de anúncios, onde dá para pausar. */}
                        <SeloCanais contagem={anunciosMap?.[p.id]}
                          onAbrir={() => { setAbaModal('anuncios'); setEditando(p) }} />
                      </>
                    )}
                    {p.promocao_ativa && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-orange-100 text-orange-600 border border-orange-200 shrink-0">
                        🏷 PROMOÇÃO
                      </span>
                    )}
                    {!p.disponivel_pdv && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200 shrink-0">
                        🚫 OCULTO NO PDV
                      </span>
                    )}
                    {(p.tags ?? []).map(t => (
                      <span key={t} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-teal-50 text-teal-700 border border-teal-200 shrink-0">
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    {p.categoria && <span className="text-xs text-gray-400">{p.categoria}</span>}
                    {p.promocao_ativa && p.preco_promocional && (
                      <span className="text-xs text-orange-500 font-medium">
                        {p.preco_promocional.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">
                  <div className="flex items-center gap-1.5">
                    <span>{p.sku ?? '—'}</span>
                    {p.sku && (
                      <button onClick={() => copiar(p.id, 'sku', p.sku!)} title="Copiar SKU"
                        className="text-gray-300 hover:text-blue-600 transition-colors leading-none">
                        {copiado === `${p.id}-sku` ? '✓' : '⧉'}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span>{p.ean ?? '—'}</span>
                    {p.ean && (
                      <button onClick={() => copiar(p.id, 'ean', p.ean!)} title="Copiar GTIN/EAN"
                        className="text-gray-300 hover:text-blue-600 transition-colors leading-none">
                        {copiado === `${p.id}-ean` ? '✓' : '⧉'}
                      </button>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-gray-600">{p.unidade}</td>
                <td className="px-3 py-2.5 text-right text-gray-900 font-medium">
                  {p.preco_venda > 0 ? p.preco_venda.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right text-gray-600">
                  {p.preco_custo > 0 ? p.preco_custo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {(() => {
                    const mk = calcMarkup(p)
                    if (mk === null) return <span className="text-gray-400">—</span>
                    return <span className={`font-medium ${mk > 0 ? 'text-green-600' : 'text-red-600'}`}>{mk.toFixed(1)}%</span>
                  })()}
                </td>
                <td className="px-3 py-2.5 text-gray-600 text-xs">{p.marca ?? '—'}</td>
                <td className="px-3 py-2.5 text-right">
                  <button onClick={() => setVendoEstoque(p)} title="Ver estoque detalhado"
                    className="text-gray-700 hover:text-blue-600 hover:underline font-medium transition-colors">
                    {p.estoque ?? 0}
                  </button>
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={() => setEditando(p)}
                      className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                      title="Editar"
                    >
                      ✎
                    </button>
                    {p.tipo !== 'kit' && (
                      <button
                        onClick={() => setDuplicando(p)}
                        className="text-gray-400 hover:text-gray-600 text-sm leading-none"
                        title="Duplicar produto"
                      >
                        ⧉
                      </button>
                    )}
                    {p.tipo !== 'kit' && (
                      <button
                        onClick={() => setCriandoKit(p)}
                        className="text-gray-400 hover:text-gray-600 text-sm leading-none"
                        title="Criar kit a partir deste produto"
                      >
                        📦
                      </button>
                    )}
                    {p.tipo !== 'kit' && canaisShopee.length > 0 && (
                      <button
                        onClick={() => setCriandoAnuncioShopee(p)}
                        className="text-gray-400 hover:text-orange-600 text-sm leading-none"
                        title="Publicar este produto como anúncio na Shopee"
                      >
                        🛍
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {produtos.length === 0 && (
              <tr><td colSpan={10} className="py-12 text-center text-gray-400">Nenhum produto encontrado.</td></tr>
            )}
          </tbody>
        </table>

        {/* Paginação */}
        {totalPaginas > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <p className="text-xs text-gray-500">
              Mostrando {((pagina - 1) * 50) + 1}–{Math.min(pagina * 50, total)} de {total.toLocaleString('pt-BR')} produtos
            </p>
            <div className="flex items-center gap-1">
              <button disabled={pagina <= 1} onClick={() => navegar({ pagina: String(pagina - 1) })}
                className={botao('secundario', 'sm')}>
                Anterior
              </button>
              <span className="px-3 py-1.5 text-xs text-gray-600 font-medium">{pagina} / {totalPaginas}</span>
              <button disabled={pagina >= totalPaginas} onClick={() => navegar({ pagina: String(pagina + 1) })}
                className={botao('secundario', 'sm')}>
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
