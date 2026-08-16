import { createClient } from '@/lib/supabase/server'
import MovimentacoesEstoqueClient from '@/components/estoque/MovimentacoesEstoqueClient'
import { calcularPeriodo, type PeriodoPreset } from '@/lib/estoque/periodo'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50

export default async function MovimentacoesEstoquePage({
  searchParams,
}: {
  searchParams: Promise<{
    modo?: string; produto?: string; deposito?: string; tipos?: string
    periodo?: string; de?: string; ate?: string; pagina?: string
  }>
}) {
  const {
    modo = 'periodo', produto = '', deposito = '', tipos = '',
    periodo = '30d', de = '', ate = '', pagina = '1',
  } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const { data: depositosRows } = await supabase
    .from('depositos').select('id, nome').eq('empresa_id', empresaId).eq('ativo', true).order('nome')
  const depositos = depositosRows ?? []

  const preset = periodo as PeriodoPreset
  const { inicio, fim } = calcularPeriodo(preset, de, ate)
  const tiposFiltro = tipos ? tipos.split(',').filter(Boolean) : []

  let produtoSelecionado: any = null
  let movimentosProduto: any[] = []
  let movimentosPeriodo: any[] = []
  let totalPeriodo = 0
  const pg = Math.max(1, parseInt(pagina))

  if (modo === 'produto' && produto) {
    const { data: p } = await supabase
      .from('produtos')
      .select('id, nome, sku, ean, categoria, unidade, estoque, estoque_minimo')
      .eq('id', produto).eq('empresa_id', empresaId).maybeSingle()
    produtoSelecionado = p

    if (p) {
      let q = supabase.from('estoque_movimentacoes')
        .select('*')
        .eq('empresa_id', empresaId)
        .eq('produto_id', produto)
        .gte('created_at', inicio).lte('created_at', fim)
        .order('created_at', { ascending: true })
        .limit(1000)
      if (deposito) q = q.eq('deposito_id', deposito)
      if (tiposFiltro.length > 0) q = q.in('tipo', tiposFiltro)
      const { data } = await q
      movimentosProduto = data ?? []
    }
  } else if (modo === 'periodo') {
    let q = supabase.from('estoque_movimentacoes')
      .select('*', { count: 'exact' })
      .eq('empresa_id', empresaId)
      .gte('created_at', inicio).lte('created_at', fim)
      .order('created_at', { ascending: false })
      .range((pg - 1) * POR_PAGINA, pg * POR_PAGINA - 1)
    if (deposito) q = q.eq('deposito_id', deposito)
    if (tiposFiltro.length > 0) q = q.in('tipo', tiposFiltro)
    const { data, count } = await q
    movimentosPeriodo = data ?? []
    totalPeriodo = count ?? 0
  }

  return (
    <MovimentacoesEstoqueClient
      empresaId={empresaId}
      depositos={depositos}
      modoInicial={modo === 'produto' ? 'produto' : 'periodo'}
      produtoIdInicial={produto}
      depositoInicial={deposito}
      tiposInicial={tiposFiltro}
      periodoInicial={preset}
      deInicial={de}
      ateInicial={ate}
      paginaInicial={pg}
      produtoSelecionado={produtoSelecionado}
      movimentosProduto={movimentosProduto}
      movimentosPeriodo={movimentosPeriodo}
      totalPeriodo={totalPeriodo}
      porPagina={POR_PAGINA}
    />
  )
}
