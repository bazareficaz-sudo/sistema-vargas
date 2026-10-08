// BUSCA DE PRODUTO "COMO NO BALCÃO".
//
// Quem pergunta na rua não lembra o nome do cadastro nem o SKU. Caso real
// de 07/10/2026: "temos quantos disjuntores de 32a mono da Guepar?" não achou
// nada — a busca procurava a frase inteira, e o produto se chama "GUEPAR
// DISJUNTOR MONOPOLAR - 32A".
//
// Aqui a frase vira GRUPOS: cada palavra que importa, com os seus
// equivalentes (mono = monopolar = unipolar = 1P; "32 amperes" = 32A;
// "disjuntores" = disjuntor). O banco pontua um acerto por grupo achado no
// nome/marca sem acento (função buscar_produtos_inteligente); quem acerta
// todos vem primeiro, e quem acerta quase todos aparece como "parecido".

/** Palavras que não ajudam a achar produto. */
const PARADAS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'o', 'os', 'as', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'um', 'uma', 'uns', 'umas', 'com', 'para', 'pra', 'pro', 'por', 'que', 'qual', 'quais',
  'quanto', 'quantos', 'quanta', 'quantas', 'tem', 'temos', 'tenho', 'ha', 'estoque', 'saldo',
  'produto', 'produtos', 'me', 'diga', 'informe', 'sobre', 'ai', 'la', 'cade', 'ver', 'ainda',
  'unidade', 'unidades', 'peca', 'pecas', 'existe', 'existem', 'sistema', 'loja', 'voce', 'vc',
  'favor', 'ola', 'oi', 'getulio', 'consegue', 'olhar', 'verificar', 'veja',
  // Conversa em volta da pergunta, que chega junto quando a frase vem inteira.
  'entendi', 'ok', 'beleza', 'blz', 'bom', 'boa', 'dia', 'tarde', 'noite', 'preciso', 'quero', 'saber',
  'consultar', 'agora', 'mais', 'menos', 'ate', 'so', 'tambem', 'aqui', 'isso', 'esse', 'essa', 'esses', 'essas',
])

/**
 * Equivalentes de balcão. A primeira forma de cada grupo não importa: o
 * produto acerta se QUALQUER uma aparecer no nome. Escrito sem acento e em
 * minúsculas, como o banco compara.
 */
const SINONIMOS: string[][] = [
  ['mono', 'monofasico', 'monofasica', 'monopolar', 'unipolar', '1p', '1 polo'],
  ['bifasico', 'bifasica', 'bipolar', '2p', '2 polos'],
  ['trifasico', 'trifasica', 'tripolar', 'triplor', '3p', '3 polos'],
  ['parafuso', 'paraf'],
  ['abracadeira', 'abrac'],
  ['lampada', 'lamp'],
  ['extensao', 'extencao', 'filtro de linha'],
  ['branco', 'branca', 'bco', 'brc'],
  ['preto', 'preta', 'pto'],
  ['torneira', 'torn'],
  ['registro', 'reg'],
  ['polegada', 'pol'],
]
/** Abreviações que, sozinhas, são ambíguas demais para virar busca. */
const SO_COMO_SINONIMO = new Set(['bi', 'tri'])
const BI_TRI: Record<string, string[]> = {
  bi: SINONIMOS[1],
  tri: SINONIMOS[2],
}

const UNIDADES: Record<string, string[]> = {
  a: ['a', ' a'],
  mm: ['mm', ' mm'],
  cm: ['cm', ' cm'],
  m: ['m', 'mt', 'mts', ' m', ' metro'],
  w: ['w', ' w'],
  v: ['v', ' v'],
  kg: ['kg', ' kg'],
  g: ['g', 'gr', ' g'],
  ml: ['ml', ' ml'],
  l: ['l', 'lt', 'lts', ' litro'],
}
const ALIAS_UNIDADE: Record<string, string> = {
  a: 'a', amp: 'a', amps: 'a', ampere: 'a', amperes: 'a',
  mm: 'mm', milimetro: 'mm', milimetros: 'mm',
  cm: 'cm', centimetro: 'cm', centimetros: 'cm',
  m: 'm', mt: 'm', mts: 'm', metro: 'm', metros: 'm',
  w: 'w', watt: 'w', watts: 'w',
  v: 'v', volt: 'v', volts: 'v',
  kg: 'kg', quilo: 'kg', quilos: 'kg', kilo: 'kg', kilos: 'kg',
  g: 'g', gr: 'g', grama: 'g', gramas: 'g',
  ml: 'ml',
  l: 'l', lt: 'l', litro: 'l', litros: 'l',
}

