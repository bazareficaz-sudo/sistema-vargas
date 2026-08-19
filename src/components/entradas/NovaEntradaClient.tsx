'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import ImprimirEtiquetaModal from '@/components/etiquetas/ImprimirEtiquetaModal'
import type { ProdutoParaEtiqueta } from '@/lib/etiquetas/tipos'
import { ajustarDepositoPrincipal, definirContagemNoDeposito } from '@/lib/produtos/depositoPrincipal'
import { registrarMovimentoEstoque, buscarDepositoPrincipal } from '@/lib/produtos/movimentacao'
import { recalcularKitsQueUsam } from '@/lib/produtos/kit'
import { sincronizarProdutoVinculado } from '@/lib/produtos/vinculo'
import { gerarProximoSku } from '@/components/produtos/sku'
import { atualizarStatusPedidoAposEntrada } from '@/lib/pedidosCompra/vincularEntrada'

type Fornecedor = { id: string; razao_social: string; nome_fantasia: string | null }

type ItemEntrada = {
  produto_id: string | null
  nome_produto: string
  sku: string | null
  quantidade: number
  preco_custo_anterior: number
  preco_custo_novo: number
  markup: number
  preco_venda_novo: number
  atualizar_custo: boolean
  atualizar_preco: boolean
  /** Zerar o saldo antes de somar a entrada — ver etapa Estoque. */
  zerar_estoque?: boolean
}

type ItemReajuste = {
  produto_id: string
  nome_produto: string
  sku: string | null
  preco_custo_anterior: number
  preco_custo_novo: number
  markup: number
  preco_venda_anterior: number
  preco_venda_novo: number
  atualizar_custo: boolean
  atualizar_preco: boolean
  is_kit: boolean
  kit_componentes?: string[]
}

type Parcela = { numero: number; vencimento: string; valor: number }

const ETAPAS = ['dados', 'itens', 'estoque', 'reajuste', 'pagamento', 'confirmacao'] as const
type Etapa = typeof ETAPAS[number]

const ETAPA_LABELS = ['Dados da NF', 'Itens', 'Estoque', 'Reajuste de Preços', 'Pagamento', 'Confirmação']

const ESTADOS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']

function calcVenda(custo: number, markup: number) {
  return parseFloat((custo * (1 + markup / 100)).toFixed(2))
}
function calcMarkup(custo: number, venda: number) {
  if (!custo) return 0
  return parseFloat((((venda / custo) - 1) * 100).toFixed(2))
}
function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

