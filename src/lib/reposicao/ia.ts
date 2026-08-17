import { perguntarJSON } from '@/lib/ia/claude'

// Camada de IA sobre o motor de reposição — item 11 do desenho original.
//
// REGRA DE OURO: a IA COMPLEMENTA o cálculo, nunca o substitui. Tudo que
// dá para saber por regra simples (cobertura, ponto de reposição, giro)
// já está em `reposicao_metricas`, calculado por `motor.ts`. A IA entra
// só onde regra simples não enxerga: um padrão que cruza várias colunas
// ao mesmo tempo e que uma pessoa lendo a planilha notaria, mas uma
// fórmula de uma linha não capta.
//
// UMA CHAMADA PARA O LOTE INTEIRO, não uma por produto. 40 produtos = 1
// chamada, não 40. Além do custo, é o que permite o resumo do comprador
// (item 37) sair coerente — comparando os produtos entre si, não cada um
// isolado.
//
// SÓ SOBRE OS DE MAIOR SCORE. Rodar isto sobre os 1.200+ produtos que o
// motor calcula, e pior, sobre os 14 mil produtos ativos, seria caro e
// inútil: a esmagadora maioria não tem nada de incomum para a IA achar,
// e o cálculo determinístico já cobre o básico sozinho.

const TIPOS_SINAL = ['aceleracao', 'queda_demanda', 'demanda_perdida', 'minimo_inadequado', 'excesso_a_liquidar'] as const
export type TipoSinal = typeof TIPOS_SINAL[number]

export type SinalIA = { tipo: TipoSinal; texto: string }

export type ResumoIA = {
  empresaId: string
  produtosAnalisados: number
  comSinal: number
  resumo: string
}

type MetricaParaIA = {
  produto_id: string
  nome: string
  categoria: string | null
  score: number
  prioridade: string
  vendas_7: number; vendas_30: number; vendas_90: number
  media_diaria: number; media_diaria_recente: number
  tendencia: number | null
  dias_sem_venda: number | null
  estoque_atual: number; estoque_minimo: number
  cobertura_dias: number | null
  faltas_abertas: number; encomendas_abertas: number; unidades_solicitadas: number
  classe_abc: string | null
  giro: string
  dias_historico: number
}

const PROMPT_SISTEMA = `Você analisa dados de reposição de estoque de uma loja de material de construção e ferragens no Brasil.

Cada produto na lista já passou por um cálculo determinístico (cobertura, ponto de reposição, giro) — isso NÃO é o seu trabalho, já está feito. Sua função é achar padrões que cruzam várias colunas ao mesmo tempo e que uma fórmula simples não capta.

Procure SOMENTE estes cinco tipos de sinal, e SÓ quando os números realmente sustentarem:

- "aceleracao": vendas recentes (7-15 dias) muito acima da média do período, de um jeito que muda a urgência da compra.
- "queda_demanda": estoque baixo ou abaixo do mínimo, mas a venda caiu — recomenda-se comprar MENOS do que a sugestão padrão indicaria.
- "demanda_perdida": estoque zerado ou negativo, com faltas ou encomendas registradas no PDV — sinal de que a venda registrada (baixa ou zero) esconde demanda real, porque o produto passou tempo sem estar disponível para vender.
- "minimo_inadequado": o estoque mínimo cadastrado está claramente descolado do giro real (muito abaixo do que vende, ou muito acima).
- "excesso_a_liquidar": cobertura de muitos meses, capital parado, candidato a promoção em vez de nova compra.

REGRAS RÍGIDAS:
- Cada sinal precisa citar o NÚMERO que o sustenta. Não escreva "vendendo bem" — escreva "vendeu 42 nos últimos 30 dias contra média de 12".
- histórico de vendas é de poucas semanas (dias_historico por produto) — NUNCA afirme padrão sazonal ("historicamente vende mais nesta época"), não há dado para isso.
- NUNCA afirme nada sobre a condição física, qualidade, ou estado de preparo do produto — você só vê números de venda e estoque, nunca viu o produto.
- Produto sem nada de incomum não entra na resposta. A maioria dos produtos da lista não deve ter sinal nenhum — isso é o esperado, não uma falha sua.
- Um produto pode ter mais de um sinal, ou nenhum.

Responda em JSON:
{
  "resumoComprador": "3-5 frases em português, para o comprador ler em 10 segundos. Fatos e números, sem floreio. Cite quantos produtos têm cada tipo de sinal encontrado.",
  "sinais": [
    { "produtoId": "...", "tipo": "aceleracao", "texto": "..." }
  ]
}`

