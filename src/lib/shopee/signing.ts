import crypto from 'crypto'

// Assinatura HMAC-SHA256 exigida pela Shopee Open Platform v2.
// Extraído de auth-url/route.ts e callback/route.ts (lógica idêntica,
// centralizada aqui para evitar divergência entre os pontos de chamada).

export function signRequest(partnerKey: string, baseString: string): string {
  return crypto.createHmac('sha256', partnerKey).update(baseString).digest('hex')
}

// Chamadas sem token de acesso (autorização de loja, troca de código por token).
export function buildPublicBaseString(partnerId: number, path: string, timestamp: number): string {
  return `${partnerId}${path}${timestamp}`
}

// Chamadas autenticadas em nome de uma loja (get_shop_info, get_item_list,
// get_item_base_info, get_model_list, refresh de token).
export function buildShopBaseString(
  partnerId: number,
  path: string,
  timestamp: number,
  accessToken: string,
  shopId: string | number
): string {
  return `${partnerId}${path}${timestamp}${accessToken}${shopId}`
}
