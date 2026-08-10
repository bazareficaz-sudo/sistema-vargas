import { buscarConfigDoCanal } from './config'
import { saudeDaMargem, calcular } from './motor'
import { aplicarRegra, buscarRegras, descreverObjetivo, resolverRegra, type Regra } from './regras'
import { calcularKit } from '@/lib/produtos/kit'
import { resolverFreteML, embalagemDoAnuncio, logisticTypeDoAnuncio, listingTypeDoAnuncio, pesoCobravelML } from './mlFrete'
import type { FaixaFrete } from './tipos'
import type { SaudePreco } from './tipos'

// Varredura de recálculo: percorre os anúncios, aplica a regra que vale pra
// cada um e devolve o que MUDARIA — sem alterar nada.
//
// A parte que importa tanto quanto o cálculo: contar honestamente o que NÃO
// deu pra calcular e por quê. Um recálculo que diz "142 anúncios" quando
// existem 8.655 precisa dizer o que houve com os outros 8.513, senão passa a
// impressão de que a loja inteira foi coberta.

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
}

const TOLERANCIA = 0.01 // centavos: abaixo disso o preço é "o mesmo"

// Teto de produtos que a busca livre resolve. Existe porque a lista de ids
// viaja dentro da própria consulta — um termo curto demais ("a") não pode
// virar uma URL de 14 mil ids.
const LIMITE_PRODUTOS_BUSCA = 400

