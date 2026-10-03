// DESTINATÁRIO DA NF-e — quem comprou, no formato que a nota exige.
//
// A NFC-e de balcão pode sair sem destinatário. A NF-e (modelo 55) não: exige
// CPF/CNPJ e endereço completo, e é a UF desse endereço que decide se a venda
// é dentro do estado ou interestadual (e, com isso, o CFOP e o DIFAL).
//
// Cada marketplace entrega isso de um jeito, e nenhum no lugar óbvio:
//
//   · TikTok: CPF em `cpf`/`cpf_name` e endereço em `recipient_address`, com
//     as linhas em posições fixas (bairro, rua, número, complemento) e
//     cidade/UF em `district_info`. Vem completo na sincronização.
//   · Shopee: CPF em `buyer_cpf_id` — só vem se for pedido explicitamente em
//     `response_optional_fields`. O endereço do pedido vem MASCARADO ("****")
//     para o nosso app, inclusive em pedido pronto para envio.
//   · Mercado Livre: nada disso no pedido; vem de uma chamada própria
//     (billing_info), que pode vir em dois formatos conforme a versão.
//
// Este arquivo só INTERPRETA o que chegou. Buscar é com cada integração.
// Nada aqui inventa dado: campo ausente ou mascarado vira pendência com nome,
// para a tela dizer o que falta em vez de a SEFAZ devolver uma rejeição.

export type EnderecoFiscal = {
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cep: string | null
  municipio: string | null
  uf: string | null
}

export type DestinatarioFiscal = {
  nome: string | null
  cpfCnpj: string | null
  /** Inscrição estadual — só contribuinte tem. "ISENTO" não conta. */
  inscricaoEstadual: string | null
  endereco: EnderecoFiscal
  fonte: 'tiktok' | 'shopee' | 'mercadolivre'
}

const UF_POR_NOME: Record<string, string> = {
  'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM', 'bahia': 'BA', 'ceara': 'CE',
  'distrito federal': 'DF', 'espirito santo': 'ES', 'goias': 'GO', 'maranhao': 'MA', 'mato grosso': 'MT',
  'mato grosso do sul': 'MS', 'minas gerais': 'MG', 'para': 'PA', 'paraiba': 'PB', 'parana': 'PR',
  'pernambuco': 'PE', 'piaui': 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
  'rio grande do sul': 'RS', 'rondonia': 'RO', 'roraima': 'RR', 'santa catarina': 'SC',
  'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO',
}
const UFS = new Set(Object.values(UF_POR_NOME))

function texto(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s ? s : null
}

/** Valor mascarado pelo marketplace ("****", "A****b") não é dado — é ausência. */
function semMascara(v: unknown): string | null {
  const s = texto(v)
  return s && !s.includes('*') ? s : null
}

function soDigitos(v: unknown): string | null {
  const s = semMascara(v)
  if (!s) return null
  const d = s.replace(/\D/g, '')
  return d || null
}

/** "RJ", "BR-RJ", "Rio de Janeiro", "São Paulo" → sigla, ou null. */
export function ufDe(valor: unknown): string | null {
  const s = semMascara(valor)
  if (!s) return null
  const sigla = s.toUpperCase().replace(/^BR-/, '')
  if (UFS.has(sigla)) return sigla
  const nome = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  return UF_POR_NOME[nome] ?? null
}

function inscricao(v: unknown): string | null {
  const s = semMascara(v)
  return s && /\d/.test(s) ? s.replace(/[^\dA-Za-z]/g, '') : null
}

// ── TikTok ─────────────────────────────────────────────────────────────

/**
 * Pedido do TikTok Shop, como fica em `marketplace_pedidos.dados_brutos`.
 * No Brasil as linhas do endereço têm posição fixa — conferido em pedido real:
 * line1 = bairro, line2 = logradouro, line3 = número, line4 = complemento.
 */
export function destinatarioTiktok(raw: any): DestinatarioFiscal {
  const ra = raw?.recipient_address ?? {}
  const niveis: any[] = Array.isArray(ra.district_info) ? ra.district_info : []
  const nivel = (n: string) => niveis.find(x => x?.address_level === n)
  return {
    nome: semMascara(raw?.cpf_name) ?? semMascara(ra.name),
    cpfCnpj: soDigitos(raw?.cpf),
    inscricaoEstadual: null,
    endereco: {
      bairro: semMascara(ra.address_line1) ?? semMascara(nivel('L3')?.address_name),
      logradouro: semMascara(ra.address_line2),
      numero: semMascara(ra.address_line3),
      complemento: semMascara(ra.address_line4),
      cep: soDigitos(ra.postal_code),
      municipio: semMascara(nivel('L2')?.address_name),
      uf: ufDe(nivel('L1')?.iso_code ?? nivel('L1')?.address_name),
    },
    fonte: 'tiktok',
  }
}

// ── Shopee ─────────────────────────────────────────────────────────────

