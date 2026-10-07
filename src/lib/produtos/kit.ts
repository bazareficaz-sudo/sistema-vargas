// Cálculo ao vivo de custo/estoque de um kit a partir dos componentes
// (kit_itens). Hoje esses valores só são gravados uma vez na criação do kit
// (CriarKitModal.tsx) e nunca recalculados ao editar a composição — isso
// deixa o preço/estoque do kit obsoleto. Este helper é usado tanto pelo
// botão "Recalcular" no EditarProdutoModal quanto antes de enviar preço/
// estoque de kits para a Shopee.

// `custoConfiavel` = false quando a soma não representa o custo do kit: um
// componente sem custo (a soma sairia parcial ou zero), componente apagado,
// ou quantidade absurda na composição (0,0002 por engano). Nesses casos o
// custo que já estava gravado vale mais que o calculado — ver
// `recalcularKitsQueUsam` e `custo_do_kit()` no banco (mesma regra).
export type ResultadoKit = { custo: number; estoque: number; custoConfiavel: boolean }

// Quantidade de componente abaixo disso é erro de cadastro, não receita.
export const QTD_MINIMA_COMPONENTE = 0.01

export async function calcularKit(
  sb: any,
  produtoId: string,
  depositoId?: string | null
): Promise<ResultadoKit | null> {
  const { data: itens } = await sb
    .from('kit_itens')
    .select('produto_id, quantidade, controla_estoque')
    .eq('kit_id', produtoId)

  if (!itens || itens.length === 0) return null

  const componenteIds = itens.map((i: any) => i.produto_id)
  const { data: componentes } = await sb
    .from('produtos')
    .select('id, preco_custo, estoque')
    .in('id', componenteIds)

  const estoquePorComponente = new Map<string, number>(
    (componentes ?? []).map((c: any) => [c.id, c.estoque ?? 0])
  )

  if (depositoId) {
    const { data: porDeposito } = await sb
      .from('produto_estoque')
      .select('produto_id, quantidade')
      .eq('deposito_id', depositoId)
      .in('produto_id', componenteIds)
    for (const row of porDeposito ?? []) {
      estoquePorComponente.set(row.produto_id, row.quantidade)
    }
  }

  let custo = 0
  let custoConfiavel = true
  let estoqueMinimo = Infinity
  for (const item of itens) {
    const componente = (componentes ?? []).find((c: any) => c.id === item.produto_id)
    if (!componente) { custoConfiavel = false; continue }
    if (!((componente.preco_custo ?? 0) > 0) || !(item.quantidade >= QTD_MINIMA_COMPONENTE)) custoConfiavel = false
    custo += (componente.preco_custo ?? 0) * item.quantidade
    // Componente marcado como "não controlar estoque" (ex: parafusos,
    // buchas) nunca limita quantos kits dá pra montar — trata como se
    // tivesse estoque infinito, só não entra no min().
    if (item.controla_estoque === false) continue
    const estoqueComponente = estoquePorComponente.get(item.produto_id) ?? 0
    estoqueMinimo = Math.min(estoqueMinimo, Math.floor(estoqueComponente / item.quantidade))
  }

  return { custo, estoque: estoqueMinimo === Infinity ? 0 : Math.max(0, estoqueMinimo), custoConfiavel }
}

// Quando um componente muda de custo/estoque (salvo como produto normal),
// os kits que o usam ficam desatualizados até alguém abrir e recalcular
// manualmente. Isso propaga o recálculo pra todos os kits que usam esse
// componente, gravando direto em `produtos`.
//
// Três cuidados, todos aprendidos com kit errado na listagem:
//
//  1. ESTOQUE E CUSTO EM GRAVAÇÕES SEPARADAS. Antes iam num UPDATE só; o
//     gatilho de permissão do banco recusa mudar `preco_custo` sem
//     `editar_produtos`, e a recusa levava junto o estoque — operador que só
//     mexe em estoque deixava o kit sem atualizar nenhum dos dois, em silêncio.
//  2. O ERRO NÃO É MAIS ENGOLIDO. Era ignorado; agora vai para o console.
//  3. CUSTO NÃO CONFIÁVEL NÃO SOBRESCREVE. Componente sem custo, apagado ou
//     com quantidade absurda dá uma soma que não é o custo do kit — o valor
//     gravado, que alguém pode ter digitado da nota, vale mais.
//
// E só grava o que mudou: cada UPDATE em `produtos` enfileira o item para o
// marketplace, e reescrever número igual seria trabalho à toa.
export async function recalcularKitsQueUsam(sb: any, componenteId: string): Promise<void> {
  const { data: itens } = await sb
    .from('kit_itens')
    .select('kit_id')
    .eq('produto_id', componenteId)

  const kitIds = Array.from(new Set<string>((itens ?? []).map((i: any) => String(i.kit_id))))
  if (kitIds.length === 0) return

  const { data: atuais } = await sb.from('produtos').select('id, estoque, preco_custo').in('id', kitIds)
  const gravado = new Map<string, { estoque: number | null; preco_custo: number | null }>(
    (atuais ?? []).map((k: any) => [k.id, k]),
  )

  for (const kitId of kitIds) {
    const resultado = await calcularKit(sb, kitId)
    if (!resultado) continue
    const atual = gravado.get(kitId)
    const agora = new Date().toISOString()

    if (Number(atual?.estoque ?? NaN) !== resultado.estoque) {
      const { error } = await sb.from('produtos').update({ estoque: resultado.estoque, updated_at: agora }).eq('id', kitId)
      if (error) console.error(`[kit] estoque do kit ${kitId} não atualizado:`, error.message)
    }

    const custo = Math.round(resultado.custo * 100) / 100
    if (resultado.custoConfiavel && Number(atual?.preco_custo ?? NaN) !== custo) {
      const { error } = await sb.from('produtos').update({ preco_custo: custo, updated_at: agora }).eq('id', kitId)
      if (error) console.error(`[kit] custo do kit ${kitId} não atualizado:`, error.message)
    }
  }
}

