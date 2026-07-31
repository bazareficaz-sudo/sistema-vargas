// Cópia de imagens entre produtos.
//
// Copia o ARQUIVO no Storage, não só a referência. Se apontasse os dois
// produtos para a mesma URL, apagar ou trocar a foto de um deles deixaria o
// outro sem imagem — e ninguém entenderia o motivo.
//
// Usado ao duplicar produto e ao criar kit a partir de um produto.

export type ResultadoCopiaImagens = { copiadas: number; erro?: string }

export async function copiarImagensDeProduto(
  sb: any,
  params: { empresaId: string; origemId: string; destinoId: string },
): Promise<ResultadoCopiaImagens> {
  const { data: imagens } = await sb
    .from('produto_imagens')
    .select('url, ordem, principal')
    .eq('produto_id', params.origemId)
    .order('ordem', { ascending: true })

  if (!imagens || imagens.length === 0) return { copiadas: 0 }

  const novasLinhas: { empresa_id: string; produto_id: string; url: string; ordem: number; principal: boolean }[] = []

  for (const img of imagens as { url: string; ordem: number; principal: boolean }[]) {
    let novaUrl = img.url
    // Imagem vinda de URL externa (importada de anúncio, por exemplo) não
    // está no nosso Storage — nesse caso só a referência é reaproveitada.
    const path = img.url.split('/produto-imagens/')[1]
    if (path) {
      const ext = path.split('.').pop() || 'jpg'
      const novoPath = `${params.empresaId}/${params.destinoId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await sb.storage.from('produto-imagens').copy(path, novoPath)
      if (!error) {
        const { data } = sb.storage.from('produto-imagens').getPublicUrl(novoPath)
        novaUrl = data.publicUrl
      }
      // Falha na cópia do arquivo cai no fallback da URL original: melhor um
      // produto compartilhando a foto do que um produto sem foto.
    }
    novasLinhas.push({
      empresa_id: params.empresaId, produto_id: params.destinoId,
      url: novaUrl, ordem: img.ordem, principal: img.principal,
    })
  }

  const { error } = await sb.from('produto_imagens').insert(novasLinhas)
  if (error) return { copiadas: 0, erro: error.message }

  // `produtos.foto_url` é o atalho usado pela listagem e pelo PDV. Sem ele, o
  // produto aparece com a miniatura genérica mesmo tendo imagem cadastrada.
  const principal = novasLinhas.find(l => l.principal) ?? novasLinhas[0]
  if (principal) {
    await sb.from('produtos').update({ foto_url: principal.url }).eq('id', params.destinoId)
  }

  return { copiadas: novasLinhas.length }
}

export async function contarImagens(sb: any, produtoId: string): Promise<number> {
  const { count } = await sb.from('produto_imagens')
    .select('id', { count: 'exact', head: true }).eq('produto_id', produtoId)
  return count ?? 0
}
