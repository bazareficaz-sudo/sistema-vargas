// Buscar TODAS as linhas de uma consulta, e não as 1.000 primeiras.
//
// O PostgREST responde no máximo 1.000 linhas por requisição. Isso não é erro:
// é o teto configurado no projeto, e ele chega em silêncio — a resposta vem
// com status 200, `error` nulo e um pedaço dos dados. Quem soma essa lista
// acha que somou o mês.
//
// Foi assim que o card "Faturamento do mês" passou a mentir quando a loja
// cresceu: em julho, 395 vendas cabiam; em agosto, 1.701 não. O painel mostrava
// R$ 26.614,94 de R$ 45.012,53 — exatamente as 1.000 vendas mais antigas.
//
// QUANDO USAR ESTA FUNÇÃO: a tela precisa das LINHAS (curva ABC, venda por
// hora do dia, lista de produtos com giro).
//
// QUANDO NÃO USAR: a tela quer um número ou uma lista já agrupada. Aí a soma
// pertence ao banco — `vendas_resumo`, `produtos_vendidos` e companhia, em
// `supabase-relatorios-agregados.sql`. Trazer 2.000 linhas para reduzir a uma
// é desperdício que cresce com o movimento.

type RespostaSupabase<T> = { data: T[] | null; error: { message: string } | null }

const TAMANHO_PAGINA = 1000

/**
 * Percorre a consulta em páginas até acabar.
 *
 * `montarPagina` recebe o intervalo e devolve a consulta JÁ com `.range()`.
 * É função, e não uma consulta pronta, porque o construtor do supabase-js é
 * mutável e de uso único: reaproveitar o mesmo objeto para a segunda página
 * traz de volta a primeira.
 *
 * **A consulta precisa de `.order()` por uma coluna estável** (`id` serve).
 * Sem ordenação declarada o Postgres não promete a mesma ordem entre duas
 * requisições, e o que se ganha em completude se perde em linha repetida e
 * linha faltante — um erro pior que o original, porque é intermitente.
 *
 * `teto` é rede de segurança contra laço infinito, não limite de negócio: se
 * for atingido, a função avisa no log em vez de devolver dado parcial calado,
 * que é justamente o defeito que ela existe para consertar.
 */
export async function buscarTudo<T>(
  montarPagina: (de: number, ate: number) => PromiseLike<RespostaSupabase<T>>,
  opcoes: { tamanhoPagina?: number; teto?: number; rotulo?: string } = {},
): Promise<T[]> {
  const tamanho = opcoes.tamanhoPagina ?? TAMANHO_PAGINA
  const teto = opcoes.teto ?? 50_000
  const tudo: T[] = []

  for (let de = 0; de < teto; de += tamanho) {
    const { data, error } = await montarPagina(de, de + tamanho - 1)
    if (error) throw new Error(error.message)
    const pagina = data ?? []
    tudo.push(...pagina)
    // Página incompleta significa fim: não há o que buscar depois dela.
    if (pagina.length < tamanho) return tudo
  }

  console.warn(
    `[paginar] teto de ${teto} linhas atingido${opcoes.rotulo ? ` em ${opcoes.rotulo}` : ''} — ` +
    'o resultado está incompleto. Esta consulta provavelmente deveria ser uma agregação no banco.'
  )
  return tudo
}