/**
 * Pedido da Shopee (`get_order_detail`). O endereço vem quebrado em
 * state/city/district/zipcode e o logradouro só no `full_address`, sem
 * separar número — por isso o número fica nulo e a nota sai "S/N" se o resto
 * estiver completo. Tudo isso só vale se a Shopee não mascarar.
 */
export function destinatarioShopee(raw: any): DestinatarioFiscal {
  const ra = raw?.recipient_address ?? {}
  return {
    nome: semMascara(ra.name),
    cpfCnpj: soDigitos(raw?.buyer_cpf_id),
    inscricaoEstadual: null,
    endereco: {
      logradouro: semMascara(ra.full_address),
      numero: null,
      complemento: null,
      bairro: semMascara(ra.district) ?? semMascara(ra.town),
      cep: soDigitos(ra.zipcode),
      municipio: semMascara(ra.city),
      uf: ufDe(ra.state),
    },
    fonte: 'shopee',
  }
}

// ── Mercado Livre ──────────────────────────────────────────────────────

/**
 * Resposta de billing_info do Mercado Livre. Aceita os dois formatos:
 *
 *   · atual (x-version 2 e /orders/billing-info/MLB/{id}):
 *     buyer.billing_info { name, last_name, identification{type,number},
 *     address{street_name, street_number, city_name, state{code|name},
 *     zip_code, neighborhood, comment}, taxes.inscriptions.state_registration }
 *   · antigo: billing_info { doc_type, doc_number,
 *     additional_info: [{ type: 'STREET_NAME', value }, ...] }
 */
export function destinatarioMercadoLivre(resp: any): DestinatarioFiscal {
  const bi = resp?.buyer?.billing_info ?? resp?.billing_info ?? resp ?? {}
  const extra: Record<string, string> = {}
  for (const a of Array.isArray(bi.additional_info) ? bi.additional_info : []) {
    if (a?.type) extra[String(a.type).toUpperCase()] = a.value
  }
  const ad = bi.address ?? {}
  const nomeCompleto = [texto(bi.name) ?? texto(extra.FIRST_NAME), texto(bi.last_name) ?? texto(extra.LAST_NAME)]
    .filter(Boolean).join(' ')
  return {
    nome: texto(extra.BUSINESS_NAME) ?? (nomeCompleto || null),
    cpfCnpj: soDigitos(bi.identification?.number ?? bi.doc_number ?? extra.DOC_NUMBER),
    inscricaoEstadual: inscricao(bi.taxes?.inscriptions?.state_registration ?? extra.STATE_REGISTRATION),
    endereco: {
      logradouro: texto(ad.street_name ?? extra.STREET_NAME),
      numero: texto(ad.street_number ?? extra.STREET_NUMBER),
      complemento: texto(ad.comment ?? extra.COMMENT),
      bairro: texto(typeof ad.neighborhood === 'object' ? ad.neighborhood?.name : ad.neighborhood) ?? texto(extra.NEIGHBORHOOD),
      cep: soDigitos(ad.zip_code ?? extra.ZIP_CODE),
      municipio: texto(typeof ad.city === 'object' ? ad.city?.name : null) ?? texto(ad.city_name ?? extra.CITY_NAME),
      uf: ufDe(ad.state?.code ?? ad.state?.id) ?? ufDe(ad.state?.name ?? ad.state_name ?? extra.STATE_NAME),
    },
    fonte: 'mercadolivre',
  }
}

// ── Conferência ────────────────────────────────────────────────────────

/**
 * O que falta para este destinatário ir numa NF-e. Lista vazia = completo.
 * Número ausente NÃO é pendência: a nota aceita "S/N".
 */
export function pendenciasDestinatario(d: DestinatarioFiscal): string[] {
  const p: string[] = []
  const doc = d.cpfCnpj ?? ''
  if (doc.length !== 11 && doc.length !== 14) p.push('CPF/CNPJ do comprador')
  if (!d.nome) p.push('nome do comprador')
  const e = d.endereco
  if (!e.logradouro) p.push('logradouro')
  if (!e.bairro) p.push('bairro')
  if (!e.municipio) p.push('cidade')
  if (!e.uf) p.push('UF')
  if ((e.cep ?? '').length !== 8) p.push('CEP')
  return p
}

/** Frase de por que faltou, conforme o marketplace — o caminho para resolver muda. */
export function explicarPendencias(d: DestinatarioFiscal, pendencias: string[]): string {
  const lista = pendencias.join(', ')
  if (d.fonte === 'shopee') {
    return `A Shopee não enviou: ${lista}. O endereço do comprador chega mascarado ("****") para o app ` +
      `do sistema, inclusive em pedido pronto para envio. Isso costuma ser permissão de acesso a dados ` +
      `do comprador no app da Shopee Open Platform — depois de liberada, sincronize o pedido de novo.`
  }
  if (d.fonte === 'mercadolivre') {
    return `O Mercado Livre não informou: ${lista}. Confira se o comprador preencheu os dados de faturamento ` +
      `no pedido (o ML pede no checkout) e tente de novo.`
  }
  return `O TikTok não informou: ${lista}. Sincronize o pedido de novo; se persistir, o comprador não preencheu esses dados.`
}
