// Produtos similares — o mesmo item de marcas diferentes, agrupados pelo
// gestor no cadastro (coluna produtos.grupo_similar). O PDV usa o grupo para
// mostrar as opções ao vendedor antes de lançar o item.

/**
 * Forma canônica do rótulo do grupo: maiúsculas, sem espaços sobrando.
 * "disjuntor  mono 32a " e "DISJUNTOR MONO 32A" precisam cair no MESMO grupo,
 * senão um espaço digitado a mais separa o produto dos seus similares sem
 * ninguém perceber. Vazio vira null (= sem grupo).
 */
export function normalizarGrupoSimilar(v: string | null | undefined): string | null {
  const s = (v ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
  return s || null
}

/** Chave de comparação de nomes: sem acento, sem caixa, espaços simples. */
export function chaveNome(nome: string | null | undefined): string {
  return (nome ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Quantos itens da lista têm cada nome. Serve para o PDV marcar, na lista de
 * busca, os produtos que só se diferenciam pela marca — mesmo os que o gestor
 * ainda não agrupou.
 */
export function contarNomesRepetidos(lista: { nome: string }[]): Map<string, number> {
  const contagem = new Map<string, number>()
  for (const p of lista) {
    const k = chaveNome(p.nome)
    contagem.set(k, (contagem.get(k) ?? 0) + 1)
  }
  return contagem
}

/**
 * Condição "nome OU marca contém o termo" para um `.or()` do PostgREST.
 *
 * O valor vai entre aspas porque vírgula e parênteses são sintaxe do filtro —
 * sem aspas, "cabo 2,5mm" quebraria a consulta inteira, e tirar a vírgula
 * transformaria "2,5" em "25". Dentro das aspas só aspas e barra precisam
 * sair. `%` e `*` também saem: são curingas do ILIKE e um deles digitado
 * viraria "qualquer coisa".
 */
export function filtroNomeOuMarca(termo: string): string | null {
  const t = termo.replace(/["\\%*]/g, '').trim()
  if (!t) return null
  return `nome.ilike."%${t}%",marca.ilike."%${t}%"`
}
