// Regras PURAS da publicação em lote na TikTok — sem banco nem API, para a
// tela (navegador) e os testes usarem sem puxar código de servidor.

import { formatarTituloAnuncio } from '@/lib/texto/titulo'
import type { AtributoTiktok, CategoriaTiktok } from '@/lib/tiktok/listing'

export type AtributoRascunho = AtributoTiktok & { valorId: string | null; valorTexto: string | null }

export type RascunhoTiktok = {
  produtoId: string
  nome: string
  sku: string | null
  ean: string | null
  foto: string | null
  fotos: string[]
  titulo: string
  descricao: string
  preco: number
  origemPreco: string
  estoque: number
  peso: number | null
  comprimento: number | null
  largura: number | null
  altura: number | null
  categoria: { id: string; caminho: string; aproximada?: boolean } | null
  marca: { id: string; nome: string } | null
  atributos: AtributoRascunho[]
  medidasObrigatorias: boolean
  pendencias: string[]
}

export const norm = (t: string) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * O valor do atributo que o NOME do produto traz, se traz. Compara palavra
 * inteira, e o valor mais longo ganha ("Bivolt" não perde para "V").
 */
export function valorPeloNome(nome: string, valores: { id: string; nome: string }[]): { id: string; nome: string } | null {
  const n = ` ${norm(nome).replace(/[^a-z0-9/.,]+/g, ' ')} `
  const achados = valores
    .filter(v => norm(v.nome).trim().length >= 2)
    .filter(v => n.includes(` ${norm(v.nome).replace(/[^a-z0-9/.,]+/g, ' ').trim()} `))
    .sort((a, b) => b.nome.length - a.nome.length)
  return achados[0] ?? null
}

export function pendenciasDoRascunho(r: Pick<RascunhoTiktok, 'fotos' | 'categoria' | 'preco' | 'peso' | 'atributos' | 'titulo' | 'medidasObrigatorias' | 'comprimento' | 'largura' | 'altura'>): string[] {
  const p: string[] = []
  if (r.fotos.length === 0) p.push('sem foto')
  if (!r.categoria) p.push('sem categoria')
  if (!(r.preco > 0)) p.push('sem preço')
  if (!(Number(r.peso) > 0)) p.push('sem peso')
  if (r.medidasObrigatorias && !(Number(r.comprimento) > 0 && Number(r.largura) > 0 && Number(r.altura) > 0)) p.push('sem medidas (a categoria exige)')
  if (!r.titulo.trim()) p.push('sem título')
  const faltando = r.atributos.filter(a => a.obrigatorio && !a.valorId && !String(a.valorTexto ?? '').trim())
  for (const a of faltando) p.push(`falta "${a.nome}"`)
  return p
}

/** Título de anúncio a partir do nome do cadastro, sem os "**" e símbolos da frente. */
export function tituloLimpo(nome: string): string {
  return formatarTituloAnuncio(String(nome ?? '').replace(/^[^\p{L}\p{N}]+/u, '')).slice(0, 255)
}

const SEM_PESO = new Set(['tipo', 'para', 'com', 'sem', 'kit', 'unidade', 'unidades', 'peca', 'pecas', 'cor', 'modelo', 'novo', 'original'])
const normalizar = (t: string) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const radical = (p: string) => (p.length > 5 ? p.replace(/(es|s)$/, '') : p)

/**
 * Plano B da categoria, quando a TikTok não sugere: a folha que mais casa
 * com as palavras do título — nome da folha vale 2, o caminho vale 1. Medido
 * em 08/10/2026: olhar só a primeira palavra mandou "Disco Serra Madeira
 * Corrente" para "Discos rígidos". Precisa casar o nome da folha; o
 * resultado sempre vai marcado como APROXIMADO.
 */
export function categoriaPorPalavras(folhas: CategoriaTiktok[], titulo: string): CategoriaTiktok | null {
  const palavras = [...new Set(normalizar(titulo).split(/[^a-z]+/).filter(p => p.length >= 4 && !SEM_PESO.has(p)).map(radical))].slice(0, 6)
  if (palavras.length === 0) return null
  let melhor: { c: CategoriaTiktok; pontos: number } | null = null
  for (const c of folhas) {
    const nome = normalizar(c.nome)
    const caminho = normalizar(c.caminho)
    let folha = 0
    let pontos = 0
    for (const p of palavras) {
      if (nome.includes(p)) { folha++; pontos += 2 } else if (caminho.includes(p)) pontos += 1
    }
    if (folha === 0) continue
    // Loja de ferragens: no empate, a árvore de ferramentas/ferragens/casa
    // ganha ("Disco serra" é serra, não disco rígido).
    if (/ferrament|ferrag|eletric|constru|casa|jardim|hidraul/.test(caminho)) pontos += 1
    if (!melhor || pontos > melhor.pontos || (pontos === melhor.pontos && c.caminho.length < melhor.c.caminho.length)) melhor = { c, pontos }
  }
  return melhor?.c ?? null
}