function montarLinhaProduto(m: MetricaParaIA): string {
  return [
    `id=${m.produto_id}`,
    `nome="${m.nome}"`,
    m.categoria ? `categoria="${m.categoria}"` : null,
    `prioridade=${m.prioridade}`, `score=${m.score}`,
    `estoque=${m.estoque_atual}`, `minimo=${m.estoque_minimo}`,
    `vendas_7d=${m.vendas_7}`, `vendas_30d=${m.vendas_30}`, `vendas_90d=${m.vendas_90}`,
    `media_diaria_90d=${m.media_diaria}`, `media_diaria_15d=${m.media_diaria_recente}`,
    m.tendencia !== null ? `tendencia=${m.tendencia}x` : null,
    m.dias_sem_venda !== null ? `dias_sem_venda=${m.dias_sem_venda}` : 'nunca_vendeu',
    m.cobertura_dias !== null ? `cobertura_dias=${m.cobertura_dias}` : 'sem_giro',
    `faltas_pdv=${m.faltas_abertas}`, `encomendas=${m.encomendas_abertas}`, `unidades_solicitadas=${m.unidades_solicitadas}`,
    m.classe_abc ? `classe_abc=${m.classe_abc}` : null,
    `giro=${m.giro}`, `dias_historico=${m.dias_historico}`,
  ].filter(Boolean).join(' ')
}

/**
 * Gera os sinais do dia e o resumo do comprador, e grava.
 * `limite` é quantos produtos entram na chamada — 40 por padrão, mantendo
 * o prompt pequeno e a resposta rápida de revisar.
 */
export async function gerarSinaisIA(sb: any, empresaId: string, limite = 40): Promise<ResumoIA> {
  const { data: metricas, error } = await sb.from('reposicao_metricas')
    .select('produto_id, score, prioridade, vendas_7, vendas_30, vendas_90, media_diaria, media_diaria_recente, tendencia, dias_sem_venda, estoque_atual, estoque_minimo, cobertura_dias, faltas_abertas, encomendas_abertas, unidades_solicitadas, classe_abc, giro')
    .eq('empresa_id', empresaId)
    .order('score', { ascending: false })
    .limit(limite)
  if (error) throw new Error(`ler reposicao_metricas: ${error.message}`)
  if (!metricas || metricas.length === 0) {
    return { empresaId, produtosAnalisados: 0, comSinal: 0, resumo: 'Nenhum produto calculado ainda.' }
  }

  const ids = metricas.map((m: any) => m.produto_id)
  const { data: produtos } = await sb.from('produtos').select('id, nome, categoria').in('id', ids)
  const nomePorId = new Map((produtos ?? []).map((p: any) => [p.id, p.nome]))
  const categoriaPorId = new Map((produtos ?? []).map((p: any) => [p.id, p.categoria]))

  // dias_historico é o mesmo para toda a empresa — é o que impede a IA de
  // enxergar sazonalidade onde só há seis semanas de dado. Calculado igual
  // a `recalcularEmpresa` (fatia 2): dias desde a primeira venda.
  const { data: primeiraVendaRow } = await sb.from('vendas')
    .select('created_at').eq('empresa_id', empresaId).eq('status', 'concluida')
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  const diasHistorico = primeiraVendaRow
    ? Math.max(1, Math.floor((Date.now() - new Date(primeiraVendaRow.created_at).getTime()) / 86_400_000))
    : 1

  const linhas: MetricaParaIA[] = metricas.map((m: any) => ({
    ...m,
    nome: nomePorId.get(m.produto_id) ?? '(produto)',
    categoria: categoriaPorId.get(m.produto_id) ?? null,
    dias_historico: diasHistorico,
  }))

  const prompt = `${PROMPT_SISTEMA}\n\nProdutos (um por linha):\n${linhas.map(montarLinhaProduto).join('\n')}`

  const resposta = await perguntarJSON(prompt)
  const sinaisBrutos: { produtoId?: string; tipo?: string; texto?: string }[] = Array.isArray(resposta?.sinais) ? resposta.sinais : []
  const idsValidos = new Set(ids)

  const porProduto = new Map<string, SinalIA[]>()
  for (const s of sinaisBrutos) {
    if (!s.produtoId || !idsValidos.has(s.produtoId)) continue
    if (!s.tipo || !TIPOS_SINAL.includes(s.tipo as TipoSinal)) continue
    if (!s.texto) continue
    const arr = porProduto.get(s.produtoId) ?? []
    arr.push({ tipo: s.tipo as TipoSinal, texto: s.texto })
    porProduto.set(s.produtoId, arr)
  }

  const linhasGravar = [...porProduto.entries()].map(([produtoId, sinais]) => ({
    empresa_id: empresaId, produto_id: produtoId, sinais, gerado_em: new Date().toISOString(),
  }))

  // Limpa os sinais de rodadas anteriores antes de gravar os novos — um
  // produto que saiu do top N não deve continuar mostrando um sinal de
  // três dias atrás como se fosse de hoje.
  await sb.from('reposicao_ia_sinais').delete().eq('empresa_id', empresaId)
  if (linhasGravar.length > 0) {
    const { error: erroGravar } = await sb.from('reposicao_ia_sinais').insert(linhasGravar)
    if (erroGravar) throw new Error(`gravar sinais: ${erroGravar.message}`)
  }

  const resumo = typeof resposta?.resumoComprador === 'string'
    ? resposta.resumoComprador
    : `${linhas.length} produtos analisados, ${porProduto.size} com algum sinal fora do padrão.`

  await sb.from('reposicao_ia_resumo').upsert({
    empresa_id: empresaId, texto: resumo, produtos_analisados: linhas.length, gerado_em: new Date().toISOString(),
  }, { onConflict: 'empresa_id' })

  return { empresaId, produtosAnalisados: linhas.length, comSinal: porProduto.size, resumo }
}
