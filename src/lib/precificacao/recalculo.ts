import { criarResolvedor, descreverOrigem, COLUNAS_ANUNCIO, COLUNAS_CANAL, COLUNAS_PRODUTO, type OrigemComissao, type OrigemFrete, type ProdutoPrecificacao } from './contexto'
import { buscarRegras, descreverObjetivo, resolverRegra, type Regra } from './regras'
import { montarEstrategia, type EstadoComercial, type EstrategiaEconomicaAnuncio, type FlagComercial, type Oportunidade } from './estrategia'
import { recomendar, type Recomendacao } from './recomendacoes'
import { sinalDeEstoque, sinalDeVendas } from './sinais'
import { estoquePorProduto, vendasPorAnuncio } from './sinaisLote'
import { cabeAtacado } from './quantidade'
import { capacidadesDoCanal } from './capacidades'
import type { EconomiaResolvida } from './cenarios'
import type { ClassificacaoMargem, Margens } from './margens'
import type { OrigemPrecoEfetivo, CampanhaVigenteResumo } from './precos'
import type { SaudePreco } from './tipos'

// O cliente do Supabase é `any` em todo o repositório: tipá-lo exigiria os
// tipos gerados do banco, que este projeto não usa. O alias existe para a
// exceção ficar declarada em UM lugar, e não repetida em cada assinatura.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteSupabase = any

// Varredura de recálculo: percorre os anúncios, aplica a regra que vale pra
// cada um e devolve o que MUDARIA — sem alterar nada.
//
// A parte que importa tanto quanto o cálculo: contar honestamente o que NÃO
// deu pra calcular e por quê. Um recálculo que diz "142 anúncios" quando
// existem 8.655 precisa dizer o que houve com os outros 8.513, senão passa a
// impressão de que a loja inteira foi coberta.
//
// FASE 1: a economia de cada anúncio deixou de ser montada aqui e passou a
// vir de `contexto.ts`, o mesmo que o simulador, o explicar e o ajustar-item
// usam. Antes esta varredura tinha frete real do ML mas comissão de tabela,
// enquanto o simulador tinha o contrário — o mesmo anúncio saía com dois
// preços dependendo da tela.

export type ItemRecalculo = {
  anuncioId: string
  canalId: string
  canalNome: string
  titulo: string
  produtoId: string
  produtoNome: string
  sku: string | null
  custo: number
  precoAtual: number
  precoNovo: number
  diferenca: number
  /** `preco_venda`: o preço espelhado do canal. */
  precoBase: number
  /** O preço que vale agora — é sobre ele que a margem atual foi medida. */
  precoEfetivo: number
  /** Qual dos dois virou `precoAtual`. Ver `precos.ts`. */
  origemPrecoAtual: OrigemPrecoEfetivo
  /** Margem LÍQUIDA: lucro ÷ preço de venda. Não confundir com markup. */
  margemAtual: number
  margemNova: number
  /**
   * Lucro sobre o CUSTO (lucro ÷ custo), em %. Mesmo dinheiro da margem, só
   * dividido pelo custo em vez de pelo preço — por isso dá um número maior.
   *
   * É esta a conta que as regras usam ("20% de lucro sobre o custo"), então é
   * ela que precisa aparecer ao lado da margem. Não confundir com o `markup`
   * do motor, que é preço ÷ custo: no mesmo item, a regra de 20% produz um
   * markup de ~63%, porque o preço também tem que cobrir comissão e frete.
   */
  lucroSobreCustoAtual: number
  lucroSobreCustoNovo: number
  saudeAtual: SaudePreco
  saudeNova: SaudePreco
  regraNome: string
  regraObjetivo: string
  regraId: string
  /** Frete que entrou na conta do preço novo — 0 abaixo do limite de grátis. */
  frete: number
  /** true quando o valor veio da API do marketplace, não do custo médio. */
  freteImportado: boolean
  origemComissao: OrigemComissao
  origemFrete: OrigemFrete

  // ── Leitura comercial (Fase 2) ──
  /** Classificação do preço EFETIVO contra a política de margens da regra. */
  classificacao: ClassificacaoMargem
  motivoClassificacao: string
  margens: Margens
  /** Preço para a margem alvo, para o limite promocional e para o piso. */
  precoAlvo: number
  precoPromocionalLimite: number | null
  precoPiso: number | null
  estado: EstadoComercial
  flags: FlagComercial[]
  campanha: CampanhaVigenteResumo | null
  oportunidades: Oportunidade[]
  /**
   * Recomendações comerciais, já sem contradição e ordenadas pela
   * gravidade. Vazio quando os sinais de estoque e venda não puderam ser
   * apurados — nenhuma delas chuta.
   */
  recomendacoes: Recomendacao[]
  /** Comissão + frete que valeram neste preço, em uma linha legível. */
  regime: string | null
  /** Custo, comissão e frete: de onde cada um saiu. */
  origem: string
  avisos: string[]
}

