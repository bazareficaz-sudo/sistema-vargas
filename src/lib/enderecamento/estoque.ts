// Motor central do módulo de Endereçamento de Estoque — mantém
// produto_enderecos (produto × depósito × endereço × quantidade) como um
// SUBCONJUNTO validado de produto_estoque (o saldo por depósito, que
// continua autoritativo). Nunca soma exatamente — "estoque não endereçado"
// é um estado permitido durante a adoção gradual — mas nunca deixa a soma
// endereçada ultrapassar o saldo real do depósito.
//
// Segue o mesmo estilo do motor de Transferência de Estoque
// (src/lib/estoque/transferencia.ts): NÃO É TRANSACIONAL, grava o
// documento/histórico antes de mexer em saldo, cada operação valida antes
// de escrever. Nunca escreve em produto_estoque nem em produtos.estoque —
// isso é deliberado: uma movimentação entre endereços do mesmo depósito
// nunca muda o total do depósito, só redistribui.

export type NiveisHierarquia = Partial<{
  zona: string; corredor: string; estante: string; modulo: string; nivel: string; posicao: string
}>

const ORDEM_NIVEIS = ['zona', 'corredor', 'estante', 'modulo', 'nivel', 'posicao'] as const

/** Monta "A-01-03" a partir dos níveis configurados no depósito, na ordem certa, com padding opcional. */
export function montarCodigoEndereco(
  niveisAtivos: string[], valores: NiveisHierarquia, separador: string, paddingPorNivel: Record<string, number>,
): string {
  return ORDEM_NIVEIS
    .filter(n => niveisAtivos.includes(n))
    .map(n => {
      const v = valores[n]
      if (!v) return ''
      const pad = paddingPorNivel[n]
      return pad ? String(v).padStart(pad, '0') : String(v)
    })
    .filter(Boolean)
    .join(separador)
}

async function saldoDeposito(sb: any, depositoId: string, produtoId: string): Promise<number> {
  const { data } = await sb.from('produto_estoque')
    .select('quantidade').eq('deposito_id', depositoId).eq('produto_id', produtoId).maybeSingle()
  return Number(data?.quantidade ?? 0)
}

/** Soma quanto do saldo do depósito já está endereçado (em qualquer endereço). */
export async function saldoEnderecado(sb: any, depositoId: string, produtoId: string): Promise<number> {
  const { data } = await sb.from('produto_enderecos')
    .select('quantidade').eq('deposito_id', depositoId).eq('produto_id', produtoId)
  return (data ?? []).reduce((s: number, r: any) => s + Number(r.quantidade ?? 0), 0)
}

/** Quanto do saldo do depósito ainda não tem endereço nenhum. */
export async function saldoNaoEnderecado(sb: any, depositoId: string, produtoId: string): Promise<number> {
  const [total, enderecado] = [await saldoDeposito(sb, depositoId, produtoId), await saldoEnderecado(sb, depositoId, produtoId)]
  return Math.max(0, total - enderecado)
}

const STATUS_NAO_RECEBE = ['inativo', 'bloqueado', 'temp_bloqueado', 'em_inventario', 'cheio']

export type ResultadoOperacaoEndereco = {
  ok: boolean
  erro?: string
  quantidadeAnteriorOrigem?: number
  quantidadeNovaOrigem?: number
  quantidadeAnteriorDestino?: number
  quantidadeNovaDestino?: number
}

/**
 * Ajuste/contagem manual de quantidade num único endereço — a única
 * operação que pode AUMENTAR a soma endereçada de um produto no depósito.
 * Por isso é a única que precisa validar contra o saldo do depósito antes
 * de gravar; transferência entre endereços nunca precisa (o total não muda).
 */
