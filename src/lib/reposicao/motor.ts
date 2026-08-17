// O cálculo de reposição, sem banco e sem rede.
//
// Tudo aqui é função pura: entra o que se sabe do produto, sai o que fazer
// com ele. Assim dá para conferir a conta lendo, e para testá-la sem subir
// nada.
//
// Duas decisões que governam o arquivo inteiro:
//
// 1. NÃO INVENTAR HISTÓRICO. O sistema tem seis semanas de venda. Dividir
//    o que se vendeu por 180 dias quando só existem 40 de história produz
//    uma média quatro vezes menor que a real, e uma sugestão de compra
//    quatro vezes menor. Toda janela é dividida pelos dias que existiram,
//    não pelos dias do nome.
//
// 2. NÃO RECOMENDAR NO ESCURO. Hoje 13.284 produtos ativos estão com
//    estoque zero no cadastro — não porque a loja esteja vazia, mas porque
//    o saldo nunca foi carregado. Um motor que olhasse só "estoque abaixo
//    do mínimo" mandaria comprar o catálogo inteiro. Por isso produto sem
//    nenhum sinal de demanda (venda, falta ou encomenda) sai classificado
//    como `sem_dados` e fica fora da lista de compra, por mais zerado que
//    esteja.

export type ConfigReposicao = {
  cobertura_alvo_dias: number
  estoque_seguranca_dias: number
  lead_time_padrao_dias: number
  peso_vendas_recentes: number
  cobertura_critica_dias: number
  cobertura_atencao_dias: number
  cobertura_excesso_dias: number
  dias_sem_venda_parado: number
  considerar_faltas: boolean
  considerar_encomendas: boolean
  considerar_pedidos_abertos: boolean
  considerar_marketplace: boolean
  considerar_outros_depositos: boolean
  exigir_sinal_de_demanda: boolean
}

export const CONFIG_PADRAO: ConfigReposicao = {
  cobertura_alvo_dias: 45,
  estoque_seguranca_dias: 7,
  lead_time_padrao_dias: 7,
  peso_vendas_recentes: 0.7,
  cobertura_critica_dias: 7,
  cobertura_atencao_dias: 20,
  cobertura_excesso_dias: 180,
  dias_sem_venda_parado: 90,
  considerar_faltas: true,
  considerar_encomendas: true,
  considerar_pedidos_abertos: true,
  considerar_marketplace: true,
  considerar_outros_depositos: true,
  exigir_sinal_de_demanda: true,
}

export type Prioridade =
  | 'critico' | 'comprar' | 'analisar' | 'saudavel'
  | 'excesso' | 'sem_giro' | 'sem_dados'

export type EntradaProduto = {
  estoque: number
  estoqueMinimo: number
  custo: number
  preco: number
  /** Unidades vendidas em cada janela, já somadas (PDV + marketplace). */
  vendas: { d7: number; d15: number; d30: number; d60: number; d90: number; d180: number }
  ultimaVenda: string | null
  /** Solicitações abertas do balcão. */
  faltasAbertas: number
  encomendasAbertas: number
  unidadesSolicitadas: number
  /** Já pedido ao fornecedor e ainda não recebido. */
  pedidoAbertoQtd: number
  estoqueOutrosDepositos: number
  leadTimeDias: number
  classeAbc: 'A' | 'B' | 'C' | null
  /** Dias de histórico de venda que a empresa realmente tem. */
  diasHistorico: number
  /**
   * Quanto a LOJA INTEIRA acelerou no mesmo período (últimos 15 dias
   * contra a média de 90). Serve de régua: 1 = ritmo estável.
   *
   * Sem isso, a tendência de cada produto mede o crescimento da loja em
   * vez do crescimento do produto. Medido no ensaio: como o volume
   * registrado saltou de 396 vendas em julho para 1.035 em agosto — o
   * PDV entrando em uso, não a demanda subindo — TODOS os produtos
   * apareciam "vendendo 400% mais". Um sinal que aponta para todo lado
   * não aponta para lugar nenhum.
   */
  fatorLoja: number
}

export type ResultadoReposicao = {
  mediaDiaria: number
  mediaDiariaRecente: number
  mediaPonderada: number
  tendencia: number | null
  diasSemVenda: number | null
  coberturaDias: number | null
  previsaoRuptura: string | null
  estoqueSeguranca: number
  pontoReposicao: number
  sugestaoQuantidade: number
  custoEstimado: number
  score: number
  prioridade: Prioridade
  giro: 'alta' | 'media' | 'baixa' | 'sem_giro'
  motivos: string[]
}

