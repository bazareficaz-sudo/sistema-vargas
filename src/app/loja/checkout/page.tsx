import type { Metadata } from 'next'
import { lojaObrigatoria } from '@/lib/commerce/loja'
import CheckoutCliente from '@/components/loja/CheckoutCliente'

export const dynamic = 'force-dynamic'

// Checkout — Fase 3.
//
// `noindex` como o carrinho: é página de uma sessão de compra, não conteúdo.
// Indexá-la traria gente do Google para um carrinho vazio.
export const metadata: Metadata = {
  title: 'Finalizar pedido',
  robots: { index: false, follow: false },
}

export default async function PaginaCheckout() {
  const loja = await lojaObrigatoria()

  // Endereço só é montado quando a retirada está ligada — é a única hora em
  // que o cliente precisa saber para onde ir.
  const endereco = loja.retiradaAtiva
    ? [loja.cidade, loja.uf].filter(Boolean).join(' / ') || null
    : null

  return (
    <CheckoutCliente
      entregaAtiva={loja.entregaAtiva}
      retiradaAtiva={loja.retiradaAtiva}
      pagamentoFormas={loja.pagamentoFormas}
      enderecoLoja={endereco}
    />
  )
}
