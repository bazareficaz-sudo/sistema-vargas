import { createAdminClient } from '@/lib/supabase/admin'
import { erroJson, registrarUso, validarTokenMarketing } from '@/lib/integracoes/marketing/token'
import { exportarProduto, temTagMarketing, VARIANTES_TAG, type ImagemErp, type ProdutoErp } from '@/lib/integracoes/marketing/catalogo'

export const dynamic = 'force-dynamic'

// GET /api/integracoes/marketing/v1/produtos?cursor=<id>&limit=<n>
//
// Produtos da empresa do token marcados com a tag "marketing", paginados por
// id. A lista completa (todas as páginas) é o conjunto vigente: o Marketing
// desativa do lado dele o que deixar de aparecer (tag removida, produto
// inativo ou mesclado). Somente leitura.

const COLUNAS = 'id, nome, sku, ean, unidade, categoria, marca, descricao_marketplace, ativo, mesclado_em, tags, preco_venda, preco_promocional, promocao_ativa, promocao_inicio, promocao_fim, controlar_estoque, estoque, foto_url, updated_at'

export async function GET(req: Request) {
  const auth = await validarTokenMarketing(req)
  if (!auth.ok) return erroJson(auth.code, auth.erro, auth.status)
  const url = new URL(req.url)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 200)
  const cursor = url.searchParams.get('cursor')
  if (cursor && !/^[0-9a-f-]{36}$/i.test(cursor)) return erroJson('invalid_cursor', 'Cursor inválido.', 400)

  const sb = createAdminClient()
  let q = sb.from('produtos').select(COLUNAS)
    .eq('empresa_id', auth.ctx.empresaId)
    .overlaps('tags', VARIANTES_TAG)
    .order('id').limit(limit)
  if (cursor) q = q.gt('id', cursor)
  const [produtos, config] = await Promise.all([
    q,
    sb.from('empresa_config_pdv').select('promocao_exige_forma, promocao_formas').eq('empresa_id', auth.ctx.empresaId).maybeSingle(),
  ])
  if (produtos.error || config.error) return erroJson('internal', 'Falha ao ler o catálogo.', 500, true)

  const lista = (produtos.data ?? []) as ProdutoErp[]
  const ids = lista.map(p => p.id)
  const imagens = ids.length
    ? await sb.from('produto_imagens').select('id, produto_id, url, ordem, principal').eq('empresa_id', auth.ctx.empresaId).in('produto_id', ids)
    : { data: [], error: null }
  if (imagens.error) return erroJson('internal', 'Falha ao ler as imagens.', 500, true)

  const cfg = config.data
    ? { exigirFormaPagamento: !!config.data.promocao_exige_forma, formasPermitidas: (config.data.promocao_formas ?? []) as string[] }
    : null
  const agora = new Date()
  const itens = lista
    .filter(p => temTagMarketing(p.tags))
    .map(p => exportarProduto(p, ((imagens.data ?? []) as (ImagemErp & { produto_id: string })[]).filter(i => i.produto_id === p.id), cfg, agora))

  await registrarUso(auth.ctx.tokenId)
  const ultimo = lista[lista.length - 1]
  return Response.json({
    items: itens,
    next_cursor: lista.length === limit && ultimo ? ultimo.id : null,
    fetched_at: agora.toISOString(),
  })
}
