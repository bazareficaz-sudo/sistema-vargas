import { NextResponse } from 'next/server'
import { lojaAtual } from '@/lib/commerce/loja'
import { calcularParaCarrinho } from '@/lib/commerce/frete/servico'
import { ipDe, ipEstourou } from '@/lib/commerce/limite'

export const dynamic = 'force-dynamic'

// Cotação de frete da vitrine.
//
// Recebe o CEP (e, se o cliente corrigiu, bairro/cidade/UF) e o carrinho, e
// devolve o endereço que o CEP trouxe e as opções de entrega. Preço e peso são
// lidos AQUI, do servidor — o navegador só diz quais produtos e quantas
// unidades. A loja vem do host, nunca do corpo.
//
// Esta rota chama serviços de terceiros (CEP e mapa), então tem limite próprio
// por IP: sem ele seria um jeito barato de gastar a cota alheia.

const txt = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : ''

export async function POST(req: Request) {
  const loja = await lojaAtual()
  if (!loja) return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })

  if (ipEstourou(ipDe(req), 'frete', 30)) {
    return NextResponse.json({ erro: 'Muitas consultas. Aguarde alguns minutos.' }, { status: 429 })
  }

  const corpo = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!corpo) return NextResponse.json({ erro: 'Requisição inválida' }, { status: 400 })

  const itens = (Array.isArray(corpo.itens) ? corpo.itens : [])
    .slice(0, 100)
    .map((i: unknown) => {
      const o = (i ?? {}) as Record<string, unknown>
      return {
        produtoId: txt(o.produtoId, 40),
        quantidade: Math.max(1, Math.floor(Number(o.quantidade) || 1)),
      }
    })
    .filter(i => i.produtoId)

  if (itens.length === 0) {
    return NextResponse.json({ erro: 'Seu carrinho está vazio.' }, { status: 400 })
  }

  const cep = txt(corpo.cep, 12)
  if (cep.replace(/\D/g, '').length !== 8) {
    return NextResponse.json({ erro: 'Informe um CEP com 8 dígitos.' }, { status: 400 })
  }

  const calculo = await calcularParaCarrinho(loja, itens, {
    cep,
    bairro: txt(corpo.bairro, 100),
    cidade: txt(corpo.cidade, 100),
    uf: txt(corpo.uf, 2),
  })

  // `ativo: false` = a loja não calcula frete; a tela mantém o aviso antigo.
  if (!calculo) return NextResponse.json({ ativo: false })

  if (!calculo.endereco) {
    return NextResponse.json(
      { ativo: true, erro: 'Não encontramos este CEP. Confira o número ou preencha o endereço.' },
      { status: 404 },
    )
  }

  return NextResponse.json({
    ativo: true,
    endereco: {
      logradouro: calculo.endereco.logradouro,
      bairro: calculo.endereco.bairro,
      cidade: calculo.endereco.cidade,
      uf: calculo.endereco.uf,
    },
    distanciaKm: calculo.distanciaKm,
    resultado: calculo.resultado,
  })
}
