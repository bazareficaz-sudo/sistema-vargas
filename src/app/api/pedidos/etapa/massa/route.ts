import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { ETAPA_INFO, transicaoPermitida, type Etapa } from '@/lib/pedidos/etapas'

// Muda a etapa de vários pedidos de uma vez.
//
// Não é a rota individual num laço: aqui a resposta precisa dizer, item a
// item, o que passou e o que não passou. Marcar 40 pedidos como "embalado"
// e receber só "ok" esconderia justamente os 3 que estavam cancelados e
// ficaram para trás.

const TABELA = { venda: 'vendas', marketplace: 'marketplace_pedidos' } as const
const LIMITE = 200

type Item = { fonte: 'venda' | 'marketplace'; id: string }

export async function POST(req: Request) {
  const { itens, etapa, observacao } = await req.json() as {
    itens: Item[]; etapa: Etapa; observacao?: string
  }
  if (!Array.isArray(itens) || itens.length === 0 || !ETAPA_INFO[etapa]) {
    return NextResponse.json({ ok: false, erro: 'Pedidos ou etapa inválidos' }, { status: 400 })
  }
  if (itens.length > LIMITE) {
    return NextResponse.json({ ok: false, erro: `Máximo de ${LIMITE} pedidos por vez.` }, { status: 400 })
  }

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'realizar_vendas')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: perfil } = await sb.from('profiles').select('nome').eq('id', guarda.userId).maybeSingle()
  const agora = new Date().toISOString()

  const aplicados: { fonte: string; id: string }[] = []
  const recusados: { fonte: string; id: string; motivo: string }[] = []
  const eventos: any[] = []

  for (const fonte of ['venda', 'marketplace'] as const) {
    const ids = itens.filter(i => i.fonte === fonte).map(i => i.id)
    if (ids.length === 0) continue

    // Uma consulta por origem, não uma por pedido — e o filtro de empresa
    // aqui é o que garante que ninguém mude pedido de outra conta passando
    // um id na mão.
    const { data: linhas } = await sb.from(TABELA[fonte])
      .select('id, etapa_operacional').in('id', ids).eq('empresa_id', guarda.empresaId)

    const mapa = new Map((linhas ?? []).map((l: any) => [l.id, (l.etapa_operacional ?? 'novo') as Etapa]))

    const podem: string[] = []
    for (const id of ids) {
      const atual = mapa.get(id)
      if (!atual) { recusados.push({ fonte, id, motivo: 'Pedido não encontrado' }); continue }
      const permite = transicaoPermitida(atual, etapa)
      if (!permite.ok) { recusados.push({ fonte, id, motivo: permite.motivo ?? 'Transição não permitida' }); continue }
      podem.push(id)
      eventos.push({
        empresa_id: guarda.empresaId,
        fonte, referencia_id: id,
        tipo: 'etapa',
        etapa_anterior: atual, etapa_nova: etapa,
        descricao: `${ETAPA_INFO[atual]?.label ?? atual} → ${ETAPA_INFO[etapa].label}`,
        observacao: observacao?.trim() ? `${observacao.trim()} (ação em massa)` : 'Ação em massa',
        usuario_id: guarda.userId, usuario_nome: perfil?.nome ?? null,
        automatico: false,
      })
    }

    if (podem.length === 0) continue

    const { error } = await sb.from(TABELA[fonte])
      .update({ etapa_operacional: etapa, etapa_operacional_em: agora })
      .in('id', podem).eq('empresa_id', guarda.empresaId)

    if (error) {
      for (const id of podem) recusados.push({ fonte, id, motivo: error.message })
      // Os eventos desta origem não valem mais — nada foi gravado.
      for (let i = eventos.length - 1; i >= 0; i--) if (eventos[i].fonte === fonte) eventos.splice(i, 1)
      continue
    }
    for (const id of podem) aplicados.push({ fonte, id })
  }

  if (eventos.length > 0) await sb.from('pedido_eventos').insert(eventos)

  return NextResponse.json({ ok: true, etapa, aplicados, recusados })
}