const DIA = 86_400_000
const arred = (v: number, casas = 2) => Math.round(v * 10 ** casas) / 10 ** casas

/** Média por dia numa janela, dividida pelos dias que de fato existiram. */
function porDia(quantidade: number, janela: number, diasHistorico: number) {
  const dias = Math.max(1, Math.min(janela, diasHistorico))
  return quantidade / dias
}

export function calcular(p: EntradaProduto, cfg: ConfigReposicao): ResultadoReposicao {
  const motivos: string[] = []

  // ── Ritmo de venda ────────────────────────────────────────────
  const longa = porDia(p.vendas.d90, 90, p.diasHistorico)
  const recente = porDia(p.vendas.d15, 15, p.diasHistorico)
  const peso = Math.min(1, Math.max(0, cfg.peso_vendas_recentes))

  // Sem venda recente, a média longa responde sozinha — senão o peso do
  // recente zeraria a demanda de um produto que vende de mês em mês.
  const mediaPonderada = p.vendas.d15 > 0
    ? recente * peso + longa * (1 - peso)
    : longa

  // Tendência só com volume que a sustente. Um produto que vendeu 1
  // unidade em 15 dias e 1 em 90 dá "vendendo 500% mais", que é ruído
  // aritmético, não aceleração de demanda. Medido no ensaio: sem este
  // piso, quase todo item da lista exibia uma alta de três dígitos.
  const regua = p.fatorLoja > 0 ? p.fatorLoja : 1
  const tendencia = longa > 0 && p.vendas.d15 >= 3 && p.vendas.d90 >= 6
    ? arred(recente / longa / regua)
    : null
  const diasSemVenda = p.ultimaVenda
    ? Math.floor((Date.now() - new Date(p.ultimaVenda).getTime()) / DIA)
    : null

  // ── Cobertura e ruptura ───────────────────────────────────────
  // NULL, não zero: produto que não vende não tem "0 dias de estoque",
  // ele não tem ritmo. Tratar os dois como a mesma coisa põe o catálogo
  // parado no topo da lista de urgência.
  const coberturaDias = mediaPonderada > 0
    ? Math.floor(Math.max(0, p.estoque) / mediaPonderada)
    : null

  const previsaoRuptura = coberturaDias !== null && p.estoque > 0
    ? new Date(Date.now() + coberturaDias * DIA).toISOString().slice(0, 10)
    : null

  const leadTime = p.leadTimeDias > 0 ? p.leadTimeDias : cfg.lead_time_padrao_dias
  const estoqueSeguranca = arred(mediaPonderada * cfg.estoque_seguranca_dias, 3)
  const pontoReposicao = arred(mediaPonderada * leadTime + estoqueSeguranca, 3)

  // ── Quanto comprar ────────────────────────────────────────────
  // Cobrir a meta mais o tempo que o fornecedor leva, somar o colchão,
  // descontar o que já tem e o que já foi pedido.
  const pedidoAberto = cfg.considerar_pedidos_abertos ? p.pedidoAbertoQtd : 0
  const alvo = mediaPonderada * (cfg.cobertura_alvo_dias + leadTime) + estoqueSeguranca
  let sugestao = Math.max(0, alvo - p.estoque - pedidoAberto)

  // O que o cliente já pediu não é previsão, é compromisso. Entra por
  // fora da média — inclusive para produto que nunca vendeu.
  const solicitado = cfg.considerar_encomendas ? p.unidadesSolicitadas : 0
  if (solicitado > 0) {
    const faltando = Math.max(0, solicitado - Math.max(0, p.estoque) - pedidoAberto)
    if (faltando > sugestao) sugestao = faltando
  }

  // Mínimo cadastrado ainda vale como piso, quando existe.
  if (p.estoqueMinimo > 0 && p.estoque + pedidoAberto < p.estoqueMinimo) {
    const ateOMinimo = p.estoqueMinimo - p.estoque - pedidoAberto
    if (ateOMinimo > sugestao) sugestao = ateOMinimo
  }

  sugestao = Math.ceil(sugestao)

  // ── Giro ──────────────────────────────────────────────────────
  const giro: ResultadoReposicao['giro'] =
    p.vendas.d30 === 0 ? 'sem_giro'
    : mediaPonderada >= 1 ? 'alta'
    : mediaPonderada >= 0.2 ? 'media'
    : 'baixa'

  // ── Prioridade ────────────────────────────────────────────────
  const temSinal =
    p.vendas.d90 > 0 ||
    (cfg.considerar_faltas && p.faltasAbertas > 0) ||
    (cfg.considerar_encomendas && p.encomendasAbertas > 0) ||
    p.estoqueMinimo > 0

  let prioridade: Prioridade
  let score = 0

  if (cfg.exigir_sinal_de_demanda && !temSinal) {
    // Nem venda, nem pedido de cliente, nem mínimo configurado. O sistema
    // não sabe nada sobre este produto — e dizer "compre" seria chute.
    prioridade = 'sem_dados'
    motivos.push('Sem venda registrada, sem falta anotada e sem estoque mínimo definido — o sistema não tem base para recomendar')
    if (p.estoque <= 0) motivos.push('O estoque no cadastro está zerado; se a loja tem este item, o saldo precisa ser corrigido')
    return montar(p, { mediaDiaria: longa, mediaDiariaRecente: recente, mediaPonderada, tendencia, diasSemVenda, coberturaDias, previsaoRuptura, estoqueSeguranca, pontoReposicao, sugestaoQuantidade: 0, custoEstimado: 0, score: 0, prioridade, giro, motivos })
  }

  const vaiAcabarAntesDeChegar = coberturaDias !== null && coberturaDias <= leadTime
  const abaixoDoPonto = mediaPonderada > 0 && p.estoque + pedidoAberto < pontoReposicao
  const encomendaSemEstoque = p.encomendasAbertas > 0 && p.estoque <= 0

  // A base é deliberadamente baixa. No ensaio sobre os dados reais, 800
  // dos 1.214 produtos com sinal caíram em "crítico" — porque quase todo
  // item que vende está com estoque zero ou negativo no cadastro. Com
  // base alta, todos empatavam perto de 100 e a lista deixava de ser uma
  // ordem de trabalho. O que separa um crítico do outro não é a
  // classificação, é o tamanho: quanto vende e quanto dinheiro está em
  // jogo. Isso entra logo abaixo, nos ajustes.
  if (encomendaSemEstoque) {
    prioridade = 'critico'
    score = 70
    motivos.push(`${p.encomendasAbertas} encomenda(s) de cliente com estoque ${p.estoque} — tem gente esperando`)
  } else if (vaiAcabarAntesDeChegar) {
    prioridade = 'critico'
    score = p.estoque <= 0 ? 60 : 55
    motivos.push(
      p.estoque <= 0
        ? `Estoque ${p.estoque} e ainda vendendo — já está em ruptura`
        : `Estoque dura ~${coberturaDias} dia(s) e o fornecedor leva ~${leadTime}; acaba antes de a compra chegar`
    )
  } else if (coberturaDias !== null && coberturaDias <= cfg.cobertura_critica_dias) {
    prioridade = 'critico'; score = 50
    motivos.push(`Cobertura de apenas ${coberturaDias} dia(s)`)
  } else if (coberturaDias !== null && coberturaDias >= cfg.cobertura_excesso_dias) {
    prioridade = 'excesso'; score = 3
    motivos.push(`Estoque para ~${coberturaDias} dias — dinheiro parado, não recomprar`)
  } else if (abaixoDoPonto || (coberturaDias !== null && coberturaDias <= cfg.cobertura_atencao_dias)) {
    prioridade = 'comprar'; score = 35
    motivos.push(
      abaixoDoPonto
        ? `Estoque abaixo do ponto de reposição (${arred(pontoReposicao, 1)})`
        : `Cobertura de ${coberturaDias} dia(s)`
    )
  } else if (giro === 'sem_giro' && diasSemVenda !== null && diasSemVenda >= cfg.dias_sem_venda_parado) {
    prioridade = 'sem_giro'; score = 3
    motivos.push(`Sem venda há ${diasSemVenda} dias`)
  } else if (p.faltasAbertas > 0 || p.encomendasAbertas > 0) {
    prioridade = 'analisar'; score = 25
  } else if (giro === 'sem_giro') {
    prioridade = 'sem_giro'; score = 3
    motivos.push('Sem venda nos últimos 30 dias')
  } else {
    prioridade = 'saudavel'; score = 10
  }

  // ── Tamanho do problema ───────────────────────────────────────
  //
  // Dois produtos podem estar igualmente em ruptura e não merecer a mesma
  // pressa: um vende 42 por mês e deixa R$ 2.000 na mesa; o outro vende 1
  // e deixa R$ 4. Sem isto, a lista de urgências fica em ordem alfabética
  // de fato. Escala logarítmica porque a diferença que importa é de
  // ordem de grandeza, não de unidade.
  if (prioridade !== 'excesso' && prioridade !== 'sem_giro') {
    const volumeMes = p.vendas.d30 > 0 ? p.vendas.d30 : mediaPonderada * 30
    score += Math.min(12, Math.round(Math.log10(1 + volumeMes) * 8))
    const valorEmRisco = sugestao * (p.preco > 0 ? p.preco : p.custo)
    score += Math.min(10, Math.round(Math.log10(1 + valorEmRisco) * 3))
  }

  // ── Ajustes de score ──────────────────────────────────────────
  if (cfg.considerar_encomendas && p.encomendasAbertas > 0) {
    score += Math.min(15, p.encomendasAbertas * 5)
    if (!motivos.some(m => m.includes('encomenda'))) {
      motivos.push(`${p.encomendasAbertas} encomenda(s) de cliente esperando`)
    }
  }
  if (cfg.considerar_faltas && p.faltasAbertas > 0) {
    score += Math.min(12, p.faltasAbertas * 4)
    motivos.push(
      `${p.faltasAbertas} vez(es) procurado no balcão sem ter em estoque` +
      (p.unidadesSolicitadas > 0 ? ` (${arred(p.unidadesSolicitadas, 0)} unidade(s) pedidas)` : '')
    )
  }
  if (p.classeAbc === 'A') { score += 10; motivos.push('Classe A — está entre os produtos que mais pesam nas vendas') }
  else if (p.classeAbc === 'B') score += 4

  if (tendencia !== null && tendencia >= 1.5) {
    score += 8
    motivos.push(`Acelerando: ${Math.round((tendencia - 1) * 100)}% acima da própria média nas últimas duas semanas, já descontado o crescimento geral da loja`)
  } else if (tendencia !== null && tendencia <= 0.5 && prioridade !== 'excesso') {
    score -= 8
    motivos.push(`Demanda caindo: ${Math.round((1 - tendencia) * 100)}% abaixo da própria média, mesmo com a loja vendendo mais`)
  }

  if (leadTime >= 15) { score += 5; motivos.push(`Fornecedor demora ~${leadTime} dias — precisa de antecedência`) }

  // Reposição já encaminhada não é urgência. Este desconto é o que evita
  // comprar duas vezes a mesma coisa.
  if (pedidoAberto > 0) {
    score -= 25
    motivos.push(`Já existe pedido de compra em aberto com ${arred(pedidoAberto, 0)} unidade(s)`)
  }

  // Antes de comprar, olhar dentro de casa.
  if (cfg.considerar_outros_depositos && p.estoqueOutrosDepositos > 0 && p.estoque <= 0) {
    score -= 10
    motivos.push(`Há ${arred(p.estoqueOutrosDepositos, 0)} unidade(s) em outro depósito — avaliar transferência antes de comprar`)
  }

  if (p.estoqueMinimo > 0 && p.estoque < p.estoqueMinimo) {
    motivos.push(`Abaixo do mínimo cadastrado (${p.estoqueMinimo})`)
  }
  if (p.custo <= 0) {
    motivos.push('Sem custo cadastrado — o valor da reposição é estimativa')
  }
  if (p.diasHistorico < 60 && p.vendas.d90 > 0) {
    motivos.push(`Histórico curto (${p.diasHistorico} dias) — a média ainda é provisória`)
  }

  score = Math.max(0, Math.min(100, Math.round(score)))
  if (sugestao <= 0 && (prioridade === 'critico' || prioridade === 'comprar')) {
    // A conta fechou sem precisar comprar (pedido em aberto cobre tudo).
    prioridade = 'analisar'
  }

  return montar(p, {
    mediaDiaria: longa, mediaDiariaRecente: recente, mediaPonderada, tendencia, diasSemVenda,
    coberturaDias, previsaoRuptura, estoqueSeguranca, pontoReposicao,
    sugestaoQuantidade: sugestao, custoEstimado: arred(sugestao * p.custo),
    score, prioridade, giro, motivos,
  })
}

function montar(_p: EntradaProduto, r: Omit<ResultadoReposicao, 'mediaDiaria'> & { mediaDiaria: number }): ResultadoReposicao {
  return {
    ...r,
    mediaDiaria: arred(r.mediaDiaria, 4),
    mediaDiariaRecente: arred(r.mediaDiariaRecente, 4),
    mediaPonderada: arred(r.mediaPonderada, 4),
  }
}

// A explicação em texto ("Entender sugestão") é montada na tela, a partir
// da linha já calculada — ver `narrativa()` em AuxiliarComprasClient. Aqui
// ficam só os fatos que a alimentam: `motivos`, e os números que os
// justificam. Nenhuma das duas coisas passa por IA: são contas, e conta
// não precisa de modelo.
