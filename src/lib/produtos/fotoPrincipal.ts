// Mantém `produtos.foto_url` igual à imagem principal da galeria.
//
// `foto_url` é o atalho que a listagem do ERP, o PDV e a vitrine leem. A galeria
// (`produto_imagens`) é onde o operador de fato edita — e as telas de edição
// gravavam SÓ nela. Resultado, medido em 23/10/2026: em 126 dos 646 produtos
// publicados a loja mostrava a foto ANTIGA do cadastro em vez da atual, e em
// 23 deles a antiga já era um link morto (a loja ficava sem imagem). O caso que
// chegou como reclamação: excluir a foto, inserir outra, clicar em atualizar —
// e a vitrine continuava com a primeira.
//
// Em vez de cada tela calcular "qual é a principal agora", esta função LÊ a
// galeria depois da gravação e copia o resultado. Ler depois evita o erro de
// ordem (remover a principal, promover a próxima, esquecer um dos dois passos).
//
// Melhor esforço: se a gravação em `produtos` falhar (permissão, rede), a foto
// da galeria continua salva, e a vitrine também lê a galeria quando o atalho
// está vazio ou desatualizado (ver supabase-loja-imagem-galeria-primeiro.sql).

export async function sincronizarFotoPrincipal(sb: any, produtoId: string): Promise<void> {
  const { data, error } = await sb
    .from('produto_imagens')
    .select('url')
    .eq('produto_id', produtoId)
    .order('principal', { ascending: false })
    .order('ordem', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) {
    console.error('[produtos] não leu a galeria para sincronizar a foto', { produtoId, erro: error.message })
    return
  }

  const url = (data?.[0]?.url as string | undefined)?.trim() || null
  const { error: erroUpdate } = await sb.from('produtos').update({ foto_url: url }).eq('id', produtoId)
  if (erroUpdate) {
    console.error('[produtos] foto principal não sincronizou', { produtoId, erro: erroUpdate.message })
  }
}

export async function sincronizarFotosPrincipais(sb: any, produtoIds: string[]): Promise<void> {
  // Sequencial de propósito: é a ação em massa de um operador, dezenas de
  // produtos, e paralelizar só empilharia requisições no mesmo banco.
  for (const id of produtoIds) await sincronizarFotoPrincipal(sb, id)
}
