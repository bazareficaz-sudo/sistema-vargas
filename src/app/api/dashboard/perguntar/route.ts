import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perguntarJSONComGateway } from '@/lib/ia/gateway'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import type { DashboardQuestionContext } from '@/components/dashboard/AskVargas'
import { periodoDosIndicadores } from '@/lib/dashboard/periodo'
import { perguntarComConsultas } from '@/lib/ia/comConsultas'
import { CONSULTAS_VENDAS } from '@/lib/ia/consultas/vendas'
import { CONSULTAS_ESTOQUE } from '@/lib/ia/consultas/estoque'
import { registrarConsumoIA } from '@/lib/ia/gateway'

type Resultado = {
  resposta: string
  evidencias: string[]
  sugestoes: string[]
  modo: 'ia' | 'automatico'
}

const brl = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const percentual = (valor: number) => `${Math.abs(valor).toFixed(1).replace('.', ',')}%`

function numero(valor: unknown): number {
  const convertido = Number(valor)
  return Number.isFinite(convertido) ? convertido : 0
}

function normalizarContexto(valor: unknown): DashboardQuestionContext {
  const entrada = typeof valor === 'object' && valor !== null ? valor as Record<string, unknown> : {}
  return {
    vendasHoje: numero(entrada.vendasHoje),
    quantidadeVendasHoje: numero(entrada.quantidadeVendasHoje),
    ticketMedioHoje: numero(entrada.ticketMedioHoje),
    projecaoFechamento: numero(entrada.projecaoFechamento),
    variacaoRitmo: entrada.variacaoRitmo === null ? null : numero(entrada.variacaoRitmo),
    variacaoTicket: entrada.variacaoTicket === null ? null : numero(entrada.variacaoTicket),
    faturamentoMes: numero(entrada.faturamentoMes),
    contasReceber: numero(entrada.contasReceber),
    contasReceberVencidas: numero(entrada.contasReceberVencidas),
    contasPagar: numero(entrada.contasPagar),
    contasPagarVencidas: numero(entrada.contasPagarVencidas),
    saldoPrevisto30: numero(entrada.saldoPrevisto30),
    comprasMes: numero(entrada.comprasMes),
    variacaoCompras: entrada.variacaoCompras === null ? null : numero(entrada.variacaoCompras),
    percentualVendasSemCliente: numero(entrada.percentualVendasSemCliente),
    vendasMarketplaceHoje: numero(entrada.vendasMarketplaceHoje),
    produtoMaiorFaturamentoMes: typeof entrada.produtoMaiorFaturamentoMes === 'string' ? entrada.produtoMaiorFaturamentoMes.slice(0, 160) : null,
    produtoMaiorFaturamentoMesValor: numero(entrada.produtoMaiorFaturamentoMesValor),
    produtoMaisVendidoMes: typeof entrada.produtoMaisVendidoMes === 'string' ? entrada.produtoMaisVendidoMes.slice(0, 160) : null,
    produtoMaisVendidoMesQuantidade: numero(entrada.produtoMaisVendidoMesQuantidade),
    vendedorCampeaoMes: typeof entrada.vendedorCampeaoMes === 'string' ? entrada.vendedorCampeaoMes.slice(0, 160) : null,
    vendedorCampeaoMesFaturamento: numero(entrada.vendedorCampeaoMesFaturamento),
    vendedorCampeaoMesVendas: numero(entrada.vendedorCampeaoMesVendas),
  }
}

