import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'

type ParItem = { produtoIdA: string; produtoIdB: string; metodo?: 'manual' | 'automatico_sku' | 'automatico_ean' }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: parceriaId } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: parceria } = await sb.from('empresa_parcerias').select('id, empresa_id_a, empresa_id_b, status').eq('id', parceriaId).maybeSingle()
  if (!parceria || (parceria.empresa_id_a !== guarda.empresaId && parceria.empresa_id_b !== guarda.empresaId)) {
    return NextResponse.json({ ok: false, erro: 'Parceria não encontrada' }, { status: 404 })
  }
  if (parceria.status !== 'ativa') return NextResponse.json({ ok: false, erro: 'Parceria não está ativa' }, { status: 400 })

  const body = await req.json()
  const itens: ParItem[] = Array.isArray(body?.itens) ? body.itens : []
  if (itens.length === 0) return NextResponse.json({ ok: false, erro: 'Nenhum item enviado' }, { status: 400 })

  let aplicados = 0
  const erros: { produtoIdA: string; erro: string }[] = []

  for (const item of itens) {
    // Revalida posse: produtoIdA precisa pertencer à empresa_id_a da
    // parceria e produtoIdB à empresa_id_b (nunca aceita produto de fora
    // do par definido, mesmo que o payload tente forçar outro id).
    const [{ data: pa }, { data: pb }] = await Promise.all([
      sb.from('produtos').select('id').eq('id', item.produtoIdA).eq('empresa_id', parceria.empresa_id_a).maybeSingle(),
      sb.from('produtos').select('id').eq('id', item.produtoIdB).eq('empresa_id', parceria.empresa_id_b).maybeSingle(),
    ])
    if (!pa || !pb) { erros.push({ produtoIdA: item.produtoIdA, erro: 'Produto não encontrado na empresa esperada' }); continue }

    const { error } = await sb.from('produto_vinculos').insert({
      parceria_id: parceriaId, produto_id_a: pa.id, produto_id_b: pb.id,
      metodo: item.metodo ?? 'manual', criado_por: guarda.userId,
    })
    if (error) { erros.push({ produtoIdA: item.produtoIdA, erro: error.message }); continue }
    aplicados++
  }

  if (aplicados > 0) {
    await registrarAuditoria(sb, {
      empresaId: guarda.empresaId, usuarioId: guarda.userId,
      acao: 'produtos_vinculados', tabela: 'produto_vinculos', valorNovo: { parceriaId, quantidade: aplicados },
    })
  }

  return NextResponse.json({ ok: true, aplicados, erros })
}
