import type { Metadata } from 'next'
import { lojaObrigatoria } from '@/lib/commerce/loja'
import { buscar } from '@/lib/commerce/catalogo'
import Listagem from '@/components/loja/Listagem'
import type { Ordenacao } from '@/lib/commerce/tipos'

// Resultado de busca — sempre dinâmico. Cachear combinação de termo, filtro,
// ordem e página é cachear um espaço infinito de URLs; o ganho seria mínimo
// e a memória, não.
export const dynamic = 'force-dynamic'

type Busca = Promise<Record<string, string | undefined>>

export async function generateMetadata({ searchParams }: { searchParams: Busca }): Promise<Metadata> {
  const { q } = await searchParams
  return {
    title: q ? `Busca por "${q}"` : 'Produtos',
    // Página de resultado nunca é indexável: gera URL infinita e conteúdo
    // duplicado, que é o jeito mais rápido de piorar o SEO do site inteiro.
    robots: { index: false, follow: true },
  }
}

export default async function PaginaBusca({ searchParams }: { searchParams: Busca }) {
  const params = await searchParams
  const loja = await lojaObrigatoria()

  const termo = params.q?.trim() || undefined
  const pagina = Math.max(Number(params.pagina) || 1, 1)

  const resultado = await buscar(loja, {
    termo,
    marca: params.marca || undefined,
    soPromocao: params.promocao === '1',
    soDisponivel: params.disponivel === '1',
    ordem: (params.ordem as Ordenacao) || 'relevancia',
    pagina,
    porPagina: 24,
  })

  const titulo = termo ? `Resultados para "${termo}"`
    : params.marca ? params.marca
    : 'Todos os produtos'

  return (
    <Listagem
      loja={loja}
      resultado={resultado}
      base="/buscar"
      params={params}
      titulo={titulo}
      vazioTitulo={termo ? `Nada encontrado para "${termo}"` : 'Nenhum produto por aqui'}
      vazioDescricao={
        termo
          // Sugestão concreta em vez de "tente outra busca": a busca já tolera
          // acento, plural e erro de digitação, então o problema costuma ser
          // termo específico demais.
          ? 'Tente escrever menos palavras, ou buscar pela marca ou pelo código do produto.'
          : 'Ajuste os filtros para ver mais produtos.'
      }
    />
  )
}
