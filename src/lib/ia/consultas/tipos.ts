// CONSULTAS NOMEADAS — o que a IA pode perguntar ao banco.
//
// POR QUE NAO SQL LIVRE, que e a saida obvia e a decisao errada aqui.
//
// Em 01/09/2026, escrevendo uma consulta de conferencia a mao neste mesmo
// sistema, eu produzi um produto cartesiano entre contas e vendas: o
// resultado deu R$ 179.126,92 e so foi pego porque o numero era absurdo
// demais para ser verdade. Um modelo escrevendo SQL erra do mesmo jeito — e o
// numero errado volta em portugues fluente, com ar de conclusao, sem nada
// gritando.
//
// Some a isso o multi-tenant: um `empresa_id` faltando num JOIN nao quebra a
// consulta, ela apenas passa a responder sobre o banco inteiro.
//
// Consulta nomeada resolve os dois: e escrita e revisada UMA vez, o
// `empresa_id` e fixado pelo servidor e nunca vem do modelo, e os JOINs sao
// os certos porque alguem os conferiu.
//
// O QUE TODA CONSULTA DEVE DEVOLVER, alem das linhas: o periodo que ela
// cobre. Sem isso o modelo repete o erro de 01/09 — recebeu
// `faturamentoMes: 1336.17` sem data e respondeu "Agosto apresenta
// R$ 1.336,17" quando agosto tinha R$ 51.498,04.

// O cliente do Supabase e `any` em todo o repositorio: tipa-lo exigiria os
// tipos gerados do banco, que este projeto nao usa.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClienteSupabase = any

export type ResultadoConsulta = {
  /** As linhas encontradas. Vazio é resposta legítima, não erro. */
  linhas: Record<string, unknown>[]
  /**
   * O que exatamente foi consultado, em português. Vai junto para o modelo
   * poder dizer "entre 1º e 2 de setembro" em vez de "no período".
   */
  periodo: string
  /**
   * Ressalvas desta consulta — o que ela NÃO cobre, quando isso muda a
   * leitura do número. Ex.: vendas canceladas ficam de fora.
   */
  ressalvas?: string[]
  /** Quando a consulta cortou o resultado, para o modelo não somar e concluir. */
  truncado?: boolean
}

export type Consulta = {
  nome: string
  /** O que ela responde, escrito para o modelo escolher entre as opções. */
  descricao: string
  /** JSON Schema dos parâmetros, no formato que o provedor espera. */
  parametros: {
    type: 'object'
    properties: Record<string, { type: string; description: string }>
    required?: string[]
  }
  executar(
    sb: ClienteSupabase,
    empresaId: string,
    args: Record<string, unknown>,
  ): Promise<ResultadoConsulta>
}

/** Limite de linhas devolvidas por consulta. */
export const MAX_LINHAS = 50

/**
 * Data em ISO ('YYYY-MM-DD'), ou `null` se não for uma.
 *
 * Recusa em vez de adivinhar. Um modelo que mande "ontem" no lugar da data
 * precisa receber um erro dizendo o formato — se aqui virasse "hoje" por
 * conveniência, a resposta sairia sobre o dia errado sem ninguém saber.
 */
export function dataISO(valor: unknown): string | null {
  const s = String(valor ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T12:00:00-03:00`)
  return Number.isNaN(d.getTime()) ? null : s
}

/** Rótulo legível de um intervalo, para o modelo repetir sem inventar. */
export function rotuloPeriodo(de: string, ate: string): string {
  const br = (iso: string) => iso.split('-').reverse().join('/')
  return de === ate ? `em ${br(de)}` : `de ${br(de)} a ${br(ate)}`
}

/**
 * Limites do intervalo em instantes UTC, cobrindo o dia inteiro em São Paulo.
 *
 * `created_at` é timestamptz. Comparar com a data pura pegaria o dia errado
 * nas primeiras três horas de cada dia: 01/09 00:30 em São Paulo é 01/09
 * 03:30 UTC, mas 01/09 23:00 em São Paulo já é 02/09 02:00 UTC.
 */
export function intervaloUTC(de: string, ate: string): { inicio: string; fim: string } {
  return {
    inicio: new Date(`${de}T00:00:00-03:00`).toISOString(),
    fim: new Date(`${ate}T23:59:59.999-03:00`).toISOString(),
  }
}

/** Status que não contam como venda realizada. */
export const STATUS_NAO_VALE = ['cancelada', 'cancelado']
