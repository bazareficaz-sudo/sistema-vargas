import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao, empresasDoUsuario } from '@/lib/auth/empresaAtiva'
import { clonarProdutosParaEmpresa } from '@/lib/produtos/clonarParaEmpresa'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Duplica produtos da empresa ativa (origem) para a empresa parceira
// (destino) — pra que a empresa destino tenha catálogo PRÓPRIO e consiga
// vender, receber XML e transferir estoque por conta dela, não emprestando
// o cadastro da outra.
//
// Processa em lotes com orçamento de tempo, mesmo padrão de
// /api/marketplaces/qualidade/recalcular: um catálogo de 14 mil produtos
// não cabe numa chamada só antes do teto da Vercel. Devolve `concluido` e
// `restantes` pra tela decidir se chama de novo.

const ORCAMENTO_MS = 240_000
const LOTE = 100

type Corpo = {
  produtoIds?: string[]
  categoria?: string
  subcategoria?: string
  tag?: string
  busca?: string
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const inicio = Date.now()
  const { id: parceriaId } = await params
  const body = await req.json().catch(() => ({})) as Corpo

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const perfil = await perfilDaSessao(sb, user.id, 'empresa_id, nome')
  const empresaOrigemId = perfil?.empresa_id
  if (!empresaOrigemId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: parceria } = await sb.from('empresa_parcerias')
    .select('id, empresa_id_a, empresa_id_b, status').eq('id', parceriaId).maybeSingle()
  if (!parceria || parceria.status !== 'ativa') {
    return NextResponse.json({ ok: false, erro: 'Parceria não encontrada ou inativa.' }, { status: 404 })
  }
  const origemEhLadoA = parceria.empresa_id_a === empresaOrigemId
  const origemEhLadoB = parceria.empresa_id_b === empresaOrigemId
  if (!origemEhLadoA && !origemEhLadoB) {
    return NextResponse.json({ ok: false, erro: 'Esta parceria não é da sua empresa.' }, { status: 403 })
  }
  const empresaDestinoId = origemEhLadoA ? parceria.empresa_id_b : parceria.empresa_id_a

  // Mesmo portão da Transferência de Estoque: só empresa que o usuário
  // logado realmente acessa.
  const permitidas = await empresasDoUsuario(sb, user.id)
  if (!permitidas.some(e => e.id === empresaDestinoId)) {
    return NextResponse.json({ ok: false, erro: 'Você não tem acesso à empresa de destino.' }, { status: 403 })
  }

  // Paginado de propósito: acima de 1000 vínculos (catálogos grandes passam
  // disso fácil), um .select() sem .range() volta só os primeiros 1000 —
  // limite padrão do PostgREST. Sem paginar aqui, produtos já clonados
  // "somem" do conjunto de já-feitos, a rota re-seleciona os mesmos como
  // pendentes pra sempre e nunca alcança o resto do catálogo — foi
  // exatamente isso que travou a duplicação da Ouro e Prata hoje.
  const colunaOrigem = origemEhLadoA ? 'produto_id_a' : 'produto_id_b'
  const idsJaClonados = new Set<string>()
  for (let offset = 0; ; offset += 1000) {
    const { data } = await sb.from('produto_vinculos')
      .select(colunaOrigem).eq('parceria_id', parceriaId).range(offset, offset + 999)
    if (!data || data.length === 0) break
    for (const v of data) idsJaClonados.add((v as any)[colunaOrigem])
    if (data.length < 1000) break
  }

  async function proximoLotePendente(tamanho: number): Promise<string[]> {
    if (Array.isArray(body.produtoIds) && body.produtoIds.length > 0) {
      return body.produtoIds.filter(id => !idsJaClonados.has(id)).slice(0, tamanho)
    }
    const pendentes: string[] = []
    for (let offset = 0; pendentes.length < tamanho; offset += 1000) {
      let q = sb.from('produtos').select('id')
        .eq('empresa_id', empresaOrigemId).eq('ativo', true).neq('tipo', 'kit')
        .order('id').range(offset, offset + 999)
      if (body.categoria) q = q.eq('categoria', body.categoria)
      if (body.subcategoria) q = q.eq('subcategoria', body.subcategoria)
      if (body.tag) q = q.contains('tags', [body.tag])
      if (body.busca) q = q.or(`nome.ilike.%${body.busca}%,sku.ilike.%${body.busca}%`)
      const { data } = await q
      if (!data || data.length === 0) break
      for (const p of data) {
        if (!idsJaClonados.has(p.id)) pendentes.push(p.id)
        if (pendentes.length >= tamanho) break
      }
      if (data.length < 1000) break
    }
    return pendentes
  }

  let clonados = 0, jaExistiam = 0, falhas = 0
  const erros: { produtoId: string; erro: string }[] = []

  while (Date.now() - inicio < ORCAMENTO_MS) {
    const lote = await proximoLotePendente(LOTE)
    if (lote.length === 0) break

    const r = await clonarProdutosParaEmpresa(sb, {
      parceriaId, empresaOrigemId, empresaDestinoId, origemEhLadoA,
      produtoIds: lote, criadoPorUserId: user.id,
    })
    clonados += r.clonados; jaExistiam += r.jaExistiam; falhas += r.falhas
    for (const item of r.resultados) {
      if (item.ok) idsJaClonados.add(item.produtoId)
      else if (item.erro) erros.push({ produtoId: item.produtoId, erro: item.erro })
    }

    // Lote explícito (produtoIds do corpo): uma passada só, não repete.
    if (Array.isArray(body.produtoIds) && body.produtoIds.length > 0) break
  }

  let restantes: number
  if (Array.isArray(body.produtoIds) && body.produtoIds.length > 0) {
    restantes = body.produtoIds.filter(id => !idsJaClonados.has(id)).length
  } else {
    let q = sb.from('produtos').select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaOrigemId).eq('ativo', true).neq('tipo', 'kit')
    if (body.categoria) q = q.eq('categoria', body.categoria)
    if (body.subcategoria) q = q.eq('subcategoria', body.subcategoria)
    if (body.tag) q = q.contains('tags', [body.tag])
    if (body.busca) q = q.or(`nome.ilike.%${body.busca}%,sku.ilike.%${body.busca}%`)
    const { count } = await q
    restantes = Math.max(0, (count ?? 0) - idsJaClonados.size)
  }

  return NextResponse.json({
    ok: true, clonados, jaExistiam, falhas, erros: erros.slice(0, 20),
    restantes, concluido: restantes === 0,
    duracaoSegundos: Math.round((Date.now() - inicio) / 1000),
  })
}
