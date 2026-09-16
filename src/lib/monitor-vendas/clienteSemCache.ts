import { createBrowserClient } from '@supabase/ssr'

// O Monitor de Vendas faz a MESMA consulta de novo a cada 60s (auto-refresh)
// e a cada clique no botão manual. Com a mesma URL/querystring, o navegador
// pode responder do cache HTTP sem ir ao banco — o sintoma é exatamente o que
// apareceu aqui: o relógio "atualizado às" anda, mas os números não mudam,
// porque a resposta servida é a mesma de antes.
//
// `cache: 'no-store'` no fetch força ida à rede em toda chamada. Cliente à
// parte (em vez de mexer em `lib/supabase/client.ts`) para não mudar o
// comportamento de cache do resto do painel, que não tem esse problema
// porque não faz polling.
export function criarClienteSemCache() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) } },
  )
}
