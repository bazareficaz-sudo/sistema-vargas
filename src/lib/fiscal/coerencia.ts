// Conferência de coerência fiscal antes de mandar a nota para a SEFAZ.
//
// Por que isto existe: a SEFAZ não valida CFOP e situação tributária
// separadamente — ela valida o PAR. Uma venda #200958 real foi recusada com
// "Rejeição 725: CFOP inválido" tendo CFOP 5403 (venda com substituição
// tributária) e CSOSN 102 (venda comum, sem ST). Os dois códigos existem e
// são válidos; juntos, se contradizem.
//
// A mensagem que volta da SEFAZ não diz qual produto nem o que trocar. Quem
// atende o balcão fica com uma nota recusada e um número de rejeição. Esta
// checagem roda antes do envio, aponta o produto pelo nome e diz o que
// corrigir — e é determinística, então acerta sempre e dá para auditar.
//
// Escopo: NFC-e (modelo 65). Ela é sempre presencial, consumidor final e
// dentro do estado, o que estreita bastante o que pode aparecer aqui.

// CFOPs que a NFC-e (modelo 65) aceita. É uma lista curta porque a NFC-e é
// sempre venda presencial a consumidor final, dentro do estado.
//
// O que derrubou a venda #200958: o produto tinha CFOP 5403 — "venda em
// substituição tributária na condição de contribuinte SUBSTITUTO", que é
// quem recolhe o ST da cadeia seguinte. Vendendo ao consumidor final não há
// cadeia seguinte, então a SEFAZ recusa o CFOP na NFC-e ("Rejeição 725: CFOP
// inválido"). Quem revende item com ST já recolhido é o SUBSTITUÍDO, e o
// CFOP dele — 5405 — é aceito.
//
// Só a checagem de par CFOP × situação não pegava esse caso: para empresa em
// regime normal, 5403 com CST 70 é um par internamente coerente. O que ele
// não é, é permitido em NFC-e.
const CFOP_VALIDO_NFCE = new Set([
  '5101', // venda de produção do próprio estabelecimento
  '5102', // venda de mercadoria adquirida de terceiros — o caso comum do varejo
  '5103', '5104', '5105', '5106',
  '5115', // venda de mercadoria recebida anteriormente em consignação
  '5405', // venda de mercadoria com ST, na condição de SUBSTITUÍDO
  '5656', '5667', // combustível
  '5933', // prestação de serviço tributado pelo ISSQN
])

/** CFOPs de saída que envolvem substituição tributária. */
const CFOP_COM_ST = new Set([
  '5401', // venda de produção própria em ST, como substituto
  '5402', // venda de produção de outro estabelecimento em ST, substituto
  '5403', // venda de mercadoria de terceiros em ST, como SUBSTITUTO
  '5405', // venda de mercadoria de terceiros em ST, como SUBSTITUÍDO
  '5409', // transferência em ST
  '5656', // venda de combustível em ST
])

/** Situação tributária que declara ST — nos dois regimes. */
const SITUACAO_COM_ST = new Set([
  // Simples Nacional (CSOSN, 3 dígitos)
  '201', '202', '203', // com permissão/sem permissão de crédito, cobrando ST
  '500',               // ICMS cobrado anteriormente por ST — o caso do varejo
  // Regime normal (CST, 2 dígitos)
  '10', '30', '70',    // tributada com cobrança de ST
  '60',               // ICMS cobrado anteriormente por ST — o caso do varejo
])

export type ItemParaConferir = {
  nome: string
  sku?: string | null
  cfop: string
  /** CST (2 dígitos) ou CSOSN (3 dígitos) já resolvido pelo regime da empresa. */
  situacao: string
  /** CEST com 7 dígitos, já limpo de máscara. Ausente = não cadastrado. */
  cest?: string
}

export type ResultadoCoerencia = {
  /** Impedem a emissão: a SEFAZ recusaria de qualquer forma. */
  erros: string[]
}

