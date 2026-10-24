// Motor de cálculo do frete.
//
// FUNÇÃO PURA, de propósito: não toca banco nem rede. Recebe as regras, o
// pedido e o destino já resolvidos, e devolve as opções. Isso permite testar
// cada combinação de regra sem subir nada, e usar exatamente a mesma conta na
// vitrine, no fechamento do pedido (que NÃO confia no valor do navegador) e
// no simulador do painel.
//
// Regra de ouro do desenho: quando o sistema não tem como calcular com
// segurança, ele diz "a combinar" — nunca chuta um valor. Frete errado para
// menos é prejuízo; para mais, é venda perdida.

export type TipoArea = 'toda_loja' | 'bairros' | 'cep' | 'raio'
export type TipoCalculo = 'fixo' | 'por_km' | 'faixas'
export type BaseFaixa = 'distancia' | 'peso' | 'subtotal'

export type Faixa = { ate: number | null; valor: number }
export type FaixaCep = { de: string; ate: string }

export type RegraFrete = {
  id: string
  nome: string
  servico: string
  ativo: boolean
  prioridade: number

  areaTipo: TipoArea
  bairros: string[]
  cidade: string | null
  cepFaixas: FaixaCep[]
  kmMin: number | null
  kmMax: number | null

  calculoTipo: TipoCalculo
  valorFixo: number
  valorBase: number
  valorPorKm: number
  faixasBase: BaseFaixa
  faixas: Faixa[]

  pesoFranquiaKg: number | null
  adicionalPorKg: number
  pesoMaxKg: number | null
  freteGratisAcima: number | null
  pedidoMinimo: number | null
  prazoTexto: string | null
}

export type ConfigFrete = {
  ativo: boolean
  fatorEstrada: number
  freteGratisAcima: number | null
  pedidoMinimo: number | null
  semRegra: 'combinar' | 'nao_entrega'
  pesoPadraoKg: number
  arredondarPara: number | null
  mensagem: string | null
}

export type ItemFrete = {
  produtoId: string
  nome?: string
  quantidade: number
  /** Peso unitário em kg; `null` usa o padrão da loja. */
  pesoKg: number | null
  precoUnitario: number
  /** Produto não pesa nem cobra no frete. */
  freteGratis?: boolean
  /** Produto que não sai para entrega. */
  somenteRetirada?: boolean
  /** Valor somado ao frete, por unidade. */
  adicionalUnidade?: number
}

export type DestinoFrete = {
  cep?: string | null
  bairro?: string | null
  cidade?: string | null
  uf?: string | null
  /** Distância (km) já corrigida pelo fator de estrada; `null` = não sabemos. */
  distanciaKm: number | null
}

export type OpcaoFrete = {
  regraId: string
  servico: string
  nome: string
  valor: number
  gratis: boolean
  prazo: string | null
}

export type ResultadoFrete =
  | { status: 'opcoes'; opcoes: OpcaoFrete[]; pesoTotalKg: number }
  /** Não há como calcular — a loja combina o valor com o cliente. */
  | { status: 'combinar'; motivo: string; pesoTotalKg: number }
  /** Entrega indisponível para este pedido/endereço. */
  | { status: 'indisponivel'; motivo: string; itensSomenteRetirada?: string[]; pesoTotalKg: number }

