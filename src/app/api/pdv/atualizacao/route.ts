import { createAdminClient } from '@/lib/supabase/admin'
import { leituraProtegida } from '@/lib/pdv/leituraProtegida'
import { tetoDeAtualizacao } from '@/lib/pdv/atualizacao'

// ATUALIZAÇÃO DO PDV, LIBERADA TERMINAL POR TERMINAL.
//
// O electron-updater lê as Releases do GitHub, e uma Release publicada
// chegaria a todos os terminais de uma vez — sem piloto, sem ordem, e
// inclusive a um terminal de outra linhagem que não pode recebê-la. Por isso
// nenhuma Release era publicada e toda atualização era manual.
//
// A partir da 1.10.8 o PDV pergunta aqui antes de baixar e só aceita uma
// versão até o teto que esta rota devolver. O rollout vira uma coluna:
//
//   update pdv_terminais set atualizacao_liberada_ate = '1.10.9'
//    where terminal_id_legado = 'PDV-004';
//
// Sem flag de rollout: todo terminal ativo precisa conseguir perguntar — e a
// resposta padrão (NULL) é "não atualize", que é o comportamento seguro.
export async function GET(req: Request) {
  return leituraProtegida(req, {
    exigirFlag: false,
    ler: async (ctx) => {
      const sb = createAdminClient()
      const { data, error } = await sb.from('pdv_terminais')
        .select('atualizacao_liberada_ate')
        .eq('id', ctx.terminal_id)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return { liberada_ate: tetoDeAtualizacao(data?.atualizacao_liberada_ate) }
    },
  })
}
