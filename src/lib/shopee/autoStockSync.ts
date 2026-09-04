import { pushPrecoEstoque, unlistItems } from './write'
import { calcularKit } from '@/lib/produtos/kit'
import { buscarConfigUnificacao, estoqueUnificadoDeProdutos } from '@/lib/produtos/estoqueUnificado'
import { calcularPrecoEstoquePorRegra, type RegraCalculo } from './aplicarRegra'
import type { ShopeeChannel } from './types'

// Sincronização automática de estoque (item "Atualizar estoque do canal com
// estoque do sistema" em Configurar → canal). Roda como parte do cron
// diário — por canal, varre os anúncios simples (sem variação, mapeados a
// um produto) e:
//   - se aplicarRegraProduto e o anúncio tiver uma regra associada, calcula
//     preço/estoque por ela (mesma matemática do envio manual em massa);
//   - senão, só espelha o estoque do produto vinculado 1:1, sem mexer no
//     preço.
// Teto por rodada — cada anúncio custa 1-2 chamadas sequenciais à Shopee
// (sem lote, diferente do catálogo), catálogos grandes ficam parciais numa
// execução e completam nas próximas rodadas do cron.
const MAX_ITEMS_POR_RODADA = 200

export type ResultadoAutoStock = { processados: number; enviados: number; falhas: number; pausados: number }

export async function sincronizarEstoqueAutomatico(
  sb: any,
  canal: ShopeeChannel,
  opts: { aplicarRegraProduto: boolean }
): Promise<ResultadoAutoStock> {
  const { data: anuncios } = await sb
    .from('marketplace_anuncios')
    .select('id, id_externo, preco_venda, estoque_reservado, regra_id, produtos(id, preco_venda, preco_custo, estoque, tipo)')
    .eq('canal_id', canal.id)
    .eq('empresa_id', canal.empresaId)
    .eq('tem_variacao', false)
    .not('produto_id', 'is', null)
    .not('id_externo', 'is', null)
    .limit(MAX_ITEMS_POR_RODADA)

  let processados = 0, enviados = 0, falhas = 0, pausados = 0
  // Estoque unificado do grupo: quando ligado, o número que vai para o canal
  // é a soma das empresas participantes, não só o desta empresa. Resolvido de
  // uma vez para todos os produtos da rodada — não uma consulta por anúncio.
  const cfgUnif = await buscarConfigUnificacao(sb, canal.empresaId)
  const idsProdutos = Array.from(new Set<string>(
    (anuncios ?? []).map((a: any) => a.produtos?.id).filter(Boolean),
  ))
  const mapaUnificado = await estoqueUnificadoDeProdutos(sb, canal.empresaId, idsProdutos, cfgUnif)

  const idsParaPausar: string[] = []

  for (const a of anuncios ?? []) {
    const produto = a.produtos as any
    if (!produto) continue
    processados++

    let precoNovo: number | undefined
    let estoqueNovo: number | undefined
    let paraPausar = false

    if (opts.aplicarRegraProduto && a.regra_id) {
      const { data: regra } = await sb.from('marketplace_regras_preco').select('*').eq('id', a.regra_id).maybeSingle()
      if (regra) {
        let kitInfo: { custo: number; estoque: number } | undefined
        if (produto.tipo === 'kit') {
          const resultadoKit = await calcularKit(sb, produto.id, regra.modo_estoque === 'deposito' ? regra.deposito_id : null)
          if (resultadoKit) kitInfo = resultadoKit
        }
        let estoquePorDeposito: number | undefined
        if (!kitInfo && regra.modo_estoque === 'deposito' && regra.deposito_id) {
          const { data: pe } = await sb.from('produto_estoque').select('quantidade')
            .eq('deposito_id', regra.deposito_id).eq('produto_id', produto.id).maybeSingle()
          estoquePorDeposito = pe?.quantidade ?? 0
        }

        const resultado = calcularPrecoEstoquePorRegra(regra as RegraCalculo, { preco_venda: a.preco_venda, produtos: produto }, { estoquePorDeposito, kitInfo })
        if (resultado.aplicavel) {
          precoNovo = resultado.precoNovo
          estoqueNovo = resultado.estoqueNovo
          paraPausar = resultado.paraPausar
        }
      }
    }

    // Kit tem estoque próprio (montável pelos componentes) e não entra na
    // unificação — somar kit de duas empresas contaria o mesmo componente
    // duas vezes.
    if (estoqueNovo === undefined) {
      estoqueNovo = (produto.tipo !== 'kit' && mapaUnificado?.has(produto.id))
        ? mapaUnificado.get(produto.id)!
        : (produto.estoque ?? 0)
    }

    // GRAVA DEPOIS DO ENVIO, E NA COLUNA CERTA.
    //
    // Isto gravava ANTES de enviar, e gravava em `estoque_reservado` — que é
    // a coluna onde a sincronização de catálogo guarda o número que a
    // PLATAFORMA devolveu. Duas coisas erradas de uma vez:
    //
    //   escrever antes    o envio podia falhar logo em seguida e o registro
    //                     ficava dizendo que o canal tinha um número que ele
    //                     nunca recebeu. Nada revertia.
    //
    //   coluna errada     `estoque_reservado` é MEDIDA. Escrever nela o que
    //                     pretendemos mandar apaga a única resposta que a
    //                     plataforma nos deu, e com ela a chance de perceber
    //                     que o envio não valeu (ver `precisaEnviar`).
    //
    // O espelho do que MANDAMOS é `estoque_externo`, que é o que a fila usa.
    let ok = false
    try {
      const resultadoPush = await pushPrecoEstoque({ sb, canal }, Number(a.id_externo), [{ preco: precoNovo, estoque: estoqueNovo }])
      ok = resultadoPush.estoqueOk && (precoNovo === undefined || resultadoPush.precoOk)
      if (ok) enviados++
      else falhas++
    } catch {
      falhas++
    }

    if (ok) {
      const updates: Record<string, any> = { updated_at: new Date().toISOString(), estoque_externo: estoqueNovo }
      if (precoNovo !== undefined) updates.preco_venda = precoNovo
      await sb.from('marketplace_anuncios').update(updates).eq('id', a.id)
    }

    if (paraPausar) { idsParaPausar.push(a.id); pausados++ }
  }

  if (idsParaPausar.length > 0) {
    const { data: pausarRows } = await sb.from('marketplace_anuncios').select('id, id_externo').in('id', idsParaPausar)
    const idsExternos = (pausarRows ?? []).map((r: any) => Number(r.id_externo)).filter(Boolean)
    if (idsExternos.length > 0) {
      await unlistItems({ sb, canal }, idsExternos, true)
      await sb.from('marketplace_anuncios').update({ status: 'pausado' }).in('id', idsParaPausar)
    }
  }

  return { processados, enviados, falhas, pausados }
}