/** Minúsculas, sem acento, sem pontuação e sem espaço duplicado. */
export function normalizarTexto(v: string | null | undefined): string {
  return (v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

const soDigitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '')

const centavos = (n: number) => Math.round(n * 100) / 100

export function pesoTotal(itens: ItemFrete[], pesoPadraoKg: number): number {
  let total = 0
  for (const i of itens) {
    if (i.freteGratis) continue
    total += (i.pesoKg ?? pesoPadraoKg) * i.quantidade
  }
  return centavos(total * 1000) / 1000
}

export function casaArea(r: RegraFrete, d: DestinoFrete): boolean | 'sem_distancia' {
  switch (r.areaTipo) {
    case 'toda_loja':
      return true
    case 'bairros': {
      const bairro = normalizarTexto(d.bairro)
      if (!bairro) return false
      if (r.cidade && normalizarTexto(d.cidade) !== normalizarTexto(r.cidade)) return false
      return r.bairros.some(b => normalizarTexto(b) === bairro)
    }
    case 'cep': {
      const cep = soDigitos(d.cep)
      if (cep.length !== 8) return false
      return r.cepFaixas.some(f => cep >= soDigitos(f.de).padEnd(8, '0') && cep <= soDigitos(f.ate).padEnd(8, '9'))
    }
    case 'raio': {
      if (d.distanciaKm == null) return 'sem_distancia'
      if (r.kmMin != null && d.distanciaKm < r.kmMin) return false
      if (r.kmMax != null && d.distanciaKm > r.kmMax) return false
      return true
    }
  }
}

function valorDaFaixa(faixas: Faixa[], medida: number): number | null {
  const ordenadas = [...faixas].sort((a, b) => (a.ate ?? Infinity) - (b.ate ?? Infinity))
  for (const f of ordenadas) {
    if (f.ate == null || medida <= f.ate) return f.valor
  }
  return null // passou da última faixa e não há faixa aberta
}

/** O valor-base da regra, antes dos adicionais. `null` = não dá para calcular. */
function valorBase(
  r: RegraFrete, d: DestinoFrete, peso: number, subtotal: number,
): number | null {
  switch (r.calculoTipo) {
    case 'fixo':
      return r.valorFixo
    case 'por_km':
      if (d.distanciaKm == null) return null
      return r.valorBase + d.distanciaKm * r.valorPorKm
    case 'faixas': {
      const medida =
        r.faixasBase === 'distancia' ? d.distanciaKm
        : r.faixasBase === 'peso' ? peso
        : subtotal
      if (medida == null) return null
      return valorDaFaixa(r.faixas, medida)
    }
  }
}

export function calcularFrete(
  config: ConfigFrete,
  regras: RegraFrete[],
  itens: ItemFrete[],
  destino: DestinoFrete,
): ResultadoFrete {
  const peso = pesoTotal(itens, config.pesoPadraoKg)
  const subtotal = centavos(itens.reduce((s, i) => s + i.precoUnitario * i.quantidade, 0))

  // Produto que não sai para entrega barra a entrega do pedido inteiro, e a
  // mensagem diz QUAL — o cliente resolve tirando o item ou retirando na loja.
  const soRetirada = itens.filter(i => i.somenteRetirada).map(i => i.nome ?? i.produtoId)
  if (soRetirada.length > 0) {
    return {
      status: 'indisponivel', pesoTotalKg: peso, itensSomenteRetirada: soRetirada,
      motivo: 'Alguns itens só podem ser retirados na loja.',
    }
  }

  const minimoGeral = config.pedidoMinimo
  if (minimoGeral != null && subtotal < minimoGeral) {
    return {
      status: 'indisponivel', pesoTotalKg: peso,
      motivo: `O pedido mínimo para entrega é de R$ ${minimoGeral.toFixed(2).replace('.', ',')}.`,
    }
  }

  // Todo item com frete grátis → pedido todo sem frete.
  const tudoGratis = itens.length > 0 && itens.every(i => i.freteGratis)

  const ordenadas = regras.filter(r => r.ativo).sort((a, b) => a.prioridade - b.prioridade)
  const escolhidas = new Map<string, OpcaoFrete>()
  let faltouDistancia = false
  let acimaDoPeso = false
  let abaixoDoMinimo: number | null = null

  for (const r of ordenadas) {
    if (escolhidas.has(r.servico)) continue // a primeira regra que casa vale

    const area = casaArea(r, destino)
    if (area === 'sem_distancia') { faltouDistancia = true; continue }
    if (!area) continue

    if (r.pesoMaxKg != null && peso > r.pesoMaxKg) { acimaDoPeso = true; continue }
    if (r.pedidoMinimo != null && subtotal < r.pedidoMinimo) {
      abaixoDoMinimo = Math.max(abaixoDoMinimo ?? 0, r.pedidoMinimo)
      continue
    }

    const base = valorBase(r, destino, peso, subtotal)
    if (base == null) {
      if (destino.distanciaKm == null) faltouDistancia = true
      continue
    }

    let valor = base
    if (r.adicionalPorKg > 0 && r.pesoFranquiaKg != null && peso > r.pesoFranquiaKg) {
      valor += Math.ceil(peso - r.pesoFranquiaKg) * r.adicionalPorKg
    }
    for (const i of itens) {
      if (i.freteGratis) continue
      valor += (i.adicionalUnidade ?? 0) * i.quantidade
    }

    const limiteGratis = r.freteGratisAcima ?? config.freteGratisAcima
    const gratis = tudoGratis || (limiteGratis != null && subtotal >= limiteGratis)

    if (gratis) valor = 0
    else if (config.arredondarPara && config.arredondarPara > 0) {
      valor = Math.ceil(valor / config.arredondarPara - 1e-9) * config.arredondarPara
    }

    escolhidas.set(r.servico, {
      regraId: r.id, servico: r.servico, nome: r.nome,
      valor: centavos(Math.max(0, valor)), gratis, prazo: r.prazoTexto,
    })
  }

  if (escolhidas.size > 0) {
    return {
      status: 'opcoes', pesoTotalKg: peso,
      opcoes: [...escolhidas.values()].sort((a, b) => a.valor - b.valor),
    }
  }

  // Nenhuma regra serviu. A razão decide o que dizer ao cliente.
  if (abaixoDoMinimo != null) {
    return {
      status: 'indisponivel', pesoTotalKg: peso,
      motivo: `O pedido mínimo para entrega neste endereço é de R$ ${abaixoDoMinimo.toFixed(2).replace('.', ',')}.`,
    }
  }
  if (acimaDoPeso) {
    return { status: 'combinar', pesoTotalKg: peso, motivo: 'O peso do pedido exige combinar a entrega com a loja.' }
  }
  if (faltouDistancia) {
    return { status: 'combinar', pesoTotalKg: peso, motivo: 'Não conseguimos localizar o endereço para calcular a distância.' }
  }
  if (config.semRegra === 'nao_entrega') {
    return { status: 'indisponivel', pesoTotalKg: peso, motivo: 'Não entregamos neste endereço. Você pode retirar na loja.' }
  }
  return { status: 'combinar', pesoTotalKg: peso, motivo: 'O valor da entrega para este endereço é combinado com a loja.' }
}
