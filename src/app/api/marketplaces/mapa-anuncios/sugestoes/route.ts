import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

const LIMIAR_ALTA_CONFIANCA = 50

function normalizarChave(v: string | null | undefined) {
  return (v ?? '').toString().trim().toUpperCase()
}

// Similaridade de texto entre o título do anúncio e o nome do produto —
// único sinal confiável quando o SKU por si só pode ser coincidência (ver
// contexto no plano: SKUs deste sistema são só sequenciais, sem prefixo).
function similaridadeTexto(a: string | null | undefined, b: string | null | undefined): number {
  const tokenizar = (s: string) => (s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3)

  const setA = new Set(tokenizar(a ?? ''))
  const setB = new Set(tokenizar(b ?? ''))
  if (setA.size === 0 || setB.size === 0) return 0

  let intersecao = 0
  for (const w of setA) if (setB.has(w)) intersecao++
  const uniao = new Set([...setA, ...setB]).size
  return Math.round((intersecao / uniao) * 100)
}

async function fetchAll(sb: any, table: string, select: string, applyFilters: (q: any) => any) {
  let all: any[] = []
  let from = 0
  const pageSize = 1000
  while (true) {
    let q = sb.from(table).select(select).range(from, from + pageSize - 1)
    q = applyFilters(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    all = all.concat(data ?? [])
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return all
}

function construirMapa(produtos: any[], campo: 'sku' | 'ean') {
  const contagem = new Map<string, any[]>()
  for (const p of produtos) {
    const chave = normalizarChave(p[campo])
    if (!chave) continue
    contagem.set(chave, (contagem.get(chave) ?? []).concat(p))
  }
  const mapa = new Map<string, any>()
  for (const [chave, ps] of contagem) {
    if (ps.length > 1) continue // ambíguo, fica de fora
    mapa.set(chave, ps[0])
  }
  return mapa
}

export async function GET(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const url = new URL(req.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '50', 10) || 50))
  const canalId = url.searchParams.get('canalId') || null
  const confianca = url.searchParams.get('confianca') as 'alta' | 'atencao' | null // filtro opcional
  const ordem = url.searchParams.get('ordem') === 'desc' ? 'desc' : 'asc'

  const produtos = await fetchAll(sb, 'produtos', 'id, nome, sku, ean', q => q.eq('empresa_id', guarda.empresaId))
  const skuMap = construirMapa(produtos, 'sku')
  const eanMap = construirMapa(produtos, 'ean')

  const [canaisRes, anuncios, variacoes] = await Promise.all([
    sb.from('marketplace_canais').select('id, nome, plataforma').eq('empresa_id', guarda.empresaId),
    fetchAll(sb, 'marketplace_anuncios', 'id, canal_id, titulo, sku_canal',
      q => q.eq('empresa_id', guarda.empresaId).is('produto_id', null).not('sku_canal', 'is', null)),
    fetchAll(sb, 'marketplace_anuncio_variacoes', 'id, anuncio_id, nome_variacao, sku_variacao',
      q => q.eq('empresa_id', guarda.empresaId).is('produto_id', null).not('sku_variacao', 'is', null)),
  ])
  const canalPorId = new Map((canaisRes.data ?? []).map((c: any) => [c.id, c]))

  // variações precisam do título/canal do anúncio pai
  const idsAnunciosPai = [...new Set(variacoes.map((v: any) => v.anuncio_id))]
  const paisMap = new Map<string, any>()
  if (idsAnunciosPai.length > 0) {
    const pais = await fetchAll(sb, 'marketplace_anuncios', 'id, canal_id, titulo', q => q.in('id', idsAnunciosPai))
    for (const p of pais) paisMap.set(p.id, p)
  }

  type Candidato = {
    tipo: 'anuncio' | 'variacao'; id: string; canalId: string; canalNome: string; plataforma: string
    titulo: string; chave: string; produtoId: string; produtoNome: string; produtoSku: string | null
    metodo: 'sku' | 'ean'; score: number
  }

  const candidatos: Candidato[] = []

  for (const a of anuncios) {
    const chave = normalizarChave(a.sku_canal)
    const porSku = skuMap.get(chave)
    const produto = porSku ?? eanMap.get(chave)
    if (!produto) continue
    const metodo: 'sku' | 'ean' = porSku ? 'sku' : 'ean'
    const canal = canalPorId.get(a.canal_id)
    candidatos.push({
      tipo: 'anuncio', id: a.id, canalId: a.canal_id, canalNome: canal?.nome ?? '—', plataforma: canal?.plataforma ?? '—',
      titulo: a.titulo ?? '', chave: a.sku_canal, produtoId: produto.id, produtoNome: produto.nome, produtoSku: produto.sku,
      metodo, score: metodo === 'ean' ? 100 : similaridadeTexto(a.titulo, produto.nome),
    })
  }

  for (const v of variacoes) {
    const chave = normalizarChave(v.sku_variacao)
    const porSku = skuMap.get(chave)
    const produto = porSku ?? eanMap.get(chave)
    if (!produto) continue
    const metodo: 'sku' | 'ean' = porSku ? 'sku' : 'ean'
    const pai = paisMap.get(v.anuncio_id)
    const canal = pai ? canalPorId.get(pai.canal_id) : null
    const tituloComparar = v.nome_variacao || pai?.titulo || ''
    candidatos.push({
      tipo: 'variacao', id: v.id, canalId: pai?.canal_id ?? '', canalNome: canal?.nome ?? '—', plataforma: canal?.plataforma ?? '—',
      titulo: pai?.titulo ? `${pai.titulo} — ${v.nome_variacao ?? ''}` : (v.nome_variacao ?? ''),
      chave: v.sku_variacao, produtoId: produto.id, produtoNome: produto.nome, produtoSku: produto.sku,
      metodo, score: metodo === 'ean' ? 100 : similaridadeTexto(tituloComparar, produto.nome),
    })
  }

  let filtrados = candidatos
  if (canalId) filtrados = filtrados.filter(c => c.canalId === canalId)
  if (confianca === 'alta') filtrados = filtrados.filter(c => c.score >= LIMIAR_ALTA_CONFIANCA)
  if (confianca === 'atencao') filtrados = filtrados.filter(c => c.score < LIMIAR_ALTA_CONFIANCA)

  filtrados.sort((a, b) => ordem === 'asc' ? a.score - b.score : b.score - a.score)

  const total = filtrados.length
  const altaConfianca = candidatos.filter(c => c.score >= LIMIAR_ALTA_CONFIANCA).length
  const revisarComAtencao = candidatos.length - altaConfianca

  const inicio = (page - 1) * pageSize
  const pagina = filtrados.slice(inicio, inicio + pageSize)

  return NextResponse.json({
    ok: true,
    total, page, pageSize,
    resumo: { totalCandidatos: candidatos.length, altaConfianca, revisarComAtencao, limiarAltaConfianca: LIMIAR_ALTA_CONFIANCA },
    canais: (canaisRes.data ?? []).map((c: any) => ({ id: c.id, nome: c.nome, plataforma: c.plataforma })),
    itens: pagina,
  })
}
