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

// ─── Sugestão de famílias para o catálogo inteiro ────────────────────────────

export type ItemParaAgrupar = {
  /** `produtos.id` — o mesmo que a rota de agrupar recebe. */
  id: string
  nome: string
  /** Não entra na comparação (ver `sugerirAgrupamentos`); fica para exibir. */
  marca: string | null
  categoria: string | null
}

export type SugestaoFamilia = {
  /** Estável entre renderizações: serve de `key`. */
  chave: string
  nome: string
  tipo: 'Cor' | 'Medida'
  itens: { id: string; nome: string; rotulo: string }[]
}

const SEM_ACENTO = /[\u0300-\u036f]/g

function palavras(nome: string): string[] {
  return nome
    .normalize('NFD').replace(SEM_ACENTO, '').toLowerCase()
    .replace(/["“”']/g, '')
    .split(/\s+/)
    // Travessão e asterisco soltos só atrapalham a comparação.
    .filter(t => t !== '' && !/^[-–—|*]+$/.test(t))
}

const MAX_CAUDA = 3
const MAX_FAMILIA = 40

/**
 * Procura, no catálogo, grupos de produtos que são "o mesmo produto em outra
 * cor ou medida": mesma categoria, nomes iguais exceto por um trecho
 * curto (a cor, a medida).
 *
 *   "TE ROSCÁVEL - 3/4"" / "TE ROSCÁVEL - 1 1/2""      → o trecho final muda
 *   "CABO FLEX 2,5MM PRETO 100M" / "... AZUL 100M"     → o trecho do meio muda
 *
 * É sugestão, não decisão: quem usa confere cada grupo antes de criar. Por
 * isso erra para o lado de sugerir de menos — um grupo errado custa a atenção
 * de quem revisa.
 */
export function sugerirAgrupamentos(itens: ItemParaAgrupar[]): SugestaoFamilia[] {
  const porBalde = new Map<string, { item: ItemParaAgrupar; t: string[] }[]>()
  for (const item of itens) {
    const t = palavras(item.nome)
    if (t.length < 3) continue
    // Por categoria, não por marca: a mesma linha costuma vir de marcas
    // diferentes (o Te de 3/4" de uma, o de 1" de outra) e é a opção que o
    // cliente quer ver lado a lado.
    const balde = (item.categoria ?? '').toLowerCase()
    const lista = porBalde.get(balde) ?? []
    lista.push({ item, t })
    porBalde.set(balde, lista)
  }

  const resultado: SugestaoFamilia[] = []

  for (const [balde, lista] of porBalde) {
    if (lista.length < 2) continue

    // Modelo → produtos que o seguem, com o trecho que varia.
    const modelos = new Map<string, { comum: number; membros: { idx: number; variavel: string }[] }>()
    const registrar = (chave: string, comum: number, idx: number, variavel: string) => {
      const m = modelos.get(chave) ?? { comum, membros: [] }
      m.membros.push({ idx, variavel })
      modelos.set(chave, m)
    }

    lista.forEach(({ t }, idx) => {
      // Trecho variável no FIM (1 a 3 palavras): "TE ROSCAVEL" + medida.
      for (let p = 2; p < t.length && t.length - p <= MAX_CAUDA; p++) {
        registrar(`F|${t.slice(0, p).join(' ')}`, p, idx, t.slice(p).join(' '))
      }
      // Trecho variável no MEIO (1 a 2 palavras), com algo depois dele.
      for (let w = 1; w <= 2; w++) {
        for (let i = 1; i + w < t.length; i++) {
          const antes = t.slice(0, i).join(' ')
          const depois = t.slice(i + w).join(' ')
          registrar(`M|${i}|${w}|${antes}|${depois}`, t.length - w, idx, t.slice(i, i + w).join(' '))
        }
      }
    })

    // Maiores grupos primeiro; empate, o de mais texto em comum (mais certo).
    const candidatos = [...modelos.entries()]
      .map(([chave, m]) => ({ chave, ...m }))
      .filter(m => m.membros.length >= 2)
      .sort((a, b) => b.membros.length - a.membros.length || b.comum - a.comum)

    const usados = new Set<number>()
    for (const c of candidatos) {
      const livres = c.membros.filter(m => !usados.has(m.idx))
      // Rótulo repetido = os nomes só diferem no que não é opção (ex.: duplicata).
      const vistos = new Set<string>()
      const unicos = livres.filter(m => (vistos.has(m.variavel) ? false : (vistos.add(m.variavel), true)))
      if (unicos.length < 2 || unicos.length > MAX_FAMILIA) continue
      for (const m of unicos) usados.add(m.idx)

      const originais = unicos.map(m => lista[m.idx].item)
      const sugerido = sugerirFamilia(originais.map(o => o.nome))
      // Opção com número ("3/4", "20MM", "16A") é medida; só palavras é cor.
      const comNumero = sugerido.rotulos.filter(r => /\d/.test(r)).length
      const tipo = comNumero >= sugerido.rotulos.length / 2 ? 'Medida' : 'Cor'

      resultado.push({
        chave: `${balde}|${c.chave}`,
        nome: sugerido.nome,
        tipo,
        itens: originais
          .map((o, i) => ({ id: o.id, nome: o.nome, rotulo: sugerido.rotulos[i] }))
          .sort((a, b) => compararRotulos(a.rotulo, b.rotulo)),
      })
    }
  }

  return resultado.sort((a, b) => b.itens.length - a.itens.length || a.nome.localeCompare(b.nome, 'pt-BR'))
}
