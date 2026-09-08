// O ORÇAMENTO COMO INTENÇÃO DE NEGÓCIO — uma validação, um comando.
//
// O caminho atual valida nada e repassa quase tudo. Aqui a entrada é fechada,
// e a validação acontece ANTES da transação: recusar no servidor Node custa
// uma resposta; recusar dentro da transação custa um número de sequência
// queimado à toa.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ItemOrcamento = {
  produto_id: string | null
  produto_nome: string
  produto_sku: string | null
  quantidade: number
  preco_unitario: number
  desconto: number
  total: number
}

export type CabecalhoOrcamento = {
  cliente_nome: string | null
  operador_nome: string | null
  status: string
  subtotal: number
  desconto: number
  total: number
  observacao: string | null
  validade: string | null
}

export type ComandoOrcamento = {
  orcamento_id: string
  revisao_base: number
  cabecalho: CabecalhoOrcamento
  itens: ItemOrcamento[]
}

export type ValidacaoOrcamento =
  | { ok: true; comando: ComandoOrcamento }
  | { ok: false; erro: string }

function texto(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, max) : null
}

function numero(v: unknown, padrao = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : padrao
}

/** ObjectId do Base44 (24 hex) não é UUID; mandá-lo rebentaria a FK. */
function comoUuid(v: unknown): string | null {
  return typeof v === 'string' && UUID.test(v) ? v : null
}

/** `AAAA-MM-DD` ou nulo. Data inválida vira nulo em vez de derrubar a transação. */
function data(v: unknown): string | null {
  const s = texto(v, 10)
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return Number.isNaN(new Date(s).getTime()) ? null : s
}

export function validarOrcamento(corpo: Record<string, unknown>): ValidacaoOrcamento {
  const id = comoUuid(corpo?.orcamento_id)
  // O id vem do PDV e vira a chave primária remota. Sem UUID válido não há
  // idempotência possível — e é melhor recusar do que gerar um id no servidor
  // e reintroduzir o defeito que estamos removendo.
  if (!id) return { ok: false, erro: 'orcamento_id deve ser um UUID.' }

  // Estrito de proposito: `Number(null)` e 0, entao aceitar coercao faria um
  // campo ausente virar "revisao 0" — que o servidor leria como criacao. Num
  // orcamento que ja existe isso vira conflito, o que e seguro; mas o cliente
  // teria mandado lixo e ninguem saberia. Campo faltando e erro do cliente.
  const base = corpo?.revisao_base
  if (typeof base !== 'number' || !Number.isInteger(base) || base < 0) {
    return { ok: false, erro: 'revisao_base deve ser um inteiro >= 0.' }
  }
  const revisao_base = base

  const brutos = Array.isArray(corpo?.itens) ? (corpo.itens as unknown[]) : []
  // Recusado aqui e também dentro da RPC. A dupla checagem não é descuido:
  // esta poupa a transação, e a de lá é a que vale se um dia outra rota
  // chamar a função.
  if (brutos.length === 0) return { ok: false, erro: 'Orçamento precisa de ao menos um item.' }
  if (brutos.length > 300) return { ok: false, erro: 'Orçamento com itens demais.' }

  const itens: ItemOrcamento[] = []
  for (const b of brutos) {
    const i = (b ?? {}) as Record<string, unknown>
    const nome = texto(i.produto_nome, 300)
    if (!nome) return { ok: false, erro: 'Todo item precisa de produto_nome.' }
    const qtd = numero(i.quantidade, 1)
    if (qtd <= 0) return { ok: false, erro: `Quantidade inválida em "${nome}".` }
    itens.push({
      // `produto_remote_id` primeiro: cair no id local geraria item órfão, que
      // é um defeito já corrigido em vendas e que aqui tinha ficado para trás.
      produto_id: comoUuid(i.produto_remote_id) ?? comoUuid(i.produto_id),
      produto_nome: nome,
      produto_sku: texto(i.produto_sku, 60),
      quantidade: qtd,
      preco_unitario: numero(i.preco_unitario),
      desconto: numero(i.desconto),
      total: numero(i.total ?? i.subtotal),
    })
  }

  const c = (corpo?.cabecalho ?? {}) as Record<string, unknown>
  return {
    ok: true,
    comando: {
      orcamento_id: id,
      revisao_base,
      itens,
      cabecalho: {
        cliente_nome: texto(c.cliente_nome, 200),
        operador_nome: texto(c.operador_nome ?? c.vendedor_nome, 120),
        status: texto(c.status, 40) ?? 'aberto',
        subtotal: numero(c.subtotal),
        desconto: numero(c.desconto ?? c.desconto_total),
        total: numero(c.total),
        observacao: texto(c.observacao, 2000),
        validade: data(c.validade),
      },
    },
  }
}

/** A chave da tentativa: o documento e o estado confirmado de que ela partiu. */
export function chaveDoOrcamento(orcamentoId: string, revisaoBase: number): string {
  return `${orcamentoId}:r${revisaoBase}`
}

/**
 * Estado da RPC → status HTTP.
 *
 * A distinção que mais importa para o cliente é 409 × 5xx: **409 significa
 * parar e recarregar; 5xx significa insistir com a mesma chave.** Um
 * `{ok:false}` genérico faria o PDV tratar os dois igual, e um deles
 * duplicaria.
 */
export function httpDoEstado(estado: string | undefined): number {
  switch (estado) {
    case 'criado':
    case 'atualizado':
      return 200
    case 'conflito_versao':
      return 409
    case 'payload_invalido':
      return 400
    default:
      return 500
  }
}
