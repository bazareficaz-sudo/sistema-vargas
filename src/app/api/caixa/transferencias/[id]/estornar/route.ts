import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auth/permissoes'
import { contextoCaixa } from '@/lib/caixa/contextoCaixa'
import { statusDoEstado } from '@/lib/caixa/transferencia'

// Estorna a transferência INTEIRA.
//
// Estornar um movimento só deixaria o dinheiro voltando de um lado e não do
// outro — metade do par — que é exatamente o buraco que a Fase 2 fecha. Por
// isso o estorno é do documento, e gera um par novo com origem e destino
// trocados. O original nunca é tocado: append-only vale aqui também.
//
// PERMISSÃO PRÓPRIA. Lançar uma sangria e desfazer uma são decisões
// diferentes: `estornar_caixa` fica com admin e gerente, enquanto
// `financeiro` opera sangria e suprimento mas não reverte. A exceção
// individual por usuário continua valendo por cima, como em qualquer
// permissão do sistema.
//
// O id do estorno é gerado NO SERVIDOR: diferente da transferência, aqui a
// identidade que idempotentiza é a da transferência ALVO — dois pedidos de
// estorno da mesma transferência convergem em `ja_estornada` pelo índice
// único de `estorno_de_id`, não pelo id do estorno.

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const sb = await createClient()
  const guarda = await contextoCaixa(sb, 'estornar_caixa')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: resultado, error } = await sb.rpc('estornar_transferencia_caixa_v1', {
    p: {
      id: randomUUID(),
      transferencia_id: id,
      empresa_id: guarda.empresaId,   // do contexto: não se estorna de outra empresa
      usuario_id: guarda.userId,
    },
  })
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  const estado = resultado?.estado as string
  const status = statusDoEstado(estado)
  if (status !== 200) {
    return NextResponse.json({ ok: false, estado, erro: resultado?.motivo ?? estado }, { status })
  }

  if (estado === 'estornada') {
    await registrarAuditoria(sb, {
      empresaId: guarda.empresaId, usuarioId: guarda.userId,
      acao: 'caixa_transferencia_estornada', tabela: 'caixa_transferencia',
      valorAnterior: { transferencia_id: id },
      valorNovo: { estorno_id: resultado?.transferencia_id, valor: resultado?.valor },
    })
  }

  return NextResponse.json({ ok: true, estado, estorno_id: resultado?.transferencia_id })
}
