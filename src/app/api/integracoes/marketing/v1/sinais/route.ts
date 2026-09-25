import { createAdminClient } from '@/lib/supabase/admin'
import { erroJson, registrarUso, validarTokenMarketing } from '@/lib/integracoes/marketing/token'
import { temTagMarketing, VARIANTES_TAG } from '@/lib/integracoes/marketing/catalogo'

export const dynamic = 'force-dynamic'

// GET /api/integracoes/marketing/v1/sinais?desde=<ISO>&ate=<ISO>
//
// Chegadas de mercadoria (entradas confirmadas) de produtos com a tag
// "marketing", no intervalo pedido (máx. 31 dias). É a data real de chegada —
// o que permite ao Marketing dizer "chegou" sem confundir com data de cadastro.
// Não sai custo, fornecedor nem nota: só produto, data e quantidade.

const MAX_DIAS = 31

export async function GET(req: Request) {
  const auth = await validarTokenMarketing(req)
  if (!auth.ok) return erroJson(auth.code, auth.erro, auth.status)
  const url = new URL(req.url)
  const desde = new Date(url.searchParams.get('desde') ?? '')
  const ate = url.searchParams.get('ate') ? new Date(url.searchParams.get('ate')!) : new Date()
  if (Number.isNaN(desde.getTime()) || Number.isNaN(ate.getTime()) || desde > ate) {
    return erroJson('invalid_range', 'Informe "desde" (e opcionalmente "ate") em ISO 8601.', 400)
  }
  if (ate.getTime() - desde.getTime() > MAX_DIAS * 86_400_000) {
    return erroJson('range_too_large', `Intervalo máximo de ${MAX_DIAS} dias.`, 400)
  }

  const sb = createAdminClient()
  const entradas = await sb.from('entradas').select('id, data_entrada')
    .eq('empresa_id', auth.ctx.empresaId).eq('status', 'confirmada')
    .gte('data_entrada', desde.toISOString()).lte('data_entrada', ate.toISOString())
    .order('data_entrada').limit(500)
  if (entradas.error) return erroJson('internal', 'Falha ao ler as entradas.', 500, true)
  const quando = new Map((entradas.data ?? []).map(e => [e.id, e.data_entrada as string]))

  let chegadas: { source_product_id: string; arrived_at: string; quantity: number | null; arrival_id: string }[] = []
  if (quando.size) {
    const itens = await sb.from('entrada_itens').select('entrada_id, produto_id, quantidade').in('entrada_id', [...quando.keys()])
    if (itens.error) return erroJson('internal', 'Falha ao ler os itens das entradas.', 500, true)
    const produtoIds = [...new Set((itens.data ?? []).map(i => i.produto_id).filter(Boolean))] as string[]
    const marcados = produtoIds.length
      ? await sb.from('produtos').select('id, tags').eq('empresa_id', auth.ctx.empresaId).in('id', produtoIds).overlaps('tags', VARIANTES_TAG)
      : { data: [], error: null }
    if (marcados.error) return erroJson('internal', 'Falha ao ler os produtos.', 500, true)
    const comTag = new Set((marcados.data ?? []).filter(p => temTagMarketing(p.tags)).map(p => p.id))
    chegadas = (itens.data ?? [])
      .filter(i => i.produto_id && comTag.has(i.produto_id))
      .map(i => ({ source_product_id: i.produto_id!, arrived_at: quando.get(i.entrada_id)!, quantity: i.quantidade === null ? null : Number(i.quantidade), arrival_id: i.entrada_id }))
  }

  await registrarUso(auth.ctx.tokenId)
  return Response.json({ arrivals: chegadas, window: { from: desde.toISOString(), to: ate.toISOString() }, generated_at: new Date().toISOString() })
}
