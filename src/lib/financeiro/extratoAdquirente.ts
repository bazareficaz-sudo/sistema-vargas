// O EXTRATO DA ADQUIRENTE, LIDO DO ARQUIVO.
//
// O relatório de Liberações do Mercado Pago vem como CSV, e as COLUNAS
// DEPENDEM DA CONFIGURAÇÃO DA CONTA: a própria API tem um endpoint
// (`/v1/account/release_report/config`) onde se escolhe quais colunas sair e
// em que ordem. Dois lojistas podem receber arquivos diferentes.
//
// Por isso aqui nada é lido por POSIÇÃO. Tudo é casado pelo NOME da coluna,
// com apelidos, e o que não for encontrado é dito em voz alta com o cabeçalho
// que chegou de verdade. Ler por posição daria certo no primeiro arquivo e
// trocaria taxa por valor líquido no dia em que a configuração mudasse — e
// esse erro não aparece: só produz um número plausível e errado.
//
// Nada neste módulo fala com a rede. É proposital: a leitura e a conferência
// são onde está o risco de errar dinheiro, e isso tem de ser testável sem
// token, sem conta e sem internet.

export type LinhaExtrato = {
  /** `YYYY-MM-DD` no fuso do arquivo. */
  data: string
  /** Identificador do lançamento na adquirente. */
  origemId: string
  /** O que o lojista mandou junto da cobrança, quando manda. */
  referenciaExterna: string | null
  /** `release`, `refund`, `dispute`, `settlement`… como vem no arquivo. */
  tipo: string
  bruto: number
  taxa: number
  liquido: number
  parcelas: number | null
  metodo: string | null
  /**
   * A linha do arquivo, exatamente como veio.
   *
   * Vem daqui e não de uma busca posterior porque o Mercado Pago emite VÁRIOS
   * registros com o mesmo `source_id` — o pagamento, o ajuste de taxa, o
   * estorno. Procurar a linha depois, pelo identificador, acharia a mesma para
   * todos eles: as duas viravam o mesmo hash, e a segunda seria descartada
   * como se fosse reimportação. Descarte invisível, que é o erro que a trava
   * de unicidade existe para não cometer.
   */
  linhaOriginal: string
}

/** O que precisa existir no cabeçalho, com os nomes que já vi em uso. */
const COLUNAS: Record<string, string[]> = {
  data: ['date', 'data', 'release_date', 'date_created', 'money_release_date'],
  origemId: ['source_id', 'transaction_id', 'operation_id', 'id', 'payment_id'],
  referenciaExterna: ['external_reference', 'referencia_externa'],
  tipo: ['record_type', 'transaction_type', 'tipo', 'description', 'descricao'],
  bruto: ['transaction_amount', 'gross_amount', 'valor_bruto', 'transaction_gross_amount'],
  taxa: ['mp_fee_amount', 'fee_amount', 'taxa', 'mercadopago_fee', 'commission'],
  liquido: ['net_credit_amount', 'net_amount', 'valor_liquido', 'settlement_net_amount'],
  parcelas: ['installments', 'parcelas'],
  metodo: ['payment_method', 'payment_method_type', 'metodo', 'forma'],
}

/** As quatro sem as quais não há conferência possível. */
const OBRIGATORIAS = ['data', 'origemId', 'bruto', 'taxa'] as const

export type Cabecalho = {
  mapa: Partial<Record<keyof typeof COLUNAS, number>>
  faltando: string[]
  recebido: string[]
}

