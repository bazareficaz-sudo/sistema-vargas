import { db } from './db'
import type { Loja } from './tipos'

// Criação do pedido da loja.
//
// Esta camada é fina de propósito: quem faz o trabalho é `loja_criar_pedido`,
// no banco. O motivo está no comentário da função, e vale repetir aqui porque
// é o tipo de coisa que alguém "simplifica" depois: criar pedido é conferir
// preço, conferir saldo, achar ou criar o cliente, gravar pedido, gravar
// itens e reservar estoque. Seis idas ao banco daqui seriam seis chances de
// falhar no meio — pedido sem reserva, reserva sem pedido, cliente órfão.
// Uma função é uma transação.
//
// O que mora aqui é só o que o navegador não pode decidir: validar a forma do
// que chegou, e traduzir o erro do banco em frase de gente.
//
// NÃO existe `loja_pedidos`. O pedido é uma linha de `marketplace_pedidos` no
// canal da loja, e por isso aparece sozinho em Pedidos, com o ciclo inteiro
// que o ERP já tem.

export type ItemPedidoNovo = { produtoId: string; quantidade: number }

export type DadosCliente = {
  nome: string
  telefone: string
  doc?: string
  email?: string
}

export type DadosEntrega = {
  modo: 'entrega' | 'retirada'
  cep?: string
  logradouro?: string
  numero?: string
  complemento?: string
  bairro?: string
  cidade?: string
  uf?: string
}

export type ItemRecusado = {
  produtoId: string
  nome: string
  motivo: 'indisponivel' | 'sem_saldo' | 'acima_do_limite'
  disponivel: number
}

export type PedidoCriado = {
  ok: true
  pedidoId: string
  numero: string
  total: number
}

export type PedidoRecusado = {
  ok: false
  erro: string
  /** Preenchido quando o motivo é item a item — a tela mostra a lista. */
  itens?: ItemRecusado[]
}

/**
 * Mensagens de recusa.
 *
 * Escritas para o consumidor, não para quem programou: ele não sabe o que é
 * "modo_entrega_indisponivel", e a frase precisa dizer o que fazer a seguir.
 */
const MENSAGEM: Record<string, string> = {
  loja_indisponivel: 'A loja está temporariamente fora do ar. Tente de novo em alguns minutos.',
  carrinho_vazio: 'Seu carrinho está vazio.',
  modo_entrega_indisponivel: 'Esta forma de receber não está disponível nesta loja.',
  cliente_sem_nome: 'Precisamos do seu nome para registrar o pedido.',
  itens_indisponiveis: 'Alguns itens mudaram de disponibilidade enquanto você comprava.',
}

export function mensagemDeErro(erro: string): string {
  return MENSAGEM[erro] ?? 'Não foi possível concluir o pedido. Tente de novo.'
}

/** Forma de pagamento — combinada, não cobrada. Ver o cabeçalho da migração. */
export const PAGAMENTO_LABEL: Record<string, string> = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  cartao: 'Cartão na entrega',
}

export async function criarPedido(
  loja: Loja,
  itens: ItemPedidoNovo[],
  cliente: DadosCliente,
  entrega: DadosEntrega,
  pagamento: string,
  observacao?: string,
): Promise<PedidoCriado | PedidoRecusado> {
  // Teto de itens distintos: a lista vem do navegador, e sem limite um
  // localStorage adulterado vira uma chamada com milhares de ids. É o mesmo
  // teto que `conferirCarrinho` já aplica.
  const limitados = itens.slice(0, 100).filter(i => i.produtoId && i.quantidade > 0)
  if (limitados.length === 0) return { ok: false, erro: 'carrinho_vazio' }

  const { data, error } = await db().rpc('loja_criar_pedido', {
    p_loja_id: loja.id,
    p_itens: limitados.map(i => ({
      produto_id: i.produtoId,
      quantidade: Math.max(1, Math.floor(i.quantidade)),
    })),
    p_cliente: {
      nome: cliente.nome, telefone: cliente.telefone,
      doc: cliente.doc ?? '', email: cliente.email ?? '',
    },
    p_entrega: entrega,
    p_pagamento: pagamento,
    p_observacao: observacao ?? null,
  })

  if (error) {
    // Erro de banco é defeito nosso, não do cliente: registra com o que
    // permite achar, e devolve uma frase que não expõe o interno.
    console.error('[loja] criar pedido falhou', { lojaId: loja.id, erro: error.message })
    return { ok: false, erro: 'falha_interna' }
  }

  const r = (data ?? {}) as Record<string, unknown>
  if (!r.ok) {
    return {
      ok: false,
      erro: String(r.erro ?? 'falha_interna'),
      itens: Array.isArray(r.itens)
        ? (r.itens as Record<string, unknown>[]).map(i => ({
            produtoId: String(i.produto_id ?? ''),
            nome: String(i.nome ?? ''),
            motivo: (i.motivo as ItemRecusado['motivo']) ?? 'indisponivel',
            disponivel: Number(i.disponivel ?? 0),
          }))
        : undefined,
    }
  }

  return {
    ok: true,
    pedidoId: String(r.pedido_id),
    numero: String(r.numero),
    total: Number(r.total ?? 0),
  }
}

/** A linha crua de `marketplace_pedidos`, antes de virar o que a tela usa. */
type LinhaPedido = {
  numero_pedido: string
  cliente_nome: string | null
  valor_total: number | string | null
  status_externo: string | null
  data_pedido: string | null
  observacoes: string | null
  entrega_cidade: string | null
  entrega_estado: string | null
  marketplace_pedido_itens: {
    nome_produto: string | null
    quantidade: number | string | null
    preco_unitario: number | string | null
    subtotal: number | string | null
  }[] | null
}

/**
 * Busca um pedido pelo número, para a página de confirmação.
 *
 * Recebe o `lojaId` e filtra por ele: sem isso, o número do pedido de uma
 * loja abriria o pedido de outra no mesmo domínio. A lista de campos é
 * branca pelo mesmo motivo da view da vitrine — `dados_brutos` traz
 * `cliente_id` e telefone, e nada disso vai para uma página pública.
 */
export async function buscarPedido(loja: Loja, numero: string) {
  const { data } = await db()
    .from('marketplace_pedidos')
    .select('numero_pedido, cliente_nome, valor_total, status, status_externo, data_pedido, observacoes, entrega_cidade, entrega_estado, marketplace_pedido_itens(nome_produto, quantidade, preco_unitario, subtotal)')
    .eq('canal_id', loja.canalId)
    .eq('numero_pedido', numero)
    .maybeSingle()

  if (!data) return null
  const d = data as LinhaPedido
  return {
    numero: String(d.numero_pedido),
    clienteNome: String(d.cliente_nome ?? ''),
    total: Number(d.valor_total ?? 0),
    modo: (d.status_externo === 'retirada' ? 'retirada' : 'entrega') as 'entrega' | 'retirada',
    dataPedido: d.data_pedido as string | null,
    observacoes: d.observacoes as string | null,
    cidade: [d.entrega_cidade, d.entrega_estado].filter(Boolean).join(' / ') || null,
    itens: (d.marketplace_pedido_itens ?? []).map(i => ({
      nome: String(i.nome_produto ?? ''),
      quantidade: Number(i.quantidade ?? 0),
      precoUnitario: Number(i.preco_unitario ?? 0),
      subtotal: Number(i.subtotal ?? 0),
    })),
  }
}
