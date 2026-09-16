import crypto from 'crypto'

// Assinatura HMAC-SHA256 exigida pela TikTok Shop Partner API — documentada
// em partner.tiktokshop.com/docv2/page/sign-your-api-request. Diferente da
// Shopee: aqui o app_secret embrulha a string dos dois lados
// (secret + input + secret) antes do HMAC, não só como chave.
//
// Passos (iguais para toda chamada, GET ou POST):
// 1. pega os parâmetros da query, tira `sign` e `access_token`, ordena por
//    nome em ordem alfabética;
// 2. concatena cada um como `{chave}{valor}` (sem separador);
// 3. prefixa com o path da API (sem domínio, sem query string);
// 4. se o corpo não for multipart/form-data, anexa o corpo EXATO que será
//    enviado (mesmos bytes — reserializar o JSON pode mudar a assinatura);
// 5. embrulha com o app_secret nos dois lados;
// 6. HMAC-SHA256 com o app_secret como chave, saída em hex.
export function sign(params: {
  path: string
  query: Record<string, string | number>
  body?: string
  appSecret: string
}): string {
  const { path, query, body, appSecret } = params

  const chaves = Object.keys(query)
    .filter(k => k !== 'sign' && k !== 'access_token')
    .sort()

  const paramString = chaves.map(k => `${k}${query[k]}`).join('')
  let input = `${path}${paramString}`
  if (body) input += body
  input = `${appSecret}${input}${appSecret}`

  return crypto.createHmac('sha256', appSecret).update(input).digest('hex')
}
