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
  /**
   * A empresa tem loja online? Decide se a linha ganha o botão de publicar.
   * Sem loja, o botão não teria para onde levar.
   */
  temLoja?: boolean
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
  produtos: inicial, imagensMap = {}, total, totalTodos, totalSimples, totalKits,
  pagina, totalPaginas, q: qInicial, abaAtiva: abaInicial, promoFiltro: promoInicial, apenasAtivos: apenasAtivosInicial, empresaId,
  anunciosMap, abrirProdutoId, abrirProdutoAba,
  categoriasRaiz, categoriasTodas, marcas,
  marcaFiltro: marcaInicial, categoriaFiltro: categoriaInicial, subcategoriaFiltro: subcategoriaInicial,
  estoqueFiltro: estoqueInicial, imagemFiltro: imagemInicial, ncmFiltro: ncmInicial,
  tagFiltro: tagInicial, entradaFiltro: entradaInicial, entradasCasadas = [], tagsDisponiveis, temLoja = false,
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

  // Abre o cadastro SEMPRE com a linha completa do banco.
  //
  // A listagem seleciona 26 colunas; o modal grava 45. Abrir com a linha da
  // lista deixava 19 campos sem valor no formulário — e o "Salvar alterações"
  // os gravava como null. Peso, medidas, código do fornecedor, CSOSN, CFOP,
  // ICMS/PIS/COFINS, markup, descrição de marketplace: tudo apagado em
  // silêncio a cada edição feita pela lista. Foi assim que a subcategoria
  // recém-criada "não surtia efeito": ela era salva e apagada na edição
  // seguinte.
  //
  // Buscar antes de abrir custa uma consulta por id (instantânea) e elimina
  // a classe inteira do problema — inclusive para a próxima coluna que
  // alguém adicionar ao modal sem lembrar de mexer na listagem.
  async function abrirProduto(p: Produto) {
    const sb = createClient()
    const { data } = await sb.from('produtos').select('*')
      .eq('id', p.id).eq('empresa_id', empresaId).maybeSingle()
    // Sem o registro completo, abre com o que veio da lista: melhor editar
    // com o formulário incompleto do que não abrir.
    setEditando((data as Produto) ?? p)
  }

  // Chegou por link com ?editar=<id>: abre o cadastro daquele produto na
  // hora. Busca por id em vez de procurar na página atual — o produto pode
  // estar em qualquer página, ou nem passar pelos filtros vigentes.
  useEffect(() => {
    if (!abrirProdutoId) return
    let cancelado = false
    ;(async () => {
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
  // Publicação na Loja Online, direto da linha. `null` = ocioso; o id do
  // produto = requisição em andamento naquela linha.
  const [publicandoLoja, setPublicandoLoja] = useState<string | null>(null)

  async function acaoLoja(p: Produto, acao: 'publicar' | 'atualizar') {
    setPublicandoLoja(p.id)
    setAvisoLoja(null)
    try {
      const r = await fetch('/api/loja-admin/sincronizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtoId: p.id, acao }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.erro ?? 'não deu certo')
      setAvisoLoja({
        texto: acao === 'publicar'
          ? `"${p.nome}" está na Loja Online.`
          : `"${p.nome}" atualizado na Loja Online.`,
        erro: false,
      })
      // Recarrega para o selo LO refletir o novo estado. router.refresh()
      // mantém o que o operador digitou nos filtros.
      router.refresh()
    } catch (e) {
      setAvisoLoja({ texto: e instanceof Error ? e.message : 'não deu certo', erro: true })
    } finally {
      setPublicandoLoja(null)
    }
  }
  const [avisoLoja, setAvisoLoja] = useState<{ texto: string; erro: boolean } | null>(null)

  // O aviso some sozinho. Erro fica mais tempo: quem precisa ler uma falha
  // costuma estar olhando para outro lugar quando ela aparece.
  useEffect(() => {
    if (!avisoLoja) return
    const t = setTimeout(() => setAvisoLoja(null), avisoLoja.erro ? 8000 : 4000)
    return () => clearTimeout(t)
  }, [avisoLoja])
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
      {/* Retorno da ação de loja. Flutuante e efêmero: a linha some da tela
          quando o operador continua rolando a lista, e prender um banner no
          topo obrigaria a rolar de volta para ler. */}
      {avisoLoja && (
        <div
          role="status"
          aria-live="polite"
          onClick={() => setAvisoLoja(null)}
          className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 cursor-pointer rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${
            avisoLoja.erro
              ? 'bg-red-600 text-white'
              : 'bg-gray-900 text-white'}`}
        >
          {avisoLoja.erro ? '⚠ ' : '✓ '}{avisoLoja.texto}
        </div>
      )}

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
            promocao_ativa: p.promocao_ativa, promocao_inicio: p.promocao_inicio, promocao_fim: p.promocao_fim,
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
      {/* No celular título e botões empilham: lado a lado, "Importar de URL"
          e "Novo produto" espremiam o título até quebrar a palavra. */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-4 mb-5">
        <h1 className="text-gray-950 text-2xl font-semibold tracking-tight">Produtos</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setImportandoUrl(true)} className={botao('secundario')}>
            ↓ Importar
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
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 bg-white border border-blue-300 rounded-xl px-4 py-3 mb-4 shadow-lg shadow-blue-100/60">
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
      <div>
      <form onSubmit={buscar} className="flex flex-col lg:flex-row lg:items-center gap-2">
        <div className="relative flex-1 min-w-0">
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
        <div className="flex items-center gap-1.5 flex-wrap lg:ml-2">
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
          <button type="button" onClick={() => { const next = !promo; setPromo(next); navegar({ promo: next ? '1' : '', pagina: '1' }) }} className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${promo ? 'border-orange-300 bg-orange-50 font-medium text-orange-700' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'}`}>
            Promoções
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
            ☷ Filtros
            {filtrosAtivos > 0 && (
              <span className="min-w-[16px] h-4 px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">
                {filtrosAtivos}
              </span>
            )}
          </button>
          <button type="button" onClick={() => { setQ(''); setPromo(false); limparFiltrosAvancados() }}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
            Limpar
          </button>
        </div>
      </form>

      {(marcaF || categoriaF || subcategoriaF || estoqueF || imagemF || ncmF || tagF || entradaF) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {[
            ['Marca', marcaF], ['Categoria', categoriaF], ['Subcategoria', subcategoriaF],
            ['Estoque', estoqueF], ['Imagem', imagemF], ['NCM', ncmF], ['Tag', tagF], ['Entrada', entradaF],
          ].filter((item): item is string[] => Boolean(item[1])).map(([label, valor]) => (
            <span key={label} className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600">
              <strong className="font-medium text-gray-800">{label}:</strong> {valor}
            </span>
          ))}
        </div>
      )}

      {/* Painel de filtros avançados */}
      {mostrarFiltros && (
        <div className="flex flex-wrap items-end gap-3 mt-3 rounded-xl border border-gray-200 p-3 sm:p-4 bg-gray-50/70">
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

      </div>

      {/* Abas */}
      <div className="flex items-end gap-5 overflow-x-auto border-b border-gray-200 mt-5 mb-0">
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

      <div className="flex flex-col gap-3 border-x border-gray-200 bg-gray-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-500">
          <strong className="font-semibold text-gray-900">{total.toLocaleString('pt-BR')} produtos</strong>
          <span> · {produtos.filter(p => (p.estoque ?? 0) <= 0).length} sem estoque nesta página</span>
          <span> · {produtos.filter(p => !p.preco_venda || !p.categoria).length} cadastros incompletos</span>
        </p>
        <div className="flex items-center gap-2" aria-label="Modo de visualização">
          <button type="button" className="rounded-lg border border-blue-400 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">☷ Tabela</button>
          <button type="button" disabled title="Visualização em cards será disponibilizada em breve" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-400">▦ Cards</button>
          <button type="button" disabled title="Personalização de colunas será disponibilizada em breve" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-400">▥ Colunas</button>
        </div>
      </div>

      {/* Tabela */}
      {/* A tabela tem mais colunas do que cabe num celular. Sem um contêiner
          com rolagem própria ela empurra a PÁGINA para o lado, e aí o menu e
          o cabeçalho saem de vista junto. Com ele, só a tabela desliza.
          `min-w` evita que as colunas se esmaguem uma sobre a outra. */}
      <div className="border border-gray-200 rounded-b-xl bg-white overflow-x-auto">
        <table className="w-full text-sm min-w-[920px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/80">
              <th className="w-10 px-4 py-3"><input type="checkbox" checked={selecionados.size === produtos.length && produtos.length > 0} onChange={e => toggleAll(e.target.checked)} className="h-4 w-4 accent-blue-600" /></th>
              <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Produto</th>
              <th className="w-56 px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Comercial</th>
              <th className="w-52 px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Estoque</th>
              <th className="w-40 px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Situação</th>
              <th className="w-48 px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {produtos.map(p => {
              const markup = calcMarkup(p)
              const estoque = p.estoque ?? 0
              const situacao = !p.ativo
                ? { texto: 'Inativo', cls: 'border-gray-200 bg-gray-100 text-gray-600' }
                : estoque < 0
                  ? { texto: 'Estoque negativo', cls: 'border-red-200 bg-red-50 text-red-700' }
                  : estoque === 0
                    ? { texto: 'Sem estoque', cls: 'border-amber-200 bg-amber-50 text-amber-700' }
                    : !p.preco_venda || !p.categoria
                      ? { texto: 'Cadastro incompleto', cls: 'border-violet-200 bg-violet-50 text-violet-700' }
                      : { texto: 'Ativo', cls: 'border-blue-200 bg-blue-50 text-blue-700' }
              return (
              <tr key={p.id} className={`group transition-colors hover:bg-blue-50/30 ${selecionados.has(p.id) ? 'bg-blue-50/60' : ''}`}>
                <td className="px-4 py-4"><input type="checkbox" checked={selecionados.has(p.id)} onChange={() => toggleOne(p.id)} className="h-4 w-4 accent-blue-600" /></td>
                <td className="min-w-[390px] px-3 py-4">
                  <div className="flex items-start gap-3">
                    {imagensMap[p.id] ? <img src={imagensMap[p.id]} alt={p.nome} onClick={() => abrirProduto(p)} className="h-10 w-10 shrink-0 cursor-pointer rounded-xl border border-gray-200 object-cover hover:opacity-80" /> : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-400">▧</div>}
                    <div className="min-w-0 flex-1">
                      {nomeEditando === p.id ? <input autoFocus value={nomeValor} onChange={e => setNomeValor(e.target.value)} onBlur={() => salvarNome(p.id)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') cancelarEdicaoNome() }} className="w-full rounded-md border border-blue-400 px-1.5 py-0.5 font-medium text-gray-900 outline-none" /> : <div className="flex items-center gap-1.5"><button onClick={() => iniciarEdicaoNome(p)} className="text-left font-medium text-gray-900 hover:text-blue-600">{p.nome}</button><button onClick={() => copiar(p.id, 'nome', p.nome)} title="Copiar nome" className="shrink-0 text-gray-300 hover:text-blue-600">{copiado === `${p.id}-nome` ? '✓' : '⧉'}</button></div>}
                      <p className="mt-1 text-xs text-gray-400">{[p.categoria, p.marca, p.sku ? `SKU ${p.sku}` : null].filter(Boolean).join(' · ') || 'Sem classificação'}</p>
                      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-1.5">
                        <SeloCanais contagem={anunciosMap?.[p.id]} onAbrir={() => { setAbaModal('anuncios'); abrirProduto(p) }} />
                        {p.promocao_ativa && <span className="rounded-md border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-600">Promoção</span>}
                        {!p.disponivel_pdv && <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">Oculto no PDV</span>}
                        {(p.tags ?? []).map(t => <span key={t} className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700">{t}</span>)}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-4 align-middle">
                  <p className="font-medium text-gray-900">{p.preco_venda > 0 ? p.preco_venda.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Sem preço'}</p>
                  <p className="mt-1 text-xs text-gray-400">Custo {p.preco_custo > 0 ? p.preco_custo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}{markup !== null ? <><span> · </span><span className={markup > 0 ? 'text-emerald-600' : 'text-red-600'}>Margem {markup.toFixed(1)}%</span></> : null}</p>
                </td>
                <td className="px-3 py-4 align-middle">
                  <button onClick={() => setVendoEstoque(p)} className={`font-medium hover:underline ${estoque < 0 ? 'text-red-600' : estoque === 0 ? 'text-amber-700' : 'text-gray-900'}`}>{estoque.toLocaleString('pt-BR')} {p.unidade.toLowerCase()}</button>
                  <p className="mt-1 text-xs text-gray-400">{estoque < 0 ? 'Reposição urgente' : estoque === 0 ? 'Sem disponibilidade' : estoque <= p.estoque_minimo ? 'Abaixo do mínimo' : 'Estoque disponível'}</p>
                </td>
                <td className="px-3 py-4 align-middle"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${situacao.cls}`}>{situacao.texto}</span></td>
                <td className="px-3 py-4 align-middle">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => abrirProduto(p)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 shadow-sm hover:border-blue-300 hover:text-blue-700"
                      title="Editar"
                    >
                      <span aria-hidden="true">✎</span> Editar
                    </button>
                    {p.tipo !== 'kit' && (
                      <button
                        onClick={() => setDuplicando(p)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        title="Duplicar produto"
                      >
                        ⧉
                      </button>
                    )}
                    {p.tipo !== 'kit' && (
                      <button
                        onClick={() => setCriandoKit(p)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        title="Criar kit a partir deste produto"
                      >
                        📦
                      </button>
                    )}
                    {temLoja && (() => {
                      // O selo LO já diz se o produto está na vitrine — o
                      // mesmo dado decide o que este botão faz. Publicado:
                      // atualizar. Fora: publicar.
                      const naLoja = anunciosMap?.[p.id]?.loja
                      const publicado = naLoja?.estado === 'publicado'
                      const ocupado = publicandoLoja === p.id
                      return (
                        <button
                          onClick={() => acaoLoja(p, publicado ? 'atualizar' : 'publicar')}
                          disabled={ocupado}
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm leading-none disabled:opacity-40 ${
                            publicado ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100' : 'text-gray-400 hover:bg-indigo-50 hover:text-indigo-600'}`}
                          title={publicado
                            ? 'Atualizar na Loja Online — relê foto, preço e estoque do cadastro agora, sem esperar a rotina'
                            : naLoja
                              ? 'Publicar na Loja Online (está pausado)'
                              : 'Publicar este produto na Loja Online'}
                        >
                          {ocupado ? '⏳' : publicado ? '↻' : '🛒'}
                        </button>
                      )
                    })()}
                  </div>
                </td>
              </tr>
            )})}
            {produtos.length === 0 && (
              <tr><td colSpan={6} className="py-12 text-center text-gray-400">Nenhum produto encontrado.</td></tr>
            )}
          </tbody>
        </table>

        {/* Paginação */}
        {totalPaginas > 1 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
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