export async function ajustarQuantidadeEndereco(sb: any, params: {
  empresaId: string; depositoId: string; enderecoId: string; produtoId: string; produtoNome?: string | null
  novaQuantidade: number; usuario: string | null; motivo?: string | null
  referenciaTipo?: string | null; referenciaId?: string | null
}): Promise<ResultadoOperacaoEndereco> {
  const { empresaId, depositoId, enderecoId, produtoId, novaQuantidade, usuario } = params
  if (novaQuantidade < 0) return { ok: false, erro: 'Quantidade não pode ser negativa.' }

  const { data: endereco } = await sb.from('enderecos')
    .select('id, status, exclusivo, produto_exclusivo_id').eq('id', enderecoId).eq('deposito_id', depositoId).maybeSingle()
  if (!endereco) return { ok: false, erro: 'Endereço não encontrado neste depósito.' }
  if (novaQuantidade > 0 && STATUS_NAO_RECEBE.includes(endereco.status)) {
    return { ok: false, erro: `Endereço está ${endereco.status.replace('_', ' ')} — não pode receber estoque.` }
  }
  if (endereco.exclusivo && endereco.produto_exclusivo_id && endereco.produto_exclusivo_id !== produtoId) {
    return { ok: false, erro: 'Endereço exclusivo já ocupado por outro produto.' }
  }

  const { data: linhaAtual } = await sb.from('produto_enderecos')
    .select('id, quantidade').eq('endereco_id', enderecoId).eq('produto_id', produtoId).maybeSingle()
  const quantidadeAnterior = Number(linhaAtual?.quantidade ?? 0)

  // A soma endereçada TOTAL (todos os endereços deste produto no depósito),
  // trocando só a parte deste endereço, não pode superar o saldo do
  // depósito — senão o operador estaria "endereçando" estoque que não existe.
  const somaAtual = await saldoEnderecado(sb, depositoId, produtoId)
  const somaNova = somaAtual - quantidadeAnterior + novaQuantidade
  const totalDeposito = await saldoDeposito(sb, depositoId, produtoId)
  if (somaNova > totalDeposito) {
    return {
      ok: false,
      erro: `Isso deixaria ${somaNova} unidades endereçadas, mas o depósito só tem ${totalDeposito}.`,
    }
  }

  if (linhaAtual) {
    await sb.from('produto_enderecos').update({
      quantidade: novaQuantidade, ultima_movimentacao: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', linhaAtual.id)
  } else if (novaQuantidade > 0) {
    await sb.from('produto_enderecos').insert({
      empresa_id: empresaId, deposito_id: depositoId, endereco_id: enderecoId, produto_id: produtoId,
      quantidade: novaQuantidade,
    })
  }

  if (endereco.exclusivo && !endereco.produto_exclusivo_id && novaQuantidade > 0) {
    await sb.from('enderecos').update({ produto_exclusivo_id: produtoId }).eq('id', enderecoId)
  } else if (endereco.exclusivo && endereco.produto_exclusivo_id === produtoId && novaQuantidade === 0) {
    // Esvaziou o endereço exclusivo — libera pra outro produto poder ocupar.
    await sb.from('enderecos').update({ produto_exclusivo_id: null }).eq('id', enderecoId)
  }

  await sb.from('endereco_movimentacoes').insert({
    empresa_id: empresaId, deposito_id: depositoId,
    endereco_destino_id: enderecoId, produto_id: produtoId, produto_nome: params.produtoNome ?? null,
    tipo: 'contagem', quantidade: Math.abs(novaQuantidade - quantidadeAnterior),
    quantidade_anterior_destino: quantidadeAnterior, quantidade_nova_destino: novaQuantidade,
    motivo: params.motivo ?? 'Ajuste manual', referencia_tipo: params.referenciaTipo ?? null, referencia_id: params.referenciaId ?? null,
    usuario,
  })

  return { ok: true, quantidadeAnteriorDestino: quantidadeAnterior, quantidadeNovaDestino: novaQuantidade }
}

/**
 * Transferir Endereço — move quantidade de um endereço pra outro, sempre
 * dentro do MESMO depósito. Nunca toca produto_estoque nem produtos.estoque
 * (o total do depósito é o mesmo antes e depois).
 */
export async function moverEntreEnderecos(sb: any, params: {
  empresaId: string; depositoId: string
  enderecoOrigemId: string; enderecoDestinoId: string
  produtoId: string; produtoNome?: string | null; quantidade: number
  usuario: string | null; motivo?: string | null; observacao?: string | null
}): Promise<ResultadoOperacaoEndereco> {
  const { empresaId, depositoId, enderecoOrigemId, enderecoDestinoId, produtoId, quantidade, usuario } = params
  if (enderecoOrigemId === enderecoDestinoId) return { ok: false, erro: 'Origem e destino não podem ser o mesmo endereço.' }
  if (!(quantidade > 0)) return { ok: false, erro: 'Quantidade inválida.' }

  const [{ data: origem }, { data: destino }] = await Promise.all([
    sb.from('enderecos').select('id, status').eq('id', enderecoOrigemId).eq('deposito_id', depositoId).maybeSingle(),
    sb.from('enderecos').select('id, status, exclusivo, produto_exclusivo_id').eq('id', enderecoDestinoId).eq('deposito_id', depositoId).maybeSingle(),
  ])
  if (!origem) return { ok: false, erro: 'Endereço de origem não encontrado neste depósito.' }
  if (!destino) return { ok: false, erro: 'Endereço de destino não encontrado neste depósito.' }
  if (origem.status === 'em_inventario') return { ok: false, erro: 'Endereço de origem está em contagem — aguarde a finalização.' }
  if (STATUS_NAO_RECEBE.includes(destino.status)) {
    return { ok: false, erro: `Endereço de destino está ${destino.status.replace('_', ' ')} — não pode receber estoque.` }
  }
  if (destino.exclusivo && destino.produto_exclusivo_id && destino.produto_exclusivo_id !== produtoId) {
    return { ok: false, erro: 'Endereço de destino é exclusivo de outro produto.' }
  }

  const { data: linhaOrigem } = await sb.from('produto_enderecos')
    .select('id, quantidade').eq('endereco_id', enderecoOrigemId).eq('produto_id', produtoId).maybeSingle()
  const quantidadeOrigemAtual = Number(linhaOrigem?.quantidade ?? 0)
  if (quantidade > quantidadeOrigemAtual) {
    return { ok: false, erro: `Só há ${quantidadeOrigemAtual} unidade(s) neste endereço.` }
  }

  const { data: linhaDestino } = await sb.from('produto_enderecos')
    .select('id, quantidade').eq('endereco_id', enderecoDestinoId).eq('produto_id', produtoId).maybeSingle()
  const quantidadeDestinoAtual = Number(linhaDestino?.quantidade ?? 0)

  const novaOrigem = quantidadeOrigemAtual - quantidade
  const novaDestino = quantidadeDestinoAtual + quantidade
  const agora = new Date().toISOString()

  await sb.from('produto_enderecos').update({ quantidade: novaOrigem, ultima_movimentacao: agora, updated_at: agora }).eq('id', linhaOrigem.id)

  if (linhaDestino) {
    await sb.from('produto_enderecos').update({ quantidade: novaDestino, ultima_movimentacao: agora, updated_at: agora }).eq('id', linhaDestino.id)
  } else {
    await sb.from('produto_enderecos').insert({
      empresa_id: empresaId, deposito_id: depositoId, endereco_id: enderecoDestinoId, produto_id: produtoId, quantidade: novaDestino,
    })
  }

  if (destino.exclusivo && !destino.produto_exclusivo_id) {
    await sb.from('enderecos').update({ produto_exclusivo_id: produtoId }).eq('id', enderecoDestinoId)
  }

  await sb.from('endereco_movimentacoes').insert({
    empresa_id: empresaId, deposito_id: depositoId,
    endereco_origem_id: enderecoOrigemId, endereco_destino_id: enderecoDestinoId,
    produto_id: produtoId, produto_nome: params.produtoNome ?? null,
    tipo: 'transferencia', quantidade,
    quantidade_anterior_origem: quantidadeOrigemAtual, quantidade_nova_origem: novaOrigem,
    quantidade_anterior_destino: quantidadeDestinoAtual, quantidade_nova_destino: novaDestino,
    motivo: params.motivo ?? 'Transferência entre endereços', observacao: params.observacao ?? null,
    usuario,
  })

  return {
    ok: true,
    quantidadeAnteriorOrigem: quantidadeOrigemAtual, quantidadeNovaOrigem: novaOrigem,
    quantidadeAnteriorDestino: quantidadeDestinoAtual, quantidadeNovaDestino: novaDestino,
  }
}
