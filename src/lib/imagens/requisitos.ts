// Requisitos de imagem dos marketplaces.
//
// Por que isso é crítico: anúncio com imagem abaixo do mínimo não é ativado,
// e o erro chega depois — quando a publicação já falhou ou o anúncio ficou
// invisível. Melhor ver o problema antes de publicar.
//
// Os valores publicados variam entre as fontes (a Shopee já documentou 500px
// como mínimo e 1024px como recomendado; o Mercado Livre trabalha com 500px
// mínimo e 1200px para o zoom funcionar). Adotei o mínimo conservador que
// atende os dois e um alvo de ajuste que garante zoom em ambos. Se algum
// marketplace mudar a exigência, é aqui que se altera.

export type Requisito = {
  plataforma: string
  minimo: number       // abaixo disso o anúncio corre risco real de não ativar
  recomendado: number  // abaixo disso funciona, mas perde qualidade/zoom
  alvoAjuste: number   // para onde o botão de ajustar leva a imagem
  quadradaPreferida: boolean
}

export const REQUISITOS: Record<string, Requisito> = {
  shopee: { plataforma: 'Shopee', minimo: 500, recomendado: 1024, alvoAjuste: 1024, quadradaPreferida: true },
  mercadolivre: { plataforma: 'Mercado Livre', minimo: 500, recomendado: 1200, alvoAjuste: 1200, quadradaPreferida: true },
}

export function requisitoDe(plataforma: string): Requisito {
  return REQUISITOS[plataforma] ?? REQUISITOS.shopee
}

export type Avaliacao = {
  nivel: 'ok' | 'aviso' | 'erro'
  mensagem: string
  precisaAjuste: boolean
}

export function avaliarDimensoes(
  largura: number, altura: number, plataforma: string,
): Avaliacao {
  const r = requisitoDe(plataforma)
  const menor = Math.min(largura, altura)

  if (menor < r.minimo) {
    return {
      nivel: 'erro',
      mensagem: `Abaixo do mínimo da ${r.plataforma} (${r.minimo}×${r.minimo}). O anúncio pode não ser ativado.`,
      precisaAjuste: true,
    }
  }
  if (menor < r.recomendado) {
    return {
      nivel: 'aviso',
      mensagem: `Funciona, mas abaixo do recomendado (${r.recomendado}×${r.recomendado}) — o zoom da ${r.plataforma} fica limitado.`,
      precisaAjuste: true,
    }
  }
  if (r.quadradaPreferida && largura !== altura) {
    return {
      nivel: 'aviso',
      mensagem: 'Não é quadrada. A vitrine corta as laterais — ajustar deixa o produto inteiro à mostra.',
      precisaAjuste: true,
    }
  }
  return { nivel: 'ok', mensagem: 'Dentro do recomendado.', precisaAjuste: false }
}

// Lê as dimensões no próprio navegador, sem servidor e sem CORS: carregar
// uma imagem para medir não exige permissão de leitura de pixel.
export function lerDimensoes(url: string): Promise<{ largura: number; altura: number } | null> {
  return new Promise(resolve => {
    if (typeof window === 'undefined') return resolve(null)
    const img = new window.Image()
    img.onload = () => resolve({ largura: img.naturalWidth, altura: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
}
