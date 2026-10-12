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

// Leitura do terminal: o que a empresa configurou sobre impressão.
//
// Devolve duas coisas que não têm a mesma natureza, e por isso ficam em
// campos separados:
//
//   `impressao` — a URL do CAIXA, publicada por um terminal para os outros.
//                 É estado de rede, muda a cada túnel novo.
//   `cupom`     — a mensagem de rodapé que a empresa escolheu na tela de
//                 Configurações → Impressão. É decisão de negócio, e já
//                 alimentava o comprovante em PDF desde que a tela existe.
//
// ── POR QUE AQUI, E NÃO NUMA ROTA NOVA ───────────────────────────────────
//
// O terminal já consulta esta rota. `empresa_config_impressao` não está
// aberta ao `anon` (conferido em produção: `has_table_privilege` falso),
// então ler direto do banco exigiria devolver um privilégio que foi tirado
// de propósito. Pendurar o campo numa rota que já autentica pelo token do
// terminal não abre nada novo.
//
// ── O QUE ISTO CORRIGE ───────────────────────────────────────────────────
//
// Hoje o cupom térmico é montado pela máquina que imprime, lendo o store
// DELA. Com seis terminais, a mesma frase teria que ser digitada seis vezes,
// e divergiria na primeira troca de telefone. Lido do servidor, o valor é um
// só — e deixa de importar qual máquina renderiza.
export async function GET(req: Request) {
  const { autenticarTerminalPdv, respostaDeRecusa } = await import('@/lib/pdv/autenticarTerminal')
  const acesso = await autenticarTerminalPdv(req, { exigirFlag: false })
  if (!acesso.ok) return respostaDeRecusa(acesso)

  const sb = createAdminClient()
  const empresaId = acesso.contexto.empresa_id

  const [{ data: impressao }, { data: cupom }] = await Promise.all([
    sb.from('pdv_impressao')
      .select('print_server_url, terminal_id, updated_at')
      .eq('empresa_id', empresaId).maybeSingle(),
    sb.from('empresa_config_impressao')
      .select('mensagem_rodape')
      .eq('empresa_id', empresaId).maybeSingle(),
  ])

  return NextResponse.json({
    ok: true,
    impressao: impressao ?? null,
    // Empresa sem linha na tabela é empresa que nunca abriu a tela. Devolver
    // `null` deixa o terminal manter o rodapé que ele já imprimia; devolver
    // string vazia mandaria apagá-lo. São respostas diferentes de propósito.
    cupom: { mensagem_rodape: cupom?.mensagem_rodape ?? null },
  })
}
