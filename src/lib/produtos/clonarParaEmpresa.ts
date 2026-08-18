import { fiscalPadraoDoRegime } from '@/lib/fiscal/regimeDefault'

// Duplica produtos de uma empresa para outra do mesmo grupo — pra que a
// segunda empresa consiga vender (PDV/NFC-e), receber entrada de XML e
// receber/enviar transferência de estoque com um catálogo PRÓPRIO, não
// emprestado.
//
// TRÊS COISAS NUNCA são copiadas da origem, de propósito:
//
//  1. CAMPOS FISCAIS DE REGIME (csosn, icms_cst, pis_cst, cofins_cst,
//     pis_percentual, cofins_percentual, cfop). Duas empresas do mesmo
//     grupo podem estar em regimes tributários diferentes — measured aqui:
//     Bazar Eficaz é Regime Normal, Ouro e Prata é Simples Nacional. Levar
//     o CSOSN/CST do regime errado faz a SEFAZ rejeitar a nota na hora
//     (mesma regra de src/lib/fiscal/emitirParaVenda.ts). Em vez de copiar,
//     estes campos são RECALCULADOS a partir do regime da empresa DESTINO,
//     com a mesma função que já sugere isso pra produto novo cadastrado à
//     mão (src/lib/fiscal/regimeDefault.ts).
//
//  2. ESTOQUE. O novo produto nasce com 0 — clonar o número da origem
//     fabricaria estoque que a empresa destino não tem fisicamente. Quem
//     põe estoque lá é a Transferência de Estoque ou uma entrada de
//     verdade, nunca a duplicação de cadastro.
//
//  3. NADA disto é original — é a mesma regra que já existe em
//     src/lib/produtos/vinculo.ts (sincronizarProdutoVinculado), cujo
//     comentário já dizia: "nunca propaga preço, estoque ou campos fiscais
//     — cada empresa mantém os seus, sempre". Preço de venda/custo AQUI
//     são copiados como valor INICIAL (a empresa nova precisa começar de
//     algum preço) — depois disso, os dois produtos ficam independentes,
//     exatamente como aquele sync já trata preço hoje.
//
// Kits (`tipo = 'kit'`) ficam de fora: um kit referencia outros produtos
// por id, e esses ids são da empresa de origem — cloná-lo sem também
// remapear os itens do kit criaria um kit vazio ou apontando pro produto
// errado. Fora do escopo desta função.

export type ItemClonagem = { produtoId: string; ok: boolean; jaExistia?: boolean; erro?: string; novoProdutoId?: string }