export type ResumoRecalculo = {
  totalAnuncios: number
  calculados: number
  semProduto: number
  semCusto: number
  semRegra: number
  semPrecoAtual: number
  sobem: number
  descem: number
  iguais: number
  emPrejuizoAgora: number
  emPrejuizoDepois: number
  somaDiferenca: number

  // ── Contagens comerciais (Fase 2) — alimentam os cartões da tela ──
  emPromocao: number
  semPromocao: number
  promocoesTerminando: number
  foraDaPoliticaPromocional: number
  abaixoDoPiso: number
  comOportunidade: number
}

const TOLERANCIA = 0.01 // centavos: abaixo disso o preço é "o mesmo"

// Teto de produtos que a busca livre resolve. Existe porque a lista de ids
// viaja dentro da própria consulta — um termo curto demais ("a") não pode
// virar uma URL de 14 mil ids.
const LIMITE_PRODUTOS_BUSCA = 400

export async function varrerRecalculo(
  sb: ClienteSupabase,
  empresaId: string,
  opcoes: {
    canaisIds?: string[]
    apenasAtivos?: boolean
    limiteItens?: number
    /** Texto livre: casa com o título do anúncio ou com nome/SKU/EAN do produto. */
    busca?: string
    /**
     * Produtos aos quais a varredura fica restrita — normalmente o que veio de
     * uma entrada de mercadoria. Lista vazia significa "a entrada não trouxe
     * nenhum produto", e o resultado correto é zero, não a loja inteira.
     */
    produtoIds?: string[] | null
    /**
     * Instante de referência. A varredura inteira é avaliada contra o mesmo
     * relógio: uma promoção que vence no meio de 9 mil anúncios não pode
     * produzir dois critérios na mesma execução.
     */
    agora?: Date
  } = {},
): Promise<{ resumo: ResumoRecalculo; itens: ItemRecalculo[]; truncado: boolean }> {
  const limiteItens = opcoes.limiteItens ?? 500

  let qCanais = sb.from('marketplace_canais').select(COLUNAS_CANAL).eq('empresa_id', empresaId)
  if (opcoes.canaisIds?.length) qCanais = qCanais.in('id', opcoes.canaisIds)
  const { data: canais } = await qCanais.order('nome')

  const regras = await buscarRegras(sb, empresaId)
  const resolvedor = criarResolvedor(sb, empresaId, opcoes.agora ?? new Date())

  const resumo: ResumoRecalculo = {
    totalAnuncios: 0, calculados: 0, semProduto: 0, semCusto: 0, semRegra: 0, semPrecoAtual: 0,
    sobem: 0, descem: 0, iguais: 0, emPrejuizoAgora: 0, emPrejuizoDepois: 0, somaDiferenca: 0,
    emPromocao: 0, semPromocao: 0, promocoesTerminando: 0,
    foraDaPoliticaPromocional: 0, abaixoDoPiso: 0, comOportunidade: 0,
  }

  // Restrição por produto (entrada de mercadoria). Lista vazia é uma resposta
  // legítima — devolve zero em vez de varrer tudo, que seria o oposto do que
  // o operador pediu.
  const idsProduto = opcoes.produtoIds ?? null
  if (idsProduto && idsProduto.length === 0) {
    return { resumo, itens: [], truncado: false }
  }

  // Busca livre: o texto pode estar no título do anúncio (que o vendedor
  // escreveu) ou no cadastro do produto (nome/SKU/EAN). Os dois valem — no
  // caso real "ralo onça", o anúncio se chama "Ralo Grelha Abacaxi Ferro
  // Fundido" e só o produto tem o termo.
  const termo = (opcoes.busca ?? '').trim()
  let idsDaBusca: string[] = []
  if (termo) {
    // Vírgula e parênteses são separadores da sintaxe `or` do PostgREST.
    const seguro = termo.replace(/[,()%]/g, ' ').trim()
    const { data: achados } = await sb.from('produtos').select('id')
      .eq('empresa_id', empresaId)
      .or(`nome.ilike.%${seguro}%,sku.ilike.%${seguro}%,ean.ilike.%${seguro}%`)
      .limit(LIMITE_PRODUTOS_BUSCA)
    idsDaBusca = (achados ?? []).map((p: { id: string }) => p.id)
  }
  const itens: ItemRecalculo[] = []

  // O que cada item precisa para virar recomendação depois da varredura.
  // Guardado só para os itens que entram na lista (no máximo `limiteItens`),
  // e não para os milhares varridos.
  type ContextoDoItem = {
    estrategia: EstrategiaEconomicaAnuncio
    economia: EconomiaResolvida
    produto: { id: string; estoque: number | null; tipo: string | null }
    plataforma: string
    temCredencial: boolean
    campanhaSincronizadaEm: string | null
  }
  const contextoDoItem = new Map<string, ContextoDoItem>()

  const TAM = 1000
  for (const canal of canais ?? []) {
    for (let off = 0; off < 30 * TAM; off += TAM) {
      let q = sb.from('marketplace_anuncios')
        .select(`${COLUNAS_ANUNCIO}, produtos(${COLUNAS_PRODUTO})`)
        .eq('canal_id', canal.id).eq('empresa_id', empresaId)
        // ORDENAÇÃO OBRIGATÓRIA. Sem ela o Postgres não promete a mesma ordem
        // entre duas requisições, e a paginação por `range` passa a repetir e
        // a perder linha — defeito intermitente, pior que o original, porque
        // some quando se vai conferir. Ver src/lib/supabase/paginar.ts.
        .order('id', { ascending: true })
        .range(off, off + TAM - 1)
      if (opcoes.apenasAtivos) q = q.eq('status', 'ativo')
      // Filtrar no banco, não em memória: sem isso, pedir 12 anúncios ainda
      // custaria a varredura dos 8.600.
      if (idsProduto) q = q.in('produto_id', idsProduto)
      if (termo) {
        const seguro = termo.replace(/[,()%]/g, ' ').trim()
        q = idsDaBusca.length
          ? q.or(`titulo.ilike.%${seguro}%,produto_id.in.(${idsDaBusca.join(',')})`)
          : q.ilike('titulo', `%${seguro}%`)
      }
      const { data } = await q
      const lote = data ?? []

      for (const a of lote) {
        resumo.totalAnuncios++
        const p = a.produtos as ProdutoPrecificacao & { estoque?: number | null } | null
        if (!p) { resumo.semProduto++; continue }

        // As três peneiras vêm ANTES do contexto completo, e nesta ordem, de
        // propósito: resolver o contexto pode significar consultar comissão e
        // frete na API do Mercado Livre, e não se paga esse preço por um
        // anúncio que já se sabe que não vai virar cálculo.
        const { custo } = await resolvedor.custo(p)
        if (!(custo > 0)) { resumo.semCusto++; continue }

        const resolucao = resolverRegra(regras, { id: p.id, categoria: p.categoria ?? null, marca: p.marca ?? null }, canal)
        if (!resolucao.vencedora) { resumo.semRegra++; continue }

        const ctx = await resolvedor.contexto({ canal, produto: p, anuncio: a })

        // O preço "de hoje" sai do vocabulário canônico, não de um
        // `promocional || venda` solto: campanha vigente da plataforma ganha
        // da promoção local, e promoção fora da janela não vale nenhuma das
        // duas. A checagem vem depois do contexto porque é a campanha que
        // pode dar preço a um anúncio cujo espelho está zerado.
        const precos = ctx.precos!
        const precoAtual = precos.efetivo
        if (!(precoAtual > 0)) { resumo.semPrecoAtual++; continue }

        const estrategia = montarEstrategia({
          economia: ctx.economia, precos, regra: resolucao.vencedora, agora: resolvedor.agora,
        })
        const novo = estrategia.cenarioAlvo!
        const atual = estrategia.cenarioEfetivo

        if (estrategia.estado === 'em_promocao') resumo.emPromocao++
        else if (estrategia.estado === 'normal') resumo.semPromocao++
        if (estrategia.flags.includes('promocao_terminando')) resumo.promocoesTerminando++
        if (estrategia.classificacao.classificacao === 'requer_aprovacao') resumo.foraDaPoliticaPromocional++
        if (estrategia.classificacao.classificacao === 'bloqueado') resumo.abaixoDoPiso++
        if (estrategia.oportunidades.length > 0) resumo.comOportunidade++

        const diferenca = Number((novo.resultado.preco - precoAtual).toFixed(2))
        resumo.calculados++
        resumo.somaDiferenca += diferenca
        if (diferenca > TOLERANCIA) resumo.sobem++
        else if (diferenca < -TOLERANCIA) resumo.descem++
        else resumo.iguais++
        if (atual.resultado.lucro < 0) resumo.emPrejuizoAgora++
        if (novo.resultado.lucro < 0) resumo.emPrejuizoDepois++

        if (itens.length < limiteItens && Math.abs(diferenca) > TOLERANCIA) {
          itens.push({
            anuncioId: a.id, canalId: canal.id, canalNome: canal.nome,
            titulo: a.titulo ?? '', produtoId: p.id, produtoNome: p.nome ?? '(produto)', sku: p.sku ?? null,
            custo: ctx.economia.custo,
            precoAtual, precoNovo: novo.resultado.preco, diferenca,
            precoBase: precos.base,
            precoEfetivo: precos.efetivo,
            origemPrecoAtual: precos.origemEfetivo,
            margemAtual: Number(atual.resultado.margemLiquida.toFixed(2)),
            margemNova: Number(novo.resultado.margemLiquida.toFixed(2)),
            // `roi` do motor JÁ é lucro ÷ custo em % — a mesma base das regras
            // de "lucro sobre o custo". Bate com o número configurado na regra.
            lucroSobreCustoAtual: atual.lucroSobreCusto,
            lucroSobreCustoNovo: novo.lucroSobreCusto,
            saudeAtual: atual.saude,
            saudeNova: novo.saude,
            regraNome: resolucao.vencedora.nome,
            regraObjetivo: descreverObjetivo(resolucao.vencedora.objetivoTipo, resolucao.vencedora.objetivoValor),
            regraId: resolucao.vencedora.id,
            frete: novo.resultado.frete,
            freteImportado: !!ctx.economia.freteFaixas,
            origemComissao: ctx.origemComissao,
            origemFrete: ctx.origemFrete,
            regime: novo.resultado.regime?.descricao ?? null,
            origem: descreverOrigem(ctx),
            classificacao: estrategia.classificacao.classificacao,
            motivoClassificacao: estrategia.classificacao.motivo,
            margens: estrategia.margens,
            precoAlvo: estrategia.precoAlvo,
            precoPromocionalLimite: estrategia.precoPromocionalLimite,
            precoPiso: estrategia.precoPiso,
            estado: estrategia.estado,
            flags: estrategia.flags,
            campanha: estrategia.campanha,
            oportunidades: estrategia.oportunidades,
            recomendacoes: [],
            avisos: [...ctx.avisos, ...novo.resultado.avisos],
          })

          contextoDoItem.set(a.id, {
            estrategia,
            economia: ctx.economia,
            produto: { id: p.id, estoque: p.estoque ?? null, tipo: p.tipo ?? null },
            plataforma: canal.plataforma,
            temCredencial: !!canal.access_token,
            // A campanha mais recentemente sincronizada do canal diz a idade
            // do espelho — e o espelho velho é motivo de recomendação.
            campanhaSincronizadaEm: ctx.campanhas
              .map(c => c.campanha.sincronizadoEm)
              .filter(Boolean)
              .sort()
              .pop() ?? null,
          })
        }
      }

      if (lote.length < TAM) break
    }
  }

  // Maior impacto primeiro: quem está mais longe do preço certo é quem mais
  // custa dinheiro deixar como está.
  itens.sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca))

  await anexarRecomendacoes(sb, empresaId, itens, contextoDoItem, resolvedor.agora)

  const totalComDiferenca = resumo.sobem + resumo.descem
  return { resumo, itens, truncado: totalComDiferenca > itens.length }
}

