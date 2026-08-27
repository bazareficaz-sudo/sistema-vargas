import { calcularKit } from '@/lib/produtos/kit'

// Qual estoque do ERP vai para o canal.
//
// Existe como arquivo próprio porque DOIS caminhos precisam do mesmo número:
// a fila automática (`fila.ts`) e o botão "Enviar estoque" no cadastro do
// produto. Enquanto cada um calculava o seu, os dois podiam mandar valores
// diferentes para o mesmo anúncio — e quem visse a divergência não teria como
// saber qual dos dois estava certo.
//
// O QUE NÃO ENTRA NA CONTA: `marketplace_anuncios.estoque_reservado`.
//
// A fila subtraía essa coluna, tratando-a como "reserva que não vai para o
// canal". Só que os dois sincronizadores (`mercadolivre/sync.ts` e
// `shopee/sync.ts`) GRAVAM nela o estoque atual da plataforma a cada rodada —
// medido em 26/08/2026: 8.852 dos 9.231 anúncios com `estoque_reservado`
// igual a `estoque_externo`, e 5.009 com valor maior que zero.
//
// A subtração, portanto, não calculava "sistema menos reserva": calculava
// "sistema menos o estoque que a plataforma já tem". Ligar o envio real com
// essa conta zeraria a maior parte dos anúncios no ar. Reserva por canal
// continua sendo uma ideia válida — mas precisa de uma coluna que os syncs
// não sobrescrevam, e aí volta por aqui.

export type ProdutoParaEnvio = {
  id: string
  estoque: number | null
  tipo: string | null
}

export type EstoqueCalculado = {
  estoque: number
  /** Como o número foi obtido — vai para o log e para a tela, porque
   *  "por que o canal recebeu 3?" é a pergunta seguinte, sempre. */
  origem: string
  /** Custo e estoque do kit, quando é kit. Devolvido junto para a regra de
   *  preço não ter de recalcular a composição numa segunda passada. */
  kitInfo?: { custo: number; estoque: number }
}

/**
 * @param mapaUnificado estoque unificado do grupo, quando o recurso está
 *   ligado. A fila resolve isso em lote para a rodada inteira; quem trata um
 *   produto só passa o mapa de um item (ou `null`, e cai no estoque próprio).
 */
export async function estoqueDoSistema(
  sb: any,
  produto: ProdutoParaEnvio,
  mapaUnificado?: Map<string, number> | null,
): Promise<EstoqueCalculado> {
  // Kit tem precedência sobre o unificado: o estoque dele é derivado dos
  // componentes, e o campo `produtos.estoque` de um kit é um valor gravado
  // uma vez na criação, que envelhece assim que a composição muda.
  if (produto.tipo === 'kit') {
    const k = await calcularKit(sb, produto.id, null)
    if (k) return { estoque: Math.max(0, k.estoque), origem: 'kit, calculado pelos componentes', kitInfo: k }
  }

  const unificado = mapaUnificado?.get(produto.id)
  if (typeof unificado === 'number') {
    return { estoque: Math.max(0, unificado), origem: 'estoque unificado do grupo' }
  }

  return { estoque: Math.max(0, Number(produto.estoque ?? 0)), origem: 'estoque do sistema' }
}
