// Localização para o frete: CEP → endereço → coordenadas → distância.
//
// Só usa serviços públicos e gratuitos, chamados DO SERVIDOR (o navegador do
// cliente nunca fala com eles, e nenhum deles recebe dado do pedido além do
// CEP e do logradouro):
//
//   1. BrasilAPI (CEP v2) — devolve endereço e, para muitos CEPs, a coordenada;
//   2. ViaCEP — se a BrasilAPI falhar, ao menos o endereço;
//   3. Nominatim (OpenStreetMap) — quando o CEP veio sem coordenada.
//
// Toda consulta tem prazo curto e FALHA PARA `null`: sem coordenada o motor de
// frete responde "a combinar", e o pedido segue. Frete nunca derruba a compra.
//
// As respostas são cacheadas pelo Next por 30 dias (endereço de CEP quase não
// muda) — isso também mantém o uso do Nominatim muito abaixo do limite de 1
// consulta por segundo da política deles.

export type EnderecoLocalizado = {
  cep: string
  logradouro: string
  bairro: string
  cidade: string
  uf: string
  lat: number | null
  lng: number | null
}

const PRAZO_MS = 4000
const CACHE_S = 60 * 60 * 24 * 30

/** O Nominatim exige um User-Agent que identifique quem chama. */
const USER_AGENT = `LojaOnlineVargas/1.0 (${process.env.NEXT_PUBLIC_LOJA_DOMINIO_RAIZ || 'sistemavargas.com.br'})`

const soDigitos = (v: string) => v.replace(/\D/g, '')

/** Território brasileiro, com folga. Coordenada fora disso é erro de geocodificação. */
function dentroDoBrasil(lat: number, lng: number): boolean {
  return lat >= -34 && lat <= 6 && lng >= -74 && lng <= -33
}

async function buscarJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(PRAZO_MS),
      next: { revalidate: CACHE_S },
    })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

function coordenada(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const la = Number(lat), ln = Number(lng)
  if (!Number.isFinite(la) || !Number.isFinite(ln) || (la === 0 && ln === 0)) return null
  return dentroDoBrasil(la, ln) ? { lat: la, lng: ln } : null
}

async function geocodificarEndereco(
  e: { logradouro?: string; bairro?: string; cidade: string; uf: string },
): Promise<{ lat: number; lng: number } | null> {
  const consulta = (extra: Record<string, string>) =>
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&${new URLSearchParams(extra)}`

  // Da busca mais precisa para a mais ampla: rua → bairro → cidade.
  const tentativas: Record<string, string>[] = []
  if (e.logradouro) tentativas.push({ street: e.logradouro, city: e.cidade, state: e.uf })
  if (e.bairro) tentativas.push({ q: `${e.bairro}, ${e.cidade}, ${e.uf}` })
  tentativas.push({ city: e.cidade, state: e.uf })

  for (const t of tentativas) {
    const r = await buscarJson(consulta(t))
    const c = Array.isArray(r) && r[0] ? coordenada(r[0].lat, r[0].lon) : null
    if (c) return c
  }
  return null
}

/** CEP → endereço e coordenadas. `null` se o CEP não existe ou nada respondeu. */
export async function localizarCep(cepBruto: string): Promise<EnderecoLocalizado | null> {
  const cep = soDigitos(cepBruto)
  if (cep.length !== 8) return null

  let end: Omit<EnderecoLocalizado, 'lat' | 'lng'> | null = null
  let coord: { lat: number; lng: number } | null = null

  const b = await buscarJson(`https://brasilapi.com.br/api/cep/v2/${cep}`)
  if (b && b.city) {
    end = {
      cep, logradouro: b.street ?? '', bairro: b.neighborhood ?? '',
      cidade: b.city ?? '', uf: b.state ?? '',
    }
    const c = b.location?.coordinates
    coord = c ? coordenada(c.latitude, c.longitude) : null
  } else {
    const v = await buscarJson(`https://viacep.com.br/ws/${cep}/json/`)
    if (v && !v.erro && v.localidade) {
      end = {
        cep, logradouro: v.logradouro ?? '', bairro: v.bairro ?? '',
        cidade: v.localidade ?? '', uf: v.uf ?? '',
      }
    }
  }
  if (!end) return null

  if (!coord) coord = await geocodificarEndereco(end)
  return { ...end, lat: coord?.lat ?? null, lng: coord?.lng ?? null }
}

/** Coordenada de um endereço já conhecido (usado para achar a origem da loja). */
export async function localizarEndereco(
  e: { cep?: string | null; logradouro?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null },
): Promise<{ lat: number; lng: number } | null> {
  if (e.cep && soDigitos(e.cep).length === 8) {
    const r = await localizarCep(e.cep)
    if (r?.lat != null && r.lng != null) return { lat: r.lat, lng: r.lng }
  }
  if (!e.cidade || !e.uf) return null
  return geocodificarEndereco({
    logradouro: e.logradouro ?? undefined, bairro: e.bairro ?? undefined,
    cidade: e.cidade, uf: e.uf,
  })
}

/** Distância em linha reta (haversine), em km. */
export function distanciaRetaKm(
  a: { lat: number; lng: number }, b: { lat: number; lng: number },
): number {
  const rad = (g: number) => (g * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}
