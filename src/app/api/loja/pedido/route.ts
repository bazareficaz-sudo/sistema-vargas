import { NextResponse } from 'next/server'
import { lojaAtual } from '@/lib/commerce/loja'
import { criarPedido, mensagemDeErro } from '@/lib/commerce/pedido'
import { notificarPedido } from '@/lib/commerce/notificar'

export const dynamic = 'force-dynamic'

// Fechamento do pedido da loja.
//
// A loja vem do HOST, nunca do corpo da requisição. É a mesma regra que rege
// a vitrine inteira desde a Fase 1: quem decide de quem é a loja é o
// endereço, resolvido por `src/proxy.ts`. Aceitar um `lojaId` daqui deixaria
// qualquer um criar pedido em qualquer loja da plataforma.

/** Limpa e limita texto que veio do navegador. */
const txt = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : ''

export async function POST(req: Request) {
  const loja = await lojaAtual()
  if (!loja) return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })
  if (loja.emManutencao) {
    return NextResponse.json({ erro: mensagemDeErro('loja_indisponivel') }, { status: 503 })
  }

  const corpo = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!corpo) return NextResponse.json({ erro: 'Requisição inválida' }, { status: 400 })

  const itensBrutos = Array.isArray(corpo.itens) ? corpo.itens : []
  const itens = itensBrutos
    .map((i: unknown) => {
      const o = (i ?? {}) as Record<string, unknown>
      return {
        produtoId: txt(o.produtoId, 40),
        quantidade: Math.max(1, Math.floor(Number(o.quantidade) || 1)),
      }
    })
    .filter(i => i.produtoId)

  if (itens.length === 0) {
    return NextResponse.json({ erro: mensagemDeErro('carrinho_vazio') }, { status: 400 })
  }

  const c = (corpo.cliente ?? {}) as Record<string, unknown>
  const nome = txt(c.nome, 120)
  const telefone = txt(c.telefone, 40)
  if (!nome) {
    return NextResponse.json({ erro: mensagemDeErro('cliente_sem_nome') }, { status: 400 })
  }
  // O telefone é como a loja retoma o contato para combinar entrega e
  // pagamento. Sem ele o pedido nasce sem caminho de volta.
  if (telefone.replace(/\D/g, '').length < 10) {
    return NextResponse.json({ erro: 'Informe um telefone com DDD.' }, { status: 400 })
  }

  const e = (corpo.entrega ?? {}) as Record<string, unknown>
  const modo = e.modo === 'retirada' ? 'retirada' as const : 'entrega' as const

  if (modo === 'entrega') {
    const faltando = ['logradouro', 'numero', 'bairro', 'cidade'].filter(k => !txt(e[k], 200))
    if (faltando.length > 0) {
      return NextResponse.json({ erro: 'Complete o endereço de entrega.' }, { status: 400 })
    }
  }

  const resultado = await criarPedido(
    loja,
    itens,
    { nome, telefone, doc: txt(c.doc, 20), email: txt(c.email, 200) },
    {
      modo,
      cep: txt(e.cep, 20), logradouro: txt(e.logradouro, 200), numero: txt(e.numero, 20),
      complemento: txt(e.complemento, 100), bairro: txt(e.bairro, 100),
      cidade: txt(e.cidade, 100), uf: txt(e.uf, 2),
    },
    txt(corpo.pagamento, 30) || 'pix',
    txt(corpo.observacao, 500),
  )

  if (!resultado.ok) {
    // 409 para o que mudou entre o carrinho e o Confirmar — não é erro de
    // preenchimento, e a tela trata diferente: mostra os itens e reconfere.
    const conflito = resultado.erro === 'itens_indisponiveis'
    return NextResponse.json(
      { erro: mensagemDeErro(resultado.erro), itens: resultado.itens },
      { status: conflito ? 409 : 400 },
    )
  }

  // Avisa DEPOIS de o pedido existir, e a função inteira engole os próprios
  // erros: o pedido já está gravado e o estoque reservado, então uma Z-API
  // fora do ar não pode virar venda perdida. Aguardado, e não disparado ao
  // vento, porque em serverless o trabalho após a resposta é cortado.
  await notificarPedido(loja, resultado.numero)

  return NextResponse.json({
    ok: true,
    numero: resultado.numero,
    total: resultado.total,
  })
}
