import { createAdminClient } from '@/lib/supabase/admin'
import { operacaoProtegida } from '@/lib/pdv/operacaoProtegida'

// CONVERSÃO DE ORÇAMENTO EM VENDA — FASE 0.6C.6A.
//
// ── O QUE ISTO SUBSTITUI ────────────────────────────────────────────────
//
// `marcarConvertido` era um QUINTO caminho de escrita de orçamento: fora do
// `orcamentoComando`, pelo `anon`, sem `registrarFallback`, e com o erro
// engolido em duas camadas — `.catch(() => {})` no renderer e `catch {}` no
// main. A venda entrava e o orçamento podia continuar aberto, em silêncio.
//
// ── O QUE ESTA ROTA GARANTE, E O QUE NÃO GARANTE ────────────────────────
//
// Garante que um orçamento seja convertido por **no máximo uma venda**, com
// arbitragem no servidor, idempotente para retry da mesma venda e com conflito
// nomeado quando outra venda chegou primeiro.
//
// NÃO garante que a venda em si seja idempotente. A venda continua nascendo no
// SQLite e subindo pelo caminho legado — isso é `registrarVenda`, e é outra
// fase. O que esta rota resolve é o VÍNCULO, não a venda.
//
// ── A CHAVE ─────────────────────────────────────────────────────────────
//
// `<orcamento_id>:conv:<venda_id>`. Derivada aqui, como nas outras rotas: um
// cliente com defeito não consegue reusar a chave de outra operação e ter a
// sua engolida como replay. A chave amarra o PAR — retry da mesma venda repete
// a mesma chave; outra venda é outra operação, e tem que conflitar de verdade,
// não ser confundida com replay.

const HTTP_POR_ESTADO: Record<string, number> = {
  convertido: 200,
  ja_convertido: 200,          // retry da MESMA venda: sucesso idempotente
  conflito_conversao: 409,     // outra venda levou — não adianta repetir
  conflito_versao: 409,
  recusado_cancelado: 409,
  nao_encontrado: 404,
}

type Resultado = { estado?: string }

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => ({}))

  const orcamentoId = String(corpo?.orcamento_id ?? '')
  const vendaId = String(corpo?.venda_id ?? '')
  const corpoComChave = { ...corpo, idempotency_key: `${orcamentoId}:conv:${vendaId}` }

  return operacaoProtegida(req, {
    operacao: 'orcamentos.converter',
    flagDaOperacao: 'orcamentos',
    corpo: corpoComChave,
    httpDoResultado: (r) => HTTP_POR_ESTADO[(r as Resultado)?.estado ?? ''] ?? 500,
    executar: async (ctx) => {
      if (!orcamentoId || !vendaId) {
        return { estado: 'nao_encontrado' as const, erro: 'Informe orcamento_id e venda_id.' }
      }
      const base = corpo?.revisao_base
      const revisaoBase = Number.isInteger(base) && base >= 0 ? base : null

      const sb = createAdminClient()
      const { data, error } = await sb.rpc('converter_orcamento_pdv', {
        p_empresa_id: ctx.empresa_id,      // ← do token, nunca do corpo
        p_orcamento_id: orcamentoId,
        p_venda_id: vendaId,
        p_revisao_base: revisaoBase,
      })
      // Erro do Postgres é transitório para o cliente: 500, e ele repete com a
      // MESMA chave. Diferente do conflito, que é 409 e não deve ser repetido.
      if (error) throw new Error(error.message)

      return data as Resultado
    },
  })
}
