import { NextResponse } from 'next/server'
import { lojaAtual } from '@/lib/commerce/loja'
import { consultarPolitica } from '@/lib/commerce/frete/servico'
import { ipDe, ipEstourou } from '@/lib/commerce/limite'

export const dynamic = 'force-dynamic'

// "Como é a entrega para o meu bairro?" — a pergunta da janela de bairro, da
// faixa do topo e do bloco da página do produto. Responde com a política (valor,
// frete grátis acima de, pedido mínimo, prazo) e, quando vem um produto, com o
// frete real daquele item.
//
// A loja vem do host, nunca do corpo. Preço e peso são lidos aqui, do servidor.
// Com CEP, chama serviços de terceiros: por isso o limite por IP, o mesmo da
// cotação do carrinho.

const txt = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : ''

export async function POST(req: Request) {
  const loja = await lojaAtual()
  if (!loja) return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })

  const corpo = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!corpo) return NextResponse.json({ erro: 'Requisição inválida' }, { status: 400 })

  const cepBruto = txt(corpo.cep, 12)
  const cep = cepBruto.replace(/\D/g, '')
  const bairro = txt(corpo.bairro, 100)

  if (cepBruto && cep.length !== 8) {
    return NextResponse.json({ erro: 'Informe um CEP com 8 dígitos.' }, { status: 400 })
  }
  if (!cep && !bairro) {
    return NextResponse.json({ erro: 'Escolha o bairro ou informe o CEP.' }, { status: 400 })
  }
  // Só o CEP custa chamada externa; escolher bairro numa lista é barato. O teto
  // é maior que o da cotação do carrinho porque o navegador reconsulta a
  // política a cada página que o cliente abre.
  if (cep && ipEstourou(ipDe(req), 'entrega-cep', 120)) {
    return NextResponse.json({ erro: 'Muitas consultas. Aguarde alguns minutos.' }, { status: 429 })
  }

  const p = (corpo.produto ?? null) as Record<string, unknown> | null
  const produto = p && txt(p.produtoId, 40)
    ? { produtoId: txt(p.produtoId, 40), quantidade: Math.max(1, Math.floor(Number(p.quantidade) || 1)) }
    : undefined

  const r = await consultarPolitica(
    loja,
    { cep: cep || undefined, bairro, cidade: txt(corpo.cidade, 100), uf: txt(corpo.uf, 2) },
    produto,
  )
  if (!r) return NextResponse.json({ ativo: false })

  if (r.cepNaoEncontrado && !bairro) {
    return NextResponse.json(
      { ativo: true, erro: 'Não encontramos este CEP. Confira o número ou escolha o bairro.' },
      { status: 404 },
    )
  }

  return NextResponse.json({ ativo: true, ...r })
}
