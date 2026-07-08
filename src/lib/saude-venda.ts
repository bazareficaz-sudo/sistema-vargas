// Utilitário de cálculo de Saúde da Venda

export interface SaudeConfig {
  taxa_pix_pct: number
  taxa_dinheiro_pct: number
  taxa_debito_pct: number
  taxa_credito_vista_pct: number
  taxa_credito_parc_pct: number
  taxa_carteira_pct: number
  taxa_fiado_pct: number
  imposto_pct: number
  custo_operacional_pct: number
  comissao_vendedor_pct: number
  custo_embalagem: number
  frete_subsidiado_pct: number
  margem_minima_desejada: number
  margem_minima_absoluta: number
  exibir_custo_vendedor: boolean
  exibir_lucro_vendedor: boolean
  exibir_margem_vendedor: boolean
}

export interface FaixaSaude {
  id: string
  nome: string
  emoji: string
  cor: string
  cor_fundo: string
  margem_min: number | null
  margem_max: number | null
  desconto_max_pct: number
  exige_autorizacao: boolean
  bloqueia_venda: boolean
  mensagem_vendedor: string | null
  mensagem_gerente: string | null
  formas_permitidas: string[] | null
  formas_bloqueadas: string[] | null
  permite_parcelamento: boolean
  max_parcelas: number
  ordem: number
  ativo?: boolean
}

export interface ItemCalc {
  custo: number
  preco_unitario: number
  quantidade: number
  tipo: 'venda' | 'devolucao'
}

export interface ResultadoSaude {
  totalBruto: number
  totalComDesc: number
  custoTotal: number
  custoTaxaPag: number
  custoImposto: number
  custoOperacional: number
  custoComissao: number
  custoEmbalagem: number
  custoFrete: number
  custoTotalReal: number
  lucroBruto: number
  lucroLiquido: number
  margem: number
  margemBruta: number
  faixa: FaixaSaude | null
  descontoMaxPct: number
  descontoMaxValor: number
  descontoAtual: number
  descontoRestante: number
  valorMinRecomendado: number
  valorMinAbsoluto: number
  taxaPagPct: number
  formasPermitidas: string[] | null
  formasBloqueadas: string[] | null
  alertas: string[]
}

export const CONFIG_PADRAO: SaudeConfig = {
  taxa_pix_pct: 0,
  taxa_dinheiro_pct: 0,
  taxa_debito_pct: 1.5,
  taxa_credito_vista_pct: 2.5,
  taxa_credito_parc_pct: 1.5,
  taxa_carteira_pct: 0,
  taxa_fiado_pct: 0,
  imposto_pct: 0,
  custo_operacional_pct: 5,
  comissao_vendedor_pct: 3,
  custo_embalagem: 0,
  frete_subsidiado_pct: 0,
  margem_minima_desejada: 25,
  margem_minima_absoluta: 10,
  exibir_custo_vendedor: false,
  exibir_lucro_vendedor: false,
  exibir_margem_vendedor: false,
}

export const FAIXAS_PADRAO: FaixaSaude[] = [
  { id: '1', nome: 'Excelente', emoji: '🟢', cor: '#16a34a', cor_fundo: '#f0fdf4', margem_min: 35,   margem_max: null, desconto_max_pct: 10, exige_autorizacao: false, bloqueia_venda: false, mensagem_vendedor: 'Venda com ótima margem. Desconto normal permitido.', mensagem_gerente: null, formas_permitidas: null, formas_bloqueadas: null, permite_parcelamento: true,  max_parcelas: 12, ordem: 1 },
  { id: '2', nome: 'Boa',       emoji: '🟡', cor: '#ca8a04', cor_fundo: '#fefce8', margem_min: 25,   margem_max: 35,   desconto_max_pct: 5,  exige_autorizacao: false, bloqueia_venda: false, mensagem_vendedor: 'Venda saudável. Desconto moderado permitido.',               mensagem_gerente: null, formas_permitidas: ['pix','dinheiro','debito','credito'], formas_bloqueadas: null, permite_parcelamento: true,  max_parcelas: 3,  ordem: 2 },
  { id: '3', nome: 'Atenção',   emoji: '🟠', cor: '#ea580c', cor_fundo: '#fff7ed', margem_min: 15,   margem_max: 25,   desconto_max_pct: 2,  exige_autorizacao: false, bloqueia_venda: false, mensagem_vendedor: 'Margem baixa. Prefira PIX ou débito.',                          mensagem_gerente: null, formas_permitidas: ['pix','dinheiro','debito'],            formas_bloqueadas: null, permite_parcelamento: false, max_parcelas: 1,  ordem: 3 },
  { id: '4', nome: 'Crítica',   emoji: '🔴', cor: '#dc2626', cor_fundo: '#fef2f2', margem_min: 5,    margem_max: 15,   desconto_max_pct: 0,  exige_autorizacao: true,  bloqueia_venda: false, mensagem_vendedor: 'Margem muito baixa. Qualquer desconto exige autorização.',      mensagem_gerente: 'Venda crítica aguardando autorização.', formas_permitidas: ['pix','dinheiro'], formas_bloqueadas: null, permite_parcelamento: false, max_parcelas: 1, ordem: 4 },
  { id: '5', nome: 'Prejuízo',  emoji: '⚫', cor: '#1c1917', cor_fundo: '#f5f5f4', margem_min: null, margem_max: 5,    desconto_max_pct: 0,  exige_autorizacao: true,  bloqueia_venda: true,  mensagem_vendedor: 'Venda com prejuízo. Finalização bloqueada.',                    mensagem_gerente: 'Autorização necessária para venda com prejuízo.', formas_permitidas: ['pix','dinheiro'], formas_bloqueadas: null, permite_parcelamento: false, max_parcelas: 1, ordem: 5 },
]

