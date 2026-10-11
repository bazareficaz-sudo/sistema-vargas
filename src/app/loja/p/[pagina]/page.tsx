import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { lojaObrigatoria } from '@/lib/commerce/loja'
import { paginaDaLoja } from '@/lib/commerce/paginas'

export const dynamic = 'force-dynamic'

// Páginas institucionais (Sobre, Entrega, Pagamento, Trocas, Privacidade).
// O conteúdo vem de `paginasDaLoja`, montado a partir dos dados da loja.

export async function generateMetadata(
  { params }: { params: Promise<{ pagina: string }> },
): Promise<Metadata> {
  const { pagina } = await params
  const loja = await lojaObrigatoria()
  const p = paginaDaLoja(loja, pagina)
  return p ? { title: p.titulo, description: p.descricao } : {}
}

export default async function PaginaInstitucional(
  { params }: { params: Promise<{ pagina: string }> },
) {
  const { pagina } = await params
  const loja = await lojaObrigatoria()
  const p = paginaDaLoja(loja, pagina)
  if (!p) notFound()

  return (
    <article className="loja-container max-w-3xl py-10">
      <h1 className="text-2xl font-bold text-[var(--tinta-forte)]">{p.titulo}</h1>

      <div className="mt-6 space-y-6">
        {p.secoes.map((s, i) => (
          <section key={i}>
            {s.titulo && (
              <h2 className="text-lg font-semibold text-[var(--tinta-forte)]">{s.titulo}</h2>
            )}
            {s.paragrafos.map((t, n) => (
              <p key={n} className="mt-2 text-sm leading-relaxed text-[var(--tinta-media)]">{t}</p>
            ))}
            {s.itens && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--tinta-media)]">
                {s.itens.map((t, n) => <li key={n}>{t}</li>)}
              </ul>
            )}
          </section>
        ))}
      </div>
    </article>
  )
}
