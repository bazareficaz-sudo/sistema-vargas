'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { calcularCustoItem, type NFeItem as NFeItemParser } from '@/lib/nfe-parser'
import { gerarProximoSku } from '@/components/produtos/sku'
import { recalcularKitsQueUsam } from '@/lib/produtos/kit'
import { registrarMovimentoEstoque } from '@/lib/produtos/movimentacao'

const UNIDADES = ['UN', 'KG', 'LT', 'MT', 'CX', 'PC', 'PR', 'DZ', 'CT', 'M2', 'M3', 'GR', 'ML', 'CM']

// ── Tipos ────────────────────────────────────────────────────────────────────
type Entrada = Record<string, any>
type Item = Record<string, any>
type Duplicata = Record<string, any>
type Deposito = { id: string; nome: string; principal: boolean }
type Produto = {
  id: string; nome: string; sku: string; ean: string | null; estoque: number; unidade: string
  preco_venda: number; preco_custo: number; marca: string | null; categoria: string | null
  ncm?: string | null; cest?: string | null; codigo_fornecedor?: string | null
}
type Fornecedor = { id: string; nome: string; cnpj: string }

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtDt(d: string) { const s = (d ?? '').split('T')[0].split('-'); return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : d }
function fmtCnpj(c: string) { return (c ?? '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') }