export default function NovaEntradaClient({
  fornecedores: fornecedoresIniciais, empresaId, rascunhoInicial,
}: { fornecedores: Fornecedor[]; empresaId: string; rascunhoInicial?: { id: string; entrada: any; itens: any[] } }) {
  const router = useRouter()

  const [fornecedores, setFornecedores] = useState(fornecedoresIniciais)

  // Rascunho
  const [rascunhoId, setRascunhoId] = useState<string | null>(rascunhoInicial?.id ?? null)
  const [salvandoRascunho, setSalvandoRascunho] = useState(false)
  const [rascunhoMsg, setRascunhoMsg] = useState<string | null>(null)

  // Modal fornecedor rápido
  const [modalForn, setModalForn] = useState(false)
  const [buscaForn, setBuscaForn] = useState('')
  const [novoForn, setNovoForn] = useState({ razao_social: '', nome_fantasia: '', cnpj: '', telefone: '', email: '', contato: '', cidade: '', estado: '' })
  const [salvandoForn, setSalvandoForn] = useState(false)
  const [erroForn, setErroForn] = useState('')

  async function cadastrarFornecedor() {
    if (!novoForn.razao_social.trim()) { setErroForn('Razão social obrigatória.'); return }
    setErroForn(''); setSalvandoForn(true)
    const sb = createClient()
    const { data, error } = await sb.from('fornecedores').insert({
      empresa_id: empresaId, razao_social: novoForn.razao_social.trim(),
      nome_fantasia: novoForn.nome_fantasia || null, cnpj: novoForn.cnpj || null,
      telefone: novoForn.telefone || null, email: novoForn.email || null,
      contato: novoForn.contato || null, cidade: novoForn.cidade || null,
      estado: novoForn.estado || null, ativo: true,
    }).select().single()
    setSalvandoForn(false)
    if (error) { setErroForn(error.message); return }
    setFornecedores(prev => [...prev, { id: data.id, razao_social: data.razao_social, nome_fantasia: data.nome_fantasia }].sort((a, b) => a.razao_social.localeCompare(b.razao_social)))
    setFornecedorId(data.id)
    setBuscaForn(data.nome_fantasia ?? data.razao_social)
    setModalForn(false)
    setNovoForn({ razao_social: '', nome_fantasia: '', cnpj: '', telefone: '', email: '', contato: '', cidade: '', estado: '' })
  }

  // Cabeçalho NF — inicializa do rascunho se disponível
  const _r = rascunhoInicial?.entrada
  const [fornecedorId, setFornecedorId] = useState(_r?.fornecedor_id ?? '')
  // Qual pedido de compra esta entrada atende — opcional. Sem isso não há
  // como saber que a mercadoria que chegou é a de um pedido específico:
  // nem prazo real de entrega, nem marcar o pedido como recebido sozinho.
  const [pedidoCompraId, setPedidoCompraId] = useState<string>((_r as any)?.pedido_compra_id ?? '')
  const [pedidosAbertos, setPedidosAbertos] = useState<{ id: string; numero: string; data_pedido: string; total: number }[]>([])
  const [numeroNf, setNumeroNf] = useState(_r?.numero_nf ?? '')
  const [serie, setSerie] = useState(_r?.serie ?? '')
  const [dataEmissao, setDataEmissao] = useState(_r?.data_emissao ?? '')
  const [valorFrete, setValorFrete] = useState(_r?.valor_frete ? String(_r.valor_frete) : '')
  const [valorDesconto, setValorDesconto] = useState(_r?.valor_desconto ? String(_r.valor_desconto) : '')
  const [valorOutros, setValorOutros] = useState(_r?.valor_outros ? String(_r.valor_outros) : '')
  const [observacoes, setObservacoes] = useState(_r?.observacoes ?? '')

  // Inicializa nome do fornecedor no campo de busca quando vem do rascunho
  useEffect(() => {
    if (_r?.fornecedor_id) {
      const forn = fornecedoresIniciais.find(f => f.id === _r.fornecedor_id)
      if (forn) setBuscaForn(forn.nome_fantasia ?? forn.razao_social)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pedidos de compra em aberto deste fornecedor, para vincular à entrada.
  // Sem vínculo a entrada continua funcionando exatamente como antes —
  // isto é um "a mais", nunca um passo obrigatório.
  useEffect(() => {
    if (!fornecedorId) { setPedidosAbertos([]); setPedidoCompraId(''); return }
    let vivo = true
    const sb = createClient()
    sb.from('pedidos_compra')
      .select('id, numero, data_pedido, total')
      .eq('empresa_id', empresaId).eq('fornecedor_id', fornecedorId)
      .in('status', ['enviado', 'aguardando_aprovacao', 'em_cotacao', 'parcialmente_recebido'])
      .order('data_pedido', { ascending: false })
      .then(({ data }) => { if (vivo) setPedidosAbertos(data ?? []) })
    return () => { vivo = false }
  }, [fornecedorId, empresaId])

  // Etapa 2: Itens — inicializa do rascunho
  const [itens, setItens] = useState<ItemEntrada[]>(
    (rascunhoInicial?.itens ?? []).map((i: any) => ({
      produto_id: i.produto_id,
      nome_produto: i.nome_produto,
      sku: i.sku,
      quantidade: i.quantidade,
      preco_custo_anterior: i.preco_custo_anterior,
      preco_custo_novo: i.preco_custo_novo,
      markup: i.markup,
      preco_venda_novo: i.preco_venda_novo,
      atualizar_custo: i.atualizar_custo,
      atualizar_preco: i.atualizar_preco,
      zerar_estoque: !!i.zerar_estoque_antes,
    }))
  )
  const [buscaProd, setBuscaProd] = useState('')
  const [resultados, setResultados] = useState<any[]>([])
  // true = nenhum produto tinha TODAS as palavras e a lista abaixo é o que
  // bate em parte. Precisa aparecer na tela: sem o aviso, um resultado
  // parecido passa por resultado certo.
  const [buscaParcial, setBuscaParcial] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [indiceProd, setIndiceProd] = useState(-1)
  const [faseItem, setFaseItem] = useState<'busca' | 'qtd' | 'custo'>('busca')
  const [itemAtual, setItemAtual] = useState<ItemEntrada | null>(null)
  const [inputQtd, setInputQtd] = useState('1')
  const [inputCusto, setInputCusto] = useState('')
  const buscarRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputBuscaRef = useRef<HTMLInputElement>(null)
  const inputQtdRef = useRef<HTMLInputElement>(null)
  const inputCustoRef = useRef<HTMLInputElement>(null)

  // Etapa 3: Reajuste
  const [reajustes, setReajustes] = useState<ItemReajuste[]>([])
  const [carregandoReajuste, setCarregandoReajuste] = useState(false)
  const [estoqueAgora, setEstoqueAgora] = useState<Record<string, { estoque: number; minimo: number; unidade: string }>>({})

  // Pagamento
  const [formaPag, setFormaPag] = useState('boleto')
  const [numParcelas, setNumParcelas] = useState(1)
  const [primeiroVenc, setPrimeiroVenc] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 30)
    return d.toISOString().split('T')[0]
  })
  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const [parcelasGeradas, setParcelasGeradas] = useState(false)

  // Geral
  const [etapa, setEtapa] = useState<Etapa>('dados')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  // Trava síncrona contra clique duplo (o estado "salvando" só bloqueia o
  // botão após o próximo render, então dois cliques muito rápidos podiam
  // disparar duas inserções antes do disabled= surtir efeito).
  const enviandoRef = useRef(false)
  const [perguntandoEtiqueta, setPerguntandoEtiqueta] = useState<ProdutoParaEtiqueta[] | null>(null)
  const [imprimindoEtiqueta, setImprimindoEtiqueta] = useState(false)

  useEffect(() => {
    if (etapa === 'itens' && faseItem === 'busca') {
      setTimeout(() => inputBuscaRef.current?.focus(), 50)
    }
  }, [etapa, faseItem])

  useEffect(() => {
    if (faseItem === 'qtd') setTimeout(() => inputQtdRef.current?.focus(), 50)
  }, [faseItem])

  useEffect(() => {
    if (faseItem === 'custo') setTimeout(() => inputCustoRef.current?.focus(), 50)
  }, [faseItem])

  function buscarProdutos(q: string) {
    setBuscaProd(q)
    setIndiceProd(-1)
    if (buscarRef.current) clearTimeout(buscarRef.current)
    setBuscaParcial(false)
    if (!q.trim()) { setResultados([]); return }
    setBuscando(true)
    buscarRef.current = setTimeout(async () => {
      const sb = createClient()

      // Normaliza texto: minúsculo + sem acentos
      function norm(s: string) {
        return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      }

      // Aspas e barra invertida saem porque quebram o filtro do PostgREST;
      // vírgula e parêntese, porque são a sintaxe do `.or()`. A barra comum
      // fica: "3/4" é medida, e é justamente ela que separa uma bucha da
      // outra.
      // Antes o mínimo era 2 letras, e isso jogava fora justamente o que mais
      // separa um produto do outro aqui: o número. "extensao 5 metros"
      // buscava "extensao metros" e trazia as de 10 e 20 metros junto.
      const palavras = q.trim().split(/\s+/).map(p => p.replace(/[,()%"'\\]/g, '')).filter(p => p.length >= 1)
      if (palavras.length === 0) { setResultados([]); setBuscando(false); return }
      const palavrasNorm = palavras.map(norm)

      // Palavra de 1 ou 2 caracteres só vale como palavra inteira: "5" tem
      // que ser o 5 de "5 METROS", não o 5 de "4,5 METROS" ou de "0.75MM".
      // Palavra maior segue valendo como pedaço, senão "bucha" não acharia
      // "BUCHAS" e "3/4" não acharia `3/4"`.
      const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
      const palavraInteira = (texto: string, p: string) => new RegExp(`(^|\\s)${escapar(p)}($|\\s)`).test(texto)
      const curtas = palavrasNorm.filter(p => p.length <= 2)
      function refinar(lista: any[]): any[] {
        if (curtas.length === 0) return lista
        const estrito = lista.filter((p: any) => {
          const campos = norm(p.nome) + ' ' + norm(p.sku ?? '') + ' ' + norm(p.ean ?? '')
          return curtas.every(c => palavraInteira(campos, c))
        })
        // Nunca esvazia a lista: se nada sobrevive ao critério estrito, o que
        // veio do banco já contém todas as palavras e é melhor que nada.
        return estrito.length > 0 ? estrito : lista
      }

      const base = () => sb.from('produtos')
        .select('id, nome, sku, ean, preco_custo, preco_venda, markup, marca')
        .eq('empresa_id', empresaId)
        .eq('ativo', true)
      const camposDe = (p: string) => `nome.ilike.%${p}%,sku.ilike.%${p}%,ean.ilike.%${p}%`

      // TODAS as palavras, exigidas no banco. Cada `.or()` encadeado é somado
      // com E aos anteriores, então "bucha red 3/4" traz só o produto que tem
      // as três coisas — em vez de todas as buchas, todos os reds e todos os
      // 3/4 misturados.
      //
      // Exigir no BANCO, e não filtrando depois, é o que faz diferença de
      // verdade: a consulta ampla trazia no máximo 300 linhas de "qualquer
      // palavra" e o produto certo podia nem estar entre elas, porque só de
      // "bucha" o catálogo tem centenas.
      let query = base()
      for (const p of palavras) query = query.or(camposDe(p))
      let lista: any[] = refinar((await query.limit(80)).data ?? []).slice(0, 50)
      let parcial = false

      // Rede de segurança para o caso que motivou a busca ampla no passado:
      // uma palavra que não existe no cadastro (o operador escreve "cromada",
      // o produto está como "prata") ou digitada com acento, que o `ilike`
      // não ignora. Aí sim vale mostrar o que bate em parte — mas dizendo
      // que é isso, em vez de misturar com o resultado exato.
      if (lista.length === 0 && palavras.length > 1) {
        const condicoes = palavras.flatMap(p => [`nome.ilike.%${p}%`, `sku.ilike.%${p}%`, `ean.ilike.%${p}%`]).join(',')
        const { data } = await base().or(condicoes).limit(300)
        lista = (data ?? [])
          .map((p: any) => {
            const campos = norm(p.nome) + ' ' + norm(p.sku ?? '') + ' ' + norm(p.ean ?? '')
            return { ...p, _acertos: palavrasNorm.filter(pw => campos.includes(pw)).length }
          })
          .filter((p: any) => p._acertos > 0)
          .sort((a: any, b: any) => b._acertos - a._acertos || a.nome.length - b.nome.length || a.nome.localeCompare(b.nome))
          .slice(0, 50)
        parcial = lista.length > 0
      }

      // Nome mais curto primeiro: entre "BUCHA RED 3/4 X 1/2" e "BUCHA RED
      // 3/4 X 1/2 COM ANEL DE VEDACAO", o que tem menos palavra sobrando é
      // o que foi digitado.
      if (!parcial) {
        lista = lista.sort((a: any, b: any) => {
          const comecaA = norm(a.nome).startsWith(palavrasNorm[0]) ? 0 : 1
          const comecaB = norm(b.nome).startsWith(palavrasNorm[0]) ? 0 : 1
          return comecaA - comecaB || a.nome.length - b.nome.length || a.nome.localeCompare(b.nome)
        })
      }

      setBuscaParcial(parcial)
      setResultados(lista)
      setBuscando(false)
    }, 250)
  }

  function selecionarProduto(p: any) {
    setItemAtual({
      produto_id: p.id, nome_produto: p.nome, sku: p.sku,
      quantidade: 1, preco_custo_anterior: p.preco_custo ?? 0,
      preco_custo_novo: p.preco_custo ?? 0,
      markup: p.markup ?? calcMarkup(p.preco_custo, p.preco_venda),
      preco_venda_novo: p.preco_venda ?? 0,
      atualizar_custo: true, atualizar_preco: true,
    })
    setInputQtd('1')
    setInputCusto(p.preco_custo > 0 ? p.preco_custo.toFixed(2) : '')
    setBuscaProd(''); setResultados([]); setIndiceProd(-1)
    setFaseItem('qtd')
  }

  // Produto digitado que ainda não existe no cadastro — cria de verdade em
  // `produtos` (SKU sequencial automático) em vez de só lançar um item solto
  // sem vínculo, pra ele passar a aparecer no catálogo e ter estoque rastreado.
  async function selecionarManual() {
    const nome = buscaProd.trim()
    if (!nome) return
    const sb = createClient()
    const sku = await gerarProximoSku(sb, empresaId)
    const { data: novoProduto, error } = await sb.from('produtos').insert({
      empresa_id: empresaId, nome, sku, tipo: 'simples', unidade: 'UN',
      preco_venda: 0, preco_custo: 0, estoque: 0, ativo: true, disponivel_pdv: true,
    }).select('id, sku').single()
    if (error) { setErro('Erro ao cadastrar produto novo: ' + error.message); return }

    setItemAtual({
      produto_id: novoProduto.id, nome_produto: nome, sku: novoProduto.sku,
      quantidade: 1, preco_custo_anterior: 0, preco_custo_novo: 0,
      markup: 0, preco_venda_novo: 0, atualizar_custo: true, atualizar_preco: true,
    })
    setInputQtd('1'); setInputCusto('')
    setBuscaProd(''); setResultados([]); setIndiceProd(-1)
    setFaseItem('qtd')
  }

  function confirmarQtd() {
    const qtd = parseFloat(inputQtd.replace(',', '.'))
    if (!qtd || qtd <= 0) return
    setItemAtual(prev => prev ? { ...prev, quantidade: qtd } : prev)
    setFaseItem('custo')
  }

  function confirmarCusto() {
    const custo = parseFloat(inputCusto.replace(',', '.'))
    if (isNaN(custo) || custo < 0) return
    const item: ItemEntrada = { ...itemAtual!, preco_custo_novo: custo }
    setItens(prev => [...prev, item])
    setItemAtual(null)
    setFaseItem('busca')
  }

  function handleKeyDownProd(e: React.KeyboardEvent<HTMLInputElement>) {
    const total = resultados.length + 1
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndiceProd(prev => (prev + 1) % total) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndiceProd(prev => (prev - 1 + total) % total) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (indiceProd >= 0 && indiceProd < resultados.length) selecionarProduto(resultados[indiceProd])
      else if (indiceProd === resultados.length) selecionarManual()
      else if (resultados.length > 0) selecionarProduto(resultados[0])
      else if (buscaProd.trim()) selecionarManual()
    }
    else if (e.key === 'Escape') { setResultados([]); setBuscaProd(''); setIndiceProd(-1) }
  }

  function removerItem(idx: number) {
    setItens(prev => prev.filter((_, i) => i !== idx))
  }

  async function avancarParaReajuste() {
    if (itens.length === 0) { setErro('Adicione pelo menos um item.'); return }
    setErro(''); setCarregandoReajuste(true)
    const sb = createClient()

    const produtosIds = itens.filter(i => i.produto_id).map(i => i.produto_id!)

    const { data: produtosData } = await sb.from('produtos')
      .select('id, preco_venda, markup')
      .in('id', produtosIds)

    const precoAtual = (produtosData ?? []).reduce((acc: Record<string, { preco_venda: number; markup: number }>, p) => {
      acc[p.id] = { preco_venda: p.preco_venda ?? 0, markup: p.markup ?? 0 }
      return acc
    }, {})

    const reajustesNota: ItemReajuste[] = itens
      .filter(i => i.produto_id)
      .map(i => {
        const atual = precoAtual[i.produto_id!] ?? { preco_venda: 0, markup: 0 }
        const mk = i.markup || atual.markup || calcMarkup(i.preco_custo_novo, atual.preco_venda)
        return {
          produto_id: i.produto_id!,
          nome_produto: i.nome_produto,
          sku: i.sku,
          preco_custo_anterior: i.preco_custo_anterior,
          preco_custo_novo: i.preco_custo_novo,
          markup: mk,
          preco_venda_anterior: atual.preco_venda,
          preco_venda_novo: i.preco_custo_novo > 0 ? calcVenda(i.preco_custo_novo, mk) : atual.preco_venda,
          atualizar_custo: true,
          atualizar_preco: true,
          is_kit: false,
        }
      })

    const { data: kitItens } = await sb.from('kit_itens')
      .select('kit_id, produto_id, produtos!kit_id(id, nome, sku, preco_venda, markup, preco_custo)')
      .in('produto_id', produtosIds)

    const kitsMap: Record<string, { kit: any; componentes: string[] }> = {}
    for (const ki of (kitItens ?? []) as any[]) {
      if (!kitsMap[ki.kit_id]) {
        kitsMap[ki.kit_id] = { kit: ki.produtos, componentes: [] }
      }
      const nomeComp = itens.find(i => i.produto_id === ki.produto_id)?.nome_produto ?? ki.produto_id
      kitsMap[ki.kit_id].componentes.push(nomeComp)
    }

    const reajustesKits: ItemReajuste[] = Object.entries(kitsMap)
      .filter(([, v]) => v.kit)
      .map(([kitId, v]) => ({
        produto_id: kitId,
        nome_produto: v.kit.nome,
        sku: v.kit.sku,
        preco_custo_anterior: v.kit.preco_custo ?? 0,
        preco_custo_novo: v.kit.preco_custo ?? 0,
        markup: v.kit.markup ?? calcMarkup(v.kit.preco_custo, v.kit.preco_venda),
        preco_venda_anterior: v.kit.preco_venda ?? 0,
        preco_venda_novo: v.kit.preco_venda ?? 0,
        atualizar_custo: false,
        atualizar_preco: true,
        is_kit: true,
        kit_componentes: v.componentes,
      }))

    setReajustes([...reajustesNota, ...reajustesKits])

    // Saldo atual lido agora, na passagem para a etapa de Estoque: entre
    // montar a lista e finalizar a entrada pode ter havido venda.
    const { data: estoqueData } = await sb.from('produtos')
      .select('id, estoque, estoque_minimo, unidade').in('id', produtosIds)
    setEstoqueAgora(Object.fromEntries((estoqueData ?? []).map((p: any) => [
      p.id, { estoque: Number(p.estoque) || 0, minimo: Number(p.estoque_minimo) || 0, unidade: p.unidade ?? 'UN' },
    ])))

    setCarregandoReajuste(false)
    setEtapa('estoque')
  }

  function updateReajuste(idx: number, field: keyof ItemReajuste, value: any) {
    setReajustes(prev => {
      const next = [...prev]
      const r = { ...next[idx], [field]: value }
      if (field === 'markup') r.preco_venda_novo = calcVenda(r.preco_custo_novo, r.markup)
      if (field === 'preco_venda_novo') r.markup = calcMarkup(r.preco_custo_novo, r.preco_venda_novo)
      next[idx] = r
      return next
    })
  }

  function aplicarMarkupGlobal(mk: number) {
    setReajustes(prev => prev.map(r => ({
      ...r, markup: mk, preco_venda_novo: r.preco_custo_novo > 0 ? calcVenda(r.preco_custo_novo, mk) : r.preco_venda_novo
    })))
  }

  const totalProdutos = itens.reduce((s, i) => s + i.preco_custo_novo * i.quantidade, 0)
  const frete = parseFloat(valorFrete.replace(',', '.')) || 0
  const desconto = parseFloat(valorDesconto.replace(',', '.')) || 0
  const outros = parseFloat(valorOutros.replace(',', '.')) || 0
  const totalGeral = totalProdutos + frete + outros - desconto

  function gerarParcelas() {
    const valorParcela = parseFloat((totalGeral / numParcelas).toFixed(2))
    const ps: Parcela[] = Array.from({ length: numParcelas }, (_, i) => ({
      numero: i + 1,
      vencimento: i === 0 ? primeiroVenc : addDays(primeiroVenc, i * 30),
      valor: i === numParcelas - 1 ? parseFloat((totalGeral - valorParcela * (numParcelas - 1)).toFixed(2)) : valorParcela,
    }))
    setParcelas(ps); setParcelasGeradas(true)
  }

  function mostrarRascunhoMsg(msg: string) {
    setRascunhoMsg(msg)
    setTimeout(() => setRascunhoMsg(null), 3500)
  }

  async function salvarRascunho() {
    if (!fornecedorId && itens.length === 0) {
      mostrarRascunhoMsg('⚠ Adicione pelo menos um fornecedor ou item para salvar o rascunho.')
      return
    }
    if (enviandoRef.current) return
    enviandoRef.current = true
    setSalvandoRascunho(true)
    try {
      const sb = createClient()
      const dadosEntrada = {
        empresa_id: empresaId, fornecedor_id: fornecedorId || null,
        numero_nf: numeroNf || null, serie: serie || null, data_emissao: dataEmissao || null,
        data_entrada: new Date().toISOString(),
        valor_produtos: totalProdutos, valor_frete: frete, valor_desconto: desconto,
        valor_outros: outros, valor_total: totalGeral,
        observacoes: observacoes || null, status: 'rascunho',
        pedido_compra_id: pedidoCompraId || null,
      }

      let entradaId = rascunhoId
      if (entradaId) {
        await sb.from('entradas').update(dadosEntrada).eq('id', entradaId)
        await sb.from('entrada_itens').delete().eq('entrada_id', entradaId)
      } else {
        const { data: nova, error } = await sb.from('entradas').insert(dadosEntrada).select('id').single()
        if (error || !nova) { mostrarRascunhoMsg('❌ Erro ao salvar rascunho.'); return }
        entradaId = nova.id
        setRascunhoId(entradaId)
      }

      if (itens.length > 0) {
        await sb.from('entrada_itens').insert(itens.map(i => ({
          entrada_id: entradaId, produto_id: i.produto_id, nome_produto: i.nome_produto,
          sku: i.sku, quantidade: i.quantidade, preco_custo_anterior: i.preco_custo_anterior,
          preco_custo_novo: i.preco_custo_novo, markup: i.markup, preco_venda_novo: i.preco_venda_novo,
          atualizar_custo: i.atualizar_custo, atualizar_preco: i.atualizar_preco,
          zerar_estoque_antes: !!i.zerar_estoque,
          subtotal: i.preco_custo_novo * i.quantidade,
        })))
      }

      mostrarRascunhoMsg('✓ Rascunho salvo! Você pode continuar depois em Entradas.')
    } finally {
      enviandoRef.current = false
      setSalvandoRascunho(false)
    }
  }

  async function confirmarEntrada() {
    if (!fornecedorId) { setErro('Selecione o fornecedor.'); return }
    if (enviandoRef.current) return
    enviandoRef.current = true
    setSalvando(true); setErro('')
    try {
      const sb = createClient()
      const agora = new Date().toISOString()

      let entrada: any
      if (rascunhoId) {
        // Atualiza o rascunho existente para confirmada
        const { data, error: errEntrada } = await sb.from('entradas').update({
          fornecedor_id: fornecedorId,
          numero_nf: numeroNf || null, serie: serie || null, data_emissao: dataEmissao || null,
          data_entrada: agora,
          valor_produtos: totalProdutos, valor_frete: frete, valor_desconto: desconto,
          valor_outros: outros, valor_total: totalGeral,
          observacoes: observacoes || null, status: 'confirmada',
          pedido_compra_id: pedidoCompraId || null,
        }).eq('id', rascunhoId).select().single()
        if (errEntrada || !data) { setErro(errEntrada?.message ?? 'Erro ao confirmar.'); return }
        entrada = data
        await sb.from('entrada_itens').delete().eq('entrada_id', rascunhoId)
      } else {
        const { data, error: errEntrada } = await sb.from('entradas').insert({
          empresa_id: empresaId, fornecedor_id: fornecedorId,
          numero_nf: numeroNf || null, serie: serie || null, data_emissao: dataEmissao || null,
          data_entrada: agora,
          valor_produtos: totalProdutos, valor_frete: frete, valor_desconto: desconto,
          valor_outros: outros, valor_total: totalGeral,
          observacoes: observacoes || null, status: 'confirmada',
          pedido_compra_id: pedidoCompraId || null,
        }).select().single()
        if (errEntrada || !data) { setErro(errEntrada?.message ?? 'Erro ao salvar.'); return }
        entrada = data
      }

      await sb.from('entrada_itens').insert(itens.map(i => ({
        entrada_id: entrada.id, produto_id: i.produto_id, nome_produto: i.nome_produto,
        sku: i.sku, quantidade: i.quantidade, preco_custo_anterior: i.preco_custo_anterior,
        preco_custo_novo: i.preco_custo_novo, markup: i.markup, preco_venda_novo: i.preco_venda_novo,
        atualizar_custo: i.atualizar_custo, atualizar_preco: i.atualizar_preco,
        subtotal: i.preco_custo_novo * i.quantidade,
      })))

      // Fecha o laço com o pedido de compra: marca recebido/parcialmente
      // recebido e passa a alimentar o prazo real do fornecedor. Erro aqui
      // não pode travar a entrada — o estoque já está confirmado e é o que
      // importa primeiro.
      if (pedidoCompraId) {
        try {
          await atualizarStatusPedidoAposEntrada(sb, empresaId, pedidoCompraId)
        } catch { /* a entrada já foi salva; o vínculo pode ser revisto depois */ }
      }

      // Atualiza estoque: busca valores atuais e soma a quantidade recebida
      const produtosComId = itens.filter(i => i.produto_id)
      if (produtosComId.length > 0) {
        const { data: estoqueAtual } = await sb.from('produtos')
          .select('id, estoque')
          .in('id', produtosComId.map(i => i.produto_id!))
        const estoqueMap = (estoqueAtual ?? []).reduce((acc: Record<string, number>, p) => {
          acc[p.id] = p.estoque ?? 0
          return acc
        }, {})
        const depositoPrincipalId = await buscarDepositoPrincipal(sb, empresaId)
        for (const item of produtosComId) {
          const qtdAtual = estoqueMap[item.produto_id!] ?? 0
          // Zerar antes: o produto termina com o que veio nesta entrada, e não
          // com a soma. Escolhido item a item na etapa Estoque.
          const qtdNova = item.zerar_estoque ? item.quantidade : qtdAtual + item.quantidade
          await sb.from('produtos').update({ estoque: qtdNova }).eq('id', item.produto_id!)
          // Espelha no depósito principal — mesmo motivo do PDV (ver
          // src/lib/produtos/depositoPrincipal.ts): sem isso o quadro por
          // depósito no Estoque Detalhado nunca acompanha as entradas.
          if (item.zerar_estoque) {
            // Sobrescreve em vez de somar a diferença — mesma regra da
            // contagem física no cadastro do produto.
            await definirContagemNoDeposito(sb, empresaId, item.produto_id!, qtdNova)
          } else {
            await ajustarDepositoPrincipal(sb, empresaId, item.produto_id!, item.quantidade)
          }
          // Dois movimentos quando zera, não um: o extrato precisa fechar
          // somando. Um movimento só, de 15 para 6, faria a coluna
          // "quantidade" mentir.
          if (item.zerar_estoque && qtdAtual !== 0) {
            await registrarMovimentoEstoque(sb, {
              empresaId, depositoId: depositoPrincipalId, produtoId: item.produto_id!, produtoNome: item.nome_produto,
              tipo: qtdAtual > 0 ? 'ajuste_saida' : 'ajuste_entrada',
              quantidade: Math.abs(qtdAtual), estoqueAnterior: qtdAtual, estoqueNovo: 0,
              motivo: `Estoque zerado antes da entrada NF ${numeroNf || entrada.id.slice(0, 8)}`,
              referenciaTipo: 'entrada', referenciaId: entrada.id,
            })
          }
          await registrarMovimentoEstoque(sb, {
            empresaId, depositoId: depositoPrincipalId, produtoId: item.produto_id!, produtoNome: item.nome_produto,
            tipo: 'entrada_compra', quantidade: item.quantidade,
            estoqueAnterior: item.zerar_estoque ? 0 : qtdAtual, estoqueNovo: qtdNova,
            motivo: `Entrada NF ${numeroNf || entrada.id.slice(0, 8)}`, referenciaTipo: 'entrada', referenciaId: entrada.id,
          })
          // Estoque do kit é um valor calculado e guardado (não ao vivo) —
          // sem isso, kits que usam esse componente ficam com estoque
          // desatualizado até alguém abrir e recalcular manualmente.
          await recalcularKitsQueUsam(sb, item.produto_id!)
        }
      }

      for (const r of reajustes) {
        const upd: any = { updated_at: new Date().toISOString() }
        if (r.atualizar_custo && !r.is_kit) upd.preco_custo = r.preco_custo_novo
        if (r.atualizar_preco) { upd.preco_venda = r.preco_venda_novo; upd.markup = r.markup }
        if (Object.keys(upd).length > 1) {
          await sb.from('produtos').update(upd).eq('id', r.produto_id)
          // Entrada é onde o custo realmente muda no dia a dia: chega a nota,
          // o fornecedor subiu o preço, o markup recalcula a venda. Sem
          // propagar aqui, a empresa parceira ficaria com o custo velho e o
          // "um custo só pro grupo" não valeria justamente no caso que mais
          // importa. Só age se a parceria tiver sincronizar_preco ligado.
          await sincronizarProdutoVinculado(sb, r.produto_id, {}, {
            ...(upd.preco_custo !== undefined ? { preco_custo: upd.preco_custo } : {}),
            ...(upd.preco_venda !== undefined ? { preco_venda: upd.preco_venda, markup: upd.markup } : {}),
          })
        }
      }

      const parcelasFinais = parcelasGeradas ? parcelas : [{ numero: 1, vencimento: primeiroVenc, valor: totalGeral }]
      await sb.from('contas_pagar').insert(parcelasFinais.map(p => ({
        empresa_id: empresaId, entrada_id: entrada.id, fornecedor_id: fornecedorId,
        descricao: `NF ${numeroNf || entrada.id.slice(0, 8)} — ${fornecedores.find(f => f.id === fornecedorId)?.razao_social}` +
          (parcelasFinais.length > 1 ? ` (${p.numero}/${parcelasFinais.length})` : ''),
        valor: p.valor, vencimento: p.vencimento, parcela: p.numero,
        total_parcelas: parcelasFinais.length, forma_pagamento: formaPag, status: 'pendente',
      })))

      // Antes de sair, oferece imprimir etiquetas dos produtos recebidos
      // (quantidade sugerida = quantidade da própria entrada).
      const idsParaEtiqueta = produtosComId.map(i => i.produto_id!)
      if (idsParaEtiqueta.length > 0) {
        const { data: dadosProdutos } = await sb.from('produtos')
          .select('id, nome, sku, ean, preco_venda, preco_promocional, marca, unidade, categoria')
          .in('id', idsParaEtiqueta)
        const porId = new Map((dadosProdutos ?? []).map(p => [p.id, p]))
        const produtosEtiqueta: ProdutoParaEtiqueta[] = produtosComId.map(item => {
          const p = porId.get(item.produto_id!)
          return {
            id: item.produto_id!,
            nome: p?.nome ?? item.nome_produto,
            sku: p?.sku ?? item.sku,
            ean: p?.ean ?? null,
            preco_venda: p?.preco_venda ?? item.preco_venda_novo,
            preco_promocional: p?.preco_promocional ?? null,
            marca: p?.marca ?? null,
            unidade: p?.unidade ?? 'UN',
            categoria: p?.categoria ?? null,
            estoque: item.quantidade,
          } as ProdutoParaEtiqueta & { estoque: number }
        })
        setPerguntandoEtiqueta(produtosEtiqueta)
      } else {
        router.push('/dashboard/entradas')
        router.refresh()
      }
    } finally {
      enviandoRef.current = false
      setSalvando(false)
    }
  }

  const etapaIdx = ETAPAS.indexOf(etapa)

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>compras</span><span>›</span>
        <a href="/dashboard/entradas" className="hover:text-gray-600">entradas</a><span>›</span>
        <span className="text-gray-600 font-medium">nova entrada</span>
      </div>
      <h1 className="text-gray-900 text-xl font-semibold mb-6">Nova Entrada de Mercadoria</h1>

      {/* Steps */}
      <div className="flex items-center gap-0 mb-8 flex-wrap gap-y-2">
        {ETAPAS.map((key, i) => (
          <div key={key} className="flex items-center">
            <div onClick={() => etapaIdx > i && setEtapa(key)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${etapaIdx > i ? 'cursor-pointer text-green-600 hover:bg-green-50' : ''} ${etapa === key ? 'bg-blue-600 text-white' : etapaIdx <= i ? 'text-gray-400' : ''}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                ${etapa === key ? 'bg-white/20 text-white' : etapaIdx > i ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                {etapaIdx > i ? '✓' : i + 1}
              </span>
              {ETAPA_LABELS[i]}
            </div>
            {i < ETAPAS.length - 1 && <div className="w-6 h-px bg-gray-300 mx-1" />}
          </div>
        ))}
      </div>

      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">{erro}</div>}
      {rascunhoMsg && (
        <div className={`text-sm px-4 py-3 rounded-lg mb-4 ${rascunhoMsg.startsWith('✓') ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-yellow-50 border border-yellow-200 text-yellow-700'}`}>
          {rascunhoMsg}
        </div>
      )}

      {/* ── ETAPA 1: Dados NF ── */}
      {etapa === 'dados' && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          <h2 className="font-semibold text-gray-800">Dados da Nota Fiscal</h2>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Fornecedor *</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input value={buscaForn} onChange={e => setBuscaForn(e.target.value)}
                  placeholder="Digite para buscar fornecedor..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
                {buscaForn && !fornecedorId && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
                    {fornecedores.filter(f =>
                      f.razao_social.toLowerCase().includes(buscaForn.toLowerCase()) ||
                      (f.nome_fantasia ?? '').toLowerCase().includes(buscaForn.toLowerCase())
                    ).slice(0, 8).map(f => (
                      <button key={f.id} onClick={() => { setFornecedorId(f.id); setBuscaForn(f.nome_fantasia ?? f.razao_social) }}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-0">
                        <p className="text-sm font-medium text-gray-900">{f.nome_fantasia ?? f.razao_social}</p>
                        {f.nome_fantasia && <p className="text-xs text-gray-400">{f.razao_social}</p>}
                      </button>
                    ))}
                    <button onClick={() => { setNovoForn(p => ({ ...p, razao_social: buscaForn })); setModalForn(true); setBuscaForn('') }}
                      className="w-full text-left px-4 py-3 text-sm text-blue-600 hover:bg-blue-50 font-medium flex items-center gap-2">
                      <span>+</span> Cadastrar &quot;{buscaForn}&quot; como novo fornecedor
                    </button>
                  </div>
                )}
              </div>
              <button type="button" onClick={() => setModalForn(true)}
                className="px-3 py-2 border border-blue-300 text-blue-600 text-sm rounded-lg hover:bg-blue-50 transition-colors whitespace-nowrap">
                + Novo
              </button>
            </div>
            {fornecedorId && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-3 py-1 rounded-full font-medium">
                  ✓ {fornecedores.find(f => f.id === fornecedorId)?.nome_fantasia ?? fornecedores.find(f => f.id === fornecedorId)?.razao_social}
                </span>
                <button onClick={() => { setFornecedorId(''); setBuscaForn('') }} className="text-xs text-gray-400 hover:text-gray-600">trocar</button>
              </div>
            )}
            {fornecedorId && pedidosAbertos.length > 0 && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Esta entrada atende um pedido de compra? (opcional)
                </label>
                <select value={pedidoCompraId} onChange={e => setPedidoCompraId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500">
                  <option value="">Não vincular</option>
                  {pedidosAbertos.map(p => (
                    <option key={p.id} value={p.id}>
                      Pedido #{p.numero} — {new Date(p.data_pedido + 'T00:00:00').toLocaleDateString('pt-BR')} — {p.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-400 mt-1">
                  Vincular marca o pedido como recebido e ajuda o Auxiliar de Compras a aprender o prazo real deste fornecedor.
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <F label="Nº da NF" value={numeroNf} onChange={setNumeroNf} placeholder="000000" />
            <F label="Série" value={serie} onChange={setSerie} placeholder="1" />
            <F label="Data de emissão" value={dataEmissao} onChange={setDataEmissao} type="date" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <F label="Frete (R$)" value={valorFrete} onChange={setValorFrete} placeholder="0,00" />
            <F label="Desconto (R$)" value={valorDesconto} onChange={setValorDesconto} placeholder="0,00" />
            <F label="Outros (R$)" value={valorOutros} onChange={setValorOutros} placeholder="0,00" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Observações</label>
            <textarea value={observacoes} onChange={e => setObservacoes(e.target.value)} rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none" />
          </div>
          <div className="flex justify-between items-center pt-2">
            <button onClick={salvarRascunho} disabled={salvandoRascunho}
              className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5 transition-colors">
              {salvandoRascunho ? '⏳ Salvando...' : '💾 Salvar Rascunho'}
            </button>
            <button onClick={() => { if (!fornecedorId) { setErro('Selecione o fornecedor.'); return }; setErro(''); setEtapa('itens') }}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
              Próximo: Itens →
            </button>
          </div>
        </div>
      )}

      {/* ── ETAPA 2: Itens ── */}
      {etapa === 'itens' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-semibold text-gray-800 mb-1">Produtos da nota</h2>
            <p className="text-xs text-gray-400 mb-4">Informe os produtos, quantidades e custos. Os preços de venda serão ajustados na próxima etapa.</p>

            {faseItem === 'busca' && (
              <div className="relative">
                <input
                  ref={inputBuscaRef}
                  value={buscaProd}
                  onChange={e => buscarProdutos(e.target.value)}
                  onKeyDown={handleKeyDownProd}
                  placeholder="Buscar produto por nome, SKU ou EAN... (↑↓ navegar · Enter selecionar)"
                  className="w-full border-2 border-blue-400 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                />
                {(resultados.length > 0 || (buscaProd && !buscando)) && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-20 overflow-hidden flex flex-col">
                    {buscaParcial && (
                      <p className="px-4 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-200 flex-shrink-0">
                        Nenhum produto tem todas as palavras que você digitou. Abaixo, os que batem em parte —
                        confira o nome antes de escolher.
                      </p>
                    )}
                    <div className="max-h-80 overflow-y-auto">
                    {resultados.map((r, i) => (
                      <button key={r.id} onClick={() => selecionarProduto(r)} onMouseEnter={() => setIndiceProd(i)}
                        className={`w-full text-left px-4 py-3 transition-colors border-b border-gray-100 last:border-0 ${indiceProd === i ? 'bg-blue-600' : 'hover:bg-blue-50'}`}>
                        <p className={`text-sm font-medium ${indiceProd === i ? 'text-white' : 'text-gray-900'}`}>{r.nome}</p>
                        <p className={`text-xs ${indiceProd === i ? 'text-blue-100' : 'text-gray-400'}`}>
                          {r.sku}{r.marca ? ` · ${r.marca}` : ''} · Custo: {fmt(r.preco_custo ?? 0)} · Venda: {fmt(r.preco_venda ?? 0)}
                        </p>
                      </button>
                    ))}
                    </div>
                    <button onClick={selecionarManual} onMouseEnter={() => setIndiceProd(resultados.length)}
                      className={`w-full text-left px-4 py-2.5 text-xs transition-colors border-t border-gray-100 flex-shrink-0 ${indiceProd === resultados.length ? 'bg-gray-700 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                      + Cadastrar &quot;{buscaProd}&quot; como produto novo e adicionar
                    </button>
                  </div>
                )}
              </div>
            )}

            {faseItem === 'qtd' && itemAtual && (
              <div className="flex items-center gap-4 bg-blue-50 border border-blue-200 rounded-xl px-5 py-4">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900">{itemAtual.nome_produto}</p>
                  {itemAtual.sku && <p className="text-xs text-gray-400 font-mono">{itemAtual.sku}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-gray-700">Quantidade:</label>
                  <input
                    ref={inputQtdRef}
                    value={inputQtd}
                    onChange={e => setInputQtd(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); confirmarQtd() }
                      if (e.key === 'Escape') { setFaseItem('busca'); setItemAtual(null) }
                    }}
                    className="w-28 border-2 border-blue-400 rounded-lg px-3 py-2 text-sm text-right focus:outline-none font-mono"
                    placeholder="1"
                    onFocus={e => e.target.select()}
                  />
                  <button onClick={confirmarQtd} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
                    Próximo →
                  </button>
                  <button onClick={() => { setFaseItem('busca'); setItemAtual(null) }} className="text-xs text-gray-400 hover:text-gray-600">
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {faseItem === 'custo' && itemAtual && (
              <div className="flex items-center gap-4 bg-green-50 border border-green-200 rounded-xl px-5 py-4">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900">{itemAtual.nome_produto}</p>
                  <p className="text-xs text-gray-500">
                    Qtd: <strong>{itemAtual.quantidade}</strong>
                    {itemAtual.preco_custo_anterior > 0 && <span className="ml-2 text-gray-400">· Custo anterior: {fmt(itemAtual.preco_custo_anterior)}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-gray-700">Custo unitário (R$):</label>
                  <input
                    ref={inputCustoRef}
                    value={inputCusto}
                    onChange={e => setInputCusto(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); confirmarCusto() }
                      if (e.key === 'Escape') setFaseItem('qtd')
                    }}
                    className="w-32 border-2 border-green-400 rounded-lg px-3 py-2 text-sm text-right focus:outline-none font-mono"
                    placeholder="0,00"
                    onFocus={e => e.target.select()}
                  />
                  <button onClick={confirmarCusto} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg">
                    ✓ Adicionar
                  </button>
                  <button onClick={() => setFaseItem('qtd')} className="text-xs text-gray-400 hover:text-gray-600">
                    ← Qtd
                  </button>
                </div>
              </div>
            )}
          </div>

          {itens.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Produto</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-24">Qtd</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Custo anterior</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Custo novo</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Subtotal</th>
                    <th className="w-8 px-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {itens.map((item, idx) => (
                    <tr key={idx} className="group hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{item.nome_produto}</p>
                        {item.sku && <p className="text-xs text-gray-400 font-mono">{item.sku}</p>}
                        {!item.produto_id && <span className="text-xs text-orange-500 font-medium">Manual</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700 font-mono">{item.quantidade}</td>
                      <td className="px-4 py-3 text-right text-gray-400 text-xs">
                        {item.preco_custo_anterior > 0 ? fmt(item.preco_custo_anterior) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 font-medium">{fmt(item.preco_custo_novo)}</td>
                      <td className="px-4 py-3 text-right text-gray-900 font-semibold">
                        {fmt(item.preco_custo_novo * item.quantidade)}
                      </td>
                      <td className="px-2 py-3 text-center">
                        <button onClick={() => removerItem(idx)}
                          className="text-gray-300 hover:text-red-500 transition-colors text-xl leading-none opacity-0 group-hover:opacity-100">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t border-gray-200">
                    <td colSpan={4} className="px-4 py-3 text-sm text-gray-600 font-medium">{itens.length} produto(s)</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{fmt(totalProdutos)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="flex justify-between items-center">
            <button onClick={() => setEtapa('dados')} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">← Voltar</button>
            <button onClick={salvarRascunho} disabled={salvandoRascunho}
              className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5 transition-colors">
              {salvandoRascunho ? '⏳ Salvando...' : '💾 Salvar Rascunho'}
            </button>
            <button onClick={avancarParaReajuste} disabled={carregandoReajuste || itens.length === 0}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {carregandoReajuste ? 'Carregando...' : 'Próximo: Estoque →'}
            </button>
          </div>
        </div>
      )}

      {/* ── ETAPA 3: Estoque ── */}
      {etapa === 'estoque' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
            <div>
              <h2 className="font-semibold text-gray-800">Estoque depois desta entrada</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Marque <b>Zerar antes</b> nos produtos em que o saldo do sistema não vale mais — o produto
                termina com exatamente o que veio nesta entrada, em vez de somar ao que estava lá.
              </p>
            </div>

            <div className="border border-gray-200 rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Produto</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Estoque hoje</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Entra</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Fica</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Mínimo</th>
                    <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Zerar antes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {itens.map((item, idx) => {
                    const info = item.produto_id ? estoqueAgora[item.produto_id] : undefined
                    const atual = info?.estoque ?? 0
                    const fica = item.zerar_estoque ? item.quantidade : atual + item.quantidade
                    const minimo = info?.minimo ?? 0
                    const abaixoDoMinimo = minimo > 0 && fica < minimo
                    return (
                      <tr key={idx} className={atual < 0 ? 'bg-red-50' : ''}>
                        <td className="px-3 py-2">
                          <p className="text-gray-800 text-xs">{item.nome_produto}</p>
                          <p className="text-gray-400 text-xs">
                            {item.sku ?? '—'}
                            {!item.produto_id && ' · produto novo, sem estoque anterior'}
                          </p>
                        </td>
                        <td className={`px-3 py-2 text-right text-xs font-medium ${atual < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                          {item.produto_id ? atual : '—'}
                          {atual < 0 && <span className="block text-[10px] font-normal">negativo</span>}
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-green-600">+{item.quantidade}</td>
                        <td className="px-3 py-2 text-right text-xs font-bold text-gray-900">
                          {fica}
                          {item.zerar_estoque && atual !== 0 && (
                            <span className="block text-[10px] font-normal text-orange-600">em vez de {atual + item.quantidade}</span>
                          )}
                        </td>
                        <td className={`px-3 py-2 text-right text-xs ${abaixoDoMinimo ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                          {minimo > 0 ? minimo : '—'}
                          {abaixoDoMinimo && <span className="block text-[10px]">continua abaixo</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" checked={!!item.zerar_estoque}
                            disabled={!item.produto_id}
                            onChange={e => setItens(prev => prev.map((it, i) => i === idx ? { ...it, zerar_estoque: e.target.checked } : it))}
                            className="w-4 h-4 accent-orange-500" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {itens.some(i => i.zerar_estoque) && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 text-sm text-orange-800">
                <b>{itens.filter(i => i.zerar_estoque).length} produto(s) terão o estoque zerado</b> antes de
                receber a quantidade desta entrada. O saldo que existia é descartado — fica registrado no
                extrato como ajuste, com o motivo, para explicar o que aconteceu depois.
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <button onClick={() => setEtapa('itens')} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">← Voltar</button>
            <button onClick={() => setEtapa('reajuste')}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
              Próximo: Reajuste de Preços →
            </button>
          </div>
        </div>
      )}

      {/* ── ETAPA 4: Reajuste de Preços ── */}
      {etapa === 'reajuste' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-1">
              <div>
                <h2 className="font-semibold text-gray-800">Reajuste de Preços de Venda</h2>
                <p className="text-xs text-gray-400 mt-0.5">Defina o markup e preço de venda para cada produto. Kits com componentes na nota também são listados.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Aplicar markup em todos:</span>
                <input
                  placeholder="Ex: 30"
                  className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500 text-right"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const mk = parseFloat((e.target as HTMLInputElement).value.replace(',', '.'))
                      if (!isNaN(mk)) { aplicarMarkupGlobal(mk); (e.target as HTMLInputElement).value = '' }
                    }
                  }}
                />
                <span className="text-xs text-gray-400">% + Enter</span>
              </div>
            </div>
          </div>

          {reajustes.filter(r => !r.is_kit).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700">Produtos da nota ({reajustes.filter(r => !r.is_kit).length})</h3>
              </div>
              <TabelaReajuste itens={reajustes.filter(r => !r.is_kit)} todos={reajustes} onUpdate={updateReajuste} />
            </div>
          )}

          {reajustes.filter(r => r.is_kit).length > 0 && (
            <div className="bg-white border border-orange-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-orange-50 border-b border-orange-200 flex items-center gap-2">
                <span className="text-orange-500">⚠</span>
                <h3 className="text-sm font-semibold text-orange-700">
                  Kits afetados ({reajustes.filter(r => r.is_kit).length}) — contêm produtos desta nota
                </h3>
              </div>
              <TabelaReajuste itens={reajustes.filter(r => r.is_kit)} todos={reajustes} onUpdate={updateReajuste} isKit />
            </div>
          )}

          <div className="flex justify-between items-center">
            <button onClick={() => setEtapa('itens')} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">← Voltar</button>
            <button onClick={salvarRascunho} disabled={salvandoRascunho}
              className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5 transition-colors">
              {salvandoRascunho ? '⏳ Salvando...' : '💾 Salvar Rascunho'}
            </button>
            <button onClick={() => setEtapa('pagamento')} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
              Próximo: Pagamento →
            </button>
          </div>
        </div>
      )}

      {/* ── ETAPA 4: Pagamento ── */}
      {etapa === 'pagamento' && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          <h2 className="font-semibold text-gray-800">Condições de Pagamento</h2>
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-gray-700">Total da entrada</span>
            <span className="text-xl font-bold text-blue-700">{fmt(totalGeral)}</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Forma de pagamento</label>
              <select value={formaPag} onChange={e => setFormaPag(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                {['boleto','pix','transferência','dinheiro','cartão','cheque'].map(f => (
                  <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nº de parcelas</label>
              <input type="number" min={1} max={24} value={numParcelas}
                onChange={e => { setNumParcelas(parseInt(e.target.value) || 1); setParcelasGeradas(false) }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">1º vencimento</label>
              <input type="date" value={primeiroVenc}
                onChange={e => { setPrimeiroVenc(e.target.value); setParcelasGeradas(false) }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <button onClick={gerarParcelas} className="px-4 py-2 border border-blue-300 text-blue-700 text-sm font-medium rounded-lg hover:bg-blue-50 transition-colors">
            Gerar parcelas
          </button>
          {parcelasGeradas && (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-center px-4 py-2 text-xs font-medium text-gray-600">Parcela</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-600">Vencimento</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-gray-600">Valor</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {parcelas.map((p, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2 text-center text-gray-600 text-xs">{p.numero}/{parcelas.length}</td>
                      <td className="px-4 py-2">
                        <input type="date" value={p.vencimento}
                          onChange={e => setParcelas(prev => prev.map((x, j) => j === i ? { ...x, vencimento: e.target.value } : x))}
                          className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400" />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input value={p.valor.toFixed(2)}
                          onChange={e => setParcelas(prev => prev.map((x, j) => j === i ? { ...x, valor: parseFloat(e.target.value) || 0 } : x))}
                          className="border border-gray-300 rounded px-2 py-1 text-xs text-right w-28 focus:outline-none focus:border-blue-400" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-between items-center pt-2">
            <button onClick={() => setEtapa('reajuste')} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">← Voltar</button>
            <button onClick={salvarRascunho} disabled={salvandoRascunho}
              className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5 transition-colors">
              {salvandoRascunho ? '⏳ Salvando...' : '💾 Salvar Rascunho'}
            </button>
            <button onClick={() => setEtapa('confirmacao')} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
              Revisar e confirmar →
            </button>
          </div>
        </div>
      )}

      {/* ── ETAPA 5: Confirmação ── */}
      {etapa === 'confirmacao' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="font-semibold text-gray-800 mb-4">Resumo da Entrada</h2>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Row label="Fornecedor" value={fornecedores.find(f => f.id === fornecedorId)?.razao_social ?? '—'} />
                <Row label="Nº NF" value={numeroNf || '—'} />
                <Row label="Data emissão" value={dataEmissao ? new Date(dataEmissao + 'T00:00:00').toLocaleDateString('pt-BR') : '—'} />
              </div>
              <div className="space-y-2">
                <Row label="Produtos" value={fmt(totalProdutos)} />
                {frete > 0 && <Row label="Frete" value={fmt(frete)} />}
                {desconto > 0 && <Row label="Desconto" value={`-${fmt(desconto)}`} />}
                <Row label="Total" value={fmt(totalGeral)} bold />
              </div>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h3 className="font-medium text-gray-700 mb-3">{itens.length} item(s) na nota</h3>
            <div className="space-y-1">
              {itens.map((item, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.nome_produto}</p>
                    <p className="text-xs text-gray-400">{item.quantidade}x · Custo {fmt(item.preco_custo_novo)}</p>
                  </div>
                  <span className="text-sm font-medium">{fmt(item.preco_custo_novo * item.quantidade)}</span>
                </div>
              ))}
            </div>
          </div>
          {reajustes.filter(r => r.atualizar_preco).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h3 className="font-medium text-gray-700 mb-3">Preços que serão atualizados ({reajustes.filter(r => r.atualizar_preco).length})</h3>
              <div className="space-y-1">
                {reajustes.filter(r => r.atualizar_preco).map((r, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div className="flex items-center gap-2">
                      {r.is_kit && <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-medium">KIT</span>}
                      <p className="text-sm text-gray-800">{r.nome_produto}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-gray-400 line-through mr-2">{fmt(r.preco_venda_anterior)}</span>
                      <span className="text-sm font-semibold text-green-600">{fmt(r.preco_venda_novo)}</span>
                      <span className="text-xs text-gray-400 ml-2">({r.markup.toFixed(1)}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h3 className="font-medium text-gray-700 mb-3">Contas a Pagar</h3>
            {(parcelasGeradas ? parcelas : [{ numero: 1, vencimento: primeiroVenc, valor: totalGeral }]).map((p, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{p.numero}/{parcelasGeradas ? parcelas.length : 1}</span>
                  <span className="text-sm text-gray-700">Vence {new Date(p.vencimento + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
                  <span className="text-xs text-gray-400 capitalize">{formaPag}</span>
                </div>
                <span className="text-sm font-medium">{fmt(p.valor)}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between">
            <button onClick={() => setEtapa('pagamento')} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">← Voltar</button>
            <button onClick={confirmarEntrada} disabled={salvando}
              className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {salvando ? 'Confirmando...' : '✓ Confirmar entrada'}
            </button>
          </div>
        </div>
      )}

      {/* Modal fornecedor rápido */}
      {modalForn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModalForn(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Novo Fornecedor</h2>
                <p className="text-xs text-gray-500 mt-0.5">Cadastro rápido — complete os dados depois em Fornecedores</p>
              </div>
              <button onClick={() => setModalForn(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Razão Social *</label>
                <input value={novoForn.razao_social} onChange={e => setNovoForn(p => ({ ...p, razao_social: e.target.value }))}
                  autoFocus placeholder="Nome da empresa"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nome Fantasia</label>
                <input value={novoForn.nome_fantasia} onChange={e => setNovoForn(p => ({ ...p, nome_fantasia: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">CNPJ</label>
                  <input value={novoForn.cnpj} onChange={e => setNovoForn(p => ({ ...p, cnpj: e.target.value }))}
                    placeholder="00.000.000/0000-00"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Telefone</label>
                  <input value={novoForn.telefone} onChange={e => setNovoForn(p => ({ ...p, telefone: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">E-mail</label>
                  <input type="email" value={novoForn.email} onChange={e => setNovoForn(p => ({ ...p, email: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Contato</label>
                  <input value={novoForn.contato} onChange={e => setNovoForn(p => ({ ...p, contato: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Cidade</label>
                  <input value={novoForn.cidade} onChange={e => setNovoForn(p => ({ ...p, cidade: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">UF</label>
                  <select value={novoForn.estado} onChange={e => setNovoForn(p => ({ ...p, estado: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                    <option value="">—</option>
                    {ESTADOS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                  </select>
                </div>
              </div>
              {erroForn && <p className="text-sm text-red-600">{erroForn}</p>}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => setModalForn(false)} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={cadastrarFornecedor} disabled={salvandoForn}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {salvandoForn ? 'Salvando...' : 'Cadastrar e selecionar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {perguntandoEtiqueta && !imprimindoEtiqueta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Entrada salva com sucesso!</h2>
            <p className="text-sm text-gray-500 mb-5">Deseja imprimir as etiquetas dos {perguntandoEtiqueta.length} produto(s) recebidos agora?</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setPerguntandoEtiqueta(null); router.push('/dashboard/entradas'); router.refresh() }}
                className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">
                Não, ir para a lista
              </button>
              <button
                onClick={() => setImprimindoEtiqueta(true)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
                🏷️ Sim, imprimir etiquetas
              </button>
            </div>
          </div>
        </div>
      )}

      {imprimindoEtiqueta && perguntandoEtiqueta && (
        <ImprimirEtiquetaModal
          produtos={perguntandoEtiqueta}
          empresaId={empresaId}
          modoQtdPadrao="estoque"
          labelModoEstoque="Igual à quantidade recebida"
          onClose={() => { setImprimindoEtiqueta(false); setPerguntandoEtiqueta(null); router.push('/dashboard/entradas'); router.refresh() }}
        />
      )}
    </div>
  )
}

function TabelaReajuste({ itens, todos, onUpdate, isKit = false }: {
  itens: ItemReajuste[]
  todos: ItemReajuste[]
  onUpdate: (idx: number, field: keyof ItemReajuste, value: any) => void
  isKit?: boolean
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 border-b border-gray-200">
          <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Produto</th>
          <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">Custo novo</th>
          <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">Markup %</th>
          <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Preço anterior</th>
          <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Preço novo</th>
          <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-20">Variação</th>
          <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-24">Atualizar</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {itens.map(item => {
          const idx = todos.indexOf(item)
          const variacao = item.preco_venda_anterior > 0
            ? ((item.preco_venda_novo - item.preco_venda_anterior) / item.preco_venda_anterior) * 100
            : 0
          return (
            <tr key={item.produto_id} className="group hover:bg-gray-50">
              <td className="px-4 py-3">
                <p className="font-medium text-gray-900">{item.nome_produto}</p>
                {item.sku && <p className="text-xs text-gray-400 font-mono">{item.sku}</p>}
                {item.kit_componentes && (
                  <p className="text-xs text-orange-500 mt-0.5">Contém: {item.kit_componentes.join(', ')}</p>
                )}
              </td>
              <td className="px-4 py-3 text-right text-xs text-gray-500">
                {!isKit ? (
                  <span className="font-mono">{fmt(item.preco_custo_novo)}</span>
                ) : <span className="text-gray-300">—</span>}
              </td>
              <td className="px-4 py-3 text-right">
                <InlineNum value={item.markup} onChange={v => onUpdate(idx, 'markup', v)} suffix="%" />
              </td>
              <td className="px-4 py-3 text-right text-gray-400 text-xs line-through">
                {item.preco_venda_anterior > 0 ? fmt(item.preco_venda_anterior) : '—'}
              </td>
              <td className="px-4 py-3 text-right font-semibold text-gray-900">
                <InlineNum value={item.preco_venda_novo} onChange={v => onUpdate(idx, 'preco_venda_novo', v)} />
              </td>
              <td className="px-4 py-3 text-right">
                {variacao !== 0 && (
                  <span className={`text-xs font-medium ${variacao > 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {variacao > 0 ? '+' : ''}{variacao.toFixed(1)}%
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-center">
                <label className="flex items-center justify-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={item.atualizar_preco}
                    onChange={e => onUpdate(idx, 'atualizar_preco', e.target.checked)}
                    className="w-4 h-4 accent-blue-600" />
                  <span className="text-xs text-gray-500">Preço</span>
                </label>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function F({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
    </div>
  )
}

function InlineNum({ value, onChange, decimals = 2, suffix = '' }: {
  value: number; onChange: (v: number) => void; decimals?: number; suffix?: string
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')
  return editing ? (
    <input value={val} onChange={e => setVal(e.target.value)}
      onBlur={() => { onChange(parseFloat(val.replace(',', '.')) || 0); setEditing(false) }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false) }}
      className="w-full border border-blue-400 rounded px-1 py-0.5 text-xs text-right focus:outline-none"
      autoFocus onFocus={e => e.target.select()} />
  ) : (
    <button onClick={() => { setVal(value.toFixed(decimals)); setEditing(true) }}
      className="w-full text-right text-xs text-gray-900 hover:text-blue-600 hover:underline transition-colors">
      {value.toFixed(decimals)}{suffix}
    </button>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={bold ? 'font-bold text-gray-900' : 'text-gray-900'}>{value}</span>
    </div>
  )
}
