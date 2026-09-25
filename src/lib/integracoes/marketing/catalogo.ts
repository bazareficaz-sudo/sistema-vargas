import { promocaoVigente } from '@/lib/produtos/promocao'
import { rotuloDaForma } from '@/lib/pdv/formasPagamento'

// Catálogo exportado para o Vargas Marketing (contrato v1).
//
// O Marketing divulga; ele não vende. Por isso sai daqui só o que uma arte
// precisa: nome, preço, promoção, disponibilidade e fotos. Nada de custo,
// margem, fornecedor, dado fiscal ou cliente. Preço em centavos (inteiro),
// nunca zero como substituto de valor ausente.

export const TAG_MARKETING = 'marketing'
// A coluna tags é text[] e o filtro do banco (overlaps) diferencia caixa. Estas
// são as grafias aceitas; o filtro final, em memória, normaliza qualquer uma.
export const VARIANTES_TAG = ['marketing', 'MARKETING', 'Marketing']

export function temTagMarketing(tags: string[] | null | undefined): boolean {
  return (tags ?? []).some(t => t.trim().toLowerCase() === TAG_MARKETING)
}

export type ConfigPromocaoPdv = { exigirFormaPagamento: boolean; formasPermitidas: string[] }

export type ProdutoErp = {
  id: string; nome: string; sku: string | null; ean: string | null; unidade: string | null
  categoria: string | null; marca: string | null; descricao_marketplace: string | null
  ativo: boolean | null; mesclado_em: string | null; tags: string[] | null
  preco_venda: number | string | null; preco_promocional: number | string | null
  promocao_ativa: boolean | null; promocao_inicio: string | null; promocao_fim: string | null
  controlar_estoque: boolean | null; estoque: number | string | null
  foto_url: string | null; updated_at: string
}
export type ImagemErp = { id: string; url: string; ordem: number | null; principal: boolean | null }

export type ProdutoExportado = {
  source_product_id: string
  name: string
  sku: string | null
  ean: string | null
  unit: string | null
  category: string | null
  brand: string | null
  description: string | null
  active: boolean
  regular_price_minor: number | null
  current_price_minor: number | null
  promotion: { price_minor: number; starts_at: string | null; ends_at: string | null; current: boolean } | null
  payment_conditions: string | null
  availability: 'in_stock' | 'out_of_stock' | 'unknown'
  images: { id: string; url: string; main: boolean; position: number }[]
  source_updated_at: string
  currency: 'BRL'
}

const centavos = (v: number | string | null | undefined) => {
  const n = Number(v)
  return v === null || v === undefined || v === '' || !Number.isFinite(n) || n <= 0 ? null : Math.round(n * 100)
}

// Só URLs públicas https: o Marketing baixa a foto e não deve receber
// endereço interno nem esquema estranho.
const urlSegura = (u: string | null | undefined) => {
  if (!u) return null
  try { return new URL(u).protocol === 'https:' ? u : null } catch { return null }
}

export function condicaoPagamento(config: ConfigPromocaoPdv | null, promocaoAtual: boolean): string | null {
  if (!promocaoAtual || !config?.exigirFormaPagamento || config.formasPermitidas.length === 0) return null
  const formas = config.formasPermitidas.map(rotuloDaForma)
  const lista = formas.length === 1 ? formas[0] : `${formas.slice(0, -1).join(', ')} ou ${formas[formas.length - 1]}`
  return `Preço promocional para pagamento em ${lista}`
}

export function exportarProduto(p: ProdutoErp, imagens: ImagemErp[], config: ConfigPromocaoPdv | null, agora = new Date()): ProdutoExportado {
  const regular = centavos(p.preco_venda)
  const promoPreco = centavos(p.preco_promocional)
  const vigente = promocaoVigente(p as Parameters<typeof promocaoVigente>[0], agora)
  const promocao = p.promocao_ativa && promoPreco !== null && (regular === null || promoPreco < regular)
    ? { price_minor: promoPreco, starts_at: p.promocao_inicio, ends_at: p.promocao_fim, current: vigente }
    : null

  const fotos = [...imagens]
    .map(i => ({ ...i, url: urlSegura(i.url) }))
    .filter((i): i is ImagemErp & { url: string } => i.url !== null)
    .sort((a, b) => Number(!!b.principal) - Number(!!a.principal) || (a.ordem ?? 0) - (b.ordem ?? 0))
    .map((i, idx) => ({ id: i.id, url: i.url, main: idx === 0, position: idx }))
  const capa = urlSegura(p.foto_url)
  if (fotos.length === 0 && capa) fotos.push({ id: `foto_url:${p.id}`, url: capa, main: true, position: 0 })

  const estoque = Number(p.estoque)
  const disponibilidade = p.controlar_estoque === false || !Number.isFinite(estoque) ? 'unknown' : estoque > 0 ? 'in_stock' : 'out_of_stock'

  return {
    source_product_id: p.id,
    name: p.nome,
    sku: p.sku || null,
    ean: p.ean || null,
    unit: p.unidade || null,
    category: p.categoria || null,
    brand: p.marca || null,
    description: p.descricao_marketplace?.trim() || null,
    active: !!p.ativo && !p.mesclado_em && temTagMarketing(p.tags),
    regular_price_minor: regular,
    current_price_minor: vigente && promocao ? promocao.price_minor : regular,
    promotion: promocao,
    payment_conditions: condicaoPagamento(config, vigente),
    availability: disponibilidade,
    images: fotos,
    source_updated_at: p.updated_at,
    currency: 'BRL',
  }
}
