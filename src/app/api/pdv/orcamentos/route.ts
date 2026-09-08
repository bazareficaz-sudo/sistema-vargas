import { createAdminClient } from '@/lib/supabase/admin'
import { operacaoProtegida } from '@/lib/pdv/operacaoProtegida'
import { validarOrcamento, chaveDoOrcamento, httpDoEstado } from '@/lib/pdv/payloadOrcamento'

// ORÇAMENTO COMO COMANDO ÚNICO.
//
// Criação e edição são a MESMA rota, e é de propósito: ter dois verbos foi o
// que permitiu, no caminho atual, que status e conteúdo andassem separados —
// duas requisições HTTP para uma intenção só, uma podendo passar e a outra não.
//
// O servidor decide qual é: sem linha ⇒ cria; com linha ⇒ substitui.
//
// ── AS TRÊS PEÇAS, QUE RESOLVEM TRÊS PROBLEMAS DIFERENTES ────────────────
//
//   idempotency_key  = <id_local>:r<revisao_base>   → repetição
//   revisao_base                                     → ordem
//   RPC transacional                                 → atomicidade
//
// Confundir os três é como se perde uma edição sem ninguém notar. A chave
// impede que um retry duplique; a revisão impede que uma versão velha
// sobrescreva uma nova; a transação impede que exista um orçamento pela
// metade.
//
// ── A REVISÃO NASCE NUM LUGAR SÓ ─────────────────────────────────────────
//
// O SERVIDOR é a autoridade. O cliente nunca incrementa: ele declara de qual
// estado confirmado partiu (`revisao_base`) e recebe de volta a revisão nova.
// Se as duas pontas pudessem incrementar, duas edições concorrentes chegariam
// com o mesmo número e uma sobrescreveria a outra em silêncio.

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => ({}))

  // A chave é DERIVADA aqui e conferida contra a que o cliente mandou.
  //
  // O cliente persiste a chave antes da primeira tentativa — é o que a faz
  // sobreviver a timeout, fechamento e reinício. Mas quem manda no formato é
  // o servidor: se a chave recebida não for a que se espera daquele documento
  // e revisão, ela é ignorada e vale a derivada. Assim um cliente com defeito
  // não consegue reusar a chave de outra operação e ter a sua engolida como
  // replay.
  const id = String(corpo?.orcamento_id ?? '')
  const base = Number(corpo?.revisao_base ?? 0)
  const acao = corpo?.acao === 'cancelar' ? 'cancelar' : 'salvar'
  const corpoComChave = {
    ...corpo,
    idempotency_key: `${chaveDoOrcamento(id, Number.isFinite(base) ? base : 0)}:${acao}`,
  }

  return operacaoProtegida(req, {
    // Cancelar e salvar são intenções diferentes e ficam contadas separadas.
    operacao: `orcamentos.${acao}`,
    flagDaOperacao: 'orcamentos',
    corpo: corpoComChave,
    httpDoResultado: (r) => httpDoEstado((r as { estado?: string })?.estado),
    executar: async (ctx) => {
      const v = validarOrcamento(corpo)
      // Validar ANTES da transação: recusar aqui custa uma resposta; recusar
      // lá dentro custaria um número de sequência queimado à toa.
      if (!v.ok) return { estado: 'payload_invalido' as const, erro: v.erro }

      const sb = createAdminClient()
      const { data, error } = await sb.rpc('salvar_orcamento_pdv', {
        p_empresa_id: ctx.empresa_id,      // ← do token, nunca do corpo
        p_terminal_id: ctx.terminal_id,
        p_orcamento_id: v.comando.orcamento_id,
        p_revisao_base: v.comando.revisao_base,
        p_cabecalho: v.comando.cabecalho,
        p_itens: v.comando.itens,
      })

      // Erro do Postgres é transitório do ponto de vista do cliente: ele deve
      // repetir com a MESMA chave. Lançar aqui vira 500, que é a semântica
      // certa — ao contrário do conflito, que é 409 e não deve ser repetido.
      if (error) throw new Error(error.message)

      return data as { estado: string; orcamento_id?: string; numero?: number; revisao?: number }
    },
  })
}
