import { contextoAdmin } from '@/lib/commerce/admin'
import ProdutosLojaClient from '@/components/loja-admin/ProdutosLojaClient'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50

// Escolha do que vai para a vitrine.
//
// Com 14.252 produtos ativos, a experiência tem que ser de LISTA e não de
// ficha: buscar, filtrar, marcar vários, publicar. Obrigar a abrir produto
// por produto tornaria a tela inútil no primeiro uso real.
//
// A consulta é paginada no banco (`range`), nunca "traz tudo e filtra na
// tela" — o relatório de Estoque & Giro deste mesmo sistema já tem o defeito
// de reler 14 mil produtos a cada abertura, e não vale repetir.

export default async function ProdutosLoja({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const p = await searchParams
  const ctx = await contextoAdmin()
  if (!ctx?.lojaId) return null

  const pagina = Math.max(Number(p.pagina) || 1, 1)
  const termo = (p.q ?? '').trim()
  const status = p.status ?? ''
  const foto = p.foto ?? ''
  const estoque = p.estoque ?? ''

  let q = ctx.sb
    .from('produtos')
    // Lista branca de colunas mesmo aqui, no painel: o operador pode não ter
    // permissão de ver custo (`ver_custos_margens`), e esta tela não precisa.
    .select('id, nome, sku, marca, categoria, preco_venda, estoque, foto_url', { count: 'exact' })
    .eq('empresa_id', ctx.empresaId)
    .eq('ativo', true)

  if (termo) {
    // Cada palavra é exigida no BANCO, encadeando `ilike` — o mesmo conserto
    // já aplicado na busca da entrada de mercadoria. Filtrar depois de trazer
    // 300 linhas faz o produto certo nem chegar a ser avaliado.
    for (const palavra of termo.split(/\s+/).filter(Boolean).slice(0, 6)) {
      const seguro = palavra.replace(/[,()%*]/g, ' ').trim()
      if (seguro) q = q.or(`nome.ilike.%${seguro}%,sku.ilike.%${seguro}%,ean.ilike.%${seguro}%`)
    }
  }
  if (foto === 'sem') q = q.is('foto_url', null)
  if (foto === 'com') q = q.not('foto_url', 'is', null)
  if (estoque === 'com') q = q.gt('estoque', 0)
  if (estoque === 'sem') q = q.lte('estoque', 0)

  const de = (pagina - 1) * POR_PAGINA
  const { data: produtos, count } = await q.order('nome').range(de, de + POR_PAGINA - 1)

  // Estado de publicação dos que estão nesta página. Consulta separada, e não
  // um join, porque `loja_produtos` é uma tabela pequena e o `in` com 50 ids
  // é mais barato que um join sobre 14 mil linhas.
  const ids = (produtos ?? []).map((x: any) => x.id)
  const { data: publicacoes } = ids.length
    ? await ctx.sb.from('loja_produtos')
        .select('produto_id, status, slug, estoque_publicavel')
        .eq('loja_id', ctx.lojaId).in('produto_id', ids)
    : { data: [] }

  const porProduto = new Map(
    ((publicacoes ?? []) as any[]).map(l => [l.produto_id, l]),
  )

  const linhas = (produtos ?? []).map((x: any) => {
    const pub = porProduto.get(x.id)
    return {
      id: x.id,
      nome: x.nome,
      sku: x.sku,
      marca: x.marca,
      categoria: x.categoria,
      preco: Number(x.preco_venda ?? 0),
      estoqueCadastro: Number(x.estoque ?? 0),
      temFoto: !!x.foto_url,
      status: (pub?.status ?? 'nao_publicado') as string,
      slug: pub?.slug ?? null,
      estoqueLoja: pub?.estoque_publicavel != null ? Number(pub.estoque_publicavel) : null,
    }
  }).filter((l: any) => !status || l.status === status)

  return (
    <ProdutosLojaClient
      lojaId={ctx.lojaId}
      linhas={linhas}
      total={count ?? 0}
      pagina={pagina}
      porPagina={POR_PAGINA}
      filtros={{ q: termo, status, foto, estoque }}
    />
  )
}
