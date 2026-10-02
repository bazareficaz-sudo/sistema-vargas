import { createAdminClient } from '@/lib/supabase/admin'
import { buscarTudo } from '@/lib/supabase/paginar'
import { erroJson, registrarUso, validarTokenMarketing } from '@/lib/integracoes/marketing/token'
import { temTagMarketing, VARIANTES_TAG } from '@/lib/integracoes/marketing/catalogo'
import { agregarVendas, FUSO_VENDAS, inicioDoDiaLocal, type ItemVenda, type VendaBase } from '@/lib/integracoes/marketing/vendas'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/integracoes/marketing/v1/vendas?desde=AAAA-MM-DD&ate=AAAA-MM-DD
//
// Vendas concluídas de produtos com a tag "marketing", em saldo por produto e
// por dia (fuso de São Paulo; devoluções descontam), no intervalo pedido (máx. 62 dias, inclusive).
// Só quantidade e valor vendido: nada de cliente, venda individual, pagamento,
// custo ou margem. Somente leitura.

const MAX_DIAS = 62
const LOTE = 150
const DIA = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  const auth = await validarTokenMarketing(req)
  if (!auth.ok) return erroJson(auth.code, auth.erro, auth.status)
  const url = new URL(req.url)
  const desde = url.searchParams.get('desde') ?? '', ate = url.searchParams.get('ate') ?? ''
  if (!DIA.test(desde) || !DIA.test(ate) || desde > ate) return erroJson('invalid_range', 'Informe "desde" e "ate" no formato AAAA-MM-DD.', 400)
  const inicio = inicioDoDiaLocal(desde)
  const fim = new Date(new Date(inicioDoDiaLocal(ate)).getTime() + 86_400_000).toISOString()
  if (Number.isNaN(Date.parse(inicio)) || Number.isNaN(Date.parse(fim))) return erroJson('invalid_range', 'Datas inválidas.', 400)
  if (Date.parse(fim) - Date.parse(inicio) > MAX_DIAS * 86_400_000) return erroJson('range_too_large', `Intervalo máximo de ${MAX_DIAS} dias.`, 400)

  const sb = createAdminClient()
  try {
    const vendas = await buscarTudo<VendaBase>((de, a) => sb.from('vendas').select('id, created_at')
      .eq('empresa_id', auth.ctx.empresaId).eq('status', 'concluida')
      .gte('created_at', inicio).lt('created_at', fim)
      .order('id').range(de, a), { rotulo: 'marketing/vendas' })

    const itens: ItemVenda[] = []
    const ids = vendas.map(v => String(v.id))
    for (let i = 0; i < ids.length; i += LOTE) {
      const lote = ids.slice(i, i + LOTE)
      itens.push(...await buscarTudo<ItemVenda>((de, a) => sb.from('venda_itens')
        .select('venda_id, produto_id, quantidade, preco_unitario').in('venda_id', lote)
        .order('id').range(de, a), { rotulo: 'marketing/venda_itens' }))
    }

    // Só produtos desta empresa com a tag "marketing" (o mesmo recorte do catálogo).
    const produtoIds = [...new Set(itens.map(i => i.produto_id).filter((p): p is string => !!p && /^[0-9a-f-]{36}$/i.test(p)))]
    const comTag = new Set<string>()
    for (let i = 0; i < produtoIds.length; i += LOTE) {
      const r = await sb.from('produtos').select('id, tags').eq('empresa_id', auth.ctx.empresaId)
        .in('id', produtoIds.slice(i, i + LOTE)).overlaps('tags', VARIANTES_TAG)
      if (r.error) throw new Error(r.error.message)
      for (const p of r.data ?? []) if (temTagMarketing(p.tags)) comTag.add(String(p.id))
    }

    await registrarUso(auth.ctx.tokenId)
    return Response.json({
      sales: agregarVendas(vendas, itens, comTag),
      window: { from: desde, to: ate, timezone: FUSO_VENDAS },
      generated_at: new Date().toISOString(),
    })
  } catch {
    return erroJson('internal', 'Falha ao ler as vendas.', 500, true)
  }
}
