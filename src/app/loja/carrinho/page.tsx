import type { Metadata } from 'next'
import { lojaObrigatoria } from '@/lib/commerce/loja'
import CarrinhoCliente from '@/components/loja/CarrinhoCliente'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Carrinho',
  robots: { index: false, follow: false },
}

export default async function PaginaCarrinho() {
  const loja = await lojaObrigatoria()

  return (
    <CarrinhoCliente
      permiteSemEstoque={loja.permitirVendaSemEstoque}
      entregaAtiva={loja.entregaAtiva}
      retiradaAtiva={loja.retiradaAtiva}
      whatsapp={loja.whatsapp}
      nomeLoja={loja.nome}
    />
  )
}
