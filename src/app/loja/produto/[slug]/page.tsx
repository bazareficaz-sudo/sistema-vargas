import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { lojaObrigatoria } from '@/lib/commerce/loja'
import { produtoPorSlug, relacionados } from '@/lib/commerce/catalogo'
import CardProduto from '@/components/loja/CardProduto'
import ComprarProduto from '@/components/loja/ComprarProduto'
import Galeria from '@/components/loja/Galeria'
import { Preco, SeloDisponibilidade, TituloSecao, real } from '@/components/loja/ds'

// Página do produto. É a página que recebe o tráfego do Google e do WhatsApp,
// então é a que mais precisa de metadata e dado estruturado.
//
// Dinâmica de propósito: a disponibilidade aqui é AO VIVO, não cache. Esta é
// a página onde o cliente decide comprar; mostrar "disponível" com número de
// cinco minutos atrás é o começo de um pedido que não pode ser atendido.
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const loja = await lojaObrigatoria()
  const p = await produtoPorSlug(loja, slug)
  if (!p) return { title: 'Produto não encontrado' }

  const descricao =
    p.metaDescription ||
    p.descricaoCurta ||
    // Fallback honesto: diz o que é e por quanto, sem inventar atributo que o
    // cadastro não tem.
    `${p.nome}${p.marca ? ` — ${p.marca}` : ''}. ${real(p.preco)} na ${loja.nome}.`

  return {
    title: p.seoTitle,
    description: descricao.slice(0, 160),
    alternates: { canonical: `/produto/${p.slug}` },
    openGraph: {
      type: 'website',
      title: p.seoTitle,
      description: descricao.slice(0, 160),
      // Compartilhamento no WhatsApp depende disto: sem imagem, o link vira
      // um retângulo cinza com texto.
      images: p.imagemUrl ? [{ url: p.imagemUrl }] : undefined,
    },
  }
}

export default async function PaginaProduto({ params }: Props) {
  const { slug } = await params
  const loja = await lojaObrigatoria()
  const p = await produtoPorSlug(loja, slug)
  if (!p) notFound()

  const similares = await relacionados(loja, p, 10)
  const disponivel = p.disponivelAgora

  // Dados estruturados: é o que faz preço e disponibilidade aparecerem no
  // resultado do Google. Só declara o que é verdade — `availability` sai do
  // número ao vivo, não de um valor fixo.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.nome,
    image: p.imagens.map(i => i.url),
    description: p.descricaoCurta || p.descricaoCompleta || undefined,
    sku: p.sku || undefined,
    gtin13: p.ean || undefined,
    brand: p.marca ? { '@type': 'Brand', name: p.marca } : undefined,
    offers: {
      '@type': 'Offer',
      price: p.preco.toFixed(2),
      priceCurrency: 'BRL',
      availability: disponivel > 0 || loja.permitirVendaSemEstoque
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: loja.nome },
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="loja-container py-6">
        <nav aria-label="Você está em" className="mb-4 text-[0.8125rem] text-[var(--tinta-media)]">
          <Link href="/" className="hover:text-[var(--tinta-forte)]">Início</Link>
          <span aria-hidden className="mx-1.5 text-[var(--tinta-fraca)]">/</span>
          <span className="text-[var(--tinta-forte)]">{p.nome}</span>
        </nav>

        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          <Galeria imagens={p.imagens} nome={p.nome} />

          <div className="space-y-5">
            <div>
              {p.marca && (
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--tinta-fraca)]">
                  {p.marca}
                </span>
              )}
              <h1 className="mt-1 text-xl font-bold leading-tight tracking-tight text-[var(--tinta-forte)] md:text-2xl">
                {p.nome}
              </h1>
              {p.sku && (
                <p className="mt-1.5 text-xs text-[var(--tinta-fraca)]">Código {p.sku}</p>
              )}
            </div>

            <div>
              <Preco
                valor={p.preco} de={p.precoDe} pix={p.precoPix}
                politica={loja.politicaPreco} tamanho="pagina"
              />
              <div className="mt-2">
                <SeloDisponibilidade
                  disponivel={disponivel}
                  permiteSemEstoque={loja.permitirVendaSemEstoque}
                />
              </div>
            </div>

            {p.descricaoCurta && (
              <p className="text-[var(--tinta-media)]">{p.descricaoCurta}</p>
            )}

            <ComprarProduto produto={p} permiteSemEstoque={loja.permitirVendaSemEstoque} />

            {(loja.whatsapp || loja.telefone) && (
              <div className="rounded-[var(--raio)] border border-[var(--borda)] bg-[var(--fundo-suave)] p-4 text-sm">
                <p className="font-medium text-[var(--tinta-forte)]">Dúvida sobre este produto?</p>
                {loja.whatsapp && (
                  <a
                    href={`https://wa.me/55${loja.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(
                      `Olá! Tenho uma dúvida sobre: ${p.nome}`,
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block font-semibold"
                    style={{ color: 'var(--loja-primaria)' }}
                  >
                    Falar no WhatsApp
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        {(p.descricaoCompleta || p.caracteristicas.length > 0 ||
          Object.keys(p.especificacoes).length > 0 || p.aplicacoes) && (
          <section className="mt-12 max-w-3xl">
            {p.descricaoCompleta && (
              <>
                <h2 className="text-lg font-bold">Sobre o produto</h2>
                <div className="mt-3 whitespace-pre-line leading-relaxed text-[var(--tinta-media)]">
                  {p.descricaoCompleta}
                </div>
              </>
            )}

            {p.caracteristicas.length > 0 && (
              <>
                <h2 className="mt-8 text-lg font-bold">Características</h2>
                <ul className="mt-3 space-y-1.5">
                  {p.caracteristicas.map((c, i) => (
                    <li key={i} className="flex gap-2 text-[var(--tinta-media)]">
                      <span aria-hidden style={{ color: 'var(--loja-primaria)' }}>•</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {Object.keys(p.especificacoes).length > 0 && (
              <>
                <h2 className="mt-8 text-lg font-bold">Especificações</h2>
                <dl className="mt-3 divide-y divide-[var(--borda)] rounded-[var(--raio)] border border-[var(--borda)]">
                  {Object.entries(p.especificacoes).map(([k, v]) => (
                    <div key={k} className="flex gap-4 px-4 py-2.5 text-sm">
                      <dt className="w-40 shrink-0 text-[var(--tinta-fraca)]">{k}</dt>
                      <dd className="text-[var(--tinta-forte)]">{v}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}

            {p.aplicacoes && (
              <>
                <h2 className="mt-8 text-lg font-bold">Aplicações</h2>
                <p className="mt-3 whitespace-pre-line leading-relaxed text-[var(--tinta-media)]">
                  {p.aplicacoes}
                </p>
              </>
            )}
          </section>
        )}

        {similares.length > 0 && (
          <section className="mt-14">
            <TituloSecao titulo="Produtos relacionados" />
            <div className="loja-trilho">
              {similares.map(s => (
                <CardProduto
                  key={s.lojaProdutoId}
                  p={s}
                  permiteSemEstoque={loja.permitirVendaSemEstoque}
                  politica={loja.politicaPreco}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  )
}
