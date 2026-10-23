// Variações de produto (cor, medida...) — regras que valem no painel E na
// vitrine. Sem acesso a banco de propósito: este arquivo é importado por
// componentes de navegador (o painel de agrupar) e por rotas de servidor.

export const TIPOS_OPCAO = ['Cor', 'Medida', 'Voltagem', 'Tamanho', 'Opção'] as const

export const ROTULO_MAX = 60
const COR_HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

export type OpcaoEntrada = { rotulo: string; cor: string | null }

/** Aceita `#fff`/`#ffffff`; vazio vira `null`. `undefined` = valor inválido. */
export function normalizarCor(valor: unknown): string | null | undefined {
  if (valor == null) return null
  if (typeof valor !== 'string') return undefined
  const v = valor.trim()
  if (v === '') return null
  return COR_HEX.test(v) ? v.toLowerCase() : undefined
}

export function normalizarRotulo(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const v = valor.trim().replace(/\s+/g, ' ')
  return v !== '' && v.length <= ROTULO_MAX ? v : null
}

// ─── Ordem das opções ────────────────────────────────────────────────────────

/**
 * Valor numérico do começo do rótulo, entendendo fração de polegada:
 * "1/2" → 0,5 · "1 1/2" → 1,5 · "2" → 2 · "2,5 mm" → 2,5. Sem número → NaN.
 * Ordem alfabética colocaria "1" antes de "1/2" e "2" antes de "3/4" — errado
 * para quem compra conexão.
 */
export function valorDoRotulo(rotulo: string): number {
  const s = rotulo.trim().replace(',', '.')
  const misto = /^(\d+)\s+(\d+)\s*\/\s*(\d+)/.exec(s)
  if (misto) return Number(misto[1]) + Number(misto[2]) / Number(misto[3])
  const fracao = /^(\d+)\s*\/\s*(\d+)/.exec(s)
  if (fracao) return Number(fracao[1]) / Number(fracao[2])
  const numero = /^(\d+(?:\.\d+)?)/.exec(s)
  return numero ? Number(numero[1]) : NaN
}

export function compararRotulos(a: string, b: string): number {
  const va = valorDoRotulo(a)
  const vb = valorDoRotulo(b)
  const aNum = !Number.isNaN(va)
  const bNum = !Number.isNaN(vb)
  if (aNum && bNum && va !== vb) return va - vb
  if (aNum !== bNum) return aNum ? -1 : 1
  return a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true })
}

// ─── Sugestão a partir dos nomes do cadastro ─────────────────────────────────

const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'para', 'em'])

/** "BRANCO NEVE" → "Branco Neve". Só mexe em texto TODO em maiúsculas. */
export function suavizarCaixa(texto: string): string {
  if (texto !== texto.toUpperCase() || texto === texto.toLowerCase()) return texto
  return texto
    .split(' ')
    .map((p, i) => {
      if (/\d/.test(p)) return p // medidas e códigos ("18L", "3/4", "PVC25") ficam como vieram
      const baixa = p.toLowerCase()
      if (i > 0 && MINUSCULAS.has(baixa)) return baixa
      return baixa.charAt(0).toUpperCase() + baixa.slice(1)
    })
    .join(' ')
}

const tira = (t: string) => t.replace(/^[\s\-–—/|,]+|[\s\-–—/|,]+$/g, '')

/**
 * A partir dos nomes do cadastro, tenta separar o que é comum (o nome da
 * família) do que muda (a opção). É só a sugestão inicial — quem agrupa
 * confere e corrige antes de salvar.
 *
 *   "TINTA CORALAR DESEMPENHO 18L BRANCO NEVE"  ┐ nome:   "Tinta Coralar Desempenho 18L"
 *   "TINTA CORALAR DESEMPENHO 18L DIA NUBLADO"  ┘ opções: "Branco Neve", "Dia Nublado"
 */
export function sugerirFamilia(nomes: string[]): { nome: string; rotulos: string[] } {
  const listas = nomes.map(n => n.trim().split(/\s+/).filter(Boolean))
  if (listas.length < 2) return { nome: nomes[0]?.trim() ?? '', rotulos: nomes.map(() => '') }

  const igual = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const menor = Math.min(...listas.map(l => l.length))

  let prefixo = 0
  while (prefixo < menor && listas.every(l => igual(l[prefixo], listas[0][prefixo]))) prefixo++

  // O sufixo comum só conta se sobrar pelo menos 1 palavra de opção em cada nome.
  let sufixo = 0
  while (
    sufixo < menor - prefixo - 1 &&
    listas.every(l => igual(l[l.length - 1 - sufixo], listas[0][listas[0].length - 1 - sufixo]))
  ) sufixo++

  const base = [
    ...listas[0].slice(0, prefixo),
    ...(sufixo > 0 ? listas[0].slice(listas[0].length - sufixo) : []),
  ]
  const rotulos = listas.map(l => tira(l.slice(prefixo, l.length - sufixo).join(' ')))

  return {
    nome: suavizarCaixa(tira(base.join(' '))),
    rotulos: rotulos.map(suavizarCaixa),
  }
}
