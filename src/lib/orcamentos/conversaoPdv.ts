// O que o PDV web diz ao vendedor quando a conversão do orçamento não passa
// (estados devolvidos pela RPC `converter_orcamento_pdv`).

export type EstadoConversao =
  | 'convertido' | 'ja_convertido' | 'conflito_conversao'
  | 'conflito_versao' | 'recusado_cancelado' | 'nao_encontrado'

/** A venda pode seguir: o orçamento agora pertence a esta venda. */
export function conversaoAceita(estado: string | undefined): boolean {
  return estado === 'convertido' || estado === 'ja_convertido'
}

export function mensagemConversao(estado: string | undefined, numero?: number | null): string {
  const orc = numero ? `O orçamento #${numero}` : 'O orçamento'
  switch (estado) {
    case 'conflito_conversao':
      return `${orc} já foi convertido em outra venda. Esta venda não foi gravada — confira em Pedidos (F10) antes de vender de novo.`
    case 'conflito_versao':
      return `${orc} foi alterado depois de ser carregado no PDV. Carregue-o de novo (F1) para vender a versão atual.`
    case 'recusado_cancelado':
      return `${orc} está cancelado e não pode virar venda.`
    case 'nao_encontrado':
      return `${orc} não foi encontrado nesta empresa.`
    default:
      return `Não foi possível vincular ${orc.toLowerCase()} a esta venda. Tente concluir de novo.`
  }
}

/** Status de orçamento que ainda pode ser carregado para venda. */
export function podeCarregarNoPdv(status: string): boolean {
  return status === 'aberto' || status === 'aprovado'
}
