import type { Metadata } from 'next'
import { lojaObrigatoria } from '@/lib/commerce/loja'
import CarrinhoCliente from '@/components/loja/CarrinhoCliente'
import { carregarFrete } from '@/lib/commerce/frete/servico'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Carrinho',
  robots: { index: false, follow: false },
}

export default async function PaginaCarrinho() {
  const loja = await lojaObrigatoria()

  // Mesma regra do checkout: só oferece cotação se a loja ligou e configurou o
  // frete. Qualquer falha ao carregar cai no aviso antigo de frete combinado.
  const freteAtivo = loja.entregaAtiva && (await carregarFrete(loja.id)) !== null

  return (
    <CarrinhoCliente
      freteAtivo={freteAtivo}
      permiteSemEstoque={loja.permitirVendaSemEstoque}
      entregaAtiva={loja.entregaAtiva}
      retiradaAtiva={loja.retiradaAtiva}
      whatsapp={loja.whatsapp}
      nomeLoja={loja.nome}
    />
  )
}