export async function varrerRecalculo(
  sb: any,
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
  } = {},
): Promise<{ resumo: ResumoRecalculo; itens: ItemRecalculo[]; truncado: boolean }> {
  const limiteItens = opcoes.limiteItens ?? 500

  let qCanais = sb.from('marketplace_canais').select('id, nome, plataforma, seller_id, access_token').eq('empresa_id', empresaId)
  if (opcoes.canaisIds?.length) qCanais = qCanais.in('id', opcoes.canaisIds)
  const { data: canais } = await qCanais.order('nome')

  const regras = await buscarRegras(sb, empresaId)
  const configPorCanal = new Map<string, any>()
  for (const c of canais ?? []) {
    const { cfg } = await buscarConfigDoCanal(sb, empresaId, c)
    configPorCanal.set(c.id, cfg)
  }

  const resumo: ResumoRecalculo = {
    totalAnuncios: 0, calculados: 0, semProduto: 0, semCusto: 0, semRegra: 0, semPrecoAtual: 0,
    sobem: 0, descem: 0, iguais: 0, emPrejuizoAgora: 0, emPrejuizoDepois: 0, somaDiferenca: 0,
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
    idsDaBusca = (achados ?? []).map((p: any) => p.id)
  }
  const itens: ItemRecalculo[] = []
  // Custo de kit é caro (consulta os componentes) — calcula uma vez por
  // produto, não uma vez por anúncio.
  const custoKitCache = new Map<string, number>()

  // Escadas de frete já resolvidas nesta varredura. A chave é peso cobrável +
  // logística + tipo de anúncio: caixas diferentes que dão o mesmo peso
  // cobrável pagam o mesmo frete, então uma consulta serve para todas.
  const freteCache = new Map<string, FaixaFrete[] | null>()

  const TAM = 1000
  for (const canal of canais ?? []) {
    const cfg = configPorCanal.get(canal.id)
    for (let off = 0; off < 30 * TAM; off += TAM) {
      let q = sb.from('marketplace_anuncios')
        .select('id, titulo, preco_venda, preco_promocional, status, produto_id, dados_brutos, produtos(id, nome, sku, categoria, marca, tipo, preco_custo, peso_kg, comprimento_cm, largura_cm, altura_cm)')
        .eq('canal_id', canal.id).eq('empresa_id', empresaId)
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
        const p: any = a.produtos
        if (!p) { resumo.semProduto++; continue }

        let custo = Number(p.preco_custo ?? 0)
        if (p.tipo === 'kit') {
          if (!custoKitCache.has(p.id)) {
            custoKitCache.set(p.id, Number((await calcularKit(sb, p.id))?.custo ?? 0))
          }
          custo = custoKitCache.get(p.id)!
        }
        if (!(custo > 0)) { resumo.semCusto++; continue }

        const resolucao = resolverRegra(regras, { id: p.id, categoria: p.categoria, marca: p.marca }, canal)
        if (!resolucao.vencedora) { resumo.semRegra++; continue }

        const precoAtual = Number(a.preco_promocional || a.preco_venda || 0)
        if (!(precoAtual > 0)) { resumo.semPrecoAtual++; continue }

        const pesoKg = p.peso_kg != null ? Number(p.peso_kg) : null

        // Frete real do Mercado Livre para ESTE anúncio, quando o canal está
        // configurado para importar. Substitui o "custo médio" digitado —
        // que erra por tamanho e por faixa de preço ao mesmo tempo.
        let freteFaixas: FaixaFrete[] | null = null
        const avisosFrete: string[] = []
        if (cfg.freteMlImportar && canal.plataforma === 'mercadolivre' && canal.access_token && canal.seller_id) {
          const emb = embalagemDoAnuncio(a.dados_brutos, p)
          if (!emb) {
            // Sem medida não dá pra saber o frete, e chutar uma caixa vira
            // erro de preço — exatamente o que esta importação existe para
            // evitar. Cai no frete configurado e diz por quê.
            avisosFrete.push('Sem peso/medidas no anúncio nem no cadastro — frete pelo custo médio configurado.')
          } else {
            const logistica = logisticTypeDoAnuncio(a.dados_brutos)
            const tipoAnuncio = listingTypeDoAnuncio(a.dados_brutos)
            const chave = `${pesoCobravelML(emb)}|${logistica}|${tipoAnuncio}`
            if (!freteCache.has(chave)) {
              try {
                const r = await resolverFreteML(
                  sb,
                  { id: canal.id, sellerId: String(canal.seller_id), accessToken: canal.access_token },
                  emb, logistica, tipoAnuncio,
                )
                freteCache.set(chave, r.faixas)
              } catch {
                // Falha de consulta não derruba a varredura inteira: este
                // anúncio volta pro frete configurado, e os outros seguem.
                freteCache.set(chave, null)
              }
            }
            freteFaixas = freteCache.get(chave) ?? null
            if (!freteFaixas) avisosFrete.push('Não foi possível consultar o frete no Mercado Livre — usando o custo médio configurado.')
          }
        }

        const novo = aplicarRegra({ cfg, custoProduto: custo, regra: resolucao.vencedora, pesoKg, freteFaixas })
        const atual = calcular({ cfg, custoProduto: custo, objetivo: { tipo: 'preco', valor: precoAtual }, pesoKg, freteFaixas })

        const diferenca = Number((novo.preco - precoAtual).toFixed(2))
        resumo.calculados++
        resumo.somaDiferenca += diferenca
        if (diferenca > TOLERANCIA) resumo.sobem++
        else if (diferenca < -TOLERANCIA) resumo.descem++
        else resumo.iguais++
        if (atual.lucro < 0) resumo.emPrejuizoAgora++
        if (novo.lucro < 0) resumo.emPrejuizoDepois++

        if (itens.length < limiteItens && Math.abs(diferenca) > TOLERANCIA) {
          itens.push({
            anuncioId: a.id, canalId: canal.id, canalNome: canal.nome,
            titulo: a.titulo ?? '', produtoId: p.id, produtoNome: p.nome, sku: p.sku ?? null,
            custo, precoAtual, precoNovo: novo.preco, diferenca,
            margemAtual: Number(atual.margemLiquida.toFixed(2)),
            margemNova: Number(novo.margemLiquida.toFixed(2)),
            // `roi` do motor JÁ é lucro ÷ custo em % — a mesma base das regras
            // de "lucro sobre o custo". Bate com o número configurado na regra.
            lucroSobreCustoAtual: Number(atual.roi.toFixed(2)),
            lucroSobreCustoNovo: Number(novo.roi.toFixed(2)),
            saudeAtual: saudeDaMargem(atual.margemLiquida, cfg.faixasSaude),
            saudeNova: saudeDaMargem(novo.margemLiquida, cfg.faixasSaude),
            regraNome: resolucao.vencedora.nome,
            regraObjetivo: descreverObjetivo(resolucao.vencedora.objetivoTipo, resolucao.vencedora.objetivoValor),
            regraId: resolucao.vencedora.id,
            frete: novo.frete, freteImportado: !!freteFaixas,
            avisos: [...avisosFrete, ...novo.avisos],
          })
        }
      }

      if (lote.length < TAM) break
    }
  }

  // Maior impacto primeiro: quem está mais longe do preço certo é quem mais
  // custa dinheiro deixar como está.
  itens.sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca))

  const totalComDiferenca = resumo.sobem + resumo.descem
  return { resumo, itens, truncado: totalComDiferenca > itens.length }
}

export function regraDoItem(regras: Regra[], id: string): Regra | undefined {
  return regras.find(r => r.id === id)
}
