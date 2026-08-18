import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

export const dynamic = 'force-dynamic'

// Cards-resumo da tela inicial do módulo — sempre por depósito, porque
// hierarquia/status são configurados por depósito.

export async function GET(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { searchParams } = new URL(req.url)
  const depositoId = searchParams.get('depositoId')

  let qEnderecos = sb.from('enderecos').select('status').eq('empresa_id', guarda.empresaId).eq('ativo', true)
  if (depositoId) qEnderecos = qEnderecos.eq('deposito_id', depositoId)
  const { data: enderecos } = await qEnderecos

  const ativos = (enderecos ?? []).length
  const bloqueados = (enderecos ?? []).filter((e: any) => ['bloqueado', 'temp_bloqueado'].includes(e.status)).length

  let qOcupados = sb.from('produto_enderecos').select('endereco_id').eq('empresa_id', guarda.empresaId).gt('quantidade', 0)
  if (depositoId) qOcupados = qOcupados.eq('deposito_id', depositoId)
  const { data: ocupadosRows } = await qOcupados
  const ocupados = new Set((ocupadosRows ?? []).map((r: any) => r.endereco_id)).size

  let naoEnderecadoTotal = 0
  let produtosSemEndereco = 0
  if (depositoId) {
    const [{ data: saldos }, { data: enderecados }] = await Promise.all([
      sb.from('produto_estoque').select('produto_id, quantidade').eq('deposito_id', depositoId).gt('quantidade', 0),
      sb.from('produto_enderecos').select('produto_id, quantidade').eq('deposito_id', depositoId),
    ])
    const enderecadoPorProduto = new Map<string, number>()
    for (const l of enderecados ?? []) enderecadoPorProduto.set(l.produto_id, (enderecadoPorProduto.get(l.produto_id) ?? 0) + Number(l.quantidade ?? 0))
    for (const s of saldos ?? []) {
      const end = enderecadoPorProduto.get(s.produto_id) ?? 0
      const total = Number(s.quantidade ?? 0)
      if (total - end > 0) { naoEnderecadoTotal += total - end; produtosSemEndereco += end === 0 ? 1 : 0 }
    }
  }

  return NextResponse.json({
    ok: true,
    enderecosAtivos: ativos,
    enderecosOcupados: ocupados,
    enderecosVazios: Math.max(0, ativos - ocupados),
    enderecosBloqueados: bloqueados,
    produtosSemEndereco,
    estoqueNaoEnderecado: naoEnderecadoTotal,
  })
}