export function conferirCoerenciaFiscal(itens: ItemParaConferir[], simplesNacional: boolean): ResultadoCoerencia {
  const erros: string[] = []

  for (const item of itens) {
    const quem = item.sku ? `${item.nome} (SKU ${item.sku})` : item.nome
    const cfop = String(item.cfop ?? '').trim()
    const situacao = String(item.situacao ?? '').trim()
    const nomeSituacao = simplesNacional ? 'CSOSN' : 'CST'

    if (!cfop) {
      erros.push(`${quem}: sem CFOP. Preencha no cadastro do produto, aba Fiscal.`)
      continue
    }

    // Em NFC-e a operação é sempre saída dentro do estado. Um CFOP de entrada
    // (1xxx/2xxx) ou interestadual (6xxx) no cadastro costuma ser código do
    // fornecedor copiado por engano — ele descreve a operação DELE, não a sua.
    if (!cfop.startsWith('5')) {
      const tipo = cfop.startsWith('1') || cfop.startsWith('2') ? 'de entrada (compra)'
        : cfop.startsWith('6') ? 'interestadual'
        : cfop.startsWith('7') ? 'de exportação'
        : 'fora do padrão'
      erros.push(
        `${quem}: CFOP ${cfop} é ${tipo}. NFC-e é sempre venda dentro do estado — ` +
        `use um CFOP da família 5xxx (5102 para revenda comum).`)
      continue
    }

    // O CFOP existe no mundo, mas a NFC-e não aceita. É o caso mais comum de
    // rejeição 725 — e o que a checagem de par sozinha não pegava.
    if (!CFOP_VALIDO_NFCE.has(cfop)) {
      const sugestao = CFOP_COM_ST.has(cfop)
        ? 'Se a mercadoria tem ST já recolhido pelo fornecedor, o CFOP de revenda é 5405.'
        : 'Para revenda comum, o CFOP é 5102.'
      erros.push(`${quem}: CFOP ${cfop} não é aceito em NFC-e. ${sugestao}`)
      continue
    }

    if (!situacao) {
      erros.push(`${quem}: sem ${nomeSituacao} definido. Preencha no cadastro do produto, aba Fiscal.`)
      continue
    }

    const cfopTemST = CFOP_COM_ST.has(cfop)
    const situacaoTemST = SITUACAO_COM_ST.has(situacao)

    // O par incoerente — a causa da rejeição 725 que motivou este arquivo.
    if (cfopTemST && !situacaoTemST) {
      erros.push(
        `${quem}: CFOP ${cfop} é de substituição tributária, mas o ${nomeSituacao} ${situacao} ` +
        `é de venda comum. Para revenda de item com ST já recolhido, o par correto é ` +
        `CFOP 5405 com ${simplesNacional ? 'CSOSN 500' : 'CST 60'}.`)
      continue
    }

    if (!cfopTemST && situacaoTemST) {
      erros.push(
        `${quem}: ${nomeSituacao} ${situacao} declara substituição tributária, mas o CFOP ${cfop} ` +
        `é de venda comum. Ou o produto tem ST e o CFOP deveria ser 5405, ou não tem e o ` +
        `${nomeSituacao} deveria ser ${simplesNacional ? '102' : '00'}.`)
      continue
    }

    // ST coerente, mas sem CEST — a rejeição 806.
    //
    // Chegar aqui já significa que CFOP e situação CONCORDAM sobre haver ST:
    // os dois casos de contradição acima terminam em `continue`. A ordem
    // importa. Se esta checagem viesse antes, um par contraditório sairia como
    // "falta CEST", mandando o operador preencher um campo que talvez nem
    // devesse existir naquele produto — a mensagem certa ali é o par errado.
    //
    // A venda #301973 foi recusada com "Rejeição 806: Operação com ICMS-ST sem
    // informação do CEST" tendo o CEST 1007900 corretamente cadastrado. Ele
    // nunca saiu do banco: `EmissaoNFCeItem` não tinha o campo, então nenhum
    // dos dois provedores recebia o dado. Isso foi corrigido no envio; esta
    // checagem é a rede embaixo, para o caso que o envio não resolve — o
    // produto que declara ST e de fato não tem CEST nenhum cadastrado.
    if (cfopTemST && !item.cest) {
      erros.push(
        `${quem}: operação com substituição tributária (CFOP ${cfop}, ${nomeSituacao} ${situacao}) ` +
        `e sem CEST cadastrado. A SEFAZ recusa com "Rejeição 806". O CEST vem do NCM do produto: ` +
        `abra o cadastro, aba Fiscal, e use "Preencher fiscal" ou digite os 7 dígitos.`)
      continue
    }
  }

  return { erros }
}
