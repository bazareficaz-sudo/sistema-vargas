import { contextoAdmin } from '@/lib/commerce/admin'
import VariacoesClient from '@/components/loja-admin/VariacoesClient'

export const dynamic = 'force-dynamic'

// Famílias de variações (cor, medida...).
//
// Criar uma família acontece na lista de Produtos (marcar os itens e
// "Agrupar como variações"). Esta tela é para conferir e ajustar o que já foi
// agrupado: renomear opções, trocar a ordem, tirar um produto, desfazer.

export default async function VariacoesLoja() {
  const ctx = await contextoAdmin()
  if (!ctx?.lojaId) return null

  const { data: familias } = await ctx.sb
    .from('loja_familias').select('id, nome, tipo_opcao')
    .eq('loja_id', ctx.lojaId).order('nome')

  const { data: membros } = await ctx.sb
    .from('loja_produtos')
    .select('id, produto_id, familia_id, opcao_rotulo, opcao_cor, opcao_ordem, status, slug')
    .eq('loja_id', ctx.lojaId).not('familia_id', 'is', null)
    .order('opcao_ordem').limit(5000)

  const ids = [...new Set(((membros ?? []) as any[]).map(m => m.produto_id as string))]
  const { data: produtos } = ids.length
    ? await ctx.sb.from('produtos').select('id, nome, sku').in('id', ids)
    : { data: [] }
  const porId = new Map(((produtos ?? []) as any[]).map(p => [p.id as string, p]))

  const porFamilia = new Map<string, any[]>()
  for (const m of (membros ?? []) as any[]) {
    const p = porId.get(m.produto_id)
    const lista = porFamilia.get(m.familia_id) ?? []
    lista.push({
      lojaProdutoId: m.id as string,
      nomeProduto: (p?.nome ?? '(produto removido)') as string,
      sku: (p?.sku ?? null) as string | null,
      rotulo: (m.opcao_rotulo ?? '') as string,
      cor: (m.opcao_cor ?? '') as string,
      status: m.status as string,
      slug: m.slug as string | null,
    })
    porFamilia.set(m.familia_id, lista)
  }

  return (
    <VariacoesClient
      lojaId={ctx.lojaId}
      familias={((familias ?? []) as any[]).map(f => ({
        id: f.id as string,
        nome: f.nome as string,
        tipoOpcao: f.tipo_opcao as string,
        itens: porFamilia.get(f.id) ?? [],
      }))}
    />
  )
}
