// Definição única de botão.
//
// Antes disto, cada tela inventava o seu: uma varredura no projeto achou 10
// combinações diferentes de padding só para o botão azul primário
// (px-4 py-2, px-5 py-2, px-3 py-1.5, px-4 py-2.5, px-6 py-2.5...). Lado a
// lado numa mesma barra, viram botões de alturas diferentes — que é o que dá
// aparência amadora a uma tela por outro lado correta.
//
// A cura não é acertar os números numa tela: é ter um lugar só onde eles são
// decididos.

export type VarianteBotao = 'primario' | 'secundario' | 'perigo' | 'sutil'
export type TamanhoBotao = 'sm' | 'md'

// Altura FIXA por tamanho, não padding vertical. Padding faz a altura variar
// conforme o conteúdo (um botão com emoji fica mais alto que um sem), e é a
// causa mais comum de barra de botões desalinhada.
const TAMANHOS: Record<TamanhoBotao, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
}

const VARIANTES: Record<VarianteBotao, string> = {
  primario:
    'bg-blue-600 text-white border border-blue-600 hover:bg-blue-700 hover:border-blue-700',
  secundario:
    'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 hover:border-gray-400',
  // Destrutivo em contorno, não em bloco vermelho: chama atenção sem gritar,
  // e deixa o vermelho sólido livre para confirmações de verdade.
  perigo:
    'bg-white text-red-700 border border-red-300 hover:bg-red-50 hover:border-red-400',
  sutil:
    'bg-transparent text-gray-500 border border-transparent hover:text-gray-800 hover:bg-gray-100',
}

const BASE = [
  'inline-flex items-center justify-center gap-1.5',
  // Rótulo nunca quebra em duas linhas. É o que produzia "palavras quebradas"
  // quando a barra ficava apertada.
  'whitespace-nowrap',
  'rounded-lg font-medium leading-none',
  'transition-colors',
  'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-inherit',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
].join(' ')

export function botao(
  variante: VarianteBotao = 'secundario',
  tamanho: TamanhoBotao = 'md',
  extra = '',
): string {
  return [BASE, TAMANHOS[tamanho], VARIANTES[variante], extra].filter(Boolean).join(' ')
}

/** Separador vertical entre grupos de ação numa barra. */
export const SEPARADOR = 'w-px h-5 bg-gray-200 mx-1 shrink-0'
