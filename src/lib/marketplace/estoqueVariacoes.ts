// ANÚNCIO COM VARIAÇÃO — QUAL É A UNIDADE DE ESTOQUE.
//
// A fila tratava `tem_variacao` como fora de escopo, e o comentário dizia por
// quê: "mandar um número só sobrescreveria a distribuição inteira". Isso é
// verdade quando se manda UM número para o item. Não é verdade quando se
// manda um número POR MODELO — que é o que as duas plataformas aceitam
// (Shopee: `stock_list[].model_id`; Mercado Livre: `variations[].id`).
//
// A unidade de estoque de um anúncio com variação é a VARIAÇÃO, e cada
// variação tem o seu próprio produto do ERP em
// `marketplace_anuncio_variacoes.produto_id`. O anúncio-pai também pode ter
// um `produto_id`, mas ele não serve para estoque aqui: o estoque de "Camiseta
// azul M" não é o estoque de "Camiseta".
//
// ── A REGRA DE OURO: SÓ MEXER NO QUE ESTÁ MAPEADO ───────────────────────
//
// Medido em produção em 12/09/2026: 1.664 variações, das quais 193 têm
// produto vinculado. Uma variação sem produto não tem estoque do ERP para
// mandar — e o que existe na plataforma é a distribuição que o vendedor fez.
// Ela fica INTOCADA: não entra na lista enviada, e por isso a plataforma não
// mexe nela. Mandar zero seria pior que não mandar nada.
//
// ── PAUSAR É DO ITEM, NÃO DA VARIAÇÃO ───────────────────────────────────
//
// As duas plataformas ligam/desligam o ANÚNCIO inteiro, não o modelo. Então
// "estoque de risco" numa variação não pode derrubar o anúncio: tirar do ar
// as outras quatro cores porque uma acabou é pior do que o problema que a
// pausa resolve. A pausa só acontece quando TODAS as variações que
// controlamos estão em risco — aí o item inteiro está, de fato, sem o que
// vender.

export type VariacaoDoAnuncio = {
  id: string
  model_id: string | null
  nome_variacao: string | null
  sku_variacao: string | null
  produto_id: string | null
  /** Preço na plataforma, na última leitura de catálogo. */
  preco: number | null
  /** Estoque na plataforma, na última leitura de catálogo. */
  estoque: number | null
}

export type MotivoIgnorada = 'sem_produto' | 'sem_model_id'

export type VariacaoIgnorada = {
  variacao: VariacaoDoAnuncio
  motivo: MotivoIgnorada
  /** Frase pronta para a linha da simulação. */
  detalhe: string
}

export type Elegiveis = {
  /** Variações que têm produto mapeado E id na plataforma. */
  elegiveis: VariacaoDoAnuncio[]
  /** As que ficam de fora, com o porquê — para a linha da fila dizer. */
  ignoradas: VariacaoIgnorada[]
}

/** Como a variação aparece no log: o nome, ou o SKU, ou o id do modelo. */
export function rotuloDaVariacao(v: VariacaoDoAnuncio): string {
  return v.nome_variacao?.trim()
    || (v.sku_variacao?.trim() ? `SKU ${v.sku_variacao.trim()}` : '')
    || (v.model_id ? `modelo ${v.model_id}` : 'variação sem identificação')
}

/**
 * Separa o que dá para sincronizar do que não dá, com o motivo.
 *
 * Os dois motivos são diferentes e pedem ações diferentes: `sem_produto` se
 * resolve no Mapa de anúncios, `sem_model_id` é linha que nunca veio de uma
 * sincronização de catálogo e não tem endereço na plataforma.
 */
export function variacoesElegiveis(variacoes: VariacaoDoAnuncio[]): Elegiveis {
  const elegiveis: VariacaoDoAnuncio[] = []
  const ignoradas: VariacaoIgnorada[] = []

  for (const v of variacoes) {
    const rotulo = rotuloDaVariacao(v)
    if (!v.model_id) {
      ignoradas.push({
        variacao: v, motivo: 'sem_model_id',
        detalhe: `${rotulo}: sem id na plataforma — a linha não veio de sincronização de catálogo`,
      })
      continue
    }
    if (!v.produto_id) {
      ignoradas.push({
        variacao: v, motivo: 'sem_produto',
        detalhe: `${rotulo}: sem produto vinculado — mapeie no Mapa de anúncios. `
          + 'O estoque desta variação NÃO foi alterado.',
      })
      continue
    }
    elegiveis.push(v)
  }

  return { elegiveis, ignoradas }
}

export type AlvoCalculado = {
  variacaoId: string
  modelId: string
  rotulo: string
  produtoId: string
  /** `undefined` quando a regra não mexe em estoque. */
  estoqueNovo?: number
  /** `null`/`undefined` quando não há preço a mandar. */
  precoNovo?: number | null
  /** A regra concluiu que ESTA variação está no estoque de risco. */
  emRisco: boolean
  /** `precisaEnviar` disse que vale a pena mandar. */
  enviar: boolean
}

export type DecisaoPausaVariacoes = {
  pausar: boolean
  /** Frase para o log — sempre preenchida, inclusive quando não pausa. */
  porque: string
}

/**
 * O anúncio inteiro deve sair do ar?
 *
 * Só quando TODAS as variações controladas estão em risco. Com uma só fora
 * do risco, o item continua tendo o que vender.
 *
 * Variação não mapeada não entra na conta nem a favor nem contra: não
 * sabemos o estoque dela. Se NENHUMA variação é controlada, não há base para
 * pausar — a decisão fica com quem cuida do anúncio.
 */
export function decidirPausaComVariacoes(alvos: AlvoCalculado[]): DecisaoPausaVariacoes {
  const comEstoque = alvos.filter(a => a.estoqueNovo !== undefined)
  if (comEstoque.length === 0) {
    return { pausar: false, porque: 'nenhuma variação controlada com estoque calculado' }
  }

  const emRisco = comEstoque.filter(a => a.emRisco)
  if (emRisco.length === comEstoque.length) {
    return {
      pausar: true,
      porque: `todas as ${comEstoque.length} variação(ões) controladas estão no estoque de risco`,
    }
  }

  if (emRisco.length > 0) {
    return {
      pausar: false,
      porque: `${emRisco.length} de ${comEstoque.length} variação(ões) em risco — `
        + 'o anúncio continua no ar porque as outras ainda têm estoque',
    }
  }

  return { pausar: false, porque: 'nenhuma variação em risco' }
}

/** Uma linha de resumo do que foi feito no anúncio, para o log da rodada. */
export function resumoDosAlvos(alvos: AlvoCalculado[], ignoradas: VariacaoIgnorada[]): string {
  const enviando = alvos.filter(a => a.enviar)
  const partes = [`${enviando.length} de ${alvos.length + ignoradas.length} variação(ões)`]
  if (enviando.length > 0) {
    partes.push(enviando.map(a => `${a.rotulo} → ${a.estoqueNovo ?? '—'}`).join(', '))
  }
  const semProduto = ignoradas.filter(i => i.motivo === 'sem_produto').length
  if (semProduto > 0) partes.push(`${semProduto} sem produto vinculado (intocada(s))`)
  return partes.join(' · ')
}