function respostaAutomatica(pergunta: string, c: DashboardQuestionContext): Resultado {
  const texto = pergunta.toLocaleLowerCase('pt-BR')
  // O MESMO CUIDADO DO CAMINHO DA IA. Este ramo e deterministico, mas dizia
  // "as compras do mes somam R$ 0,00, variacao de 100% para baixo" no dia 1o
  // do mes — verdade aritmetica lida como colapso.
  const per = periodoDosIndicadores(new Date())
  const ressalvaMes = per.mesIncompleto
    ? ` Atencao: ${per.mesDeReferencia} tem ${per.diasDecorridosDoMes} de ${per.diasNoMes} dias decorridos, entao os numeros do mes ainda estao parciais.`
    : ''
  if (/produto|item|mercadoria/.test(texto) && /mais|melhor|campe[aã]o|lider|top|vend/.test(texto)) {
    if (!c.produtoMaisVendidoMes && !c.produtoMaiorFaturamentoMes) {
      return {
        modo: 'automatico',
        resposta: 'Ainda não há vendas de produtos suficientes neste mês para montar esse ranking.',
        evidencias: ['Ranking considerado: mês atual', 'Somente vendas concluídas entram no cálculo'],
        sugestoes: ['Consultar o relatório de produtos', 'Perguntar sobre as vendas de hoje'],
      }
    }
    const mesmoProduto = c.produtoMaisVendidoMes === c.produtoMaiorFaturamentoMes
    return {
      modo: 'automatico',
      resposta: mesmoProduto
        ? `${c.produtoMaisVendidoMes} é o produto líder do mês: ${c.produtoMaisVendidoMesQuantidade.toLocaleString('pt-BR')} unidades vendidas e ${brl(c.produtoMaiorFaturamentoMesValor)} em faturamento.`
        : `Em quantidade, o produto mais vendido do mês é ${c.produtoMaisVendidoMes}, com ${c.produtoMaisVendidoMesQuantidade.toLocaleString('pt-BR')} unidades. Em faturamento, o líder é ${c.produtoMaiorFaturamentoMes}, com ${brl(c.produtoMaiorFaturamentoMesValor)}.`,
      evidencias: [
        `Período analisado: mês atual`,
        `Líder em unidades: ${c.produtoMaisVendidoMes ?? 'indisponível'}`,
        `Líder em faturamento: ${c.produtoMaiorFaturamentoMes ?? 'indisponível'}`,
      ],
      sugestoes: ['Ver margem dos produtos líderes', 'Comparar com o mês anterior', 'Analisar estoque disponível'],
    }
  }
  if (/vendedor|vendedora|equipe|atendente/.test(texto) && /mais|melhor|campe[aã]o|lider|top|vend|desempenho/.test(texto)) {
    return c.vendedorCampeaoMes
      ? {
          modo: 'automatico',
          resposta: `${c.vendedorCampeaoMes} é o vendedor campeão do mês por faturamento, com ${brl(c.vendedorCampeaoMesFaturamento)} em ${c.vendedorCampeaoMesVendas.toLocaleString('pt-BR')} vendas concluídas.`,
          evidencias: [`Período analisado: mês atual`, `Faturamento atribuído: ${brl(c.vendedorCampeaoMesFaturamento)}`, `Vendas concluídas: ${c.vendedorCampeaoMesVendas.toLocaleString('pt-BR')}`],
          sugestoes: ['Comparar ticket médio por vendedor', 'Ver evolução da equipe', 'Analisar metas do mês'],
        }
      : {
          modo: 'automatico',
          resposta: 'Não há vendas concluídas atribuídas a vendedores neste mês. Sem essa identificação, não é possível apontar um campeão com segurança.',
          evidencias: ['Período analisado: mês atual', 'Critério: faturamento de vendas concluídas'],
          sugestoes: ['Verificar a identificação do vendedor no PDV', 'Consultar o relatório de vendas'],
        }
  }
  if (/saldo|caixa|negativ|pagar|receber/.test(texto)) {
    const deficit = Math.max(0, -c.saldoPrevisto30)
    return {
      modo: 'automatico',
      resposta: deficit > 0
        ? `O saldo operacional previsto está negativo porque os pagamentos registrados para os próximos 30 dias superam os recebimentos do período em ${brl(deficit)}. O principal sinal de urgência são ${brl(c.contasPagarVencidas)} em contas já vencidas.`
        : `Os títulos registrados não indicam déficit operacional nos próximos 30 dias. O resultado previsto é ${brl(c.saldoPrevisto30)}.`,
      evidencias: [
        `Contas a pagar em aberto: ${brl(c.contasPagar)}`,
        `Contas a receber em aberto: ${brl(c.contasReceber)}`,
        `Contas vencidas: ${brl(c.contasPagarVencidas)}`,
      ],
      sugestoes: ['Revisar contas vencidas', 'Confirmar datas dos recebimentos', 'Simular prioridades de pagamento'],
    }
  }
  if (/venda|fatur|ticket|ritmo|fechamento/.test(texto)) {
    return {
      modo: 'automatico',
      resposta: `Hoje foram vendidos ${brl(c.vendasHoje)} em ${c.quantidadeVendasHoje} transações, com ticket médio de ${brl(c.ticketMedioHoje)}. Mantido o comportamento atual, a projeção de fechamento é ${brl(c.projecaoFechamento)}.${c.variacaoRitmo === null ? '' : ` O ritmo está ${percentual(c.variacaoRitmo)} ${c.variacaoRitmo >= 0 ? 'acima' : 'abaixo'} da média equivalente.`}`,
      evidencias: [
        `Faturamento de ${per.mesDeReferencia} (${per.periodoDosIndicadoresDoMes}): ${brl(c.faturamentoMes)}`,
        `Ticket médio hoje: ${brl(c.ticketMedioHoje)}`,
        `Vendas no marketplace hoje: ${brl(c.vendasMarketplaceHoje)}`,
      ],
      sugestoes: ['Comparar canais', 'Investigar ticket médio', 'Ver produtos mais vendidos'],
    }
  }
  if (/cliente|identific|crm|recorr/.test(texto)) {
    return {
      modo: 'automatico',
      resposta: `${percentual(c.percentualVendasSemCliente)} das vendas de hoje não têm cliente identificado. Isso limita análises de recorrência, carteira e pós-venda. A prioridade é melhorar a captura do cliente sem aumentar o atrito no caixa.`,
      evidencias: [`Vendas sem cliente identificado: ${percentual(c.percentualVendasSemCliente)}`, `${c.quantidadeVendasHoje} transações registradas hoje`],
      sugestoes: ['Revisar identificação no PDV', 'Criar incentivo de cadastro', 'Medir recorrência'],
    }
  }
  if (/compra|fornecedor|estoque/.test(texto)) {
    return {
      modo: 'automatico',
      resposta: `As compras de ${per.mesDeReferencia} somam ${brl(c.comprasMes)}.${c.variacaoCompras === null ? ' Ainda não há base anterior suficiente para medir a variação.' : ` Isso representa uma variação de ${percentual(c.variacaoCompras)} ${c.variacaoCompras >= 0 ? 'para cima' : 'para baixo'} frente ao mês anterior.`}${ressalvaMes}`,
      evidencias: [
        `Compras em ${per.mesDeReferencia} (${per.periodoDosIndicadoresDoMes}): ${brl(c.comprasMes)}`,
        c.variacaoCompras === null ? 'Comparação mensal indisponível'
          // Comparar um mes parcial com um mes fechado nao mede queda de
          // compras; mede que o mes ainda nao aconteceu.
          : `Variação mensal: ${c.variacaoCompras.toFixed(1).replace('.', ',')}%${per.mesIncompleto ? ' — comparação de mês parcial com mês fechado' : ''}`,
      ],
      sugestoes: ['Comparar compras com vendas', 'Revisar fornecedores', 'Analisar giro de estoque'],
    }
  }
  return {
    modo: 'automatico',
    resposta: 'Ainda não tenho um indicador confiável nesta tela para responder exatamente essa pergunta. Posso analisar vendas, produtos líderes, vendedores, caixa, contas, clientes e compras.',
    evidencias: ['Nenhum indicador compatível foi encontrado para a pergunta'],
    sugestoes: ['Pergunte sobre o caixa', 'Pergunte sobre vendas', 'Pergunte sobre vendedores'],
  }
}

