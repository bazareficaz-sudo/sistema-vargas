// Leitura pública de um anúncio do Mercado Livre a partir da URL — usa a API
// pública deles (api.mercadolibre.com/items/{id}), que não exige OAuth nem
// token, mesmo para anúncios de lojas que não são a nossa conectada.

export type AnuncioMercadoLivre = {
  titulo: string
  descricao: string
  preco: number
  imagens: string[]
  categoriaNomeExterna: string | null
  marcaSugerida: string | null
  temVariacoes: boolean
}

export function extrairItemId(url: string): string | null {
  const match = url.match(/MLB-?(\d+)/i)
  return match ? `MLB${match[1]}` : null
}

export async function buscarAnuncioPorUrl(url: string): Promise<AnuncioMercadoLivre> {
  const itemId = extrairItemId(url)
  if (!itemId) throw new Error('Não foi possível identificar o anúncio nessa URL. Cole o link completo da página do produto no Mercado Livre.')

  const respItem = await fetch(`https://api.mercadolibre.com/items/${itemId}`)
  if (respItem.status === 404) throw new Error('Anúncio não encontrado ou removido.')
  if (!respItem.ok) throw new Error(`Erro ao consultar o Mercado Livre (${respItem.status})`)
  const item = await respItem.json()

  if (item.status && item.status !== 'active') {
    throw new Error('Este anúncio não está mais ativo no Mercado Livre.')
  }

  const respDesc = await fetch(`https://api.mercadolibre.com/items/${itemId}/description`)
  const descricao = respDesc.ok ? ((await respDesc.json()).plain_text ?? '') : ''

  let categoriaNomeExterna: string | null = null
  if (item.category_id) {
    try {
      const respCat = await fetch(`https://api.mercadolibre.com/categories/${item.category_id}`)
      if (respCat.ok) categoriaNomeExterna = (await respCat.json()).name ?? null
    } catch {
      // apenas uma dica de texto — falha aqui não deve derrubar a importação
    }
  }

  const marcaSugerida = (item.attributes ?? []).find((a: any) => a.id === 'BRAND')?.value_name ?? null
  const imagens: string[] = (item.pictures ?? []).map((p: any) => p.secure_url ?? p.url).filter(Boolean)

  return {
    titulo: item.title ?? '',
    descricao,
    preco: typeof item.price === 'number' ? item.price : 0,
    imagens,
    categoriaNomeExterna,
    marcaSugerida,
    temVariacoes: Array.isArray(item.variations) && item.variations.length > 0,
  }
}
