// Controle de impressão da etiqueta de envio.
//
// Marcar como impresso é o que leva o pedido para "Aguardando postagem" na
// esteira (ver esteira.ts) e responde "o que já foi impresso hoje?". Fica
// na linha do tempo do pedido quem marcou e quando.
//
// Reimpressão NÃO muda a data: quem quer saber "quando saiu a etiqueta"
// quer a primeira vez. Por isso só grava em pedido que ainda não estava
// marcado.

export async function registrarImpressao(sb: any, params: {
  empresaId: string
  ids: string[]
  impresso: boolean
  usuarioId?: string | null
  usuarioNome?: string | null
  origem: string // ex.: "Marcado na esteira", "Etiqueta baixada (Shopee)"
}): Promise<{ alterados: string[] }> {
  const { empresaId, ids, impresso, usuarioId, usuarioNome, origem } = params
  if (ids.length === 0) return { alterados: [] }

  // Só os que mudam de fato — e o filtro de empresa impede mexer em pedido
  // de outra conta passando um id na mão.
  let consulta = sb.from('marketplace_pedidos').select('id')
    .in('id', ids).eq('empresa_id', empresaId)
  consulta = impresso ? consulta.is('etiqueta_impressa_em', null) : consulta.not('etiqueta_impressa_em', 'is', null)
  const { data: linhas, error: erroBusca } = await consulta
  if (erroBusca) throw new Error(erroBusca.message)
  const alterados: string[] = (linhas ?? []).map((l: any) => l.id)
  if (alterados.length === 0) return { alterados }

  const agora = new Date().toISOString()
  const { error } = await sb.from('marketplace_pedidos')
    .update(impresso
      ? { etiqueta_impressa_em: agora, etiqueta_impressa_por: usuarioNome ?? null }
      : { etiqueta_impressa_em: null, etiqueta_impressa_por: null })
    .in('id', alterados).eq('empresa_id', empresaId)
  if (error) throw new Error(error.message)

  await sb.from('pedido_eventos').insert(alterados.map(id => ({
    empresa_id: empresaId,
    fonte: 'marketplace', referencia_id: id,
    tipo: 'impressao',
    descricao: impresso ? 'Etiqueta impressa' : 'Impressão desfeita — etiqueta volta para "Imprimir"',
    observacao: origem,
    usuario_id: usuarioId ?? null, usuario_nome: usuarioNome ?? null,
    automatico: false,
  })))

  return { alterados }
}
