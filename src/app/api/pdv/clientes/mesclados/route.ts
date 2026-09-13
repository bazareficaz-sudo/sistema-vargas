import { createAdminClient } from '@/lib/supabase/admin'
import { leituraProtegida } from '@/lib/pdv/leituraProtegida'

// QUEM VIROU QUEM.
//
// `GET /api/pdv/clientes` só traz os ATIVOS, então um cadastro unificado no
// ERP some do snapshot e o terminal fica com o `remote_id` de um cliente morto
// para sempre — sem erro, só sem atualização nunca mais.
//
// Esta lista é o que o PDV usa para seguir a unificação em vez de ignorá-la.
// É pequena por natureza (só as linhas com `mesclado_em` preenchido) e não
// pagina: paginar aqui seria inventar um problema que a tabela não tem.
//
// Rota separada, e não um campo do snapshot, porque as duas leituras têm
// recortes opostos: aquela é incremental e só de ativos, esta é completa e só
// dos inativados por unificação. Misturá-las obrigaria uma das duas a mentir.
export async function GET(req: Request) {
  return leituraProtegida(req, {
    flagDaOperacao: 'clientes',
    ler: async (ctx) => {
      const sb = createAdminClient()
      const { data, error } = await sb.from('clientes')
        .select('id, mesclado_em')
        .eq('empresa_id', ctx.empresa_id)
        .not('mesclado_em', 'is', null)

      if (error) throw new Error(error.message)
      return { pares: data ?? [] }
    },
  })
}
