// ETIQUETA PRÉ-BAIXADA.
//
// Alguns canais só liberam a etiqueta um tempo depois da nota (ou do envio
// organizado). Em vez de o operador clicar "Imprimir" e esperar cada canal
// responder — ou receber "ainda não disponível" —, um robô passa a cada 10
// minutos, baixa a etiqueta assim que ela existe e guarda no sistema. Na
// hora de imprimir, as etiquetas já estão aqui: sai na hora.
//
// Guardada CRUA (como o canal mandou) — o recorte e o mini pedido são feitos
// na impressão, então mudar o formato não exige baixar de novo.

import { buscarEtiquetaDoPedido, EtiquetaJaUsada } from './buscar'
import { registrarImpressao } from '@/lib/pedidos/impressao'

export const BUCKET_ETIQUETAS = 'etiquetas-envio'

export function caminhoEtiquetaDoPedido(empresaId: string, pedidoId: string): string {
  return `pedidos/${empresaId}/${pedidoId}.pdf`
}

/** Colunas que o pré-download precisa do pedido e do canal. */
export const COLUNAS_PRE_BAIXAR = [
  'id, empresa_id, canal_id, id_externo, numero_pedido, dados_brutos',
  'marketplace_canais(id, nome, plataforma, empresa_id, seller_id, shop_cipher, access_token, refresh_token, token_expira_em)',
].join(', ')

export type ResultadoPreBaixar = 'baixada' | 'ja_usada' | 'indisponivel'

/**
 * Tenta baixar e guardar a etiqueta de UM pedido. `admin` é o cliente com
 * service role: o bucket não tem regra de acesso para o navegador.
 */
export async function preBaixarEtiqueta(admin: any, pedido: any): Promise<{ resultado: ResultadoPreBaixar; erro?: string }> {
  const agora = new Date().toISOString()
  try {
    const pdf = await buscarEtiquetaDoPedido(admin, pedido.marketplace_canais, pedido)
    const caminho = caminhoEtiquetaDoPedido(pedido.empresa_id, pedido.id)
    const { error } = await admin.storage.from(BUCKET_ETIQUETAS).upload(caminho, pdf, { contentType: 'application/pdf', upsert: true })
    if (error) throw new Error(`Falha ao guardar a etiqueta: ${error.message}`)
    await admin.from('marketplace_pedidos').update({
      etiqueta_arquivo: caminho, etiqueta_baixada_em: agora, etiqueta_erro: null, etiqueta_tentativa_em: agora,
    }).eq('id', pedido.id)
    return { resultado: 'baixada' }
  } catch (e: any) {
    if (e instanceof EtiquetaJaUsada) {
      // O pacote já saiu: tira o pedido de "Imprimir etiqueta".
      await registrarImpressao(admin, {
        empresaId: pedido.empresa_id, ids: [pedido.id], impresso: true,
        usuarioNome: 'Sistema', origem: 'Canal informou que o pacote já foi coletado (etiqueta usada fora do sistema)',
      }).catch(() => {})
      await admin.from('marketplace_pedidos').update({ etiqueta_erro: null, etiqueta_tentativa_em: agora }).eq('id', pedido.id)
      return { resultado: 'ja_usada' }
    }
    const erro = String(e?.message ?? 'Etiqueta ainda não disponível').slice(0, 300)
    await admin.from('marketplace_pedidos').update({ etiqueta_erro: erro, etiqueta_tentativa_em: agora }).eq('id', pedido.id)
    return { resultado: 'indisponivel', erro }
  }
}

/** PDF já guardado do pedido, ou null se não houver. */
export async function etiquetaGuardada(admin: any, caminho: string | null | undefined): Promise<Uint8Array | null> {
  if (!caminho) return null
  const { data, error } = await admin.storage.from(BUCKET_ETIQUETAS).download(caminho)
  if (error || !data) return null
  return new Uint8Array(await data.arrayBuffer())
}