export function regraDoItem(regras: Regra[], id: string): Regra | undefined {
  return regras.find(r => r.id === id)
}

/**
 * Segunda passada: transforma os itens da prévia em recomendações.
 *
 * POR QUE UMA SEGUNDA PASSADA, e não dentro do laço
 *
 * Estoque e vendas são consultas em LOTE. Buscá-los durante a varredura
 * significaria uma consulta por anúncio entre milhares; aqui são duas
 * consultas para os poucos que entraram na lista.
 *
 * E por que só para os que entraram: recomendação é para ler, e o que não vai
 * ser mostrado não precisa ser apurado.
 *
 * Falha em qualquer das duas buscas deixa as recomendações vazias em vez de
 * inventar sinal. Um estoque desconhecido tratado como zero produziria
 * "sem estoque, não promova" para a loja inteira.
 */
async function anexarRecomendacoes(
  sb: ClienteSupabase,
  empresaId: string,
  itens: ItemRecalculo[],
  contextos: Map<string, {
    estrategia: EstrategiaEconomicaAnuncio
    economia: EconomiaResolvida
    produto: { id: string; estoque: number | null; tipo: string | null }
    plataforma: string
    temCredencial: boolean
    campanhaSincronizadaEm: string | null
  }>,
  agora: Date,
): Promise<void> {
  if (itens.length === 0) return

  const produtos = [...new Map(
    itens.map(i => contextos.get(i.anuncioId)?.produto).filter(Boolean)
      .map(p => [p!.id, p!] as const),
  ).values()]

  const [estoques, vendas] = await Promise.all([
    estoquePorProduto(sb, empresaId, produtos),
    vendasPorAnuncio(sb, empresaId, itens.map(i => i.anuncioId), { agora }),
  ])

  for (const item of itens) {
    const ctx = contextos.get(item.anuncioId)
    if (!ctx) continue

    const estoque = estoques.get(ctx.produto.id) ?? sinalDeEstoque(null)
    const entradaVendas = vendas.get(item.anuncioId) ?? { unidades: null, dias: 0 }
    const sinalVendas = sinalDeVendas(estoque, entradaVendas)

    item.recomendacoes = recomendar({
      estrategia: ctx.estrategia,
      estoque,
      vendas: sinalVendas,
      // Só pergunta se cabe atacado quando há estoque: a resposta não muda
      // nada num item que não pode ser entregue.
      atacado: estoque.temEstoque
        ? cabeAtacado(ctx.economia, ctx.estrategia.margens)
        : null,
      capacidadeAtacado: capacidadesDoCanal(ctx.plataforma, { temCredencial: ctx.temCredencial })
        .precoQuantidadeEscrita,
      campanhaSincronizadaEm: ctx.campanhaSincronizadaEm,
      agora,
    })
  }
}