function taxaPorForma(forma: string, parcelas: number, cfg: SaudeConfig): number {
  switch (forma) {
    case 'pix':      return cfg.taxa_pix_pct
    case 'dinheiro': return cfg.taxa_dinheiro_pct
    case 'debito':   return cfg.taxa_debito_pct
    case 'credito':  return cfg.taxa_credito_vista_pct + Math.max(0, parcelas - 1) * cfg.taxa_credito_parc_pct
    case 'carteira': return cfg.taxa_carteira_pct
    case 'fiado':    return cfg.taxa_fiado_pct
    default:         return 0
  }
}

function encontrarFaixa(margem: number, faixas: FaixaSaude[]): FaixaSaude | null {
  const ordenadas = [...faixas].sort((a, b) => (b.margem_min ?? -Infinity) - (a.margem_min ?? -Infinity))
  return ordenadas.find(f => {
    const min = f.margem_min ?? -Infinity
    const max = f.margem_max ?? Infinity
    return margem >= min && margem < max
  }) ?? ordenadas[ordenadas.length - 1] ?? null
}

export function calcSaude(
  itens: ItemCalc[],
  descontoGlobal: number,
  formaPrincipal: string,
  parcelas: number,
  cfg: SaudeConfig,
  faixas: FaixaSaude[]
): ResultadoSaude {
  const itensVenda = itens.filter(i => i.tipo === 'venda')

  const totalBruto = itensVenda.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0)
  const custoTotal = itensVenda.reduce((s, i) => s + i.custo * i.quantidade, 0)
  const totalComDesc = Math.max(0, totalBruto - descontoGlobal)

  const taxaPagPct = taxaPorForma(formaPrincipal, parcelas, cfg)
  const custoTaxaPag    = totalComDesc * (taxaPagPct / 100)
  const custoImposto    = totalComDesc * (cfg.imposto_pct / 100)
  const custoOperacional = totalComDesc * (cfg.custo_operacional_pct / 100)
  const custoComissao   = totalComDesc * (cfg.comissao_vendedor_pct / 100)
  const custoEmbalagem  = cfg.custo_embalagem
  const custoFrete      = totalComDesc * (cfg.frete_subsidiado_pct / 100)

  const custoTotalReal = custoTotal + custoTaxaPag + custoImposto + custoOperacional + custoComissao + custoEmbalagem + custoFrete
  const lucroBruto  = totalComDesc - custoTotal
  const lucroLiquido = totalComDesc - custoTotalReal
  const margem = totalComDesc > 0 ? (lucroLiquido / totalComDesc) * 100 : 0
  const margemBruta = totalComDesc > 0 ? (lucroBruto / totalComDesc) * 100 : 0

  const faixasAtivas = (faixas.length > 0 ? faixas : FAIXAS_PADRAO).filter(f => f.ativo !== false)
  const faixa = encontrarFaixa(margem, faixasAtivas)

  const descontoMaxPct   = faixa?.desconto_max_pct ?? 0
  const descontoMaxValor = totalBruto * (descontoMaxPct / 100)
  const descontoRestante = Math.max(0, descontoMaxValor - descontoGlobal)

  // Valor mínimo = custo_total_real / (1 - margem_min/100)
  const margemMinDes = (cfg.margem_minima_desejada ?? 25) / 100
  const margemMinAbs = (cfg.margem_minima_absoluta ?? 10) / 100
  const custoSemDesc  = custoTotal + custoEmbalagem +
    (custoTotal * (cfg.imposto_pct + cfg.custo_operacional_pct + cfg.comissao_vendedor_pct + cfg.frete_subsidiado_pct) / 100)
  const valorMinRecomendado = margemMinDes < 1 ? custoSemDesc / (1 - margemMinDes) : custoSemDesc
  const valorMinAbsoluto    = margemMinAbs < 1 ? custoSemDesc / (1 - margemMinAbs) : custoSemDesc

  // Alertas
  const alertas: string[] = []
  if (faixa?.bloqueia_venda)        alertas.push('Venda bloqueada por margem insuficiente.')
  if (faixa?.exige_autorizacao)     alertas.push('Esta venda exige autorização gerencial.')
  if (descontoGlobal > descontoMaxValor && descontoMaxValor >= 0 && totalBruto > 0)
    alertas.push(`Desconto acima do permitido para esta margem (máx. ${descontoMaxPct}%).`)
  if (margem < 0) alertas.push('Venda com margem negativa — gerando prejuízo.')
  if (formaPrincipal && faixa?.formas_permitidas && !faixa.formas_permitidas.includes(formaPrincipal))
    alertas.push(`Forma de pagamento "${formaPrincipal}" não permitida para esta margem.`)

  return {
    totalBruto, totalComDesc, custoTotal,
    custoTaxaPag, custoImposto, custoOperacional, custoComissao, custoEmbalagem, custoFrete,
    custoTotalReal, lucroBruto, lucroLiquido,
    margem, margemBruta, faixa,
    descontoMaxPct, descontoMaxValor, descontoAtual: descontoGlobal, descontoRestante,
    valorMinRecomendado, valorMinAbsoluto,
    taxaPagPct,
    formasPermitidas: faixa?.formas_permitidas ?? null,
    formasBloqueadas: faixa?.formas_bloqueadas ?? null,
    alertas,
  }
}