function validarResultado(valor: unknown): Omit<Resultado, 'modo'> | null {
  if (typeof valor !== 'object' || valor === null) return null
  const objeto = valor as Record<string, unknown>
  if (typeof objeto.resposta !== 'string' || !objeto.resposta.trim()) return null
  return {
    resposta: objeto.resposta.trim().slice(0, 1500),
    evidencias: Array.isArray(objeto.evidencias) ? objeto.evidencias.filter((item): item is string => typeof item === 'string').slice(0, 5) : [],
    sugestoes: Array.isArray(objeto.sugestoes) ? objeto.sugestoes.filter((item): item is string => typeof item === 'string').slice(0, 4) : [],
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const body = await request.json().catch(() => null) as { pergunta?: unknown; contexto?: unknown } | null
  const pergunta = typeof body?.pergunta === 'string' ? body.pergunta.trim().slice(0, 300) : ''
  if (pergunta.length < 3) return NextResponse.json({ ok: false, erro: 'Escreva uma pergunta um pouco mais detalhada.' }, { status: 400 })
  const contexto = normalizarContexto(body?.contexto)

  const periodo = periodoDosIndicadores(new Date())

  const prompt = `Você é o analista executivo do Sistema Vargas, um ERP brasileiro.
Responda à pergunta do empresário usando SOMENTE os indicadores JSON fornecidos. Não invente causas, produtos, clientes ou valores. Diferencie correlação de causa. Seja direto, em português brasileiro, com no máximo 130 palavras. Não dê aconselhamento jurídico, contábil ou de investimento. Se faltar dado, diga claramente.

VOCÊ PODE CONSULTAR O BANCO. As ferramentas oferecidas respondem perguntas que os indicadores não cobrem — venda de um produto específico, de um cliente, de um vendedor, ranking de produtos, saldo de estoque por depósito, rupturas, capital parado e movimentações. Use-as sempre que a pergunta pedir um detalhe que não esteja nos indicadores, em vez de dizer que não tem o dado.
Datas relativas ("ontem", "semana passada") você mesmo converte para AAAA-MM-DD usando "periodo.hoje" antes de chamar a ferramenta.
Todo resultado de consulta traz o período que cobre e as ressalvas — repita-os na resposta em vez de descrever o presente sem data.

REGRAS SOBRE O PERÍODO — elas corrigem dois erros reais cometidos por esta ferramenta:
1. Todo indicador com "Mes" no nome cobre APENAS o período em "periodo", que vai do dia 1º até hoje. NUNCA atribua esses números a outro mês, mesmo que a pergunta cite outro mês pelo nome. Se perguntarem sobre um mês que não é o de referência, diga que não tem esse dado — não ofereça o número do mês corrente no lugar.
2. Quando "mesIncompleto" for true, um valor baixo ou zero em indicador do mês pode ser apenas o mês ter poucos dias decorridos, e NÃO queda de atividade. Não conclua crise, colapso nem restrição de caixa a partir disso. Diga quantos dias de quantos já passaram.

Pergunta: ${JSON.stringify(pergunta)}
Periodo: ${JSON.stringify(periodo)}
Indicadores: ${JSON.stringify(contexto)}

Responda SOMENTE neste JSON:
{"resposta":"análise objetiva","evidencias":["número e significado"],"sugestoes":["próxima investigação segura"]}`

  const perfilSessao = await perfilDaSessao(supabase, user.id, 'empresa_id')
  const empresaAtiva: string | undefined = perfilSessao?.empresa_id ?? undefined
  if (!empresaAtiva) return NextResponse.json({ ok: false, erro: 'Empresa ativa não encontrada.' }, { status: 400 })

  // ── PRIMEIRO O CAMINHO COM CONSULTAS ───────────────────────────────────
  //
  // O retrato pre-calculado tem teto: so responde o que alguem anteviu.
  // Medido em 02/09/2026 — "teve venda do produto 24150 ontem?" recebeu
  // "nao tenho esse dado", e tinha: 2 vendas, 3 unidades, R$ 7,50.
  //
  // Falhar aqui NAO e erro: cai no caminho de sempre, que continua inteiro.
  // Uma pergunta sobre caixa nao precisa de consulta nenhuma, e o retrato
  // responde melhor e mais barato.
  try {
    const comConsultas = await perguntarComConsultas({
      sb: supabase,
      empresaId: empresaAtiva,
      prompt,
      consultas: [...CONSULTAS_VENDAS, ...CONSULTAS_ESTOQUE],
      modelo: 'claude-haiku-4-5-20251001',
      maxTokens: 1200,
    })
    if (comConsultas.ok) {
      const resultado = validarResultado(comConsultas.valor)
      if (resultado) {
        // Telemetria com o custo REAL do laco: uma pergunta com consultas
        // gasta 2 a 3 chamadas, e a cota da empresa precisa enxergar isso.
        await registrarConsumoIA(supabase, {
          empresa_id: empresaAtiva, usuario_id: user.id,
          funcionalidade: 'dashboard', provedor: 'anthropic',
          modelo: 'claude-haiku-4-5-20251001', status: 'sucesso',
          tokens_entrada: comConsultas.tokensEntrada, tokens_saida: comConsultas.tokensSaida,
        })
        return NextResponse.json({ ok: true, resultado: { ...resultado, modo: 'ia' } satisfies Resultado })
      }
    }
  } catch { /* cai no caminho de sempre */ }

  try {
    const execucao = await perguntarJSONComGateway({
      supabase,
      empresaId: empresaAtiva,
      usuarioId: user.id,
      funcionalidade: 'dashboard',
      prompt,
    })
    if (!execucao.ok) {
      if (!execucao.fallbackAutomatico) return NextResponse.json({ ok: false, erro: 'A IA está indisponível ou atingiu o limite desta empresa.' }, { status: 503 })
      return NextResponse.json({ ok: true, resultado: respostaAutomatica(pergunta, contexto) })
    }
    const resultado = validarResultado(execucao.valor)
    if (!resultado) throw new Error('Resposta da IA fora do formato esperado')
    return NextResponse.json({ ok: true, resultado: { ...resultado, modo: 'ia' } satisfies Resultado })
  } catch {
    return NextResponse.json({ ok: true, resultado: respostaAutomatica(pergunta, contexto) })
  }
}