export type KitReprecificado = {
  kitId: string
  nome: string
  precoAntes: number
  precoDepois: number
}

// Mudou o PREÇO DE VENDA de um componente — os kits que o usam ficam com um
// preço que não corresponde mais ao que está dentro deles.
//
// A regra não é "somar os componentes de novo e sobrescrever". Kit quase
// sempre é vendido com desconto sobre a soma das peças — é essa a razão de
// existir do kit. Sobrescrever pela soma apagaria essa decisão comercial e o
// operador só descobriria pela reclamação do cliente.
//
// O que se preserva é a RELAÇÃO: um kit que valia 10% menos que a soma das
// peças continua valendo 10% menos depois do reajuste. Um kit que era
// exatamente a soma continua exatamente a soma (o fator dá 1).
//
// Devolve o que mudou, para a tela poder dizer quais kits foram mexidos em
// vez de alterar preço em silêncio.
export async function reprecificarKitsQueUsam(
  sb: any,
  componenteId: string,
  precoAntigoComponente: number,
): Promise<KitReprecificado[]> {
  const { data: ondeEntra } = await sb
    .from('kit_itens')
    .select('kit_id, quantidade')
    .eq('produto_id', componenteId)
  if (!ondeEntra || ondeEntra.length === 0) return []

  const { data: comp } = await sb.from('produtos')
    .select('preco_venda').eq('id', componenteId).maybeSingle()
  const precoNovoComponente = Number(comp?.preco_venda ?? 0)
  const variacao = precoNovoComponente - Number(precoAntigoComponente ?? 0)
  if (variacao === 0) return []

  const alterados: KitReprecificado[] = []

  for (const entrada of ondeEntra) {
    const kitId = String(entrada.kit_id)
    const qtdNoKit = Number(entrada.quantidade ?? 0)

    const { data: kit } = await sb.from('produtos')
      .select('id, nome, preco_venda, preco_custo, tipo').eq('id', kitId).maybeSingle()
    if (!kit) continue

    const { data: itens } = await sb.from('kit_itens')
      .select('produto_id, quantidade').eq('kit_id', kitId)
    if (!itens || itens.length === 0) continue

    const { data: componentes } = await sb.from('produtos')
      .select('id, preco_venda').in('id', itens.map((i: any) => i.produto_id))
    const precoDe = new Map<string, number>((componentes ?? []).map((c: any) => [c.id, Number(c.preco_venda ?? 0)]))

    const somaDepois = itens.reduce(
      (s: number, i: any) => s + (precoDe.get(i.produto_id) ?? 0) * Number(i.quantidade ?? 0), 0)
    // A soma de antes sai da de agora, desfazendo só a variação deste
    // componente — evita depender de um retrato do preço anterior de todos.
    const somaAntes = somaDepois - variacao * qtdNoKit

    const precoAntes = Number(kit.preco_venda ?? 0)
    const fator = somaAntes > 0 && precoAntes > 0 ? precoAntes / somaAntes : 1
    const precoDepois = Math.max(0, Number((somaDepois * fator).toFixed(2)))
    if (precoDepois === precoAntes) continue

    const custo = Number(kit.preco_custo ?? 0)
    await sb.from('produtos').update({
      preco_venda: precoDepois,
      markup: custo > 0 ? ((precoDepois / custo) - 1) * 100 : null,
      updated_at: new Date().toISOString(),
      preco_atualizado_em: new Date().toISOString(),
    }).eq('id', kitId)

    alterados.push({ kitId, nome: kit.nome ?? 'Kit', precoAntes, precoDepois })
  }

  return alterados
}
