import { NextResponse } from 'next/server'
import { lojaAtual } from '@/lib/commerce/loja'
import { aplicarFrete, criarPedido, mensagemDeErro, type FreteAplicado } from '@/lib/commerce/pedido'
import { calcularParaCarrinho, escolherOpcao } from '@/lib/commerce/frete/servico'
import { notificarPedido } from '@/lib/commerce/notificar'
import { ipDe, ipEstourou, limiteDoBancoEstourou } from '@/lib/commerce/limite'

export const dynamic = 'force-dynamic'

const MENSAGEM_LIMITE =
  'Recebemos muitos pedidos seus em pouco tempo. Aguarde alguns minutos ou fale com a loja pelo WhatsApp.'

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

  // Campo-isca: invisível para gente, preenchido por robô de formulário.
  if (txt(corpo.site, 200)) {
    return NextResponse.json({ erro: 'Requisição inválida' }, { status: 400 })
  }
  if (ipEstourou(ipDe(req))) {
    return NextResponse.json({ erro: MENSAGEM_LIMITE }, { status: 429 })
  }

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

  if (await limiteDoBancoEstourou(loja, telefone.replace(/\D/g, ''))) {
    return NextResponse.json({ erro: MENSAGEM_LIMITE }, { status: 429 })
  }

  const e = (corpo.entrega ?? {}) as Record<string, unknown>
  const modo = e.modo === 'retirada' ? 'retirada' as const : 'entrega' as const

  if (modo === 'entrega') {
    const faltando = ['logradouro', 'numero', 'bairro', 'cidade'].filter(k => !txt(e[k], 200))
    if (faltando.length > 0) {
      return NextResponse.json({ erro: 'Complete o endereço de entrega.' }, { status: 400 })
    }
  }

  // ── Frete ──────────────────────────────────────────────────
  //
  // Recalculado AQUI, com preço e peso do servidor. O valor que o cliente viu
  // só serve de conferência: se o servidor chega a outro número, o pedido NÃO
  // é criado e o cliente vê o valor novo antes de confirmar — frete nunca
  // muda em silêncio. Retirada na loja não tem frete.
  let frete: FreteAplicado | null = null
  if (modo === 'entrega') {
    const vistoBruto = (corpo.frete ?? {}) as Record<string, unknown>
    const calculo = await calcularParaCarrinho(loja, itens, {
      cep: txt(e.cep, 12), bairro: txt(e.bairro, 100), cidade: txt(e.cidade, 100), uf: txt(e.uf, 2),
    })

    if (calculo) {
      const r = calculo.resultado
      if (txt(e.cep, 12).replace(/\D/g, '').length !== 8) {
        return NextResponse.json({ erro: 'Informe o CEP para calcular a entrega.' }, { status: 400 })
      }
      if (r.status === 'indisponivel') {
        return NextResponse.json({ erro: r.motivo }, { status: 400 })
      }
      if (r.status === 'combinar') {
        frete = { status: 'combinar', valor: 0, distanciaKm: calculo.distanciaKm }
      } else {
        const opcao = escolherOpcao(r, txt(vistoBruto.servico, 80))
        const visto = Number(vistoBruto.valor)
        if (!opcao || !Number.isFinite(visto) || Math.abs(opcao.valor - visto) > 0.005) {
          return NextResponse.json(
            { erro: 'O valor da entrega mudou. Confira e confirme de novo.', frete: r },
            { status: 409 },
          )
        }
        frete = {
          status: 'calculado', valor: opcao.valor, servico: opcao.servico,
          regraId: opcao.regraId, distanciaKm: calculo.distanciaKm,
        }
      }
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
  // O frete entra ANTES do aviso, para a mensagem da loja já trazer o total
  // certo.
  const total = frete
    ? await aplicarFrete(resultado.pedidoId, resultado.total, frete)
    : resultado.total

  await notificarPedido(loja, resultado.numero)

  return NextResponse.json({
    ok: true,
    numero: resultado.numero,
    total,
  })
}
