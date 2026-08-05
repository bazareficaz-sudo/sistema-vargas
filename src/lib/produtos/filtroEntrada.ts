// Resolve "quais produtos entraram nesta nota/neste período" para os filtros
// de Entrada de Mercadoria.
//
// Existe como módulo compartilhado porque a mesma pergunta é feita em duas
// telas (Produtos e Gestão de Preços) e as duas implementações divergiram: a
// de Produtos já tinha as duas correções abaixo, a de Preços tinha os dois
// problemas ainda. Uma função só, para não voltarem a se afastar.
//
// 1. Busca por número casava por semelhança sempre. Medido na base real:
//    digitar "1" casava com 12 entradas (ENT-000001, 000010, 000011...) e
//    listava 87 produtos. Tenta o número EXATO primeiro; só cai para a busca
//    parcial quando o exato não acha nada — que é o que permite achar uma
//    entrada lembrando só um pedaço do número.
//
// 2. Só olhava `entradas` (lançamento manual). Nota importada por XML vive em
//    `nfe_entradas` + `nfe_itens`, e ficava invisível para o filtro.

export type EntradaCasada = { rotulo: string; origem: 'manual' | 'xml' }

export type FiltroEntrada = {
  /** Número da entrada manual ou número da NF. */
  numero?: string
  /** Data de emissão — início do intervalo (YYYY-MM-DD). */
  de?: string
  /** Data de emissão — fim do intervalo (YYYY-MM-DD). */
  ate?: string
}

export type ResultadoFiltroEntrada = {
  /** Produtos que aparecem nos itens das entradas casadas. */
  produtoIds: string[]
  /**
   * Quais entradas casaram. Volta para a tela porque, quando mais de uma
   * casa, o operador precisa saber quais — senão os produtos "a mais" ficam
   * sem explicação.
   */
  entradasCasadas: EntradaCasada[]
}

/**
 * Devolve `null` quando nenhum filtro de entrada foi informado — o chamador
 * usa isso para não restringir a consulta.
 */
export async function produtosDaEntrada(
  sb: any,
  empresaId: string,
  filtro: FiltroEntrada,
): Promise<ResultadoFiltroEntrada | null> {
  const numero = (filtro.numero ?? '').trim()
  const de = (filtro.de ?? '').trim()
  const ate = (filtro.ate ?? '').trim()
  if (!numero && !de && !ate) return null

  // Vírgula e parênteses são separadores da sintaxe `or` do PostgREST.
  const seguro = numero.replace(/[,()%]/g, ' ').trim()

  // O período, quando informado, vale junto com o número — "a NF 1234, mas só
  // se for do mês passado" é uma pergunta legítima e barata de responder.
  const comPeriodo = (qb: any) => {
    let out = qb
    if (de) out = out.gte('data_emissao', de)
    if (ate) out = out.lte('data_emissao', ate)
    return out
  }

  const achados: EntradaCasada[] = []
  const idsManuais: string[] = []
  const idsXml: string[] = []

  const registrarManual = (linhas: any[]) => {
    for (const e of linhas) {
      idsManuais.push(e.id)
      achados.push({ rotulo: e.numero_entrada ?? `NF ${e.numero_nf}`, origem: 'manual' })
    }
  }
  const registrarXml = (linhas: any[]) => {
    for (const e of linhas) {
      idsXml.push(e.id)
      achados.push({ rotulo: `NF ${e.numero}${e.serie ? '-' + e.serie : ''}`, origem: 'xml' })
    }
  }

  const baseManual = () => comPeriodo(
    sb.from('entradas').select('id, numero_entrada, numero_nf').eq('empresa_id', empresaId),
  )
  const baseXml = () => comPeriodo(
    sb.from('nfe_entradas').select('id, numero, serie').eq('empresa_id', empresaId),
  )

  if (seguro) {
    const [exatoManual, exatoXml] = await Promise.all([
      baseManual().or(`numero_entrada.eq.${seguro},numero_nf.eq.${seguro}`).limit(50),
      baseXml().eq('numero', seguro).limit(50),
    ])
    registrarManual(exatoManual.data ?? [])
    registrarXml(exatoXml.data ?? [])

    if (achados.length === 0) {
      const [parcialManual, parcialXml] = await Promise.all([
        baseManual().or(`numero_entrada.ilike.%${seguro}%,numero_nf.ilike.%${seguro}%`).limit(50),
        baseXml().ilike('numero', `%${seguro}%`).limit(50),
      ])
      registrarManual(parcialManual.data ?? [])
      registrarXml(parcialXml.data ?? [])
    }
  } else {
    // Só período: todas as entradas emitidas no intervalo, das duas origens.
    const [periodoManual, periodoXml] = await Promise.all([
      baseManual().limit(500),
      baseXml().limit(500),
    ])
    registrarManual(periodoManual.data ?? [])
    registrarXml(periodoXml.data ?? [])
  }

  const [itensManuais, itensXml] = await Promise.all([
    idsManuais.length
      ? sb.from('entrada_itens').select('produto_id').in('entrada_id', idsManuais)
      : Promise.resolve({ data: [] as { produto_id: string | null }[] }),
    idsXml.length
      ? sb.from('nfe_itens').select('produto_id').in('entrada_id', idsXml)
      : Promise.resolve({ data: [] as { produto_id: string | null }[] }),
  ])

  const produtoIds = Array.from(new Set<string>(
    [...(itensManuais.data ?? []), ...(itensXml.data ?? [])]
      .map((r: any) => r.produto_id).filter(Boolean) as string[],
  ))

  return { produtoIds, entradasCasadas: achados }
}
