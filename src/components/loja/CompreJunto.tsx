'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useCarrinho } from './CarrinhoContexto'
import { ImagemProduto, TituloSecao, classesBotao, estiloPrimario, real } from './ds'
import type { ProdutoCard } from '@/lib/commerce/tipos'

// "Compre junto" na página do produto.
//
// Mesma ideia do "Ofereça também" do PDV, só que dirigida ao cliente: o balcão
// lembra o vendedor do parafuso que ficou sem a bucha; aqui a vitrine lembra o
// comprador. As sugestões saem da mesma função do banco (ver
// `compreJunto` em src/lib/commerce/catalogo.ts).
//
// Tudo vem marcado: é uma OFERTA, e quem não quer desmarca. O total mostrado é
// só soma de preços de tabela — o que vale é o carrinho, que o servidor
// reconfere (preço e saldo) a cada abertura. Por isso o botão leva ao carrinho
// em vez de fechar o pedido daqui.

export type ItemOferta = Pick<ProdutoCard, 'produtoId' | 'slug' | 'nome' | 'marca' | 'imagemUrl' | 'preco'>

export default function CompreJunto({ principal, sugestoes }: {
  principal: ItemOferta
  sugestoes: ItemOferta[]
}) {
  const router = useRouter()
  const { adicionar } = useCarrinho()
  const [marcados, setMarcados] = useState<Set<string>>(
    () => new Set(sugestoes.map(s => s.produtoId)),
  )

  const escolhidos = sugestoes.filter(s => marcados.has(s.produtoId))
  const quantidade = 1 + escolhidos.length
  const total = principal.preco + escolhidos.reduce((s, i) => s + i.preco, 0)

  function alternar(id: string) {
    setMarcados(atual => {
      const novo = new Set(atual)
      if (novo.has(id)) novo.delete(id); else novo.add(id)
      return novo
    })
  }

  function adicionarTodos() {
    for (const i of [principal, ...escolhidos]) {
      adicionar({
        produtoId: i.produtoId, slug: i.slug, nome: i.nome,
        imagemUrl: i.imagemUrl, precoVisto: i.preco,
      }, 1)
    }
    router.push('/carrinho')
  }

  return (
    <section className="mt-12" aria-label="Compre junto">
      <TituloSecao titulo="Compre junto" subtitulo="Quem levou este produto também levou" />

      <div className="grid gap-4 rounded-[var(--raio)] border border-[var(--borda)] bg-white p-4 lg:grid-cols-[1fr_17rem]">
        <ul className="divide-y divide-[var(--borda)]">
          <li className="flex items-center gap-3 pb-3">
            <span className="w-5 shrink-0" aria-hidden />
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-[var(--raio-sm)] border border-[var(--borda)]">
              <ImagemProduto url={principal.imagemUrl} alt={principal.nome} compacto className="h-full w-full" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--tinta-fraca)]">
                Este produto
              </span>
              <p className="loja-linhas-2 text-[0.875rem] font-medium text-[var(--tinta-forte)]">{principal.nome}</p>
            </div>
            <span className="shrink-0 text-[0.9375rem] font-bold">{real(principal.preco)}</span>
          </li>

          {sugestoes.map(s => (
            <li key={s.produtoId} className="flex items-center gap-3 py-3 last:pb-0">
              <input
                type="checkbox"
                checked={marcados.has(s.produtoId)}
                onChange={() => alternar(s.produtoId)}
                aria-label={`Incluir ${s.nome}`}
                className="h-5 w-5 shrink-0 cursor-pointer accent-[var(--loja-primaria)]"
              />
              <Link
                href={`/produto/${s.slug}`}
                className="h-14 w-14 shrink-0 overflow-hidden rounded-[var(--raio-sm)] border border-[var(--borda)]"
                tabIndex={-1}
                aria-hidden
              >
                <ImagemProduto url={s.imagemUrl} alt="" compacto className="h-full w-full" />
              </Link>
              <div className="min-w-0 flex-1">
                {s.marca && (
                  <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--tinta-fraca)]">
                    {s.marca}
                  </span>
                )}
                <Link href={`/produto/${s.slug}`} className="loja-linhas-2 block text-[0.875rem] font-medium text-[var(--tinta-forte)] hover:underline">
                  {s.nome}
                </Link>
              </div>
              <span className="shrink-0 text-[0.9375rem] font-bold">{real(s.preco)}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col justify-center rounded-[10px] bg-[var(--fundo-suave)] p-4">
          <p className="text-sm text-[var(--tinta-media)]">
            {quantidade} {quantidade === 1 ? 'item' : 'itens'} juntos
          </p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-[var(--tinta-forte)]" aria-live="polite">
            {real(total)}
          </p>
          <button
            type="button"
            onClick={adicionarTodos}
            disabled={escolhidos.length === 0}
            className={classesBotao('primario', 'mt-3 w-full disabled:opacity-40')}
            style={estiloPrimario}
          >
            {escolhidos.length === 0 ? 'Marque um item' : `Adicionar ${quantidade} itens ao carrinho`}
          </button>
        </div>
      </div>
    </section>
  )
}
