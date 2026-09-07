import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { operacaoProtegida } from '@/lib/pdv/operacaoProtegida'
import { urlDeImpressaoValida } from '@/lib/pdv/urlImpressao'

// A PRIMEIRA OPERAÇÃO ATRÁS DA IDENTIDADE DO TERMINAL.
//
// O que ela faz: o terminal que tem a impressora física roda um túnel
// Cloudflare, que ganha uma URL pública nova a cada reinício. Ele publica
// essa URL aqui, e os outros terminais da mesma empresa a consultam a cada
// sincronização e se autoconfiguram.
//
// ── POR QUE ESTA, E NÃO OUTRA ────────────────────────────────────────────
//
// Ela é a única escrita do PDV que satisfaz os critérios todos ao mesmo
// tempo — baixa frequência, não bloqueia venda, fácil de conferir, sem
// estoque, sem dinheiro, sem risco de duplicidade — e tem uma quinta
// propriedade que nenhuma outra tem:
//
//     ELA JÁ ESTÁ QUEBRADA EM PRODUÇÃO.
//
// O `anon` perdeu INSERT e UPDATE em `pdv_impressao` numa onda anterior de
// fechamento de privilégios, cuja justificativa escrita foi "o terminal lê
// config, nunca a grava". Ele grava. O upsert falha, `console.warn` registra
// num log que ninguém lê, e quem chama tem `.catch(() => {})`. A linha em
// produção está com 10 dias, e a URL de um Quick Tunnel muda a cada reinício.
//
// Isso torna esta a migração mais segura possível: não existe regressão a
// causar, porque não existe funcionamento a preservar. O pior caso da rota
// nova é continuar quebrado — que é o estado de hoje. O melhor caso é
// consertar, pela porta certa, algo que já devia funcionar.
//
// ── O QUE ELA CONSERTA DE QUEBRA ─────────────────────────────────────────
//
// No caminho legado, a `empresa_id` deste upsert vinha de
// `store.get('auth.usuario')` — o JSON local editável — e a tabela tem
// `empresa_id` como chave primária. Um terminal podia publicar a própria URL
// de impressão na linha de OUTRA empresa, e os terminais dela passariam a
// mandar cupom para uma impressora de fora. Aqui a empresa vem do token.

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => ({}))

  return operacaoProtegida(req, {
    operacao: 'impressao.publicar_url',
    corpo,
    executar: async (ctx) => {
      const url = String(corpo?.print_server_url ?? '').trim()
      if (!urlDeImpressaoValida(url)) {
        throw new Error('URL de impressão inválida.')
      }

      const sb = createAdminClient()
      const { error } = await sb.from('pdv_impressao').upsert({
        empresa_id: ctx.empresa_id,       // ← do token, não do corpo
        print_server_url: url,
        // Passa a ser o UUID do terminal, e não mais a string editável do
        // arquivo local. É o primeiro lugar do sistema onde `terminal_id`
        // quer dizer alguma coisa verificável.
        terminal_id: ctx.terminal_id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'empresa_id' })

      if (error) throw new Error(error.message)

      return { print_server_url: url, terminal: ctx.nome }
    },
  })
}

// Leitura de diagnóstico: qual URL está publicada para a empresa deste
// terminal. Não substitui a leitura legada (que segue pelo `anon` e funciona);
// existe para o piloto poder conferir o efeito da escrita sem abrir o banco.
export async function GET(req: Request) {
  const { autenticarTerminalPdv, respostaDeRecusa } = await import('@/lib/pdv/autenticarTerminal')
  const acesso = await autenticarTerminalPdv(req, { exigirFlag: false })
  if (!acesso.ok) return respostaDeRecusa(acesso)

  const sb = createAdminClient()
  const { data } = await sb.from('pdv_impressao')
    .select('print_server_url, terminal_id, updated_at')
    .eq('empresa_id', acesso.contexto.empresa_id)
    .maybeSingle()

  return NextResponse.json({ ok: true, impressao: data ?? null })
}
