import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { lojaObrigatoria } from '@/lib/commerce/loja'
import { buscar, categoriaPorCaminho, categorias } from '@/lib/commerce/catalogo'
import Listagem from '@/components/loja/Listagem'
import { TituloSecao } from '@/components/loja/ds'
import type { Ordenacao } from '@/lib/commerce/tipos'

// Categoria e subcategoria no mesmo arquivo, via rota opcional:
//   /c                      → índice de categorias
//   /c/hidraulica           → listagem
//   /c/hidraulica/tubos-pvc → subcategoria
//
// URL amigável e hierárquica, que é o que o projeto pediu para SEO: o caminho
// conta a estrutura, e não `?categoria=93829`.
export const revalidate = 300

type Props = {
  params: Promise<{ caminho?: string[] }>
  searchParams: Promise<Record<string, string | undefined>>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { caminho = [] } = await params
  const loja = await lojaObrigatoria()
  if (caminho.length === 0) return { title: 'Categorias' }

  const { atual } = await categoriaPorCaminho(loja.id, caminho)
  if (!atual) return { title: 'Categoria' }

  return {
    title: atual.nome,
    description: atual.descricao || `${atual.nome} na ${loja.nome}.`,
    alternates: { canonical: `/c/${caminho.join('/')}` },
  }
}

export default async function PaginaCategoria({ params, searchParams }: Props) {
  const { caminho = [] } = await params
  const busca = await searchParams
  const loja = await lojaObrigatoria()

  // ── Índice de categorias ──────────────────────────────────
  if (caminho.length === 0) {
    const arvore = await categorias(loja.id)
    return (
      <div className="loja-container py-6">
        <TituloSecao titulo="Categorias" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {arvore.map(c => (
            <Link
              key={c.id}
              href={`/c/${c.slug}`}
              className="rounded-[var(--raio)] border border-[var(--borda)] bg-white p-4 transition-shadow hover:shadow-[var(--sombra)]"
            >
              <span className="block font-semibold text-[var(--tinta-forte)]">{c.nome}</span>
              {c.filhos.length > 0 && (
                <span className="mt-1 block text-xs text-[var(--tinta-fraca)]">
                  {c.filhos.length} subcategorias
                </span>
              )}
            </Link>
          ))}
        </div>
      </div>
    )
  }

  const { atual, trilha } = await categoriaPorCaminho(loja.id, caminho)
  if (!atual) notFound()

  const resultado = await buscar(loja, {
    categoriaId: atual.id,
    soPromocao: busca.promocao === '1',
    soDisponivel: busca.disponivel === '1',
    ordem: (busca.ordem as Ordenacao) || 'relevancia',
    pagina: Math.max(Number(busca.pagina) || 1, 1),
    porPagina: 24,
  })

  return (
    <>
      {/* Trilha de navegação: em catálogo grande, é o que evita o cliente
          ficar sem saber onde está depois de chegar por um link do Google. */}
      <nav aria-label="Você está em" className="loja-container pt-5">
        <ol className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-[var(--tinta-media)]">
          <li><Link href="/" className="hover:text-[var(--tinta-forte)]">Início</Link></li>
          {trilha.map((c, i) => (
            <li key={c.id} className="flex items-center gap-1.5">
              <span aria-hidden className="text-[var(--tinta-fraca)]">/</span>
              {i === trilha.length - 1
                ? <span className="font-medium text-[var(--tinta-forte)]" aria-current="page">{c.nome}</span>
                : <Link href={`/c/${caminho.slice(0, i + 1).join('/')}`} className="hover:text-[var(--tinta-forte)]">{c.nome}</Link>}
            </li>
          ))}
        </ol>
      </nav>

      {atual.filhos.length > 0 && (
        <div className="loja-container pt-4">
          <div className="flex flex-wrap gap-2">
            {atual.filhos.map(f => (
              <Link
                key={f.id}
                href={`/c/${[...caminho, f.slug].join('/')}`}
                className="rounded-full border border-[var(--borda)] bg-white px-3.5 py-2 text-[0.8125rem] font-medium text-[var(--tinta-media)] hover:text-[var(--tinta-forte)]"
              >
                {f.nome}
              </Link>
            ))}
          </div>
        </div>
      )}

      <Listagem
        loja={loja}
        resultado={resultado}
        base={`/c/${caminho.join('/')}`}
        params={busca}
        titulo={atual.nome}
        subtitulo={atual.descricao ?? undefined}
        vazioTitulo="Nenhum produto nesta categoria por enquanto"
        vazioDescricao="Estamos ampliando o catálogo. Use a busca para encontrar o que precisa."
      />
    </>
  )
}
