import { createAdminClient } from '@/lib/supabase/admin'
import { leituraProtegida } from '@/lib/pdv/leituraProtegida'

// SNAPSHOT DE UM ORÇAMENTO, PARA AÇÃO CRUZADA ONLINE.
//
// O PDV mantém em disco os documentos que ele próprio criou. Um orçamento de
// outro terminal ele conhece só pelo cabeçalho, que desce no sync. Para
// VISUALIZAR, EDITAR ou CANCELAR esse documento, ele pede aqui um estado
// completo e coerente — e não guarda os itens.
//
// A garantia que importa está na RPC: cabeçalho, itens e revisão saem de UMA
// instrução SQL, logo de um snapshot só. Duas consultas separadas — que é o que
// o `getOrcamentoCloud` legado faz — podem pegar o cabeçalho da revisão 4 com
// os itens da 3, e aí a próxima edição sobrescreve em silêncio itens que o
// operador nunca viu.
//
// A `revisao` devolvida aqui é o que o cliente usa como `revisao_base` na
// gravação seguinte. Se alguém tiver editado no intervalo, a RPC de escrita
// responde 409 e nada é sobrescrito.

type Snapshot = { estado: string; revisao?: number }

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return leituraProtegida(req, {
    // Mesmo rollout da escrita: terminal sem a flag cai no caminho legado e
    // registra fallback, como em todo o resto da migração.
    flagDaOperacao: 'orcamentos',
    // 404 é o desfecho certo tanto para "não existe" quanto para "é de outra
    // empresa" — a RPC devolve o mesmo `nao_encontrado` nos dois casos, de
    // propósito, e a rota não tem como distinguir nem deve ter.
    httpDoResultado: (r) => ((r as Snapshot)?.estado === 'encontrado' ? 200 : 404),
    ler: async (ctx) => {
      const sb = createAdminClient()
      const { data, error } = await sb.rpc('ler_orcamento_pdv', {
        p_empresa_id: ctx.empresa_id,      // ← do token/banco, nunca do cliente
        p_orcamento_id: id,
      })
      if (error) throw new Error(error.message)
      return data as Snapshot
    },
  })
}
