// Limpeza de texto capturado de anúncio de terceiro.
//
// O que esta função faz: tira do texto tudo que identifica a LOJA e a MARCA
// de origem, e devolve um ponto de partida limpo para o operador reescrever.
//
// O que ela NÃO faz, e é importante ser claro: ela não reescreve. O texto que
// sai continua sendo, em essência, o texto do vendedor de origem — sem os
// nomes dele. Anúncio duplicado é penalizado no ranking dos marketplaces e
// descrição de terceiro pode ser conteúdo protegido, então isto é um rascunho
// de trabalho, não um texto pronto para publicar.
//
// Tudo aqui é determinístico e auditável: cada remoção é registrada e
// devolvida, para o operador conferir o que sumiu em vez de descobrir depois.

export type OpcoesLimpeza = {
  /** Nome da loja de origem, para apagar do texto. */
  vendedor?: string | null
  /** Marca do anúncio de origem. */
  marcaOrigem?: string | null
  /** Marca do produto vinculado no sistema — entra no lugar da de origem. */
  marcaDestino?: string | null
}

export type ResultadoLimpeza = {
  texto: string
  /** O que foi tirado ou trocado, em linguagem de gente. */
  mudancas: string[]
}

/** Escapa para uso literal dentro de RegExp. */
function esc(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Palavras que aparecem em nome de marca e de loja mas são palavras comuns do
 * português. Nunca podem ser apagadas sozinhas.
 *
 * Isto não é preciosismo: testado contra um anúncio real de torneira da marca
 * "Casa Premier", apagar a palavra "casa" destruiria a frase "a cozinha é um
 * dos locais mais movimentados da casa". A palavra distintiva é "Premier" —
 * e é só ela que deve sair.
 */
const PALAVRAS_GENERICAS = new Set([
  'casa', 'lar', 'loja', 'store', 'shop', 'oficial', 'brasil', 'brazil',
  'comercio', 'comércio', 'industria', 'indústria', 'distribuidora', 'importadora',
  'produtos', 'artigos', 'materiais', 'metais', 'ferragens', 'utilidades',
  'ltda', 'eireli', 'epp', 'sa', 'me', 'cia', 'grupo', 'center', 'centro',
  'moveis', 'móveis', 'decoracao', 'decoração', 'construcao', 'construção',
])

/**
 * Plataformas e termos de loja que aparecem em descrição copiada. Não é uma
 * lista de concorrentes — é a lista do que denuncia que o texto veio de outro
 * anúncio.
 */
const PLATAFORMAS = [
  'mercado livre', 'mercadolivre', 'mercado libre', 'mercadolibre',
  'shopee', 'magalu', 'magazine luiza', 'americanas', 'aliexpress',
  'amazon', 'olx', 'shein', 'tiktok shop', 'nuvemshop',
]

/**
 * Promessa comercial de quem vendia — frete, prazo, parcelamento, superlativo
 * de vitrine. Nada disso é característica do produto, e prometer no seu lugar
 * o que a outra loja prometia é como um anúncio copiado nasce errado.
 */
const PROMESSAS = [
  'frete gr[áa]tis', 'frete free', 'envio imediato', 'entrega imediata',
  'pronta entrega', 'envio em 24 ?h(oras)?', 'entrega r[áa]pida',
  '\\d{1,2}x sem juros', 'sem juros', 'parcele em at[ée] \\d{1,2}x',
  'menor pre[çc]o', 'melhor pre[çc]o', 'super oferta', 'promo[çc][ãa]o rel[âa]mpago',
  'imperd[íi]vel', '[úu]ltimas unidades', 'compre j[áa]', 'aproveite',
  'loja oficial', 'vendido e entregue por', 'garantia da loja',
  'siga (a )?nossa loja', 'visite nossa loja', 'consulte nossa loja',
]

/** Contato direto: e-mail, telefone, WhatsApp, @perfil, link. */
function removerContatos(texto: string, mudancas: string[]): string {
  let out = texto
  const aplicar = (re: RegExp, rotulo: string) => {
    if (re.test(out)) {
      out = out.replace(re, ' ')
      if (!mudancas.includes(rotulo)) mudancas.push(rotulo)
    }
  }
  aplicar(/https?:\/\/\S+/gi, 'endereços de site')
  aplicar(/\bwww\.[^\s]+/gi, 'endereços de site')
  aplicar(/[\w.+-]+@[\w-]+\.[\w.]+/g, 'e-mails')
  // (11) 91234-5678 / 11912345678 / +55 11 91234-5678
  aplicar(/(\+?55\s*)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g, 'telefones')
  aplicar(/\bwhats?app\b[^.\n]*/gi, 'menções a WhatsApp')
  aplicar(/(^|\s)@[A-Za-z0-9_.]{3,}/g, 'perfis de rede social')
  return out
}

/**
 * Texto quase todo em caixa alta cansa de ler e é marca de anúncio de
 * marketplace. Só mexe quando a maioria das letras é maiúscula — assim uma
 * sigla legítima (LED, PVC, INOX) no meio de um texto normal não é tocada.
 */
function normalizarCaixa(texto: string, mudancas: string[]): string {
  const letras = texto.replace(/[^A-Za-zÀ-ÿ]/g, '')
  if (letras.length < 12) return texto
  const maiusculas = (texto.match(/[A-ZÀ-Þ]/g) ?? []).length
  if (maiusculas / letras.length < 0.6) return texto

  mudancas.push('caixa alta excessiva')
  const minusculo = texto.toLowerCase()
  // Recapitaliza o início de cada frase.
  return minusculo.replace(/(^|[.!?]\s+|\n\s*)([a-zà-ÿ])/g, (_m, antes, letra) => antes + letra.toUpperCase())
}

export function limparTextoOrigem(original: string | null | undefined, opcoes: OpcoesLimpeza = {}): ResultadoLimpeza {
  const mudancas: string[] = []
  if (!original || !original.trim()) return { texto: '', mudancas }

  let texto = original

  // ── Marca: troca pela do seu cadastro, ou some ───────────────────────────
  //
  // Duas passadas, e as duas são necessárias. Medido contra anúncio real:
  // a marca cadastrada era "Premier Metais", mas a descrição dizia só
  // "A marca Premier oferece..." — procurar o nome inteiro não achava nada.
  const marcaOrigem = (opcoes.marcaOrigem ?? '').trim()
  const marcaDestino = (opcoes.marcaDestino ?? '').trim()
  if (marcaOrigem && marcaOrigem.length >= 2) {
    // 1) Nome completo → vira a sua marca.
    const reCompleto = new RegExp(`\\b${esc(marcaOrigem)}\\b`, 'gi')
    if (reCompleto.test(texto)) {
      texto = texto.replace(reCompleto, marcaDestino || ' ')
      mudancas.push(marcaDestino
        ? `marca "${marcaOrigem}" trocada por "${marcaDestino}"`
        : `marca "${marcaOrigem}" removida`)
    }

    // 2) Palavra distintiva solta → sai. Palavra comum do português que só
    //    por acaso está no nome da marca fica onde está.
    for (const palavra of marcaOrigem.split(/\s+/)) {
      const limpa = palavra.replace(/[^\wÀ-ÿ]/g, '')
      if (limpa.length < 4) continue
      if (PALAVRAS_GENERICAS.has(limpa.toLowerCase())) continue
      const re = new RegExp(`\\b${esc(limpa)}\\b`, 'gi')
      if (!re.test(texto)) continue
      texto = texto.replace(re, ' ')
      const rotulo = `menção solta a "${limpa}"`
      if (!mudancas.includes(rotulo)) mudancas.push(rotulo)
    }
  }

  // ── Loja de origem ───────────────────────────────────────────────────────
  const vendedor = (opcoes.vendedor ?? '').trim()
  if (vendedor && vendedor.length >= 3) {
    const reCompleto = new RegExp(`\\b${esc(vendedor)}\\b`, 'gi')
    if (reCompleto.test(texto)) {
      texto = texto.replace(reCompleto, ' ')
      mudancas.push(`nome da loja "${vendedor}" removido`)
    }
    // Mesma lógica da marca: o nome da loja quase nunca aparece completo no
    // meio do texto — aparece a palavra que identifica ela.
    for (const palavra of vendedor.split(/\s+/)) {
      const limpa = palavra.replace(/[^\wÀ-ÿ]/g, '')
      if (limpa.length < 4) continue
      if (PALAVRAS_GENERICAS.has(limpa.toLowerCase())) continue
      const re = new RegExp(`\\b${esc(limpa)}\\b`, 'gi')
      if (!re.test(texto)) continue
      texto = texto.replace(re, ' ')
      const rotulo = `menção solta a "${limpa}"`
      if (!mudancas.includes(rotulo)) mudancas.push(rotulo)
    }
    // "Vendido por Fulano", "Loja Fulano" — o rótulo sozinho também sai.
    texto = texto.replace(/\bvendido (e entregue )?por\b/gi, ' ')
  }

  // ── Plataformas ──────────────────────────────────────────────────────────
  for (const p of PLATAFORMAS) {
    const re = new RegExp(`\\b${p}\\b`, 'gi')
    if (re.test(texto)) {
      texto = texto.replace(re, ' ')
      if (!mudancas.includes('nomes de marketplace')) mudancas.push('nomes de marketplace')
    }
  }

  // ── Promessas comerciais de quem vendia ──────────────────────────────────
  for (const p of PROMESSAS) {
    const re = new RegExp(p, 'gi')
    if (re.test(texto)) {
      texto = texto.replace(re, ' ')
      if (!mudancas.includes('promessas de frete/prazo/parcelamento')) {
        mudancas.push('promessas de frete/prazo/parcelamento')
      }
    }
  }

  texto = removerContatos(texto, mudancas)

  // ── Emoji e enfeite ──────────────────────────────────────────────────────
  const semEmoji = texto.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, ' ')
  if (semEmoji !== texto) { texto = semEmoji; mudancas.push('emojis') }

  const semRepetido = texto.replace(/([!?*_~=-])\1{1,}/g, '$1')
  if (semRepetido !== texto) { texto = semRepetido; mudancas.push('pontuação repetida') }

  texto = normalizarCaixa(texto, mudancas)

  // ── Espaçamento ──────────────────────────────────────────────────────────
  texto = texto
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .split('\n').map(l => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // Linha que sobrou vazia de sentido depois das remoções (só pontuação).
  texto = texto.split('\n').filter(l => !/^[\s|•\-–—*.:;,]*$/.test(l) || l === '').join('\n').trim()

  return { texto, mudancas }
}