function normalizar(nome: string): string {
  return nome.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function lerCabecalho(colunas: string[]): Cabecalho {
  const normalizadas = colunas.map(normalizar)
  const mapa: Cabecalho['mapa'] = {}

  for (const [campo, apelidos] of Object.entries(COLUNAS)) {
    const i = normalizadas.findIndex(c => apelidos.includes(c))
    if (i >= 0) mapa[campo as keyof typeof COLUNAS] = i
  }

  const faltando = OBRIGATORIAS.filter(c => mapa[c] === undefined)
  return { mapa, faltando, recebido: colunas.map(c => c.trim()) }
}

/**
 * Divide uma linha de CSV respeitando aspas.
 *
 * Escrito à mão, e não com `split(',')`, porque a descrição do lançamento vem
 * com vírgula dentro ("Pagamento, parcela 2/3") — e `split` deslocaria todas
 * as colunas seguintes, movendo o valor da taxa para onde se espera o líquido.
 */
export function dividirLinha(linha: string, separador: string): string[] {
  const campos: string[] = []
  let atual = ''
  let dentroDeAspas = false

  for (let i = 0; i < linha.length; i++) {
    const c = linha[i]
    if (c === '"') {
      // Aspa dobrada dentro de campo entre aspas é uma aspa literal.
      if (dentroDeAspas && linha[i + 1] === '"') { atual += '"'; i++ }
      else dentroDeAspas = !dentroDeAspas
      continue
    }
    if (c === separador && !dentroDeAspas) { campos.push(atual); atual = ''; continue }
    atual += c
  }
  campos.push(atual)
  return campos.map(c => c.trim())
}

/**
 * Descobre o separador: a exportação brasileira costuma vir com ponto e vírgula
 * (porque a vírgula é o separador decimal), e a internacional com vírgula.
 * Decidir pelo cabeçalho é seguro: ele não tem número.
 */
export function detectarSeparador(cabecalho: string): string {
  const ponto = (cabecalho.match(/;/g) ?? []).length
  const virgula = (cabecalho.match(/,/g) ?? []).length
  const tab = (cabecalho.match(/\t/g) ?? []).length
  if (tab > ponto && tab > virgula) return '\t'
  return ponto >= virgula ? ';' : ','
}

/**
 * Número em dinheiro, nos dois formatos que o arquivo pode trazer.
 *
 *   "1.234,56"  ->  1234.56   (brasileiro)
 *   "1,234.56"  ->  1234.56   (internacional)
 *   "-12,30"    ->  -12.3
 *
 * Confundir os dois é o erro mais caro possível aqui: "1.234,56" lido como
 * formato internacional vira 1,23456 — a conferência acusaria falta de mil
 * reais e alguém iria procurar um roubo que não houve.
 */
export function valorMonetario(texto: string | undefined | null): number {
  if (texto === undefined || texto === null) return 0
  let t = String(texto).trim().replace(/\s|R\$| /g, '')
  if (t === '' || t === '-') return 0

  // Parênteses como negativo, convenção contábil: (12,30)
  let negativo = false
  if (/^\(.*\)$/.test(t)) { negativo = true; t = t.slice(1, -1) }

  const temPonto = t.includes('.')
  const temVirgula = t.includes(',')

  if (temPonto && temVirgula) {
    // O ÚLTIMO separador é o decimal; o outro é de milhar.
    t = t.lastIndexOf(',') > t.lastIndexOf('.')
      ? t.replace(/\./g, '').replace(',', '.')
      : t.replace(/,/g, '')
  } else if (temVirgula) {
    // Só vírgula: decimal se sobrarem 1 ou 2 casas, senão é milhar.
    const depois = t.length - t.lastIndexOf(',') - 1
    t = depois <= 2 ? t.replace(',', '.') : t.replace(/,/g, '')
  } else if (temPonto) {
    // Só ponto, com 3 casas depois e sem nada antes do grupo: é milhar.
    // "1.234" é mil duzentos e trinta e quatro; "12.34" é doze e trinta e quatro.
    const depois = t.length - t.lastIndexOf('.') - 1
    if (depois === 3 && /^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  }

  const n = Number(t)
  if (!Number.isFinite(n)) return 0
  return negativo ? -n : n
}

/** A data em `YYYY-MM-DD`, aceitando ISO e `DD/MM/AAAA`. */
export function dataDoExtrato(texto: string | undefined | null): string | null {
  if (!texto) return null
  const t = String(texto).trim()
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  return null
}

export type LeituraExtrato = {
  linhas: LinhaExtrato[]
  cabecalho: Cabecalho
  /** Linhas que não deram para ler, com o número e o motivo. */
  descartadas: { linha: number; motivo: string }[]
}

export function lerExtrato(csv: string): LeituraExtrato {
  // O relatório pode vir com linhas de resumo antes do cabeçalho de verdade.
  // O cabeçalho é a primeira linha onde as colunas obrigatórias aparecem.
  const todas = csv.split(/\r?\n/).filter(l => l.trim() !== '')
  if (todas.length === 0) {
    return { linhas: [], cabecalho: { mapa: {}, faltando: [...OBRIGATORIAS], recebido: [] }, descartadas: [] }
  }

  let iCabecalho = -1
  let cabecalho: Cabecalho = { mapa: {}, faltando: [...OBRIGATORIAS], recebido: [] }
  for (let i = 0; i < Math.min(todas.length, 20); i++) {
    const sep = detectarSeparador(todas[i])
    const tentativa = lerCabecalho(dividirLinha(todas[i], sep))
    if (tentativa.faltando.length === 0) { iCabecalho = i; cabecalho = tentativa; break }
    if (i === 0) cabecalho = tentativa
  }

  if (iCabecalho < 0) return { linhas: [], cabecalho, descartadas: [] }

  const sep = detectarSeparador(todas[iCabecalho])
  const linhas: LinhaExtrato[] = []
  const descartadas: { linha: number; motivo: string }[] = []
  const m = cabecalho.mapa

  const pegar = (campos: string[], campo: keyof typeof COLUNAS): string | undefined => {
    const i = m[campo]
    return i === undefined ? undefined : campos[i]
  }

  for (let i = iCabecalho + 1; i < todas.length; i++) {
    const campos = dividirLinha(todas[i], sep)
    const data = dataDoExtrato(pegar(campos, 'data'))
    const origemId = (pegar(campos, 'origemId') ?? '').trim()

    // Sem data ou sem identificador não há como conferir nem como evitar
    // importar duas vezes. Descartar em silêncio seria subestimar o extrato.
    if (!data) { descartadas.push({ linha: i + 1, motivo: 'sem data legivel' }); continue }
    if (!origemId) { descartadas.push({ linha: i + 1, motivo: 'sem identificador de origem' }); continue }

    const bruto = valorMonetario(pegar(campos, 'bruto'))
    // A taxa vem negativa no arquivo (é um débito). Guardamos positiva, porque
    // no ledger ela já é uma SAÍDA — o sinal estaria contado duas vezes.
    const taxa = Math.abs(valorMonetario(pegar(campos, 'taxa')))
    const liquidoLido = pegar(campos, 'liquido')
    const parcelasLidas = pegar(campos, 'parcelas')

    linhas.push({
      data,
      origemId,
      referenciaExterna: (pegar(campos, 'referenciaExterna') ?? '').trim() || null,
      tipo: (pegar(campos, 'tipo') ?? '').trim() || 'desconhecido',
      bruto,
      taxa,
      // Se o arquivo não trouxer o líquido, ele é bruto menos taxa — e não
      // zero, que faria a conferência acusar que nada caiu.
      liquido: liquidoLido !== undefined && String(liquidoLido).trim() !== ''
        ? valorMonetario(liquidoLido)
        : Number((bruto - taxa).toFixed(2)),
      parcelas: parcelasLidas && Number.isFinite(Number(parcelasLidas))
        ? Math.max(1, Math.floor(Number(parcelasLidas)))
        : null,
      metodo: (pegar(campos, 'metodo') ?? '').trim() || null,
      linhaOriginal: todas[i],
    })
  }

  return { linhas, cabecalho, descartadas }
}

export type TotaisDoDia = { data: string; bruto: number; taxa: number; liquido: number; lancamentos: number }

export function totaisPorDia(linhas: LinhaExtrato[]): TotaisDoDia[] {
  const mapa = new Map<string, TotaisDoDia>()
  for (const l of linhas) {
    const t = mapa.get(l.data) ?? { data: l.data, bruto: 0, taxa: 0, liquido: 0, lancamentos: 0 }
    t.bruto += l.bruto
    t.taxa += l.taxa
    t.liquido += l.liquido
    t.lancamentos += 1
    mapa.set(l.data, t)
  }
  return [...mapa.values()]
    .map(t => ({
      ...t,
      bruto: Number(t.bruto.toFixed(2)),
      taxa: Number(t.taxa.toFixed(2)),
      liquido: Number(t.liquido.toFixed(2)),
    }))
    .sort((a, b) => (a.data < b.data ? 1 : -1))
}

export type Divergencia = {
  data: string
  nossoBruto: number
  delesBruto: number
  nossaTaxa: number
  delesTaxa: number
  difBruto: number
  difTaxa: number
  confere: boolean
}

/**
 * A conferência de um dia, comparando DUAS DATAS QUE SÓ COINCIDEM EM ALGUNS
 * CASOS — e é preciso saber quais antes de olhar o resultado.
 *
 * ── A ARMADILHA ──────────────────────────────────────────────────────────
 *
 * No nosso ledger, a venda no crédito entra na data em que VENDEU. No
 * relatório de Liberações, ela aparece na data em que o dinheiro foi
 * LIBERADO — cerca de trinta dias depois. Somar os dois lados por dia e
 * esperar que fechem é comparar coisas diferentes: toda venda no crédito
 * apareceria como divergência, e a tela ficaria vermelha num mês correto.
 *
 * Então esta função só vale onde as duas datas coincidem:
 *
 *   pix      prazo 0  -> compara
 *   debito   prazo 1  -> compara deslocando um dia, quando o prazo estiver
 *                        cadastrado
 *   credito  prazo 30 -> NÃO compara por dia; precisa casar transação por
 *                        transação pela referência externa, e o PDV ainda não
 *                        manda referência nenhuma para a maquininha
 *
 * Quem chamar é responsável por filtrar. A função não adivinha, porque
 * adivinhar aqui produziria um alerta falso por dia — e alerta falso diário
 * é como um alerta deixa de ser lido.
 *
 * `toleranciaCentavos` existe porque arredondamento de taxa por transação não
 * fecha com arredondamento do total: dez vendas com taxa de 3,04% podem somar
 * um centavo de diferença, e tratar isso como erro treinaria o lojista a
 * ignorar o alerta — pelo mesmo motivo.
 */
export function conferirDia(
  nosso: { data: string; bruto: number; taxa: number }[],
  deles: TotaisDoDia[],
  toleranciaCentavos = 5,
): Divergencia[] {
  const tol = toleranciaCentavos / 100
  const dias = [...new Set([...nosso.map(n => n.data), ...deles.map(d => d.data)])]

  return dias.map(data => {
    const n = nosso.find(x => x.data === data)
    const d = deles.find(x => x.data === data)
    const nossoBruto = Number((n?.bruto ?? 0).toFixed(2))
    const delesBruto = Number((d?.bruto ?? 0).toFixed(2))
    const nossaTaxa = Number((n?.taxa ?? 0).toFixed(2))
    const delesTaxa = Number((d?.taxa ?? 0).toFixed(2))
    const difBruto = Number((delesBruto - nossoBruto).toFixed(2))
    const difTaxa = Number((delesTaxa - nossaTaxa).toFixed(2))
    return {
      data, nossoBruto, delesBruto, nossaTaxa, delesTaxa, difBruto, difTaxa,
      confere: Math.abs(difBruto) <= tol && Math.abs(difTaxa) <= tol,
    }
  }).sort((a, b) => (a.data < b.data ? 1 : -1))
}
