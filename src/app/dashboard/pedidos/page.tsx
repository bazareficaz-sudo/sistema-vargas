import { createClient } from '@/lib/supabase/server'
import PedidosClient from '@/components/pedidos/PedidosClient'
import { calcularPeriodo, type PeriodoPreset } from '@/lib/estoque/periodo'
import { vendaParaPedido, marketplaceParaPedido, calcularIndicadores, type PedidoUnificado } from '@/lib/pedidos/unificado'

export const dynamic = 'force-dynamic'

// Teto por fonte. Com 30 dias a loja fica bem abaixo disso; o aviso na tela
// aparece se algum dia encostar, em vez de cortar em silêncio.
const LIMITE_POR_FONTE = 1000

export default async function PedidosPage({ searchParams }: {
  searchParams: Promise<{ periodo?: string; de?: string; ate?: string }>
}) {
  const { periodo = '30d', de = '', ate = '' } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const preset = periodo as PeriodoPreset
  const { inicio, fim } = calcularPeriodo(preset, de, ate)

  const [{ data: vendas }, { data: pedidosMkt }, { data: canais }] = await Promise.all([
    supabase.from('vendas')
      .select('id, numero, total, desconto, desconto_total, status, tipo_operacao, canal, cliente_nome, created_at, nfce_status, nfce_numero, etapa_operacional, etapa_operacional_em, clientes(nome)')
      .eq('empresa_id', empresaId)
      .gte('created_at', inicio).lte('created_at', fim)
      .order('created_at', { ascending: false })
      .limit(LIMITE_POR_FONTE),
    supabase.from('marketplace_pedidos')
      .select('id, canal_id, numero_pedido, id_externo, cliente_nome, valor_total, valor_desconto, valor_frete, status, data_pedido, data_envio, transportadora, codigo_rastreio, nfe_numero, venda_id, etapa_operacional, etapa_operacional_em, created_at')
      .eq('empresa_id', empresaId)
      .gte('data_pedido', inicio).lte('data_pedido', fim)
      .order('data_pedido', { ascending: false })
      .limit(LIMITE_POR_FONTE),
    supabase.from('marketplace_canais').select('id, nome, plataforma').eq('empresa_id', empresaId),
  ])

  const plataformaPorCanal = new Map((canais ?? []).map(c => [c.id, c.plataforma]))
  const nomePorCanal = new Map((canais ?? []).map(c => [c.id, c.nome]))

  const pedidos: PedidoUnificado[] = [
    ...(vendas ?? []).map(vendaParaPedido),
    ...(pedidosMkt ?? []).map(p => marketplaceParaPedido(p, plataformaPorCanal, nomePorCanal)),
  ].sort((a, b) => (b.criadoEm ?? '').localeCompare(a.criadoEm ?? ''))

  return (
    <PedidosClient
      pedidos={pedidos}
      indicadores={calcularIndicadores(pedidos)}
      periodoInicial={preset}
      deInicial={de}
      ateInicial={ate}
      truncou={(vendas?.length ?? 0) >= LIMITE_POR_FONTE || (pedidosMkt?.length ?? 0) >= LIMITE_POR_FONTE}
      limitePorFonte={LIMITE_POR_FONTE}
    />
  )
}
