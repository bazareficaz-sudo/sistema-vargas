import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auth/permissoes'
import { contextoCaixa } from '@/lib/caixa/contextoCaixa'
import { prepararEstorno } from '@/lib/caixa/movimento'

// Corrige um lançamento errado — nunca por UPDATE/DELETE (seção K.5 da
// auditoria). Lança um movimento novo de sinal contrário, referenciando o
// original por `estorno_de_id`. O índice único do banco
// (`idx_caixa_movimento_estorno_unico`) é a trava real contra concorrência;
// `prepararEstorno` só antecipa o erro com uma mensagem legível.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const sb = await createClient()
  const guarda = await contextoCaixa(sb, 'estornar_caixa')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: original } = await sb.from('caixa_movimento')
    .select('id, caixa_id, tipo, natureza, valor, estorno_de_id, transferencia_id')
    .eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!original) return NextResponse.json({ ok: false, erro: 'Movimento não encontrado.' }, { status: 404 })

  // FASE 2 — METADE DE UMA TRANSFERÊNCIA NÃO SE ESTORNA AQUI.
  //
  // Esta rota estorna UM movimento. Um movimento de sangria/suprimento é um
  // dos dois lados de uma transferência: revertê-lo sozinho devolveria o
  // dinheiro à gaveta sem tirá-lo da tesouraria, e o sistema passaria a
  // contar o mesmo dinheiro duas vezes — exatamente o descasamento que a
  // Fase 2 existe para impedir.
  //
  // O estorno da transferência inteira vive em
  // /api/caixa/transferencias/[id]/estornar e exige `estornar_caixa`.
  if (original.transferencia_id) {
    return NextResponse.json({
      ok: false,
      erro: 'Este movimento faz parte de uma transferência entre caixas. '
          + 'Estorne a transferência inteira, não um dos lados.',
      transferencia_id: original.transferencia_id,
    }, { status: 409 })
  }

  const { data: existente } = await sb.from('caixa_movimento')
    .select('id').eq('estorno_de_id', id).maybeSingle()

  const preparado = prepararEstorno(original, new Set(existente ? [id] : []))
  if (!preparado.ok) return NextResponse.json({ ok: false, erro: preparado.erro }, { status: 400 })

  const { data: estorno, error } = await sb.from('caixa_movimento').insert({
    caixa_id: original.caixa_id,
    empresa_id: guarda.empresaId,
    usuario_id: guarda.userId,
    observacao: `Estorno do lançamento ${id}.`,
    ...preparado.estorno,
  }).select('*').single()
  if (error) {
    // Corrida perdida contra o índice único: outro estorno chegou primeiro.
    if (error.code === '23505') {
      return NextResponse.json({ ok: false, erro: 'Este movimento já foi estornado.' }, { status: 409 })
    }
    return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })
  }

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: 'caixa_movimento_estornado', tabela: 'caixa_movimento',
    valorAnterior: { id: original.id, natureza: original.natureza, tipo: original.tipo, valor: original.valor },
    valorNovo: { id: estorno.id, tipo: estorno.tipo, valor: estorno.valor },
  })

  return NextResponse.json({ ok: true, estorno })
}