export function normalizar(texto: string): string {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** "disjuntores" → "disjuntor"; "brancas" → "branc". Só em palavra longa. */
function radical(p: string): string {
  let r = p
  if (r.length >= 6 && r.endsWith('oes')) r = r.slice(0, -3)
  else if (r.length >= 6 && /(res|zes|les)$/.test(r)) r = r.slice(0, -2)
  else if (r.length >= 5 && r.endsWith('s')) r = r.slice(0, -1)
  if (r.length >= 6 && /[aoe]$/.test(r)) r = r.slice(0, -1)
  return r
}

const MAX_GRUPOS = 6

/**
 * Frase → grupos de equivalentes. Puro (sem banco), para ser testado.
 * Ex.: "temos quantos disjuntores de 32a mono da Guepar?" →
 *   [["disjuntor"], ["32a","32 a"], ["mono","monofasico",…], ["guepar"]]
 */
export function montarGrupos(texto: string): string[][] {
  let t = normalizar(texto)
  // Número colado à unidade: "32 amperes" → "32a", "2,5mm" → "2.5mm".
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*(amperes?|amps?|milimetros?|centimetros?|metros?|mts?|watts?|volts?|quilos?|kilos?|gramas?|gr|litros?|lts?|mm|cm|kg|ml|a|m|w|v|g|l)\b/g,
    (_, n: string, u: string) => `${n.replace(',', '.')}${ALIAS_UNIDADE[u] ?? u}`)
  const palavras = t.split(/[^a-z0-9/".]+/).map(p => p.replace(/^\.+|\.+$/g, '')).filter(Boolean)

  const grupos: string[][] = []
  for (const p of palavras) {
    if (PARADAS.has(p)) continue
    const comUnidade = p.match(/^(\d+(?:\.\d+)?)(a|mm|cm|m|w|v|kg|g|ml|l)$/)
    if (comUnidade) {
      const [, n, u] = comUnidade
      const nums = n.includes('.') ? [n, n.replace('.', ',')] : [n]
      grupos.push(nums.flatMap(x => (UNIDADES[u] ?? [u]).map(s => `${x}${s}`)))
      continue
    }
    if (BI_TRI[p]) { grupos.push(BI_TRI[p]); continue }
    if (SO_COMO_SINONIMO.has(p)) continue
    // Plural e gênero também valem para o sinônimo: "monofásicos" = monofásico.
    const sinonimo = SINONIMOS.find(g => g.some(a => a === p || radical(a) === radical(p)))
    if (sinonimo) { grupos.push(sinonimo); continue }
    // Palavra solta muito curta (letra, "x") só atrapalha.
    if (p.length < 2) continue
    const r = radical(p)
    grupos.push([...new Set([p, r.length >= 4 ? r : p])])
  }

  // Sem repetir grupo, e no máximo 6 — frase longa vira ruído.
  const vistos = new Set<string>()
  return grupos.filter(g => {
    const k = [...g].sort().join('|')
    if (vistos.has(k)) return false
    vistos.add(k)
    return true
  }).slice(0, MAX_GRUPOS)
}

export type ProdutoAchado = {
  id: string; nome: string; sku: string | null; marca: string | null
  estoque: number; preco_venda: number | null; ativo: boolean; acertos: number
}

export type ResultadoBuscaProduto = {
  grupos: string[][]
  /** Acertaram todos os termos. */
  exatos: ProdutoAchado[]
  /** Acertaram quase todos — mostrados quando não há exato, ou como "parecidos". */
  parecidos: ProdutoAchado[]
}

/** Roda a busca no banco (chave de serviço — a função não abre para usuário comum). */
export async function buscarProdutoInteligente(sb: any, empresaId: string, texto: string, limite = 20): Promise<ResultadoBuscaProduto> {
  const grupos = montarGrupos(texto)
  if (grupos.length === 0) return { grupos, exatos: [], parecidos: [] }
  const { data, error } = await sb.rpc('buscar_produtos_inteligente', { p_empresa: empresaId, p_grupos: grupos, p_limite: limite })
  if (error) throw new Error(error.message)
  const lista = ((data ?? []) as any[]).map(p => ({
    id: p.id, nome: p.nome, sku: p.sku, marca: p.marca, estoque: Number(p.estoque ?? 0),
    preco_venda: p.preco_venda != null ? Number(p.preco_venda) : null, ativo: !!p.ativo, acertos: Number(p.acertos),
  }))
  const exatos = lista.filter(p => p.acertos === grupos.length)
  // Parecido = faltou no máximo um termo (com 1 ou 2 termos, nenhum pode faltar).
  const minimo = grupos.length >= 3 ? grupos.length - 1 : grupos.length
  const parecidos = lista.filter(p => p.acertos < grupos.length && p.acertos >= minimo)
  return { grupos, exatos, parecidos }
}
