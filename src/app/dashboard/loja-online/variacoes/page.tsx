import { contextoAdmin } from '@/lib/commerce/admin'
import VariacoesClient from '@/components/loja-admin/VariacoesClient'
import SugestoesVariacoes from '@/components/loja-admin/SugestoesVariacoes'
import { sugerirAgrupamentos } from '@/lib/commerce/variacoes'

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

  // Sugestões: produtos que já estão na loja e ainda não têm família. Um
  // produto que nunca foi publicado não entra — a família mora na linha de
  // `loja_produtos`, que só existe depois de publicar ou salvar rascunho.
  const { data: candidatos } = await ctx.sb
    .from('loja_produtos')
    .select('produto_id, produtos(nome, marca, categoria)')
    .eq('loja_id', ctx.lojaId).is('familia_id', null)
    .in('status', ['publicado', 'rascunho', 'pausado'])
    .limit(5000)

  const sugestoes = sugerirAgrupamentos(
    ((candidatos ?? []) as any[])
      .filter(c => c.produtos?.nome)
      .map(c => ({
        id: c.produto_id as string,
        nome: c.produtos.nome as string,
        marca: (c.produtos.marca ?? null) as string | null,
        categoria: (c.produtos.categoria ?? null) as string | null,
      })),
  )

  const lista = ((familias ?? []) as any[]).map(f => ({
    id: f.id as string,
    nome: f.nome as string,
    tipoOpcao: f.tipo_opcao as string,
    itens: porFamilia.get(f.id) ?? [],
  }))

  return (
    <div className="space-y-8">
      <SugestoesVariacoes
        lojaId={ctx.lojaId}
        sugestoes={sugestoes.slice(0, 60)}
        totalSugestoes={sugestoes.length}
        familias={lista.map(f => ({ id: f.id, nome: f.nome, tipoOpcao: f.tipoOpcao }))}
      />
      <VariacoesClient lojaId={ctx.lojaId} familias={lista} />
    </div>
  )
}
