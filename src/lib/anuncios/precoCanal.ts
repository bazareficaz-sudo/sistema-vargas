// Preço de um produto NOVO num canal, pela regra de Precificação daquele
// canal — a mesma conta do recálculo em massa. Sem regra ou sem custo, o
// preço do cadastro, dizendo por quê (a tela mostra a origem ao lado).
// Usado pela publicação em lote de todas as plataformas.

import { criarResolvedor, COLUNAS_CANAL } from '@/lib/precificacao/contexto'
import { buscarRegras, resolverRegra } from '@/lib/precificacao/regras'
import { precificarPorRegra } from '@/lib/precificacao/cenarios'

export type PrecificadorCanal = (produto: any) => Promise<{ preco: number; origem: string }>

export async function criarPrecificadorCanal(sb: any, empresaId: string, canalId: string): Promise<PrecificadorCanal> {
  const [{ data: canalPreco }, regras] = await Promise.all([
    sb.from('marketplace_canais').select(COLUNAS_CANAL).eq('id', canalId).eq('empresa_id', empresaId).maybeSingle(),
    buscarRegras(sb, empresaId),
  ])
  const resolvedor = criarResolvedor(sb, empresaId)

  return async (produto: any) => {
    const cadastro = Number(produto.preco_venda ?? 0)
    if (!canalPreco) return { preco: cadastro, origem: 'preço do cadastro' }
    try {
      const regra = resolverRegra(regras, { id: produto.id, categoria: produto.categoria ?? null, marca: produto.marca ?? null }, canalPreco).vencedora
      if (!regra) return { preco: cadastro, origem: 'preço do cadastro (sem regra de preço para este canal)' }
      const c = await resolvedor.contexto({ canal: canalPreco, produto, anuncio: null })
      if (!(c.economia.custo > 0)) return { preco: cadastro, origem: 'preço do cadastro (produto sem custo)' }
      const preco = Number(precificarPorRegra(c.economia, regra).resultado.preco.toFixed(2))
      return preco > 0 ? { preco, origem: `regra "${regra.nome}"` } : { preco: cadastro, origem: 'preço do cadastro' }
    } catch {
      return { preco: cadastro, origem: 'preço do cadastro (não deu para calcular a regra)' }
    }
  }
}
