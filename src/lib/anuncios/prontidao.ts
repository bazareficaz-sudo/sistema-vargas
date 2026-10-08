// PRONTIDÃO PARA ANUNCIAR — o que falta no cadastro de cada produto para ele
// poder virar anúncio em cada canal.
//
// Medido em 08/10/2026: 1.063 produtos ativos com estoque, 762 sem anúncio em
// canal nenhum — e só 40 com peso, 36 com medidas, 24 com descrição. Criar
// anúncio um a um esbarra nisso antes de qualquer outra coisa: a tela de
// criar pede o peso, a Shopee recusa sem medidas, a TikTok sem foto.
//
// OBRIGATÓRIO aqui é o que o canal RECUSA sem; RECOMENDADO é o que ele
// aceita mas vende pior (sem EAN o ML esconde de busca por código; sem marca
// algumas categorias da Shopee travam).

export type Plataforma = 'mercadolivre' | 'shopee' | 'tiktok'

export const PLATAFORMAS: { id: Plataforma; nome: string }[] = [
  { id: 'mercadolivre', nome: 'Mercado Livre' },
  { id: 'shopee', nome: 'Shopee' },
  { id: 'tiktok', nome: 'TikTok Shop' },
]

export type Requisito = 'foto' | 'peso' | 'medidas' | 'descricao' | 'preco' | 'ean' | 'marca' | 'fotos3'

export const ROTULO_REQUISITO: Record<Requisito, string> = {
  foto: 'foto',
  peso: 'peso',
  medidas: 'medidas',
  descricao: 'descrição',
  preco: 'preço',
  ean: 'EAN',
  marca: 'marca',
  fotos3: '3+ fotos',
}

const REGRAS: Record<Plataforma, { obrigatorio: Requisito[]; recomendado: Requisito[] }> = {
  // Mercado Envios calcula frete pelo pacote: sem peso e medidas o anúncio
  // não entra no envio do ML.
  mercadolivre: { obrigatorio: ['foto', 'preco', 'peso', 'medidas'], recomendado: ['ean', 'marca', 'descricao', 'fotos3'] },
  shopee: { obrigatorio: ['foto', 'preco', 'peso', 'medidas', 'descricao'], recomendado: ['marca', 'fotos3', 'ean'] },
  // TikTok: peso é obrigatório; medidas só em algumas categorias.
  tiktok: { obrigatorio: ['foto', 'preco', 'peso', 'descricao'], recomendado: ['medidas', 'marca', 'fotos3'] },
}

/** Descrição curta demais não vende nem passa na Shopee. */
export const DESCRICAO_MINIMA = 60

export type ProdutoProntidao = {
  id: string; nome: string; sku: string | null; ean: string | null; marca: string | null
  estoque: number; preco_venda: number | null; preco_custo: number | null
  peso_kg: number | null; comprimento_cm: number | null; largura_cm: number | null; altura_cm: number | null
  descricao_marketplace: string | null; fotos: number; plataformas: string[]
}

export function temRequisito(p: ProdutoProntidao, r: Requisito): boolean {
  switch (r) {
    case 'foto': return p.fotos > 0
    case 'fotos3': return p.fotos >= 3
    case 'peso': return Number(p.peso_kg ?? 0) > 0
    case 'medidas': return Number(p.comprimento_cm ?? 0) > 0 && Number(p.largura_cm ?? 0) > 0 && Number(p.altura_cm ?? 0) > 0
    case 'descricao': return String(p.descricao_marketplace ?? '').trim().length >= DESCRICAO_MINIMA
    case 'preco': return Number(p.preco_venda ?? 0) > 0
    case 'ean': return /^\d{8,14}$/.test(String(p.ean ?? '').replace(/\D/g, '')) && String(p.ean ?? '').replace(/\D/g, '').length >= 8
    case 'marca': return String(p.marca ?? '').trim().length > 0
  }
}

export type Avaliacao = {
  /** O que falta e o canal recusa. Vazio = pronto. */
  faltaObrigatorio: Requisito[]
  faltaRecomendado: Requisito[]
  pronto: boolean
  jaAnunciado: boolean
}

export function avaliar(p: ProdutoProntidao, plataforma: Plataforma): Avaliacao {
  const regras = REGRAS[plataforma]
  const faltaObrigatorio = regras.obrigatorio.filter(r => !temRequisito(p, r))
  return {
    faltaObrigatorio,
    faltaRecomendado: regras.recomendado.filter(r => !temRequisito(p, r)),
    pronto: faltaObrigatorio.length === 0,
    jaAnunciado: p.plataformas.includes(plataforma),
  }
}

/** Tudo que falta em qualquer canal, sem repetir — o que a linha da grade mostra. */
export function faltasGerais(p: ProdutoProntidao): Requisito[] {
  const todas = new Set<Requisito>()
  for (const { id } of PLATAFORMAS) for (const r of REGRAS[id].obrigatorio) if (!temRequisito(p, r)) todas.add(r)
  return [...todas]
}

/**
 * Marca sugerida sem IA: a marca cadastrada que aparece no nome do produto
 * (a mais longa, para "TRAMONTINA PRO" ganhar de "TRAMONTINA").
 */
export function marcaNoNome(nome: string, marcas: string[]): string | null {
  const n = ` ${normalizar(nome)} `
  const achadas = marcas
    .filter(m => m.trim().length >= 2)
    .filter(m => n.includes(` ${normalizar(m)} `) || n.includes(` ${normalizar(m)}-`))
    .sort((a, b) => b.length - a.length)
  return achadas[0] ?? null
}

function normalizar(t: string): string {
  return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}
