// SUBSTITUIÇÃO DE VARIÁVEIS EM MODELO DE MENSAGEM.
//
// Esta função faltava, e a falta dela é o motivo de o recurso de modelos
// nunca ter saído do papel. Levantado em 02/09/2026:
//
//   `whatsapp_modelos`         — tabela existe, ZERO linhas, lida só pela
//                                tela de configuração;
//   `whatsapp_config.texto_*`  — sete colunas de texto, lidas só pela tela
//                                de configuração;
//   a lista de variáveis       — `{nome_cliente}`, `{numero_pedido}` e mais
//                                onze, exibidas na tela.
//
// Nenhum código do repositório trocava uma chave por um valor. Dava para
// escrever "Olá {nome_cliente}" e salvar; o cliente receberia exatamente
// "Olá {nome_cliente}". Três mecanismos e nenhuma substituição.

/** O que uma variável vale nesta mensagem. Vazio conta como ausente. */
export type ValoresDoModelo = Record<string, string | number | null | undefined>

export type ModeloAplicado = {
  /** O texto final, pronto para enviar. */
  texto: string
  /**
   * Variáveis que o texto pede e este contexto não tem.
   *
   * NÃO É ERRO — é informação para a tela. Um modelo de cobrança usado num
   * envio de produto vai citar `{vencimento}`, e quem escreveu precisa ver
   * isso ANTES de mandar, não depois que o cliente recebeu a frase pela
   * metade.
   */
  desconhecidas: string[]
  /** Variáveis que existem no contexto e o texto não usou. */
  naoUsadas: string[]
}

// `{` + letras, números e underscore + `}`. Acento fica de fora de propósito:
// a variável é identificador, não texto para o cliente ler.
const CHAVE = /\{([a-z0-9_]+)\}/gi

const vazio = (v: unknown) => v === null || v === undefined || String(v).trim() === ''

/**
 * Troca `{chave}` pelos valores, e diz o que ficou faltando.
 *
 * VARIÁVEL SEM VALOR NÃO VIRA STRING VAZIA. Ela é mantida como está no texto
 * e reportada em `desconhecidas`. Apagar silenciosamente produziria
 * "Segue o link do :" — uma frase quebrada que o cliente recebe e ninguém
 * explica. Deixar a chave à vista é feio, e é feio no lugar certo: na
 * pré-visualização de quem está escrevendo.
 */
export function aplicarModelo(modelo: string, valores: ValoresDoModelo): ModeloAplicado {
  const texto = String(modelo ?? '')
  const desconhecidas: string[] = []
  const usadas = new Set<string>()

  const saida = texto.replace(CHAVE, (original, chave: string) => {
    const nome = chave.toLowerCase()
    const valor = valores[nome]
    if (vazio(valor)) {
      if (!desconhecidas.includes(nome)) desconhecidas.push(nome)
      return original
    }
    usadas.add(nome)
    return String(valor)
  })

  const naoUsadas = Object.keys(valores)
    .filter(k => !vazio(valores[k]) && !usadas.has(k.toLowerCase()))

  return { texto: saida, desconhecidas, naoUsadas }
}

/** As variáveis que um texto pede, na ordem em que aparecem, sem repetir. */
export function variaveisDoModelo(modelo: string): string[] {
  const achadas: string[] = []
  for (const m of String(modelo ?? '').matchAll(CHAVE)) {
    const nome = m[1].toLowerCase()
    if (!achadas.includes(nome)) achadas.push(nome)
  }
  return achadas
}

// ── Variáveis oferecidas por evento ────────────────────────────────────────
//
// Cada evento oferece o que ele REALMENTE tem em mãos na hora do envio. A
// tela mostra só essas, e é o que impede alguém de escrever `{vencimento}`
// numa mensagem de produto: a variável não está lá para ser clicada, e a
// pré-visualização acusa se for digitada.

export type VariavelOferecida = { chave: string; descricao: string; exemplo: string }

export const VARIAVEIS_PRODUTO_LINK: VariavelOferecida[] = [
  { chave: 'produto', descricao: 'Nome do produto', exemplo: 'TELA MOSQUITEIRO VELCRO 1,3M X 1,5M' },
  { chave: 'preco', descricao: 'Preço na loja virtual', exemplo: 'R$ 8,00' },
  { chave: 'link', descricao: 'Endereço do produto na loja', exemplo: 'https://bazareficaz.sistemavargas.com.br/produto/tela-mosquiteiro' },
  { chave: 'loja', descricao: 'Nome da sua loja', exemplo: 'Bazar Eficaz' },
  { chave: 'sku', descricao: 'Código do produto', exemplo: '25637' },
]

/**
 * Mensagem padrão do link de produto.
 *
 * SÓ O LINK, e a razão é medida: a página do produto tem OpenGraph completo,
 * e o WhatsApp monta sozinho a prévia com foto, nome e preço — conferido em
 * produção em 01/09/2026. Repetir o nome no texto duplica o que a prévia
 * mostra e ocupa a primeira linha, que é onde o vendedor escreve o recado
 * dele. Quem quiser um texto de abertura, edita — é o objetivo desta tela.
 */
export const PADRAO_PRODUTO_LINK = '{link}'

/** Exemplo para a pré-visualização, a partir das variáveis oferecidas. */
export function exemploDe(variaveis: VariavelOferecida[]): ValoresDoModelo {
  return Object.fromEntries(variaveis.map(v => [v.chave, v.exemplo]))
}
