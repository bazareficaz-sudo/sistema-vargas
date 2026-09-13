import { createAdminClient } from '@/lib/supabase/admin'
import { leituraProtegida } from '@/lib/pdv/leituraProtegida'

// A REDE DE SEGURANÇA DO SYNC INCREMENTAL.
//
// O sync de produtos é incremental por `updated_at`. Isso tem um buraco que
// o próprio PDV já documenta: se o catálogo LOCAL encolher — limpeza de dados
// legados, corrupção do SQLite, terminal restaurado de backup velho — os
// produtos que sumiram de lá não voltam nunca, porque o `updated_at` deles no
// servidor não mudou. O incremental não os vê.
//
// A defesa é comparar as contagens: local muito menor que remoto força uma
// carga completa. Por isso esta rota existe separada, e por isso ela conta só
// os ATIVOS — é com esse número que o PDV compara.
//
// `head: true` de propósito: a resposta é um inteiro, não 28.676 linhas.
export async function GET(req: Request) {
  return leituraProtegida(req, {
    flagDaOperacao: 'produtos',
    ler: async (ctx) => {
      const sb = createAdminClient()
      const { count, error } = await sb.from('produtos')
        .select('id', { count: 'exact', head: true })
        .eq('empresa_id', ctx.empresa_id)
        .eq('ativo', true)

      if (error) throw new Error(error.message)
      return { total: count ?? 0 }
    },
  })
}
