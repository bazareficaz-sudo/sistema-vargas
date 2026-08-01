import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

// Histórico de alterações dos pedidos.
//
// Lê `pedido_eventos`, que é append-only — nenhum evento é editado nem
// apagado. É por isso que esta tela consegue responder "quem despachou
// este pedido, e quando?" meses depois.
//
// O número do pedido não está no evento (a referência é polimórfica), então
// é resolvido aqui, em duas consultas, só para os ids da página atual.

const PAGINA = 100

export async function GET(req: Request) {
  const url = new URL(req.url)
  const de = url.searchParams.get('de')
  const ate = url.searchParams.get('ate')
  const usuario = url.searchParams.get('usuario')
  const fonte = url.searchParams.get('fonte')
  const origem = url.searchParams.get('origem') // 'pessoa' | 'automatico'
  const pagina = Math.max(0, Number(url.searchParams.get('pagina') ?? 0))

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'realizar_vendas')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  let q = sb.from('pedido_eventos')
    .select('*', { count: 'exact' })
    .eq('empresa_id', guarda.empresaId)
    .order('created_at', { ascending: false })
    .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1)

  if (de) q = q.gte('created_at', `${de}T00:00:00`)
  if (ate) q = q.lte('created_at', `${ate}T23:59:59`)
  if (usuario) q = q.eq('usuario_id', usuario)
  if (fonte === 'venda' || fonte === 'marketplace') q = q.eq('fonte', fonte)
  if (origem === 'pessoa') q = q.eq('automatico', false)
  if (origem === 'automatico') q = q.eq('automatico', true)

  const { data: eventos, count, error } = await q
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })

  // Resolve o número do pedido só dos eventos desta página.
  const idsVenda = [...new Set((eventos ?? []).filter(e => e.fonte === 'venda').map(e => e.referencia_id))]
  const idsMkt = [...new Set((eventos ?? []).filter(e => e.fonte === 'marketplace').map(e => e.referencia_id))]

  const [vRes, mRes] = await Promise.all([
    idsVenda.length ? sb.from('vendas').select('id, numero, cliente_nome').in('id', idsVenda) : Promise.resolve({ data: [] as any[] }),
    idsMkt.length ? sb.from('marketplace_pedidos').select('id, numero_pedido, id_externo, cliente_nome').in('id', idsMkt) : Promise.resolve({ data: [] as any[] }),
  ])

  const numeros = new Map<string, { numero: string; cliente: string | null }>()
  for (const v of vRes.data ?? []) numeros.set(v.id, { numero: String(v.numero), cliente: v.cliente_nome })
  for (const m of mRes.data ?? []) numeros.set(m.id, { numero: String(m.numero_pedido ?? m.id_externo), cliente: m.cliente_nome })

  return NextResponse.json({
    ok: true,
    total: count ?? 0,
    pagina,
    porPagina: PAGINA,
    eventos: (eventos ?? []).map(e => ({
      ...e,
      pedidoNumero: numeros.get(e.referencia_id)?.numero ?? null,
      pedidoCliente: numeros.get(e.referencia_id)?.cliente ?? null,
    })),
  })
}
