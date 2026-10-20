// MODELOS DE ACESSO — um clique em vez de marcar dezenas de telas.
//
// Liberar o sistema web para um funcionário significava desmarcar, uma a
// uma, as ~70 telas que ele não usa (o vendedor tinha 66 marcadas à mão).
// O modelo faz isso de uma vez: libera as telas do perfil, bloqueia as
// demais e liga as ações de que essas telas precisam. É só um ponto de
// partida: aplicado na janela de Permissões, o gestor ainda ajusta e salva.

import { codigoDaTela, type PermissaoCodigo } from './permissoesBase'

export type ModeloAcesso = {
  id: string
  nome: string
  icone: string
  descricao: string
  /** Telas liberadas; toda outra tela do menu fica bloqueada. */
  telas: string[]
  /** Ações ligadas ou desligadas além do que o papel já dá. */
  acoes: Partial<Record<PermissaoCodigo, boolean>>
}

export const MODELOS_ACESSO: ModeloAcesso[] = [
  {
    id: 'vendedor',
    nome: 'Vendedor',
    icone: '🛍️',
    descricao: 'Início do vendedor, WhatsApp, orçamentos, anúncios, pedidos da internet, atendimento do Mercado Livre e da Shopee, produtos, clientes e PDV.',
    telas: [
      '/dashboard/inicio',
      '/pdv',
      '/dashboard/integracoes/whatsapp/conversas',
      '/dashboard/integracoes/whatsapp/contatos',
      '/dashboard/orcamentos',
      '/dashboard/marketplaces/anuncios',
      '/dashboard/pedidos-ecommerce',
      '/dashboard/atendimento-ml',
      '/dashboard/atendimento-shopee',
      '/dashboard/produtos',
      '/dashboard/clientes',
    ],
    // Responder no WhatsApp, mexer em anúncio e despachar pedido passam por
    // estas duas permissões no servidor; sem elas os botões das telas
    // liberadas dariam "sem permissão".
    acoes: { gerenciar_whatsapp: true, gerenciar_marketplaces: true, realizar_vendas: true },
  },
]

/**
 * Os valores da janela de Permissões depois de aplicar o modelo. `telasDoMenu`
 * são todas as telas que a janela mostra; o resto dos valores é preservado.
 */
export function aplicarModelo(
  valores: Record<string, boolean>, modelo: ModeloAcesso, telasDoMenu: string[],
): Record<string, boolean> {
  const novo = { ...valores }
  const liberadas = new Set(modelo.telas)
  for (const href of telasDoMenu) novo[codigoDaTela(href)] = liberadas.has(href)
  for (const [codigo, ligado] of Object.entries(modelo.acoes)) novo[codigo] = !!ligado
  return novo
}
