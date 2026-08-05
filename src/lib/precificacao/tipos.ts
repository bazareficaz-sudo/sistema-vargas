// Tipos do Motor de Precificação.
//
// Regra de ouro deste módulo: NADA de taxa escrita em código. Toda comissão,
// frete, imposto e custo extra vem de `ConfigTaxas`, que o usuário edita na
// tela. Adicionar um marketplace novo é cadastrar uma configuração, não
// programar.

export type BasePercentual = 'preco' | 'custo'

// Um componente de custo ou taxa. Serve pra tudo: embalagem, imposto,
// marketing, taxa de antecipação, perdas médias, comissão do vendedor.
export type ItemCusto = {
  nome: string
  tipo: 'fixo' | 'percentual'
  valor: number
  // Só vale pra `percentual`. Marketing e comissão de marketplace incidem
  // sobre o preço de venda; perdas e embalagem costumam incidir sobre o
  // custo. Default 'preco'.
  base?: BasePercentual
}

// Comissão por faixa de valor — como Shopee e Mercado Livre realmente
// cobram (a alíquota muda conforme o preço do item).
export type FaixaComissao = {
  min: number
  max: number | null // null = sem teto
  percentual: number
  fixo: number
}

/**
 * Escada de frete por faixa de preço, importada do marketplace.
 *
 * É por faixa de PREÇO, não de peso, porque é assim que o Mercado Livre
 * cobra: o mesmo pacote de 1 kg custa R$ 18,45 a R$ 79 e R$ 30,75 acima de
 * R$ 200. Cada embalagem tem a sua escada — ver `mlFrete.ts`.
 */
export type FaixaFrete = {
  min: number
  max: number | null // null = sem teto
  valor: number
}

export type ConfigTaxas = {
  id?: string
  canalId: string | null
  plataforma: string
  nome: string

  // 'faixas'  — tabela por valor (Shopee, ML)
  // 'simples' — um percentual + um valor fixo pra qualquer preço
  // 'api_ml'  — busca a alíquota real na API do Mercado Livre; quem resolve
  //             é o chamador, que converte em `comissaoFaixas` antes de
  //             chamar o motor (o motor é síncrono e puro de propósito)
  comissaoModo: 'faixas' | 'simples' | 'api_ml'
  comissaoPercentual: number
  comissaoFixo: number
  comissaoFaixas: FaixaComissao[]

  // Taxas do marketplace além da comissão: por pedido, financeira,
  // antecipação, tarifa Pix, fulfillment...
  taxas: ItemCusto[]

  // 'gratis_acima' é o caso do ML e da Shopee: acima de um valor o frete
  // vira "grátis" pro comprador e o custo cai no vendedor.
  freteModo: 'nao' | 'fixo' | 'gratis_acima' | 'faixa_peso'
  freteValor: number
  freteLimiteGratis: number
  freteCustoMedio: number
  freteFaixas: { pesoAte: number; valor: number }[]

  /**
   * Buscar o frete real do Mercado Livre por anúncio, em vez de usar
   * `freteCustoMedio`. Só vale para canal ML — ver `mlFrete.ts`.
   */
  freteMlImportar?: boolean

  embalagem: ItemCusto | null
  imposto: ItemCusto | null
  custosExtras: ItemCusto[]

  // Pro comparador entre canais: vender mais caro recebendo em 30 dias
  // pode ser pior que vender mais barato recebendo em 7.
  diasRecebimento: number | null
}

export type Objetivo =
  | { tipo: 'preco'; valor: number }           // já sei o preço, quero saber o lucro
  | { tipo: 'margem_liquida'; valor: number }  // % sobre o preço final
  | { tipo: 'sobre_custo'; valor: number }     // % sobre o custo
  | { tipo: 'markup'; valor: number }          // multiplicador do custo
  | { tipo: 'lucro_fixo'; valor: number }      // R$ por unidade

export type LinhaCalculo = {
  rotulo: string
  valor: number
  sinal: '+' | '-' | '='
  detalhe?: string
}

export type Resultado = {
  preco: number
  custoProduto: number
  custoTotal: number // custo + embalagem + extras que incidem sobre o custo

  comissao: number
  frete: number
  imposto: number
  embalagem: number
  outrasTaxas: number
  custosExtras: number
  totalDeducoes: number

  lucro: number
  margemLiquida: number // lucro / preço
  markup: number        // preço / custo total
  roi: number           // lucro / custo total
  valorLiquido: number  // o que sobra depois das deduções do marketplace
  diasRecebimento: number | null

  // Memória de cálculo linha a linha — é isso que a tela mostra pro usuário
  // entender de onde saiu o preço.
  linhas: LinhaCalculo[]
  // Avisos honestos: faixa de comissão não resolvida, margem abaixo do
  // mínimo, preço que não fecha em regime nenhum.
  avisos: string[]
}

export type SaudePreco = 'prejuizo' | 'critica' | 'baixa' | 'saudavel' | 'excelente'
