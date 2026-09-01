/**
 * O PERIODO QUE OS INDICADORES "DO MES" COBREM.
 *
 * Defeito reportado em 01/09/2026. O empresario perguntou sobre "o historico
 * de venda de agosto" e a IA respondeu "Agosto apresenta R$ 1.336,17 em
 * vendas". Agosto teve R$ 51.498,04 — o R$ 1.336,17 era o faturamento do dia
 * 1o de setembro, unico dia do mes corrente.
 *
 * A causa nao foi o modelo alucinar: foi o contexto nao dizer nada. O prompt
 * mandava `faturamentoMes: 1336.17` sem data, sem nome de mes e sem quantos
 * dias o periodo tem. Perguntado sobre agosto, o modelo atribuiu a agosto o
 * unico numero de faturamento que recebeu — nao havia como ele saber que era
 * de outro mes.
 *
 * O SEGUNDO ERRO FOI PIOR QUE O PRIMEIRO. `comprasMes: 0` e
 * `variacaoCompras: -100` viraram "compras do mes foram ZERO (-100%)" e
 * "restricao de caixa severa". No dia 1o do mes, compra zero e o estado
 * esperado de um mes que tem um dia de idade — agosto teve R$ 36.348,35 em
 * compras. O sistema entregou um alarme de caixa a partir de artefato de
 * calendario.
 *
 * Por isso o periodo vai junto, com o dia de hoje, o intervalo coberto e
 * QUANTOS DIAS DE QUANTOS ja passaram: um mes com 1 de 30 dias nao pode ser
 * lido como um mes fechado.
 */
export function periodoDosIndicadores(agora: Date) {
  const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const hoje = iso(agora)
  const ano = Number(hoje.slice(0, 4))
  const mes = Number(hoje.slice(5, 7))
  const dia = Number(hoje.slice(8, 10))
  const diasNoMes = new Date(ano, mes, 0).getDate()
  const nome = new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  return {
    hoje,
    mesDeReferencia: nome,
    // O intervalo real: do dia 1o ate HOJE, nao ate o fim do mes.
    periodoDosIndicadoresDoMes: `${ano}-${String(mes).padStart(2, '0')}-01 a ${hoje}`,
    diasDecorridosDoMes: dia,
    diasNoMes,
    mesIncompleto: dia < diasNoMes,
  }
}
