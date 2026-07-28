import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { normalizarChave, similaridadeTexto } from '@/lib/texto/similaridade'

const LIMIAR_ALTA_CONFIANCA = 50

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

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: parceriaId } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: parceria } = await sb.from('empresa_parcerias').select('id, empresa_id_a, empresa_id_b, status').eq('id', parceriaId).maybeSingle()
  if (!parceria || (parceria.empresa_id_a !== guarda.empresaId && parceria.empresa_id_b !== guarda.empresaId)) {
    return NextResponse.json({ ok: false, erro: 'Parceria não encontrada' }, { status: 404 })
  }
  if (parceria.status !== 'ativa') return NextResponse.json({ ok: false, erro: 'Parceria não está ativa' }, { status: 400 })

  const url = new URL(req.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '50', 10) || 50))
  const ordem = url.searchParams.get('ordem') === 'desc' ? 'desc' : 'asc'

  const [produtosA, produtosB, vinculosExistentes] = await Promise.all([
    fetchAll(sb, 'produtos', 'id, nome, sku, ean', q => q.eq('empresa_id', parceria.empresa_id_a).eq('ativo', true)),
    fetchAll(sb, 'produtos', 'id, nome, sku, ean', q => q.eq('empresa_id', parceria.empresa_id_b).eq('ativo', true)),
    fetchAll(sb, 'produto_vinculos', 'produto_id_a, produto_id_b', q => q.eq('parceria_id', parceriaId)),
  ])

  const jaVinculadosA = new Set(vinculosExistentes.map((v: any) => v.produto_id_a))
  const jaVinculadosB = new Set(vinculosExistentes.map((v: any) => v.produto_id_b))

  const skuMapB = construirMapa(produtosB, 'sku')
  const eanMapB = construirMapa(produtosB, 'ean')

  type Candidato = {
    produtoIdA: string; nomeA: string; skuA: string | null
    produtoIdB: string; nomeB: string; skuB: string | null
    metodo: 'sku' | 'ean'; score: number
  }

  const candidatos: Candidato[] = []
  for (const pa of produtosA) {
    if (jaVinculadosA.has(pa.id)) continue
    const chaveSku = normalizarChave(pa.sku)
    const chaveEan = normalizarChave(pa.ean)
    const porSku = chaveSku ? skuMapB.get(chaveSku) : null
    const porEan = !porSku && chaveEan ? eanMapB.get(chaveEan) : null
    const pb = porSku ?? porEan
    if (!pb || jaVinculadosB.has(pb.id)) continue
    const metodo: 'sku' | 'ean' = porSku ? 'sku' : 'ean'
    candidatos.push({
      produtoIdA: pa.id, nomeA: pa.nome, skuA: pa.sku,
      produtoIdB: pb.id, nomeB: pb.nome, skuB: pb.sku,
      metodo, score: metodo === 'ean' ? 100 : similaridadeTexto(pa.nome, pb.nome),
    })
  }

  candidatos.sort((a, b) => ordem === 'asc' ? a.score - b.score : b.score - a.score)

  const total = candidatos.length
  const altaConfianca = candidatos.filter(c => c.score >= LIMIAR_ALTA_CONFIANCA).length
  const inicio = (page - 1) * pageSize
  const pagina = candidatos.slice(inicio, inicio + pageSize)

  return NextResponse.json({
    ok: true, total, page, pageSize,
    resumo: { totalCandidatos: candidatos.length, altaConfianca, revisarComAtencao: candidatos.length - altaConfianca, limiarAltaConfianca: LIMIAR_ALTA_CONFIANCA },
    itens: pagina,
  })
}
