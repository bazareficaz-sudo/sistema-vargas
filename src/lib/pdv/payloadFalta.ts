// O QUE UM PDV PODE DIZER SOBRE UMA FALTA — e nada além disso.
//
// O caminho legado tem `atualizarFalta(remoteId, dados)`, que repassa o objeto
// inteiro para um `.update(dados)`. Qualquer campo que o cliente mandasse
// seria gravado. Como o PDV é um binário distribuído, isso é o cliente
// escolhendo o que escrever na tabela.
//
// Aqui a lista é fechada e explícita. Campo fora dela é ignorado, não é erro:
// um PDV mais novo mandando um campo que este servidor ainda não conhece deve
// funcionar, não quebrar.
//
// ESTA FASE NÃO REDESENHA O MÓDULO. Os campos, os defaults e o significado de
// "falta" e "encomenda" são exatamente os de hoje — só o transporte e a
// autorização mudam.

export type FaltaEntrada = {
  produto_id: string | null
  produto_nome: string
  produto_sku: string | null
  cliente_nome: string | null
  cliente_telefone: string | null
  quantidade_solicitada: number
  observacao: string | null
  status: string
  origem: string
  usuario_nome: string | null
  tipo: 'falta' | 'encomenda'
  prazo_desejado: string | null
  preco_negociado: number | null
  terminal_id_legado: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Texto aparado, limitado, ou nulo. Vazio vira nulo — não string vazia. */
function texto(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, max) : null
}

/**
 * O mesmo `_comoUuid` do PDV: um `remote_id` herdado do Base44 é um ObjectId
 * de 24 caracteres, não um UUID, e mandá-lo como chave estrangeira rebenta com
 * "invalid input syntax for type uuid". Tratar como não-vinculado é melhor do
 * que travar o registro por causa de um vínculo velho.
 */
function comoUuid(v: unknown): string | null {
  return typeof v === 'string' && UUID.test(v) ? v : null
}

export type ValidacaoFalta =
  | { ok: true; falta: FaltaEntrada }
  | { ok: false; erro: string }

export function validarFalta(corpo: Record<string, unknown>): ValidacaoFalta {
  const nome = texto(corpo?.produto_nome, 300)
  // Único campo realmente obrigatório, hoje e aqui: sem nome de produto a
  // linha não serve para nada — ninguém sabe o que faltou.
  if (!nome) return { ok: false, erro: 'produto_nome é obrigatório.' }

  const qtdBruta = Number(corpo?.quantidade_solicitada ?? 1)
  const quantidade = Number.isFinite(qtdBruta) && qtdBruta > 0 ? qtdBruta : 1

  const precoBruto = corpo?.preco_negociado
  const preco = precoBruto == null || precoBruto === ''
    ? null
    : (Number.isFinite(Number(precoBruto)) && Number(precoBruto) >= 0 ? Number(precoBruto) : null)

  return {
    ok: true,
    falta: {
      produto_id: comoUuid(corpo?.produto_id),
      produto_nome: nome,
      produto_sku: texto(corpo?.produto_sku, 60),
      cliente_nome: texto(corpo?.cliente_nome, 200),
      cliente_telefone: texto(corpo?.cliente_telefone, 30),
      quantidade_solicitada: quantidade,
      observacao: texto(corpo?.observacao, 1000),
      status: texto(corpo?.status, 40) ?? 'pendente',
      origem: texto(corpo?.origem, 40) ?? 'pdv',
      usuario_nome: texto(corpo?.usuario_nome, 120),
      // Mesma regra do PDV: qualquer coisa diferente de 'encomenda' é 'falta'.
      tipo: corpo?.tipo === 'encomenda' ? 'encomenda' : 'falta',
      prazo_desejado: texto(corpo?.prazo_desejado, 40),
      preco_negociado: preco,
      terminal_id_legado: texto(corpo?.terminal_id, 60),
    },
  }
}

/**
 * O que um PDV pode mudar numa falta já registrada.
 *
 * Hoje a fila só sincroniza `status`, mas o legado aceitaria qualquer campo.
 * A lista fechada abaixo é o que a operação realmente precisa — e amanhã,
 * quando o comprador atualizar prazo ou preço, o campo entra aqui de forma
 * deliberada, e não por acidente de repasse.
 */
export type AtualizacaoFalta = { status?: string; observacao?: string | null }

export function validarAtualizacaoFalta(corpo: Record<string, unknown>): ValidacaoFalta | { ok: true; dados: AtualizacaoFalta } {
  const dados: AtualizacaoFalta = {}
  const status = texto(corpo?.status, 40)
  if (status) dados.status = status
  if ('observacao' in (corpo ?? {})) dados.observacao = texto(corpo?.observacao, 1000)

  if (Object.keys(dados).length === 0) {
    return { ok: false, erro: 'Nada para atualizar.' }
  }
  return { ok: true, dados }
}
