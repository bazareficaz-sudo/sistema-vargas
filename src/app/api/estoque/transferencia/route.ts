import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao, empresasDoUsuario } from '@/lib/auth/empresaAtiva'
import { executarTransferencia, type ItemTransferencia } from '@/lib/estoque/transferencia'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Executa uma transferência de estoque — sempre no servidor, nunca direto
// do navegador. A validação de que a empresa destino é permitida (mesmo
// grupo, com parceria ativa, e o usuário logado tem acesso a ela) só pode
// ser confiável aqui: o app confia em `empresa_id` filtrado em código, não
// em RLS no banco (produtos, produto_estoque, estoque_movimentacoes e
// transferencias_estoque não têm RLS ligada) — então o portão certo é a
// rota, não a tela.

type Corpo = {
  depositoOrigemId?: string
  empresaDestinoId?: string
  depositoDestinoId?: string
  itens?: { produtoId: string; quantidade: number; percentual?: number | null }[]
  observacao?: string
  entradaId?: string
  entradaOrigem?: 'manual' | 'xml'
}

export async function POST(req: Request) {
  const body = await req.json() as Corpo
  const { depositoOrigemId, depositoDestinoId, itens, observacao, entradaId, entradaOrigem } = body

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const perfil = await perfilDaSessao(sb, user.id, 'empresa_id, nome')
  const empresaOrigemId = perfil?.empresa_id
  if (!empresaOrigemId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  if (!depositoOrigemId || !depositoDestinoId) {
    return NextResponse.json({ ok: false, erro: 'Escolha o depósito de origem e o de destino.' }, { status: 400 })
  }
  if (!Array.isArray(itens) || itens.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nenhum produto selecionado.' }, { status: 400 })
  }

  const empresaDestinoId = body.empresaDestinoId || empresaOrigemId
  const mesmaEmpresa = empresaDestinoId === empresaOrigemId

  if (mesmaEmpresa && depositoOrigemId === depositoDestinoId) {
    return NextResponse.json({ ok: false, erro: 'Origem e destino são o mesmo depósito.' }, { status: 400 })
  }

  const { data: depOrigem } = await sb.from('depositos')
    .select('id').eq('id', depositoOrigemId).eq('empresa_id', empresaOrigemId).eq('ativo', true).maybeSingle()
  if (!depOrigem) return NextResponse.json({ ok: false, erro: 'Depósito de origem inválido.' }, { status: 400 })

  const { data: depDestino } = await sb.from('depositos')
    .select('id').eq('id', depositoDestinoId).eq('empresa_id', empresaDestinoId).eq('ativo', true).maybeSingle()
  if (!depDestino) return NextResponse.json({ ok: false, erro: 'Depósito de destino inválido.' }, { status: 400 })

  let produtoDestinoPorOrigem: Record<string, string> | undefined

  if (!mesmaEmpresa) {
    // O usuário só pode empurrar estoque para uma empresa onde ele mesmo
    // tem acesso — senão, transferir seria um jeito de mexer no estoque de
    // uma empresa que ele nem deveria enxergar.
    const permitidas = await empresasDoUsuario(sb, user.id)
    if (!permitidas.some(e => e.id === empresaDestinoId)) {
      return NextResponse.json({ ok: false, erro: 'Você não tem acesso à empresa de destino.' }, { status: 403 })
    }

    const { data: parceria } = await sb.from('empresa_parcerias')
      .select('id').eq('status', 'ativa')
      .or(`and(empresa_id_a.eq.${empresaOrigemId},empresa_id_b.eq.${empresaDestinoId}),and(empresa_id_a.eq.${empresaDestinoId},empresa_id_b.eq.${empresaOrigemId})`)
      .maybeSingle()
    if (!parceria) {
      return NextResponse.json({
        ok: false,
        erro: 'Não existe parceria ativa entre estas empresas. Crie em Empresas → Parcerias antes de transferir.',
      }, { status: 400 })
    }

    // Vínculo de produto entre as duas empresas — o MESMO mecanismo que já
    // alimenta o Estoque Unificado (src/lib/produtos/estoqueUnificado.ts),
    // não um novo. O vínculo não tem lado fixo (produto_id_a/b), então as
    // duas direções são checadas.
    const produtoIds = itens.map(i => i.produtoId)
    const { data: vinculos } = await sb.from('produto_vinculos')
      .select('produto_id_a, produto_id_b')
      .eq('parceria_id', parceria.id)
      .or(`produto_id_a.in.(${produtoIds.join(',')}),produto_id_b.in.(${produtoIds.join(',')})`)

    produtoDestinoPorOrigem = {}
    for (const v of vinculos ?? []) {
      if (produtoIds.includes(v.produto_id_a)) produtoDestinoPorOrigem[v.produto_id_a] = v.produto_id_b
      else if (produtoIds.includes(v.produto_id_b)) produtoDestinoPorOrigem[v.produto_id_b] = v.produto_id_a
    }
  }

  const resultado = await executarTransferencia(sb, {
    empresaOrigemId, depositoOrigemId, empresaDestinoId, depositoDestinoId,
    itens: itens as ItemTransferencia[],
    usuario: perfil?.nome ?? user.email ?? null,
    observacao: observacao || null,
    entradaId: entradaId || null,
    entradaOrigem: entradaOrigem || null,
    produtoDestinoPorOrigem,
  })

  return NextResponse.json({ ok: true, ...resultado })
}
