import { listarDescontos, buscarDesconto, type SituacaoDesconto } from '@/lib/shopee/discount'
import type { ShopeeChannel } from '@/lib/shopee/types'

// Traz as campanhas da Shopee para o espelho local.
//
// Mesma premissa de `marketplace_anuncios`: a plataforma é a verdade, aqui é
// cópia. Por isso o item da campanha é RECONCILIADO a cada rodada — quem saiu
// lá sai daqui —, senão o espelho vira um acumulado que só cresce e a tela
// mostra em campanha quem já não está.

export type ResultadoSyncPromocoes = {
  ok: boolean
  erro?: string
  campanhas: number
  itens: number
  itensSemAnuncio: number
  avisos: string[]
}

export async function sincronizarPromocoesShopee(
  sb: any, canal: ShopeeChannel, empresaId: string, canalId: string,
  situacao: SituacaoDesconto = 'all',
): Promise<ResultadoSyncPromocoes> {
  const avisos: string[] = []
  const ctx = { sb, canal }

  let resumos
  try {
    resumos = await listarDescontos(ctx, situacao)
  } catch (e: any) {
    return { ok: false, erro: e?.message ?? 'Erro ao listar campanhas na Shopee', campanhas: 0, itens: 0, itensSemAnuncio: 0, avisos }
  }

  if (resumos.length === 0) {
    return { ok: true, campanhas: 0, itens: 0, itensSemAnuncio: 0, avisos: ['A Shopee não devolveu campanha nenhuma para esta loja.'] }
  }

  // Um mapa id_externo → anúncio local, montado UMA vez para todas as
  // campanhas. Um item pode repetir entre campanhas, e consultar por item
  // seria uma ida ao banco por linha.
  const { data: anunciosLocais } = await sb
    .from('marketplace_anuncios')
    .select('id, id_externo')
    .eq('canal_id', canalId)
    .not('id_externo', 'is', null)
  const anuncioPorExterno = new Map<string, string>(
    (anunciosLocais ?? []).map((a: any) => [String(a.id_externo), a.id]))

  let totalItens = 0
  let semAnuncio = 0
  const agora = new Date().toISOString()

  for (const resumo of resumos) {
    let detalhe
    try {
      detalhe = await buscarDesconto(ctx, resumo.discountId)
    } catch (e: any) {
      // Uma campanha ilegível não invalida as outras: registra e segue. O
      // contrário faria uma campanha antiga e estranha impedir a leitura de
      // todas as ativas.
      avisos.push(`Campanha ${resumo.nome}: ${e?.message ?? 'não foi possível ler o detalhe'}`)
      continue
    }
    if (!detalhe) {
      avisos.push(`Campanha ${resumo.nome}: a Shopee não devolveu detalhe.`)
      continue
    }

    const { data: promo, error: erroPromo } = await sb
      .from('marketplace_promocoes')
      .upsert({
        empresa_id: empresaId,
        canal_id: canalId,
        id_externo: detalhe.discountId,
        nome: detalhe.nome,
        inicio: detalhe.inicio,
        fim: detalhe.fim,
        status: detalhe.status,
        sincronizado_em: agora,
        dados_brutos: detalhe.bruto,
      }, { onConflict: 'canal_id,id_externo' })
      .select('id')
      .single()

    if (erroPromo || !promo) {
      avisos.push(`Campanha ${detalhe.nome}: falha ao gravar (${erroPromo?.message ?? 'sem id de volta'})`)
      continue
    }

    const linhas = detalhe.itens.map(it => {
      const anuncioId = anuncioPorExterno.get(it.itemId) ?? null
      if (!anuncioId) semAnuncio++
      return {
        promocao_id: promo.id,
        anuncio_id: anuncioId,
        item_id_externo: it.itemId,
        item_nome: it.nome,
        model_id: it.modelId,
        preco_original: it.precoOriginal,
        preco_promocional: it.precoPromocional,
        limite_por_compra: it.limitePorCompra,
        estoque_promocao: it.estoquePromocao,
      }
    })

    // Reconciliação: apaga o que não veio desta vez e regrava o que veio.
    // Apagar antes de inserir, e não depois, porque um item que mudou de
    // variação mudaria de chave e as duas linhas conviveriam.
    const { error: erroLimpeza } = await sb
      .from('marketplace_promocao_itens').delete().eq('promocao_id', promo.id)
    if (erroLimpeza) {
      avisos.push(`Campanha ${detalhe.nome}: falha ao limpar itens antigos (${erroLimpeza.message})`)
      continue
    }

    if (linhas.length > 0) {
      const { error: erroItens } = await sb.from('marketplace_promocao_itens').insert(linhas)
      if (erroItens) {
        avisos.push(`Campanha ${detalhe.nome}: falha ao gravar itens (${erroItens.message})`)
        continue
      }
    }
    totalItens += linhas.length
  }

  if (semAnuncio > 0) {
    avisos.push(`${semAnuncio} item(ns) em campanha não têm anúncio correspondente no sistema — sincronize o catálogo deste canal para vinculá-los.`)
  }

  return { ok: true, campanhas: resumos.length, itens: totalItens, itensSemAnuncio: semAnuncio, avisos }
}