export async function clonarProdutosParaEmpresa(sb: any, params: {
  parceriaId: string
  empresaOrigemId: string
  empresaDestinoId: string
  /** Lado da parceria (empresa_parcerias.empresa_id_a/b) em que a empresa de ORIGEM está. */
  origemEhLadoA: boolean
  produtoIds: string[]
  /** UUID do usuário autenticado — `produto_vinculos.criado_por` é UUID, não nome. */
  criadoPorUserId: string | null
}): Promise<{ resultados: ItemClonagem[]; clonados: number; jaExistiam: number; falhas: number }> {
  const { parceriaId, empresaOrigemId, empresaDestinoId, origemEhLadoA, produtoIds, criadoPorUserId } = params
  const resultados: ItemClonagem[] = []
  if (produtoIds.length === 0) return { resultados, clonados: 0, jaExistiam: 0, falhas: 0 }

  // ── Regime fiscal da empresa DESTINO — uma consulta só, vale pro lote inteiro ──
  const { data: configFiscal } = await sb.from('empresa_config_fiscal')
    .select('crt, cfop_venda_dentro').eq('empresa_id', empresaDestinoId).maybeSingle()
  const { data: empresaDestino } = await sb.from('empresas')
    .select('regime_tributario').eq('id', empresaDestinoId).maybeSingle()
  const fiscal = fiscalPadraoDoRegime(
    String(configFiscal?.crt ?? '1'),
    empresaDestino?.regime_tributario ?? null,
    configFiscal?.cfop_venda_dentro ?? null,
  )

  // ── Quem já foi clonado antes (idempotente — reexecutar não duplica) ──
  const colunaOrigem = origemEhLadoA ? 'produto_id_a' : 'produto_id_b'
  const { data: jaVinculados } = await sb.from('produto_vinculos')
    .select(colunaOrigem).eq('parceria_id', parceriaId).in(colunaOrigem, produtoIds)
  const idsJaClonados = new Set<string>((jaVinculados ?? []).map((v: any) => v[colunaOrigem] as string))

  const pendentes = produtoIds.filter(id => !idsJaClonados.has(id))
  for (const id of idsJaClonados) resultados.push({ produtoId: id, ok: true, jaExistia: true })
  if (pendentes.length === 0) {
    return { resultados, clonados: 0, jaExistiam: resultados.length, falhas: 0 }
  }

  // ── Categorias já existentes no destino (cache pro lote inteiro) ──
  const { data: categoriasDestino } = await sb.from('categorias')
    .select('id, nome, pai_id').eq('empresa_id', empresaDestinoId)
  const categoriaPorNome = new Map<string, { id: string; pai_id: string | null }>(
    (categoriasDestino ?? []).map((c: any) => [c.nome, { id: c.id, pai_id: c.pai_id }])
  )

  async function garantirCategoria(nome: string | null, nomePai: string | null): Promise<void> {
    if (!nome) return
    if (categoriaPorNome.has(nome)) return
    let paiId: string | null = null
    if (nomePai) {
      if (!categoriaPorNome.has(nomePai)) {
        const { data } = await sb.from('categorias').insert({ empresa_id: empresaDestinoId, nome: nomePai, pai_id: null }).select('id').single()
        categoriaPorNome.set(nomePai, { id: data.id, pai_id: null })
      }
      paiId = categoriaPorNome.get(nomePai)!.id
    }
    const { data } = await sb.from('categorias').insert({ empresa_id: empresaDestinoId, nome, pai_id: paiId }).select('id').single()
    categoriaPorNome.set(nome, { id: data.id, pai_id: paiId })
  }

  // ── Produtos de origem ──
  const { data: origens, error: erroOrigens } = await sb.from('produtos')
    .select('id, nome, sku, ean, ncm, cest, unidade, categoria, subcategoria, marca, tags, tipo, controlar_estoque, disponivel_pdv, permite_fracao, estoque_minimo, peso_kg, comprimento_cm, largura_cm, altura_cm, icms_origem, icms_percentual, ibs_cst, ibs_cclasstrib, ibs_aliquota, cbs_aliquota, preco_venda, preco_custo, markup')
    .eq('empresa_id', empresaOrigemId).in('id', pendentes)
  if (erroOrigens) throw new Error(`ler produtos de origem: ${erroOrigens.message}`)

  const encontrados = new Map<string, any>((origens ?? []).map((p: any) => [p.id, p]))

  for (const produtoId of pendentes) {
    const origem = encontrados.get(produtoId)
    if (!origem) { resultados.push({ produtoId, ok: false, erro: 'Produto não encontrado.' }); continue }
    if (origem.tipo === 'kit') { resultados.push({ produtoId, ok: false, erro: 'Kits não são clonados — os itens do kit são de outra empresa.' }); continue }

    if (origem.categoria) await garantirCategoria(origem.categoria, null)
    if (origem.subcategoria) await garantirCategoria(origem.subcategoria, origem.categoria)

    const { data: novo, error: erroNovo } = await sb.from('produtos').insert({
      empresa_id: empresaDestinoId,
      nome: origem.nome, sku: origem.sku, ean: origem.ean,
      ncm: origem.ncm, cest: origem.cest, unidade: origem.unidade,
      categoria: origem.categoria, subcategoria: origem.subcategoria, marca: origem.marca, tags: origem.tags,
      tipo: origem.tipo, controlar_estoque: origem.controlar_estoque ?? true,
      disponivel_pdv: origem.disponivel_pdv ?? true, permite_fracao: origem.permite_fracao ?? false,
      estoque: 0, estoque_minimo: origem.estoque_minimo ?? 0,
      peso_kg: origem.peso_kg, comprimento_cm: origem.comprimento_cm, largura_cm: origem.largura_cm, altura_cm: origem.altura_cm,
      // Intrínseco ao produto (classificação da mercadoria), não ao regime —
      // segue igual nas duas empresas.
      icms_origem: origem.icms_origem,
      icms_percentual: fiscal.simples ? null : origem.icms_percentual,
      ibs_cst: origem.ibs_cst, ibs_cclasstrib: origem.ibs_cclasstrib, ibs_aliquota: origem.ibs_aliquota, cbs_aliquota: origem.cbs_aliquota,
      // Recalculado do regime da empresa DESTINO — nunca copiado da origem.
      cfop: fiscal.cfop, csosn: fiscal.csosn, icms_cst: fiscal.icms_cst,
      pis_cst: fiscal.pis_cst, cofins_cst: fiscal.cofins_cst,
      pis_percentual: fiscal.pis_percentual, cofins_percentual: fiscal.cofins_percentual,
      // Ponto de partida, não sincronizado depois — a empresa destino passa
      // a decidir o próprio preço a partir daqui.
      preco_venda: origem.preco_venda, preco_custo: origem.preco_custo, markup: origem.markup,
      ativo: true,
    }).select('id').single()

    if (erroNovo || !novo) {
      resultados.push({ produtoId, ok: false, erro: erroNovo?.message ?? 'Falha ao criar o produto.' })
      continue
    }

    const vinculo = origemEhLadoA
      ? { produto_id_a: produtoId, produto_id_b: novo.id }
      : { produto_id_a: novo.id, produto_id_b: produtoId }
    const { error: erroVinculo } = await sb.from('produto_vinculos')
      .insert({ parceria_id: parceriaId, ...vinculo, metodo: 'clone', criado_por: criadoPorUserId })
    if (erroVinculo) {
      // O produto já existe; o vínculo é o que garante que não seja
      // clonado de novo na próxima rodada — sem ele, reexecutar duplicaria.
      resultados.push({ produtoId, ok: false, erro: `Produto criado, mas falhou ao vincular: ${erroVinculo.message}` })
      continue
    }

    resultados.push({ produtoId, ok: true, novoProdutoId: novo.id })
  }

  return {
    resultados,
    clonados: resultados.filter(r => r.ok && !r.jaExistia).length,
    jaExistiam: resultados.filter(r => r.jaExistia).length,
    falhas: resultados.filter(r => !r.ok).length,
  }
}
