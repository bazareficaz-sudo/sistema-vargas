import Link from 'next/link'
import { ImagemProduto, Preco, SeloDisponibilidade } from './ds'
import type { ProdutoCard } from '@/lib/commerce/tipos'

// O card existe para uma decisão só: vale a pena abrir este produto?
//
// Por isso ele mostra imagem, nome, preço e disponibilidade — e nada mais.
// SKU, EAN, marca em destaque, ficha técnica e botão de comprar direto foram
// deixados de fora de propósito: informação técnica no card é ruído para o
// consumidor, e "comprar" sem escolher quantidade leva de volta para trás.

export default function CardProduto({ p, permiteSemEstoque, prioridade = false }: {
  p: ProdutoCard
  permiteSemEstoque: boolean
  /** Só para os primeiros da primeira dobra: carrega a imagem sem lazy. */
  prioridade?: boolean
}) {
  const semSaldo = p.estoquePublicavel <= 0 && !permiteSemEstoque
  const desconto = p.precoDe && p.precoDe > p.preco
    ? Math.round((1 - p.preco / p.precoDe) * 100)
    : 0

  return (
    <Link
      href={`/produto/${p.slug}`}
      className="group flex flex-col overflow-hidden rounded-[var(--raio)] border border-[var(--borda)] bg-white transition-shadow hover:shadow-[var(--sombra-alta)]"
    >
      <div className="relative">
        <ImagemProduto
          url={p.imagemUrl}
          alt={p.nome}
          prioridade={prioridade}
          // Quadrado: o catálogo mistura foto de fornecedor, de marketplace e
          // sem foto. Altura fixa é o que mantém a grade alinhada.
          className="aspect-square w-full"
        />

        {desconto >= 5 && (
          <span
            className="absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[0.6875rem] font-bold text-white"
            style={{ background: 'var(--loja-destaque)' }}
          >
            −{desconto}%
          </span>
        )}

        {/* Esmaecer, e não esconder: o cliente precisa saber que a loja
            trabalha com o item, mesmo que hoje não tenha. */}
        {semSaldo && (
          <span className="absolute inset-x-0 bottom-0 bg-white/92 py-1 text-center text-[0.6875rem] font-semibold text-[var(--tinta-media)]">
            Indisponível
          </span>
        )}
      </div>

      <div className={`flex flex-1 flex-col gap-1.5 p-3 ${semSaldo ? 'opacity-70' : ''}`}>
        {p.marca && (
          <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--tinta-fraca)]">
            {p.marca}
          </span>
        )}

        <h3 className="loja-linhas-2 text-[0.8125rem] leading-snug text-[var(--tinta-forte)]">
          {p.nome}
        </h3>

        <div className="mt-auto pt-1">
          <Preco valor={p.preco} de={p.precoDe} pix={p.precoPix} />
          <div className="mt-1">
            <SeloDisponibilidade disponivel={p.estoquePublicavel} permiteSemEstoque={permiteSemEstoque} />
          </div>
        </div>
      </div>
    </Link>
  )
}
