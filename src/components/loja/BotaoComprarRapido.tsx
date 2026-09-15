'use client'

import { useRouter } from 'next/navigation'
import { useCarrinho } from './CarrinhoContexto'
import { estiloPrimario } from './ds'
import type { ProdutoCard } from '@/lib/commerce/tipos'

// Compra rápida no card da listagem — configurável em Loja Online →
// Configurações → Listagem de produtos, desligada por padrão.
//
// `CardProduto` inteiro é um `<Link>` para a página do produto; este botão
// mora DENTRO dele, então `preventDefault`/`stopPropagation` são obrigatórios
// — sem eles, clicar em "Comprar" também navegaria para a página por baixo.
//
// Sempre 1 unidade, sempre "Comprar agora" (vai direto pro carrinho): o card
// não tem espaço nem contexto para escolher quantidade — quem quiser mais de
// uma unidade ajusta na página do produto ou no próprio carrinho.
export default function BotaoComprarRapido({ p }: { p: ProdutoCard }) {
  const router = useRouter()
  const { adicionar } = useCarrinho()

  function comprar(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    adicionar({
      produtoId: p.produtoId, slug: p.slug, nome: p.nome,
      imagemUrl: p.imagemUrl, precoVisto: p.preco,
    }, 1)
    router.push('/carrinho')
  }

  return (
    <button
      type="button"
      onClick={comprar}
      className="mt-2 h-8 w-full rounded-[8px] text-[0.75rem] font-semibold text-white transition-colors hover:brightness-110 active:brightness-95"
      style={estiloPrimario}
    >
      Comprar
    </button>
  )
}