const STATUS_LABEL: Record<string, string> = {
  xml_importado: 'XML Importado', aguardando_mapeamento: 'Mapeamento Pendente',
  aguardando_conferencia: 'Conferência Pendente', aguardando_precos: 'Revisão de Preços',
  aguardando_financeiro: 'Aguard. Financeiro', pronta: 'Pronta p/ Finalizar',
  finalizada: 'Finalizada', cancelada: 'Cancelada',
}
const MAP_STATUS_COR: Record<string, string> = {
  nao_mapeado: 'text-red-600', auto: 'text-blue-600', manual: 'text-emerald-600',
  novo_produto: 'text-purple-600', ignorado: 'text-slate-400'
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function EntradaXmlDetalheClient({
  entrada: entradaInicial, itensIniciais, duplicatasIniciais,
  depositos, produtos, fornecedores, empresaId, operador, somenteLeitura = false
}: {
  entrada: Entrada; itensIniciais: Item[]; duplicatasIniciais: Duplicata[]
  depositos: Deposito[]; produtos: Produto[]; fornecedores: Fornecedor[]
  empresaId: string; operador: string; somenteLeitura?: boolean
}) {
  const sb = createClient()
  const router = useRouter()

  const [entrada, setEntrada] = useState<Entrada>(entradaInicial)
  const [itens, setItens] = useState<Item[]>(itensIniciais)
  const [duplicatas] = useState<Duplicata[]>(duplicatasIniciais)
  const [aba, setAba] = useState('dados')
  const [salvando, setSalvando] = useState(false)

  // Mapeamento
  const [buscaItem, setBuscaItem] = useState<Record<number, string>>({})
  const [mapModal, setMapModal] = useState<Item | null>(null)
  const [mapBusca, setMapBusca] = useState('')
  const [mapFator, setMapFator] = useState('1')
  const [produtoSelecionado, setProdutoSelecionado] = useState<Produto | null>(null)
  const [indiceDestacado, setIndiceDestacado] = useState(0)
  const buscaInputRef = useRef<HTMLInputElement>(null)
  const fatorInputRef = useRef<HTMLInputElement>(null)
  const linhaRefs = useRef<Record<number, HTMLTableRowElement | null>>({})
  const [criandoProduto, setCriandoProduto] = useState(false)
  const [novoProd, setNovoProd] = useState({ nome: '', ean: '', ncm: '', cest: '', unidade: 'UN', precoCusto: '0', precoVenda: '0' })
  const [salvandoNovoProduto, setSalvandoNovoProduto] = useState(false)

  function abrirMapModal(item: Item) {
    setMapModal(item)
    setMapBusca('')
    setMapFator(String(item.fator_conversao || 1))
    setIndiceDestacado(0)
    setCriandoProduto(false)

    // Se o EAN do item bate exatamente com o de algum produto cadastrado,
    // já pré-seleciona — evita ter que buscar manualmente quando o produto
    // já existe no sistema com o mesmo código de barras.
    const porEan = item.ean ? produtos.find(p => p.ean && p.ean === item.ean) : undefined
    setProdutoSelecionado(porEan ?? null)
  }

  function fecharMapModal() {
    setMapModal(null)
    setProdutoSelecionado(null)
    setCriandoProduto(false)
  }

  // Foca a busca sempre que o modal abre (ou quando volta da tela de criar
  // produto) — a menos que já tenha achado o produto certo pelo EAN, aí foca
  // direto o fator de conversão pra já confirmar com Enter.
  useEffect(() => {
    if (mapModal && !criandoProduto) {
      const t = setTimeout(() => {
        if (produtoSelecionado) { fatorInputRef.current?.focus(); fatorInputRef.current?.select() }
        else buscaInputRef.current?.focus()
      }, 50)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapModal, criandoProduto])

  // Reseta o destaque do teclado a cada nova busca.
  useEffect(() => { setIndiceDestacado(0) }, [mapBusca])

  function moverDestaque(delta: number, total: number) {
    setIndiceDestacado(i => {
      const novo = Math.max(0, Math.min(total - 1, i + delta))
      setTimeout(() => linhaRefs.current[novo]?.scrollIntoView({ block: 'nearest' }), 0)
      return novo
    })
  }

  function selecionarProduto(p: Produto) {
    setProdutoSelecionado(p)
    setTimeout(() => { fatorInputRef.current?.focus(); fatorInputRef.current?.select() }, 0)
  }

  function iniciarCriarProduto(item: Item | null) {
    if (!item) return
    const unidadeXml = (item.unidade_xml || '').toUpperCase()
    setNovoProd({
      nome: item.descricao_xml || '',
      ean: item.ean || '',
      ncm: item.ncm || '',
      cest: item.cest || '',
      unidade: UNIDADES.includes(unidadeXml) ? unidadeXml : 'UN',
      precoCusto: String(item.custo_unitario || item.valor_unitario_xml || 0),
      precoVenda: '0',
    })
    setCriandoProduto(true)
  }

  async function criarProdutoEMapear() {
    if (!mapModal) return
    if (!novoProd.nome.trim()) { alert('Informe o nome do produto'); return }
    setSalvandoNovoProduto(true)
    try {
      const sku = await gerarProximoSku(sb, empresaId)
      const { data: produtoCriado, error } = await sb.from('produtos').insert({
        empresa_id: empresaId,
        nome: novoProd.nome.trim(),
        sku,
        tipo: 'simples',
        unidade: novoProd.unidade,
        ean: novoProd.ean || null,
        ncm: novoProd.ncm || null,
        cest: novoProd.cest || null,
        codigo_fornecedor: mapModal.codigo_fornecedor || null,
        preco_custo: parseFloat(novoProd.precoCusto) || 0,
        preco_venda: parseFloat(novoProd.precoVenda) || 0,
        estoque: 0,
        ativo: true,
        disponivel_pdv: true,
      }).select().single()
      if (error) throw error
      await mapearItem(mapModal, produtoCriado as Produto, 'novo_produto')
    } catch (e: any) {
      alert('Erro ao criar produto: ' + e.message)
    } finally {
      setSalvandoNovoProduto(false)
    }
  }

  // Conferência
  const [confQtd, setConfQtd] = useState<Record<string, number>>({})

  // Custos
  const [incluirIpi, setIncluirIpi] = useState(true)
  const [incluirSt, setIncluirSt] = useState(true)
  const [custosAdic, setCustosAdic] = useState({ frete_adicional: 0, seguro_adicional: 0, outras_despesas: 0 })

  // Preços
  const [precosNovos, setPrecosNovos] = useState<Record<string, number>>({})
  const [margemInputs, setMargemInputs] = useState<Record<string, string>>({})
  const [margemPadrao, setMargemPadrao] = useState(40)
  const [modoPreco, setModoPreco] = useState<'margem' | 'preco'>('margem')
  const [produtosAtuais, setProdutosAtuais] = useState<Record<string, Produto>>({})

  // Finalizar
  const [depositoId, setDepositoId] = useState(entrada.deposito_id ?? depositos.find(d => d.principal)?.id ?? '')
  const [gerarContaPagar, setGerarContaPagar] = useState(true)
  const [obsFinanceiro, setObsFinanceiro] = useState('')
  const [finalizando, setFinalizando] = useState(false)
  const [cancelando, setCancelando] = useState(false)

  // ── Stats mapeamento ─────────────────────────────────────────────────────
  const mapeados = itens.filter(i => i.status_mapeamento !== 'nao_mapeado').length
  const naoMapeados = itens.filter(i => i.status_mapeamento === 'nao_mapeado').length
  const todosMapeados = naoMapeados === 0

  // ── Dados atuais dos produtos mapeados (preço/custo vigentes) ───────────
  // Busca direto no banco em vez de usar a lista inicial (limitada a 2000),
  // que pode não conter o produto e fazer preço/margem aparecerem zerados.
  useEffect(() => {
    const ids = Array.from(new Set(itens.map(i => i.produto_id).filter(Boolean)))
    if (ids.length === 0) { setProdutosAtuais({}); return }
    let ativo = true
    sb.from('produtos')
      .select('id, nome, sku, ean, estoque, unidade, preco_venda, preco_custo, marca, categoria, ncm, cest, codigo_fornecedor')
      .in('id', ids)
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) { console.error('Erro ao buscar dados atuais dos produtos:', error); return }
        const mapa: Record<string, Produto> = {}
        for (const p of (data ?? []) as Produto[]) mapa[p.id] = p
        setProdutosAtuais(mapa)
      })
    return () => { ativo = false }
  }, [itens])

  // ── Busca produto p/ mapeamento ──────────────────────────────────────────
  // Busca no banco a cada digitação em vez de filtrar só a lista inicial
  // (limitada a 2000 produtos), pois catálogos grandes podem deixar o produto
  // certo fora dessa janela quando ordenado por nome.
  const [produtosBusca, setProdutosBusca] = useState<Produto[] | null>(null)
  const [buscandoProduto, setBuscandoProduto] = useState(false)

  useEffect(() => {
    if (!mapModal) { setProdutosBusca(null); return }
    let ativo = true
    setBuscandoProduto(true)
    const termo = mapBusca.trim()
    const timer = setTimeout(async () => {
      let query = sb.from('produtos')
        .select('id, nome, sku, ean, estoque, unidade, preco_venda, preco_custo, marca, categoria')
        .eq('empresa_id', empresaId).eq('ativo', true).order('nome').limit(50)
      if (termo) {
        const palavras = termo.toLowerCase().split(/\s+/).map(p => p.replace(/[,()%]/g, ''))
        for (const palavra of palavras) {
          if (!palavra) continue
          query = query.or(`nome.ilike.%${palavra}%,sku.ilike.%${palavra}%,ean.ilike.%${palavra}%`)
        }
      }
      const { data } = await query
      if (ativo) { setProdutosBusca(data ?? []); setBuscandoProduto(false) }
    }, 250)
    return () => { ativo = false; clearTimeout(timer) }
  }, [mapBusca, mapModal, empresaId])

  const produtosFiltrados = produtosBusca ?? produtos.slice(0, 50)

  // ── Mapear item ──────────────────────────────────────────────────────────
  async function mapearItem(item: Item, produto: Produto, status: string = 'manual') {
    const fator = parseFloat(mapFator) || 1
    try {
      // Recalcula o custo com o fator de conversão real — o custo gravado na
      // importação foi dividido pela quantidade do XML (antes de saber o
      // fator), não pela quantidade de entrada de verdade.
      const quantidadeEntrada = item.quantidade_xml * fator
      const custoUnitario = calcularCustoItem({ ...item, quantidade_entrada: quantidadeEntrada } as any, incluirIpi, incluirSt)
      const { error: erroItem } = await sb.from('nfe_itens').update({
        produto_id: produto.id,
        descricao_sistema: produto.nome,
        unidade_sistema: produto.unidade,
        fator_conversao: fator,
        quantidade_entrada: quantidadeEntrada,
        status_mapeamento: status,
        custo_unitario: custoUnitario,
        custo_total: custoUnitario * quantidadeEntrada,
      }).eq('id', item.id)
      if (erroItem) throw erroItem

      // Salvar histórico de mapeamento — best-effort: não é o dado principal
      // (já gravado acima em nfe_itens), só alimenta o auto-mapeamento de
      // futuras entradas do mesmo fornecedor, então uma falha aqui não deve
      // impedir o mapeamento do item em si.
      const { error: erroMapa } = await sb.from('nfe_mapeamentos').upsert({
        empresa_id: empresaId,
        cnpj_fornecedor: entrada.cnpj_fornecedor,
        codigo_fornecedor: item.codigo_fornecedor,
        ean: item.ean || null,
        produto_id: produto.id,
        fator_conversao: fator,
        unidade_xml: item.unidade_xml,
        unidade_sistema: produto.unidade,
        descricao_xml: item.descricao_xml,
        operador: operador,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'empresa_id,cnpj_fornecedor,codigo_fornecedor' })
      if (erroMapa) console.error('Falha ao salvar histórico de mapeamento (nfe_mapeamentos):', erroMapa)

      setItens(p => p.map(i => i.id === item.id ? {
        ...i, produto_id: produto.id, descricao_sistema: produto.nome,
        unidade_sistema: produto.unidade, fator_conversao: fator,
        quantidade_entrada: quantidadeEntrada, status_mapeamento: status,
        custo_unitario: custoUnitario, custo_total: custoUnitario * quantidadeEntrada,
      } : i))

      // Verificar se todos mapeados
      const novosItens = itens.map(i => i.id === item.id ? { ...i, status_mapeamento: status } : i)
      const allMapped = novosItens.every(i => i.status_mapeamento !== 'nao_mapeado')
      if (allMapped && entrada.status === 'aguardando_mapeamento') {
        const { error: erroStatus } = await sb.from('nfe_entradas').update({ status: 'aguardando_conferencia' }).eq('id', entrada.id)
        if (erroStatus) throw erroStatus
        setEntrada(p => ({ ...p, status: 'aguardando_conferencia' }))
      }

      fecharMapModal()
    } catch (e: any) { alert('Erro ao mapear item: ' + e.message) }
  }

  async function ignorarItem(item: Item) {
    const { error } = await sb.from('nfe_itens').update({ status_mapeamento: 'ignorado' }).eq('id', item.id)
    if (error) { alert('Erro ao ignorar item: ' + error.message); return }
    setItens(p => p.map(i => i.id === item.id ? { ...i, status_mapeamento: 'ignorado' } : i))
  }

  // ── Salvar conferência ───────────────────────────────────────────────────
  async function salvarConferencia() {
    setSalvando(true)
    try {
      for (const item of itens) {
        const qtd = confQtd[item.id] ?? item.quantidade_entrada
        const ok = Math.abs(qtd - item.quantidade_entrada) < 0.001
        const { error } = await sb.from('nfe_itens').update({
          qtd_conferida: qtd,
          conferido: ok,
          diferenca_qtd: qtd - item.quantidade_entrada,
        }).eq('id', item.id)
        if (error) throw error
      }
      setItens(p => p.map(i => {
        const qtd = confQtd[i.id] ?? i.quantidade_entrada
        return { ...i, qtd_conferida: qtd, conferido: Math.abs(qtd - i.quantidade_entrada) < 0.001, diferenca_qtd: qtd - i.quantidade_entrada }
      }))
      if (entrada.status === 'aguardando_conferencia') {
        const { error: erroStatus } = await sb.from('nfe_entradas').update({ status: 'aguardando_precos' }).eq('id', entrada.id)
        if (erroStatus) throw erroStatus
        setEntrada(p => ({ ...p, status: 'aguardando_precos' }))
      }
    } catch (e: any) { alert('Erro ao salvar conferência: ' + e.message) }
    finally { setSalvando(false) }
  }

  // ── Calcular custo com adicionais ────────────────────────────────────────
  function custoComAdic(item: Item): number {
    const base = calcularCustoItem(item as any, incluirIpi, incluirSt)
    const totalProd = itens.reduce((s, i) => s + (i.valor_produto ?? 0), 0) || 1
    const prop = (item.valor_produto ?? 0) / totalProd
    const adic = (custosAdic.frete_adicional + custosAdic.seguro_adicional + custosAdic.outras_despesas) * prop
    return base + adic / (item.quantidade_entrada || item.quantidade_xml || 1)
  }

  async function salvarCustos() {
    setSalvando(true)
    try {
      const custos: Record<string, number> = {}
      for (const item of itens) {
        const custo = custoComAdic(item)
        custos[item.id] = custo
        const { error } = await sb.from('nfe_itens').update({ custo_unitario: custo, custo_total: custo * (item.quantidade_entrada || item.quantidade_xml) }).eq('id', item.id)
        if (error) throw error
      }
      const { error: erroEntrada } = await sb.from('nfe_entradas').update({
        frete_adicional: custosAdic.frete_adicional,
        seguro_adicional: custosAdic.seguro_adicional,
        outras_despesas_adicionais: custosAdic.outras_despesas,
        incluir_ipi_custo: incluirIpi,
        incluir_st_custo: incluirSt,
        status: 'aguardando_precos',
      }).eq('id', entrada.id)
      if (erroEntrada) throw erroEntrada
      setItens(p => p.map(i => ({ ...i, custo_unitario: custos[i.id], custo_total: custos[i.id] * (i.quantidade_entrada || i.quantidade_xml) })))
      setEntrada(p => ({ ...p, status: 'aguardando_precos' }))
    } catch (e: any) { alert('Erro ao salvar custos: ' + e.message) }
    finally { setSalvando(false) }
  }

  // ── Aplicar (margem padrão OU preço atual) a todos ───────────────────────
  function aplicarMargem() {
    const novos: Record<string, number> = {}
    for (const item of itens) {
      if (!item.produto_id || item.status_mapeamento === 'ignorado') continue
      const custo = custoComAdic(item)
      if (modoPreco === 'preco') {
        // Mantém o preço de venda atual — a margem muda em função do novo custo
        novos[item.id] = produtosAtuais[item.produto_id]?.preco_venda ?? 0
      } else {
        // Mantém a margem padrão — o preço de venda é recalculado a partir do novo custo
        novos[item.id] = Math.ceil(custo * (1 + margemPadrao / 100) * 100) / 100
      }
    }
    setPrecosNovos(novos)
  }

  async function salvarPrecos() {
    setSalvando(true)
    try {
      for (const [itemId, preco] of Object.entries(precosNovos)) {
        const item = itens.find(i => i.id === itemId)
        if (!item?.produto_id) continue
        const custo = custoComAdic(item)
        const { error } = await sb.from('produtos').update({ preco_custo: custo, preco_venda: preco }).eq('id', item.produto_id).eq('empresa_id', empresaId)
        if (error) throw error
      }
      const { error: erroEntrada } = await sb.from('nfe_entradas').update({ status: 'aguardando_financeiro' }).eq('id', entrada.id)
      if (erroEntrada) throw erroEntrada
      setEntrada(p => ({ ...p, status: 'aguardando_financeiro' }))
    } catch (e: any) { alert('Erro ao salvar preços: ' + e.message) }
    finally { setSalvando(false) }
  }

  // ── Atualização de dados fiscais/códigos do produto ─────────────────────
  // Compara NCM/CEST/EAN/Código do fornecedor do item da NF-e com o que já
  // está cadastrado no produto vinculado — só sugere quando há diferença
  // real (o produto está vazio nesse campo, ou tem um valor diferente do
  // que veio na nota). O usuário escolhe, por item, se quer atualizar.
  type CampoFiscal = 'ncm' | 'cest' | 'ean' | 'codigo_fornecedor'
  const CAMPOS_FISCAIS: { campo: CampoFiscal; label: string }[] = [
    { campo: 'ncm', label: 'NCM' },
    { campo: 'cest', label: 'CEST' },
    { campo: 'ean', label: 'EAN' },
    { campo: 'codigo_fornecedor', label: 'Cód. Fornecedor' },
  ]

  const candidatosFiscais = itens
    .filter(i => i.produto_id && i.status_mapeamento !== 'ignorado' && produtosAtuais[i.produto_id])
    .map(i => {
      const produto = produtosAtuais[i.produto_id]
      const diffs = CAMPOS_FISCAIS.filter(({ campo }) => {
        const doXml = (i[campo] ?? '').toString().trim()
        const doProduto = (produto[campo] ?? '').toString().trim()
        return doXml && doXml !== doProduto
      })
      return { item: i, produto, diffs }
    })
    .filter(c => c.diffs.length > 0)

  // A escolha é por CAMPO, não por item: dá para aceitar o NCM que veio na
  // nota e recusar o EAN do mesmo produto. Marcar o item inteiro obrigava a
  // engolir junto um código de barras que o fornecedor mandou errado.
  const chaveFiscal = (itemId: string, campo: CampoFiscal) => `${itemId}|${campo}`
  const [selecaoFiscal, setSelecaoFiscal] = useState<Record<string, boolean>>({})
  const [aplicandoFiscal, setAplicandoFiscal] = useState(false)

  useEffect(() => {
    // Marca por padrão toda diferença encontrada — o usuário desmarca o que
    // não quiser. Só entra chave nova; o que ele já desmarcou fica assim.
    setSelecaoFiscal(prev => {
      const novo = { ...prev }
      for (const c of candidatosFiscais) {
        for (const { campo } of c.diffs) {
          const k = chaveFiscal(c.item.id, campo)
          if (!(k in novo)) novo[k] = true
        }
      }
      return novo
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, produtosAtuais])

  const totalDiffsFiscais = candidatosFiscais.reduce((s, c) => s + c.diffs.length, 0)
  const marcadosFiscais = candidatosFiscais.reduce(
    (s, c) => s + c.diffs.filter(d => selecaoFiscal[chaveFiscal(c.item.id, d.campo)]).length, 0)

  // Marca/desmarca uma coluna inteira — é o atalho para "não quero atualizar
  // EAN nenhum", que é justamente o caso mais comum.
  function alternarColunaFiscal(campo: CampoFiscal, marcar: boolean) {
    setSelecaoFiscal(prev => {
      const novo = { ...prev }
      for (const c of candidatosFiscais) {
        if (c.diffs.some(d => d.campo === campo)) novo[chaveFiscal(c.item.id, campo)] = marcar
      }
      return novo
    })
  }
  function alternarLinhaFiscal(itemId: string, diffs: { campo: CampoFiscal }[], marcar: boolean) {
    setSelecaoFiscal(prev => {
      const novo = { ...prev }
      for (const d of diffs) novo[chaveFiscal(itemId, d.campo)] = marcar
      return novo
    })
  }

  async function aplicarAtualizacoesFiscais() {
    if (marcadosFiscais === 0) return
    setAplicandoFiscal(true)
    try {
      let produtosTocados = 0
      let camposAplicados = 0
      for (const { item, produto, diffs } of candidatosFiscais) {
        const patch: Record<string, string> = {}
        for (const { campo } of diffs) {
          if (!selecaoFiscal[chaveFiscal(item.id, campo)]) continue
          patch[campo] = (item[campo] ?? '').toString().trim()
        }
        if (Object.keys(patch).length === 0) continue
        const { error } = await sb.from('produtos').update(patch).eq('id', produto.id).eq('empresa_id', empresaId)
        if (error) throw error
        setProdutosAtuais(p => ({ ...p, [produto.id]: { ...p[produto.id], ...patch } }))
        produtosTocados++
        camposAplicados += Object.keys(patch).length
      }
      alert(`${camposAplicados} campo(s) atualizado(s) em ${produtosTocados} produto(s).`)
    } catch (e: any) {
      alert('Erro ao atualizar dados fiscais: ' + e.message)
    } finally {
      setAplicandoFiscal(false)
    }
  }

  // ── Finalizar entrada ────────────────────────────────────────────────────
  async function finalizar() {
    setFinalizando(true)
    try {
      const agora = new Date().toISOString()
      const produtoIdsAfetados = new Set<string>()

      // 1. Dar entrada no estoque
      for (const item of itens) {
        if (!item.produto_id || item.status_mapeamento === 'ignorado') continue
        const qtd = item.qtd_conferida || item.quantidade_entrada || item.quantidade_xml
        // Sempre recalcula na hora de finalizar (não confia em custo_unitario
        // salvo) — esse campo é gravado na importação, antes do fator de
        // conversão ser conhecido, e só é atualizado se o usuário passar
        // pela aba Custos manualmente. Sem isso, produto com conversão (ex.
        // fator 48, uma caixa vira 48 unidades) herdava o custo da caixa
        // inteira como se fosse o custo de 1 unidade.
        const custo = custoComAdic(item)

        // Busca o saldo antes de incrementar — precisa pra logar o
        // movimento (anterior/novo), e serve pros dois caminhos abaixo
        // (RPC ou fallback), em vez de buscar de novo só no fallback.
        const { data: prodAntes, error: erroBusca } = await sb.from('produtos').select('estoque').eq('id', item.produto_id).single()
        if (erroBusca) throw erroBusca
        const estoqueAnterior = prodAntes?.estoque ?? 0
        const estoqueNovo = estoqueAnterior + qtd

        const { error: erroRpc } = await sb.rpc('incrementar_estoque', {
          p_produto_id: item.produto_id,
          p_empresa_id: empresaId,
          p_deposito_id: depositoId,
          p_quantidade: qtd,
          p_custo: custo,
        })
        if (erroRpc) {
          // fallback: update direto
          const { error: erroUpdate } = await sb.from('produtos').update({ estoque: estoqueNovo, preco_custo: custo }).eq('id', item.produto_id)
          if (erroUpdate) throw erroUpdate
        }
        await registrarMovimentoEstoque(sb, {
          empresaId, depositoId, produtoId: item.produto_id, produtoNome: item.descricao_sistema || item.descricao_xml,
          tipo: 'entrada_nfe', quantidade: qtd, estoqueAnterior, estoqueNovo,
          motivo: `Entrada NF-e ${entrada.numero}/${entrada.serie}`, referenciaTipo: 'entrada_xml', referenciaId: entrada.id,
          usuario: operador,
        })
        produtoIdsAfetados.add(item.produto_id)
      }

      // 1b. Recalcular custo/estoque dos kits que têm algum item desta
      // entrada como componente — senão o kit fica com custo desatualizado
      // até alguém abrir o produto e clicar em "Recalcular" manualmente.
      for (const produtoId of produtoIdsAfetados) {
        await recalcularKitsQueUsam(sb, produtoId)
      }

      // 2. Gerar contas a pagar
      if (gerarContaPagar) {
        for (const dup of duplicatas) {
          const { error } = await sb.from('contas_pagar').insert({
            empresa_id: empresaId,
            descricao: `NF-e ${entrada.numero}/${entrada.serie} — ${entrada.nome_fornecedor} — Dup. ${dup.num_dup}`,
            fornecedor_id: entrada.fornecedor_id || null,
            valor: dup.valor,
            vencimento: dup.data_vencimento,
            status: 'aberto',
            origem: 'entrada_xml',
            origem_id: entrada.id,
            observacoes: obsFinanceiro || null,
          })
          if (error) throw error
        }
      }

      // 3. Atualizar status da entrada
      const { error: erroStatus } = await sb.from('nfe_entradas').update({
        status: 'finalizada',
        data_finalizacao: agora,
        deposito_id: depositoId,
        operador_finalizacao: operador,
      }).eq('id', entrada.id)
      if (erroStatus) throw erroStatus

      // 4. Log — best-effort, não bloqueia a finalização se falhar
      const { error: erroLog } = await sb.from('nfe_logs').insert({
        entrada_id: entrada.id,
        empresa_id: empresaId,
        acao: 'finalizada',
        operador,
        detalhes: JSON.stringify({ deposito_id: depositoId, gerou_cp: gerarContaPagar }),
      })
      if (erroLog) console.error('Falha ao gravar log de finalização:', erroLog)

      setEntrada(p => ({ ...p, status: 'finalizada' }))
      setAba('dados')
      alert('Entrada finalizada com sucesso!')
    } catch (e: any) { alert('Erro ao finalizar: ' + e.message) }
    finally { setFinalizando(false) }
  }

  async function cancelar() {
    if (!confirm('Cancelar esta entrada? Esta ação não pode ser desfeita.')) return
    setCancelando(true)
    try {
      const { error } = await sb.from('nfe_entradas').update({ status: 'cancelada' }).eq('id', entrada.id)
      if (error) throw error
      const { error: erroLog } = await sb.from('nfe_logs').insert({ entrada_id: entrada.id, empresa_id: empresaId, acao: 'cancelada', operador })
      if (erroLog) console.error('Falha ao gravar log de cancelamento:', erroLog)
      setEntrada(p => ({ ...p, status: 'cancelada' }))
    } catch (e: any) { alert('Erro ao cancelar: ' + e.message) }
    finally { setCancelando(false) }
  }

  const isFinalizada = entrada.status === 'finalizada'
  const isCancelada  = entrada.status === 'cancelada'
  const readonly     = isFinalizada || isCancelada || somenteLeitura

  const ABAS = [
    { id: 'dados',       label: '📄 Dados NF-e' },
    { id: 'mapeamento',  label: `🔗 Mapeamento ${naoMapeados > 0 ? `(${naoMapeados} pendente${naoMapeados > 1 ? 's' : ''})` : '✓'}` },
    { id: 'conferencia', label: '📦 Conferência' },
    { id: 'custos',      label: '💰 Custos' },
    { id: 'precos',      label: '🏷 Revisão Preços' },
    { id: 'fiscal',      label: `🧬 Dados Fiscais${candidatosFiscais.length > 0 ? ` (${candidatosFiscais.length})` : ''}` },
    { id: 'financeiro',  label: '🧾 Financeiro' },
    { id: 'finalizar',   label: '✅ Finalizar' },
  ]
  // Cliente externo (plano Consulta Fiscal) só vê a nota em si e as duplicatas —
  // mapeamento/conferência/custos/preços/fiscal/finalizar são etapas de trabalho interno.
  const abasVisiveis = somenteLeitura ? ABAS.filter(a => a.id === 'dados' || a.id === 'financeiro') : ABAS

  function baixarXml() {
    const blob = new Blob([entrada.xml_content ?? ''], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `NFe-${entrada.numero}-${entrada.serie}-${entrada.chave_acesso ?? entrada.id}.xml`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/dashboard/entradas-xml')} className="text-slate-400 hover:text-slate-700">← Voltar</button>
        <div className="flex-1">
          <h1 className="text-slate-900 text-lg font-bold">NF-e {entrada.numero}/{entrada.serie} — {entrada.nome_fornecedor}</h1>
          <p className="text-slate-500 text-sm">{fmtCnpj(entrada.cnpj_fornecedor ?? '')} • Emissão: {fmtDt(entrada.data_emissao ?? '')} • {fmt(entrada.valor_total)}</p>
        </div>
        <span className={`text-xs px-3 py-1 rounded-full ${
          isFinalizada ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
          isCancelada  ? 'bg-red-50 text-red-600 border border-red-100' :
          'bg-amber-50 text-amber-600 border border-amber-100'
        }`}>{STATUS_LABEL[entrada.status] ?? entrada.status}</span>
        <button onClick={baixarXml}
          className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 text-sm rounded-xl border border-slate-200">
          ⬇ Exportar XML
        </button>
        {!readonly && (
          <button onClick={cancelar} disabled={cancelando}
            className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm rounded-xl border border-red-200">
            {cancelando ? '...' : 'Cancelar'}
          </button>
        )}
      </div>

      {/* Abas */}
      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {abasVisiveis.map(a => (
          <button key={a.id} onClick={() => setAba(a.id)}
            className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${
              aba === a.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>{a.label}</button>
        ))}
      </div>

      {/* ── ABA DADOS ─────────────────────────────────────────────── */}
      {aba === 'dados' && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white border border-slate-100 rounded-2xl p-4 space-y-3 shadow-sm">
            <h3 className="text-slate-500 text-xs uppercase font-semibold tracking-wide">Identificação</h3>
            <Row label="Chave de Acesso" value={<span className="font-mono text-xs text-slate-500 break-all">{entrada.chave_acesso}</span>} />
            <Row label="NF-e" value={`${entrada.numero}/${entrada.serie}`} />
            <Row label="Modelo" value={entrada.modelo} />
            <Row label="Natureza Op." value={entrada.nat_operacao} />
            <Row label="Emissão" value={fmtDt(entrada.data_emissao ?? '')} />
            <Row label="Entrada" value={fmtDt(entrada.data_entrada ?? '')} />
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl p-4 space-y-3 shadow-sm">
            <h3 className="text-slate-500 text-xs uppercase font-semibold tracking-wide">Fornecedor</h3>
            <Row label="Razão Social" value={entrada.nome_fornecedor} />
            <Row label="CNPJ" value={fmtCnpj(entrada.cnpj_fornecedor ?? '')} />
            <Row label="IE" value={entrada.ie_fornecedor} />
            <Row label="UF" value={entrada.uf_fornecedor} />
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl p-4 space-y-3 col-span-2 shadow-sm">
            <h3 className="text-slate-500 text-xs uppercase font-semibold tracking-wide">Totais</h3>
            <div className="grid grid-cols-6 gap-3">
              <Metric label="Produtos" value={fmt(entrada.valor_produtos)} />
              <Metric label="Frete" value={fmt(entrada.valor_frete)} />
              <Metric label="IPI" value={fmt(entrada.valor_ipi)} />
              <Metric label="ICMS ST" value={fmt(entrada.valor_icms_st)} />
              <Metric label="FCP-ST" value={fmt(entrada.valor_fcp_st || 0)} />
              <Metric label="Total NF-e" value={fmt(entrada.valor_total)} color="text-emerald-600" />
            </div>
          </div>
          {/* Itens resumo */}
          <div className="col-span-2 bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="text-slate-800 text-sm font-medium">Itens ({itens.length})</h3>
            </div>
            <table className="w-full text-xs">
              <thead><tr className="text-slate-500 border-b border-slate-100 bg-slate-50">
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Cód. Forn.</th>
                <th className="px-3 py-2 text-left">EAN</th>
                <th className="px-3 py-2 text-left">Descrição XML</th>
                <th className="px-3 py-2 text-right">Qtd</th>
                <th className="px-3 py-2 text-right">Vl. Unit.</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {itens.map(item => (
                  <tr key={item.id} className="text-slate-500">
                    <td className="px-3 py-1.5">{item.num_item}</td>
                    <td className="px-3 py-1.5 font-mono">{item.codigo_fornecedor}</td>
                    <td className="px-3 py-1.5 font-mono">{item.ean || '—'}</td>
                    <td className="px-3 py-1.5 max-w-[200px] truncate text-slate-700">{item.descricao_xml}</td>
                    <td className="px-3 py-1.5 text-right">{item.quantidade_xml} {item.unidade_xml}</td>
                    <td className="px-3 py-1.5 text-right">{fmt(item.valor_unitario_xml)}</td>
                    <td className="px-3 py-1.5 text-right text-slate-800 font-semibold">{fmt(item.valor_produto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── ABA MAPEAMENTO ────────────────────────────────────────── */}
      {aba === 'mapeamento' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex gap-3 text-sm">
              <span className="text-emerald-600">{mapeados} mapeados</span>
              <span className="text-red-500">{naoMapeados} pendentes</span>
              <span className="text-slate-500">{itens.filter(i => i.status_mapeamento === 'ignorado').length} ignorados</span>
            </div>
            {todosMapeados && <span className="text-green-400 text-sm">✓ Todos os itens mapeados!</span>}
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead><tr className="text-slate-500 text-xs border-b border-slate-100 bg-slate-50">
                <th className="px-3 py-2 text-left">Item XML</th>
                <th className="px-3 py-2 text-left">EAN</th>
                <th className="px-3 py-2 text-right">Qtd</th>
                <th className="px-3 py-2 text-left">Produto Sistema</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-center">Ação</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {itens.map(item => (
                  <tr key={item.id} className={`${item.status_mapeamento === 'nao_mapeado' ? 'bg-red-50' : ''}`}>
                    <td className="px-3 py-2">
                      <p className="text-slate-700 text-xs font-medium">{item.descricao_xml}</p>
                      <p className="text-slate-400 text-xs">Cód: {item.codigo_fornecedor}</p>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">{item.ean || '—'}</td>
                    <td className="px-3 py-2 text-right text-xs text-slate-500">{item.quantidade_xml} {item.unidade_xml}</td>
                    <td className="px-3 py-2">
                      {item.produto_id ? (
                        <div>
                          <p className="text-slate-800 text-xs">{item.descricao_sistema || '(produto)'}</p>
                          <p className="text-slate-400 text-xs">Fator: {item.fator_conversao}x → {item.quantidade_entrada} {item.unidade_sistema}</p>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs italic">Não mapeado</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs ${MAP_STATUS_COR[item.status_mapeamento] ?? 'text-slate-500'}`}>
                        {item.status_mapeamento === 'nao_mapeado' ? '⚠ Pendente' :
                         item.status_mapeamento === 'auto' ? '🤖 Auto' :
                         item.status_mapeamento === 'manual' ? '✓ Manual' :
                         item.status_mapeamento === 'novo_produto' ? '✨ Novo produto' : '— Ignorado'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {!readonly && item.status_mapeamento !== 'ignorado' && (
                        <div className="flex gap-1 justify-center flex-wrap">
                          <button onClick={() => abrirMapModal(item)}
                            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg">
                            {item.produto_id ? 'Alterar' : 'Mapear'}
                          </button>
                          <button onClick={() => { abrirMapModal(item); iniciarCriarProduto(item) }}
                            className="px-2 py-1 bg-purple-50 hover:bg-purple-100 text-purple-600 text-xs rounded-lg">
                            Criar Produto
                          </button>
                          <button onClick={() => ignorarItem(item)}
                            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-500 text-xs rounded-lg">
                            Ignorar
                          </button>
                        </div>
                      )}
                      {item.status_mapeamento === 'ignorado' && !readonly && (
                        <button onClick={async () => {
                          const { error } = await sb.from('nfe_itens').update({ status_mapeamento: 'nao_mapeado', produto_id: null }).eq('id', item.id)
                          if (error) { alert('Erro ao reverter: ' + error.message); return }
                          setItens(p => p.map(i => i.id === item.id ? { ...i, status_mapeamento: 'nao_mapeado', produto_id: null } : i))
                        }} className="px-2 py-1 bg-slate-100 text-slate-500 text-xs rounded-lg">Reverter</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── ABA CONFERÊNCIA ───────────────────────────────────────── */}
      {aba === 'conferencia' && (
        <div className="space-y-3">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-blue-700 text-sm">
            Confira as quantidades recebidas fisicamente e corrija caso haja divergências.
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead><tr className="text-slate-500 text-xs border-b border-slate-100 bg-slate-50">
                <th className="px-3 py-2 text-left">Produto</th>
                <th className="px-3 py-2 text-right">Qtd NF-e</th>
                <th className="px-3 py-2 text-right">Qtd Conferida</th>
                <th className="px-3 py-2 text-center">Diferença</th>
                <th className="px-3 py-2 text-center">OK?</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {itens.filter(i => i.status_mapeamento !== 'ignorado').map(item => {
                  const qtd = confQtd[item.id] ?? item.qtd_conferida ?? item.quantidade_entrada ?? item.quantidade_xml
                  const esp = item.quantidade_entrada || item.quantidade_xml
                  const dif = qtd - esp
                  return (
                    <tr key={item.id} className={Math.abs(dif) > 0.001 ? 'bg-red-50' : ''}>
                      <td className="px-3 py-2">
                        <p className="text-slate-700 text-xs">{item.descricao_sistema || item.descricao_xml}</p>
                        <p className="text-slate-400 text-xs">{item.unidade_sistema || item.unidade_xml}</p>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500 text-xs">{esp}</td>
                      <td className="px-3 py-2 text-right">
                        {readonly ? (
                          <span className="text-slate-700 text-xs">{item.qtd_conferida ?? esp}</span>
                        ) : (
                          <input type="number" step="0.001" value={qtd}
                            onChange={e => setConfQtd(p => ({ ...p, [item.id]: parseFloat(e.target.value) || 0 }))}
                            className="w-20 bg-slate-50 border border-slate-200 text-slate-800 rounded-lg px-2 py-1 text-xs text-right" />
                        )}
                      </td>
                      <td className="px-3 py-2 text-center text-xs">
                        <span className={Math.abs(dif) > 0.001 ? 'text-red-500' : 'text-emerald-600'}>
                          {dif > 0 ? `+${dif.toFixed(2)}` : dif < 0 ? dif.toFixed(2) : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center text-xs">
                        {Math.abs(dif) < 0.001 ? <span className="text-emerald-600">✓</span> : <span className="text-red-500">✕</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!readonly && (
            <div className="flex justify-end">
              <button onClick={salvarConferencia} disabled={salvando}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm disabled:opacity-50">
                {salvando ? 'Salvando...' : 'Confirmar Conferência →'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── ABA CUSTOS ────────────────────────────────────────────── */}
      {aba === 'custos' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white border border-slate-100 rounded-2xl p-4 space-y-3 shadow-sm">
              <h3 className="text-slate-800 text-sm font-medium">Composição do Custo</h3>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={incluirIpi} onChange={e => setIncluirIpi(e.target.checked)} className="accent-blue-500" />
                Incluir IPI no custo
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={incluirSt} onChange={e => setIncluirSt(e.target.checked)} className="accent-blue-500" />
                Incluir ICMS ST no custo
              </label>
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl p-4 space-y-3 shadow-sm">
              <h3 className="text-slate-800 text-sm font-medium">Despesas Adicionais</h3>
              <Field label="Frete adicional" type="number" value={custosAdic.frete_adicional}
                onChange={v => setCustosAdic(p => ({ ...p, frete_adicional: +v }))} />
              <Field label="Seguro adicional" type="number" value={custosAdic.seguro_adicional}
                onChange={v => setCustosAdic(p => ({ ...p, seguro_adicional: +v }))} />
              <Field label="Outras despesas" type="number" value={custosAdic.outras_despesas}
                onChange={v => setCustosAdic(p => ({ ...p, outras_despesas: +v }))} />
            </div>
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-xs">
              <thead><tr className="text-slate-500 border-b border-slate-100 bg-slate-50">
                <th className="px-3 py-2 text-left">Produto</th>
                <th className="px-3 py-2 text-right">Vl. Prod.</th>
                <th className="px-3 py-2 text-right">IPI</th>
                <th className="px-3 py-2 text-right">ST+FCP</th>
                <th className="px-3 py-2 text-right">Frete+</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">Custo Unit.</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {itens.filter(i => i.status_mapeamento !== 'ignorado').map(item => {
                  const custo = custoComAdic(item)
                  return (
                    <tr key={item.id} className="text-slate-500">
                      <td className="px-3 py-2 text-slate-700 max-w-[180px] truncate">{item.descricao_sistema || item.descricao_xml}</td>
                      <td className="px-3 py-2 text-right">{fmt(item.valor_produto)}</td>
                      <td className="px-3 py-2 text-right">{fmt(item.ipi || 0)}</td>
                      <td className="px-3 py-2 text-right">{fmt((item.icms_st || 0) + (item.fcp_st || 0))}</td>
                      <td className="px-3 py-2 text-right">{fmt((item.frete_item || 0) + (item.seguro_item || 0) + (item.outras_desp_item || 0))}</td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-600">{fmt(custo)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!readonly && (
            <div className="flex justify-end">
              <button onClick={salvarCustos} disabled={salvando}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm disabled:opacity-50">
                {salvando ? 'Salvando...' : 'Salvar Custos →'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── ABA REVISÃO PREÇOS ────────────────────────────────────── */}
      {aba === 'precos' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex-wrap">
            <div className="flex bg-slate-100 rounded-xl p-1">
              <button onClick={() => setModoPreco('margem')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${modoPreco === 'margem' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
                Manter margem
              </button>
              <button onClick={() => setModoPreco('preco')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${modoPreco === 'preco' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
                Manter preço
              </button>
            </div>
            {modoPreco === 'margem' ? (
              <>
                <label className="text-slate-500 text-sm">Margem padrão (%)</label>
                <input type="number" value={margemPadrao} onChange={e => setMargemPadrao(+e.target.value)}
                  className="w-24 bg-slate-50 border border-slate-200 text-slate-800 rounded-lg px-2 py-1 text-sm" />
              </>
            ) : (
              <p className="text-slate-400 text-xs">O preço de venda é mantido; a margem se ajusta ao novo custo.</p>
            )}
            <button onClick={aplicarMargem} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm rounded-xl">
              Aplicar a todos
            </button>
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead><tr className="text-slate-500 text-xs border-b border-slate-100 bg-slate-50">
                <th className="px-3 py-2 text-left">Produto</th>
                <th className="px-3 py-2 text-right">Custo Novo</th>
                <th className="px-3 py-2 text-right">Preço Atual</th>
                <th className="px-3 py-2 text-right">Margem Atual</th>
                <th className="px-3 py-2 text-right">Novo Preço</th>
                <th className="px-3 py-2 text-right">Nova Margem</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {itens.filter(i => i.produto_id && i.status_mapeamento !== 'ignorado').map(item => {
                  const prod = produtosAtuais[item.produto_id]
                  const custo = custoComAdic(item)
                  const precoAtual = prod?.preco_venda ?? 0
                  const custoAtual = prod?.preco_custo ?? 0
                  const margemAtual = custoAtual > 0 ? ((precoAtual - custoAtual) / custoAtual * 100) : null
                  const novoPr = precosNovos[item.id] ?? precoAtual
                  const novaMargem = custo > 0 ? ((novoPr - custo) / custo * 100) : 0
                  return (
                    <tr key={item.id} className="text-slate-700">
                      <td className="px-3 py-2 text-xs max-w-[200px] truncate">{item.descricao_sistema || item.descricao_xml}</td>
                      <td className="px-3 py-2 text-right text-xs text-slate-500">{fmt(custo)}</td>
                      <td className="px-3 py-2 text-right text-xs text-slate-500">{fmt(precoAtual)}</td>
                      <td className="px-3 py-2 text-right text-xs">
                        {margemAtual === null ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <span className={margemAtual > 0 ? 'text-slate-500' : 'text-red-500'}>{margemAtual.toFixed(1)}%</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {readonly ? (
                          <span className="text-sm">{fmt(novoPr)}</span>
                        ) : (
                          <input type="number" step="0.01" value={novoPr}
                            onChange={e => setPrecosNovos(p => ({ ...p, [item.id]: +e.target.value }))}
                            className="w-24 bg-slate-50 border border-slate-200 text-slate-800 rounded-lg px-2 py-1 text-xs text-right" />
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {readonly ? (
                          <span className={`text-xs ${novaMargem > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{novaMargem.toFixed(1)}%</span>
                        ) : (
                          <input type="number" step="0.1"
                            value={margemInputs[item.id] ?? novaMargem.toFixed(1)}
                            onChange={e => {
                              const raw = e.target.value
                              setMargemInputs(p => ({ ...p, [item.id]: raw }))
                              const m = parseFloat(raw)
                              if (!Number.isNaN(m)) {
                                const preco = custo > 0 ? Math.ceil(custo * (1 + m / 100) * 100) / 100 : 0
                                setPrecosNovos(p => ({ ...p, [item.id]: preco }))
                              }
                            }}
                            onBlur={() => setMargemInputs(p => {
                              const { [item.id]: _remove, ...rest } = p
                              return rest
                            })}
                            className="w-20 bg-slate-50 border border-slate-200 text-slate-800 rounded-lg px-2 py-1 text-xs text-right" />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!readonly && (
            <div className="flex justify-end">
              <button onClick={salvarPrecos} disabled={salvando}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm disabled:opacity-50">
                {salvando ? 'Salvando...' : 'Atualizar Preços →'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── ABA DADOS FISCAIS ─────────────────────────────────────── */}
      {aba === 'fiscal' && (
        <div className="space-y-3">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-blue-700 text-sm">
            Compara NCM, CEST, EAN e Código do Fornecedor do XML com o que já está cadastrado no produto vinculado.
            Só aparece aqui quando há diferença de verdade.
            <span className="block mt-1 text-blue-600 text-xs">
              A escolha é campo a campo: dá para aceitar o NCM da nota e recusar o EAN do mesmo produto.
              Use o checkbox no título da coluna para tratar um campo inteiro de uma vez.
            </span>
          </div>
          {candidatosFiscais.length === 0 ? (
            <p className="text-slate-400 text-center py-8 text-sm">Nenhuma diferença encontrada entre o XML e o cadastro dos produtos mapeados.</p>
          ) : (
            <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead><tr className="text-slate-500 text-xs border-b border-slate-100 bg-slate-50">
                  <th className="px-3 py-2 text-center">
                    <input type="checkbox" disabled={readonly}
                      title="Marcar ou desmarcar tudo"
                      checked={totalDiffsFiscais > 0 && marcadosFiscais === totalDiffsFiscais}
                      onChange={e => {
                        const marcar = e.target.checked
                        setSelecaoFiscal(Object.fromEntries(candidatosFiscais.flatMap(c =>
                          c.diffs.map(d => [chaveFiscal(c.item.id, d.campo), marcar]))))
                      }} />
                  </th>
                  <th className="px-3 py-2 text-left">Produto</th>
                  {CAMPOS_FISCAIS.map(({ campo, label }) => {
                    // Quantos itens desta coluna têm diferença — a coluna só
                    // ganha checkbox quando há algo nela para decidir.
                    const naColuna = candidatosFiscais.filter(c => c.diffs.some(d => d.campo === campo))
                    const marcadosNaColuna = naColuna.filter(c => selecaoFiscal[chaveFiscal(c.item.id, campo)]).length
                    return (
                      <th key={campo} className="px-3 py-2 text-left">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          {naColuna.length > 0 && (
                            <input type="checkbox" disabled={readonly}
                              title={`Marcar ou desmarcar ${label} em todos os ${naColuna.length} item(ns)`}
                              checked={marcadosNaColuna === naColuna.length}
                              ref={el => { if (el) el.indeterminate = marcadosNaColuna > 0 && marcadosNaColuna < naColuna.length }}
                              onChange={e => alternarColunaFiscal(campo, e.target.checked)} />
                          )}
                          <span>{label}</span>
                          {naColuna.length > 0 && (
                            <span className="text-slate-400 font-normal">({marcadosNaColuna}/{naColuna.length})</span>
                          )}
                        </label>
                      </th>
                    )
                  })}
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {candidatosFiscais.map(({ item, produto, diffs }) => {
                    const marcadosNaLinha = diffs.filter(d => selecaoFiscal[chaveFiscal(item.id, d.campo)]).length
                    return (
                      <tr key={item.id} className={readonly ? 'opacity-60' : ''}>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" disabled={readonly}
                            title="Marcar ou desmarcar todos os campos deste produto"
                            checked={marcadosNaLinha === diffs.length}
                            ref={el => { if (el) el.indeterminate = marcadosNaLinha > 0 && marcadosNaLinha < diffs.length }}
                            onChange={e => alternarLinhaFiscal(item.id, diffs, e.target.checked)} />
                        </td>
                        <td className="px-3 py-2 text-slate-800 text-xs max-w-[180px] truncate">{produto.nome}</td>
                        {CAMPOS_FISCAIS.map(({ campo }) => {
                          const mudou = diffs.some(d => d.campo === campo)
                          if (!mudou) {
                            return (
                              <td key={campo} className="px-3 py-2 text-xs">
                                <span className="text-slate-400">{produto[campo] || '—'}</span>
                              </td>
                            )
                          }
                          const marcado = !!selecaoFiscal[chaveFiscal(item.id, campo)]
                          return (
                            <td key={campo} className="px-3 py-2 text-xs">
                              <label className="flex items-start gap-1.5 cursor-pointer">
                                <input type="checkbox" disabled={readonly} className="mt-0.5"
                                  checked={marcado}
                                  onChange={e => setSelecaoFiscal(p => ({ ...p, [chaveFiscal(item.id, campo)]: e.target.checked }))} />
                                <span className={marcado ? '' : 'opacity-40'}>
                                  <span className="text-slate-400 line-through">{produto[campo] || '—'}</span>
                                  {' → '}
                                  <span className="text-emerald-600 font-medium">{item[campo]}</span>
                                </span>
                              </label>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!readonly && candidatosFiscais.length > 0 && (
            <div className="flex justify-end items-center gap-3">
              <span className="text-xs text-slate-500">
                {marcadosFiscais} de {totalDiffsFiscais} campo(s) marcado(s)
              </span>
              <button onClick={aplicarAtualizacoesFiscais} disabled={aplicandoFiscal || marcadosFiscais === 0}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm disabled:opacity-50">
                {aplicandoFiscal ? 'Aplicando...' : `Aplicar ${marcadosFiscais} campo(s)`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── ABA FINANCEIRO ────────────────────────────────────────── */}
      {aba === 'financeiro' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="text-slate-800 text-sm font-medium">Duplicatas / Condições de Pagamento</h3>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-slate-500 text-xs border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-2 text-left">Duplicata</th>
                <th className="px-4 py-2 text-center">Vencimento</th>
                <th className="px-4 py-2 text-right">Valor</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {duplicatas.length === 0 && (
                  <tr><td colSpan={3} className="text-center py-6 text-slate-400">Nenhuma duplicata registrada</td></tr>
                )}
                {duplicatas.map((d, i) => (
                  <tr key={i} className="text-slate-700">
                    <td className="px-4 py-2.5">Dup. {d.num_dup}</td>
                    <td className="px-4 py-2.5 text-center">{fmtDt(d.data_vencimento ?? '')}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{fmt(d.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!readonly && (
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={gerarContaPagar} onChange={e => setGerarContaPagar(e.target.checked)} className="accent-blue-500" />
                Gerar contas a pagar ao finalizar
              </label>
            </div>
          )}
        </div>
      )}

      {/* ── ABA FINALIZAR ─────────────────────────────────────────── */}
      {aba === 'finalizar' && (
        <div className="space-y-4">
          {isFinalizada ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
              <p className="text-green-400 text-2xl mb-2">✓</p>
              <p className="text-green-400 font-semibold">Entrada finalizada com sucesso!</p>
              <p className="text-slate-500 text-sm mt-1">Estoque atualizado • {gerarContaPagar ? 'Contas a pagar geradas' : ''}</p>
            </div>
          ) : isCancelada ? (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
              <p className="text-red-400 font-semibold">Esta entrada foi cancelada.</p>
            </div>
          ) : (
            <>
              {/* Checklist */}
              <div className="bg-white border border-slate-100 rounded-2xl p-4 space-y-2 shadow-sm">
                <h3 className="text-slate-800 text-sm font-medium mb-3">Checklist antes de finalizar</h3>
                <CheckItem ok={todosMapeados} label={`Mapeamento: ${mapeados}/${itens.length} itens mapeados`} />
                <CheckItem ok={true} label="Conferência física registrada" />
                <CheckItem ok={true} label="Custos calculados" />
                <CheckItem ok={true} label="Preços revisados" />
              </div>
              <div className="bg-white border border-slate-100 rounded-2xl p-4 space-y-3 shadow-sm">
                <h3 className="text-slate-800 text-sm font-medium">Configurações de entrada</h3>
                <div>
                  <label className="text-slate-500 text-xs">Depósito de destino</label>
                  <select value={depositoId} onChange={e => setDepositoId(e.target.value)}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm">
                    {depositos.map(d => <option key={d.id} value={d.id}>{d.nome}{d.principal ? ' (Principal)' : ''}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={gerarContaPagar} onChange={e => setGerarContaPagar(e.target.checked)} className="accent-blue-500" />
                  Gerar {duplicatas.length} conta(s) a pagar — Total: {fmt(duplicatas.reduce((s, d) => s + d.valor, 0))}
                </label>
                <div>
                  <label className="text-slate-500 text-xs">Observações financeiras</label>
                  <textarea value={obsFinanceiro} onChange={e => setObsFinanceiro(e.target.value)} rows={2}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm resize-none" />
                </div>
              </div>
              <div className="flex justify-end">
                <button onClick={finalizar} disabled={finalizando || !todosMapeados}
                  className="px-6 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-lg font-semibold disabled:opacity-50">
                  {finalizando ? 'Finalizando...' : '✅ Finalizar Entrada de Mercadoria'}
                </button>
              </div>
              {!todosMapeados && (
                <p className="text-red-400 text-sm text-center">
                  ⚠ Ainda há {naoMapeados} item(ns) não mapeados. Mapeie ou ignore antes de finalizar.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── MODAL MAPEAMENTO ──────────────────────────────────────── */}
      {mapModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl shadow-xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-slate-900 font-semibold">Mapear Item</h2>
                <p className="text-slate-500 text-xs mt-0.5">{mapModal.descricao_xml} — Cód: {mapModal.codigo_fornecedor}</p>
              </div>
              <button onClick={fecharMapModal} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>

            {criandoProduto ? (
              <>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  <p className="text-xs text-slate-500">Dados pré-preenchidos a partir do item da NF-e — ajuste o que precisar antes de criar.</p>
                  <div>
                    <label className="text-slate-400 text-xs">Nome do produto</label>
                    <input value={novoProd.nome} onChange={e => setNovoProd(p => ({ ...p, nome: e.target.value }))}
                      className="w-full mt-0.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-slate-400 text-xs">EAN</label>
                      <input value={novoProd.ean} onChange={e => setNovoProd(p => ({ ...p, ean: e.target.value }))}
                        className="w-full mt-0.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-lg px-2 py-1.5 text-sm font-mono" />
                    </div>
                    <div>
                      <label className="text-slate-400 text-xs">NCM</label>
                      <input value={novoProd.ncm} onChange={e => setNovoProd(p => ({ ...p, ncm: e.target.value }))}
                        className="w-full mt-0.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-lg px-2 py-1.5 text-sm font-mono" />
                    </div>
                    <div>
                      <label className="text-slate-400 text-xs">CEST</label>
                      <input value={novoProd.cest} onChange={e => setNovoProd(p => ({ ...p, cest: e.target.value }))}
                        className="w-full mt-0.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-lg px-2 py-1.5 text-sm font-mono" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-slate-400 text-xs">Unidade</label>
                      <select value={novoProd.unidade} onChange={e => setNovoProd(p => ({ ...p, unidade: e.target.value }))}
                        className="w-full mt-0.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-lg px-2 py-1.5 text-sm">
                        {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-slate-400 text-xs">Preço de custo</label>
                      <input type="number" step="0.01" value={novoProd.precoCusto} onChange={e => setNovoProd(p => ({ ...p, precoCusto: e.target.value }))}
                        className="w-full mt-0.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-lg px-2 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label className="text-slate-400 text-xs">Preço de venda</label>
                      <input type="number" step="0.01" value={novoProd.precoVenda} onChange={e => setNovoProd(p => ({ ...p, precoVenda: e.target.value }))}
                        className="w-full mt-0.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-lg px-2 py-1.5 text-sm" />
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">Código do fornecedor: <span className="font-mono text-slate-600">{mapModal.codigo_fornecedor || '—'}</span> (gravado no cadastro do produto)</p>
                </div>
                <div className="px-5 py-3 border-t border-slate-100 flex justify-between">
                  <button onClick={() => setCriandoProduto(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm hover:bg-slate-200">← Voltar</button>
                  <button onClick={criarProdutoEMapear} disabled={salvandoNovoProduto}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm disabled:opacity-50">
                    {salvandoNovoProduto ? 'Criando...' : '✨ Criar produto e mapear'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="p-4 border-b border-slate-100 flex gap-3">
                  <input ref={buscaInputRef} value={mapBusca} onChange={e => setMapBusca(e.target.value)}
                    placeholder="Buscar por nome, SKU ou EAN..."
                    onKeyDown={e => {
                      if (e.key === 'ArrowDown') { e.preventDefault(); moverDestaque(1, produtosFiltrados.length) }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); moverDestaque(-1, produtosFiltrados.length) }
                      else if (e.key === 'Enter') {
                        e.preventDefault()
                        const p = produtosFiltrados[indiceDestacado]
                        if (p) selecionarProduto(p)
                      }
                    }}
                    className="flex-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 placeholder-slate-400" />
                  <div>
                    <label className="text-slate-400 text-xs">Fator conversão</label>
                    <input ref={fatorInputRef} type="number" step="0.001" value={mapFator}
                      onChange={e => setMapFator(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && produtoSelecionado) {
                          e.preventDefault()
                          mapearItem(mapModal, produtoSelecionado)
                        }
                      }}
                      className="w-20 bg-slate-50 border border-slate-200 text-slate-800 rounded-lg px-2 py-2 text-sm mt-0.5" />
                  </div>
                </div>
                <div className="px-4 py-2 border-b border-slate-100">
                  <button onClick={() => iniciarCriarProduto(mapModal)} className="text-xs text-purple-600 hover:text-purple-700 font-medium">
                    + Criar produto novo a partir deste item
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {buscandoProduto ? (
                    <p className="text-slate-400 text-center py-8 text-sm">Buscando...</p>
                  ) : produtosFiltrados.length === 0 ? (
                    <p className="text-slate-400 text-center py-8 text-sm">Nenhum produto encontrado</p>
                  ) : (
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-slate-50">
                        {produtosFiltrados.map((p, i) => {
                          const destacado = produtoSelecionado ? produtoSelecionado.id === p.id : i === indiceDestacado
                          return (
                          <tr key={p.id}
                            ref={el => { linhaRefs.current[i] = el }}
                            className={`text-slate-700 cursor-pointer ${destacado ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                            onClick={() => selecionarProduto(p)}>
                            <td className="px-4 py-2.5">
                              <p className="text-slate-800 text-xs font-medium">{p.nome}{p.marca && <span className="text-blue-600 font-normal"> — {p.marca}</span>}</p>
                              <p className="text-slate-400 text-xs">SKU: {p.sku} • EAN: {p.ean || '—'}</p>
                            </td>
                            <td className="px-4 py-2.5 text-center text-xs text-slate-500">{p.unidade}</td>
                            <td className="px-4 py-2.5 text-right text-xs">
                              <p className="text-slate-500">Custo: {fmt(p.preco_custo)}</p>
                              <p className="text-slate-800 font-medium">Venda: {fmt(p.preco_venda)}</p>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <p className={`text-xs ${p.estoque <= 0 ? 'text-red-500' : 'text-emerald-600'}`}>{p.estoque} un.</p>
                            </td>
                          </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="px-5 py-3 border-t border-slate-100 text-xs text-slate-400 text-center">
                  {produtoSelecionado
                    ? <>Selecionado: <span className="text-slate-600 font-medium">{produtoSelecionado.nome}</span> — ajuste o fator e aperte Enter pra confirmar</>
                    : <>↑↓ pra navegar, Enter pra selecionar · Fator {mapFator}x = {((parseFloat(mapFator) || 1) * mapModal.quantidade_xml).toFixed(3)} unidades no sistema</>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helpers de layout ───────────────────────────────────────────────────────
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-400 text-xs">{label}</span>
      <span className="text-slate-700 text-xs text-right">{value || '—'}</span>
    </div>
  )
}

function Metric({ label, value, color = 'text-slate-800' }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-center">
      <p className="text-slate-500 text-xs">{label}</p>
      <p className={`text-sm font-semibold mt-1 ${color}`}>{value}</p>
    </div>
  )
}

function Field({ label, type, value, onChange }: { label: string; type: string; value: any; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-slate-400 text-xs">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-2 py-1.5 text-sm" />
    </div>
  )
}

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={ok ? 'text-emerald-600' : 'text-red-500'}>{ok ? '✓' : '✕'}</span>
      <span className={ok ? 'text-slate-700' : 'text-red-500'}>{label}</span>
    </div>
  )
}
