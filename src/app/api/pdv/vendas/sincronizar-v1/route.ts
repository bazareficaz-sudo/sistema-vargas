import { createAdminClient } from '@/lib/supabase/admin'
import { operacaoProtegida } from '@/lib/pdv/operacaoProtegida'

// FASE 0.6D.3 — A VENDA INTEIRA NUMA CHAMADA.
//
// ── O QUE ESTA ROTA SUBSTITUI ────────────────────────────────────────────
//
// No caminho legado, uma venda são três a cinco requisições independentes,
// direto do terminal com a chave `anon`:
//
//   insert vendas · insert venda_itens · N × CAS de estoque
//   (+ produto_estoque e estoque_movimentacoes por item)
//
// A 0.6D.0R mediu o que isso produz: a linha `vendas` é idempotente desde a
// 0.6C.6A, mas o `return existente` do reenvio acontece ANTES dos itens e do
// estoque. Uma venda que chega ao servidor e não completa os efeitos NUNCA
// os completa — o retry reconhece, devolve sucesso, e a fila marca `synced`.
//
// Aqui é uma chamada só, e quem materializa tudo é
// `sincronizar_venda_pdv_v1`, numa transação do Postgres.
//
// ── POR QUE A RPC NÃO É EXPOSTA DIRETAMENTE ──────────────────────────────
//
// Ela é `service_role` e só. O terminal não tem — e não pode ter — essa
// chave: ela ignora RLS no banco inteiro. O caminho é sempre
// terminal → (token do terminal) → esta rota → (service_role) → RPC.
//
// ── O QUE ESTA ROTA NÃO FAZ ──────────────────────────────────────────────
//
// Não arbitra orçamento. Quem arbitra é o terminal, ANTES, por
// `/api/pdv/orcamentos/converter` — e a RPC apenas CONFERE que
// `orcamentos.venda_id` já aponta para esta venda. Manter a arbitragem fora
// daqui é o que preserva a 0.6C.6A.1: nenhum efeito remoto da venda antes de
// o servidor ter dito quem ganhou o orçamento.

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => ({}))
  const payload = (corpo as Record<string, unknown>)?.payload

  return operacaoProtegida(req, {
    operacao: 'vendas.sincronizar_v1',
    corpo: corpo as Record<string, unknown>,
    // Flag PRÓPRIA. Ligar orçamentos não pode ligar a venda inteira por
    // tabela — são riscos de tamanhos diferentes.
    flagDaOperacao: 'vendas_transacional_v1',
    // A RPC devolve conflitos que NÃO são erro de servidor: payload
    // divergente, orçamento não arbitrado, legado incompatível. Se virassem
    // 5xx, o terminal trataria como transitório e repetiria para sempre algo
    // que nunca vai mudar. 409 diz "pare e olhe", que é o correto.
    httpDoResultado: (r) => {
      const estado = (r as { estado?: string })?.estado
      if (estado === 'payload_invalido') return 400
      if (estado && estado.startsWith('conflito')) return 409
      if (estado === 'legado_incompativel') return 409
      return 200
    },
    executar: async (ctx) => {
      if (!payload || typeof payload !== 'object') {
        return { ok: false, estado: 'payload_invalido', motivo: 'corpo sem `payload`' }
      }

      // A EMPRESA É A DO TOKEN, sempre. O terminal manda a dele por
      // conveniência de log, e `operacaoProtegida` já recusa divergência —
      // mas quem vai para o banco é esta, não a do corpo.
      const seguro = { ...(payload as Record<string, unknown>), empresa_id: ctx.empresa_id }

      const sb = createAdminClient()
      const { data, error } = await sb.rpc('sincronizar_venda_pdv_v1', { p_payload: seguro })

      if (error) {
        // Erro de banco é transitório do ponto de vista do terminal: o estado
        // remoto é desconhecido. Sobe como 500 para ele repetir com o MESMO
        // uuid — que é seguro, porque a RPC é idempotente.
        throw new Error(`sincronizar_venda_pdv_v1: ${error.message}`)
      }

      const r = (data ?? {}) as Record<string, unknown>
      return { ok: r.estado !== 'payload_invalido', ...r }
    },
  })
}
