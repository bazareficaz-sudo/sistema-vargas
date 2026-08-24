import { contextoAdmin } from '@/lib/commerce/admin'
import CategoriasLojaClient from '@/components/loja-admin/CategoriasLojaClient'

export const dynamic = 'force-dynamic'

// Categorias comerciais.
//
// A árvore da loja é INDEPENDENTE da categoria do ERP de propósito. No
// cadastro, categoria é TEXTO, está duplicada e tem acento quebrado — e
// arrumar isso lá mexe em dezenas de telas, relatórios e na IA. Aqui a
// faxina acontece só na vitrine, sem um único UPDATE em `produtos`.

export default async function CategoriasLoja() {
  const ctx = await contextoAdmin()
  if (!ctx?.lojaId) return null

  const { data: categorias } = await ctx.sb
    .from('loja_categorias')
    .select('id, nome, slug, pai_id, ativo, destaque, ordem')
    .eq('loja_id', ctx.lojaId)
    .order('ordem').order('nome')

  const lista = (categorias ?? []) as any[]

  // Quantos produtos publicados caem em cada nó. É esse número que mostra
  // qual categoria vale a pena manter e qual é resíduo do cadastro.
  const { data: contagem } = await ctx.sb
    .from('loja_produtos')
    .select('loja_categoria_id')
    .eq('loja_id', ctx.lojaId).eq('status', 'publicado')
    .limit(5000)

  const porCategoria = new Map<string, number>()
  for (const l of ((contagem ?? []) as any[])) {
    const k = l.loja_categoria_id
    if (k) porCategoria.set(k, (porCategoria.get(k) ?? 0) + 1)
  }

  return (
    <CategoriasLojaClient
      lojaId={ctx.lojaId}
      categorias={lista.map(c => ({
        id: c.id, nome: c.nome, slug: c.slug, paiId: c.pai_id,
        ativo: c.ativo, destaque: c.destaque, ordem: c.ordem,
        produtos: porCategoria.get(c.id) ?? 0,
      }))}
      semCategoria={porCategoria.size > 0 ? (contagem ?? []).filter((l: any) => !l.loja_categoria_id).length : 0}
    />
  )
}
