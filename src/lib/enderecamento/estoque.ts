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

/**
 * Monta o código do endereço a partir dos níveis configurados no depósito.
 *
 * O prefixo por nível existe porque um código só de números não diz nada a
 * quem está separando: "E-01-1-02" não conta que aquilo é uma gaveta. Com
 * prefixo, o mesmo endereço vira "E-01-EST1-GAV02" e a expedição entende o
 * que procurar sem consultar o sistema.
 *
 * O prefixo é colado no valor exatamente como foi digitado — quem quiser
 * "GAV-02" põe "GAV-" no prefixo, quem quiser "GAV02" põe "GAV". Fica a
 * critério de quem conhece o galpão, em vez de o sistema impor um formato.
 */
export function montarCodigoEndereco(
  niveisAtivos: string[],
  valores: NiveisHierarquia,
  separador: string,
  paddingPorNivel: Record<string, number>,
  prefixosPorNivel: Record<string, string> = {},
): string {
  return ORDEM_NIVEIS
    .filter(n => niveisAtivos.includes(n))
    .map(n => {
      const v = valores[n]
      if (!v) return ''
      const pad = paddingPorNivel[n]
      const valor = pad ? String(v).padStart(pad, '0') : String(v)
      return `${prefixosPorNivel[n] ?? ''}${valor}`
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

type ParamsEscritaEndereco = {
  empresaId: string; depositoId: string; enderecoId: string; produtoId: string; produtoNome?: string | null
  usuario: string | null; motivo?: string | null
  referenciaTipo?: string | null; referenciaId?: string | null
}

/**
 * Núcleo compartilhado de escrita — valida (status do endereço, exclusivo,
 * teto do saldo do depósito), grava `produto_enderecos` e loga em
 * `endereco_movimentacoes`. `quantidadeAnterior` e `linhaAtualId` são do
 * chamador porque CADA caminho (contagem absoluta vs. soma de recebido) lê
 * o valor anterior à sua própria maneira — este núcleo só escreve o que já
 * foi decidido, nunca decide sozinho quanto somar ou sobrescrever.
 */
async function _escreverQuantidadeEndereco(
  sb: any, params: ParamsEscritaEndereco, endereco: any,
  quantidadeAnterior: number, linhaAtualId: string | undefined, novaQuantidade: number,
): Promise<ResultadoOperacaoEndereco> {
  const { empresaId, depositoId, enderecoId, produtoId, usuario } = params

  if (novaQuantidade > 0 && STATUS_NAO_RECEBE.includes(endereco.status)) {
    return { ok: false, erro: `Endereço está ${endereco.status.replace('_', ' ')} — não pode receber estoque.` }
  }
  if (endereco.exclusivo && endereco.produto_exclusivo_id && endereco.produto_exclusivo_id !== produtoId) {
    return { ok: false, erro: 'Endereço exclusivo já ocupado por outro produto.' }
  }

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

  if (linhaAtualId) {
    await sb.from('produto_enderecos').update({
      quantidade: novaQuantidade, ultima_movimentacao: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', linhaAtualId)
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

async function _buscarEnderecoOuFalhar(sb: any, enderecoId: string, depositoId: string) {
  const { data: endereco } = await sb.from('enderecos')
    .select('id, status, exclusivo, produto_exclusivo_id').eq('id', enderecoId).eq('deposito_id', depositoId).maybeSingle()
  return endereco
}

/**
 * Ajuste/contagem manual de quantidade num único endereço — declara o total
 * exato que deve ficar ali (uma contagem física, não uma soma). É a única
 * operação que pode AUMENTAR a soma endereçada de um produto no depósito
 * "do nada" (por isso valida contra o saldo do depósito); transferência
 * entre endereços nunca precisa (o total não muda).
 */
export async function ajustarQuantidadeEndereco(sb: any, params: ParamsEscritaEndereco & {
  novaQuantidade: number
}): Promise<ResultadoOperacaoEndereco> {
  const { depositoId, enderecoId, produtoId, novaQuantidade } = params
  if (novaQuantidade < 0) return { ok: false, erro: 'Quantidade não pode ser negativa.' }

  const endereco = await _buscarEnderecoOuFalhar(sb, enderecoId, depositoId)
  if (!endereco) return { ok: false, erro: 'Endereço não encontrado neste depósito.' }

  const { data: linhaAtual } = await sb.from('produto_enderecos')
    .select('id, quantidade').eq('endereco_id', enderecoId).eq('produto_id', produtoId).maybeSingle()
  const quantidadeAnterior = Number(linhaAtual?.quantidade ?? 0)

  return _escreverQuantidadeEndereco(sb, params, endereco, quantidadeAnterior, linhaAtual?.id, novaQuantidade)
}

/**
 * Soma uma quantidade RECEBIDA ao que o endereço tiver no momento da
 * chamada — para "guardar a entrada num endereço já conhecido" (ver
 * ConfirmarEnderecoEntradaModal). Nunca recebe de fora um total já
 * calculado: lê `produto_enderecos` fresco aqui dentro e só então soma,
 * porque entre a entrada e a confirmação pode ter havido venda ou outro
 * movimento naquele endereço — usar um valor calculado antes sobrescreveria
 * isso. `ajustarQuantidadeEndereco` continua sendo o caminho certo para
 * quando o operador está DECLARANDO o total (contagem), não somando.
 */
export async function adicionarQuantidadeEndereco(sb: any, params: ParamsEscritaEndereco & {
  quantidadeRecebida: number
}): Promise<ResultadoOperacaoEndereco> {
  const { depositoId, enderecoId, produtoId, quantidadeRecebida } = params
  if (!(quantidadeRecebida > 0)) return { ok: false, erro: 'Quantidade recebida deve ser maior que zero.' }

  const endereco = await _buscarEnderecoOuFalhar(sb, enderecoId, depositoId)
  if (!endereco) return { ok: false, erro: 'Endereço não encontrado neste depósito.' }

  const { data: linhaAtual } = await sb.from('produto_enderecos')
    .select('id, quantidade').eq('endereco_id', enderecoId).eq('produto_id', produtoId).maybeSingle()
  const quantidadeAnterior = Number(linhaAtual?.quantidade ?? 0)
  const novaQuantidade = quantidadeAnterior + quantidadeRecebida

  return _escreverQuantidadeEndereco(
    sb, { ...params, motivo: params.motivo ?? 'Guardado após entrada de mercadoria' },
    endereco, quantidadeAnterior, linhaAtual?.id, novaQuantidade,
  )
}

export type SugestaoEndereco = { id: string; codigoLegivel: string; quantidadeAtual: number }

/**
 * Sugere, para cada produto, o endereço a usar num "guardar recebido" — só
 * quando existe exatamente UM endereço com saldo > 0 pra aquele produto
 * naquele depósito. Mais de um endereço distinto (split real entre locais)
 * ou nenhum (produto ainda não endereçado ali) não tem sugestão segura:
 * `null` empurra a UI pra escolha manual. Usado tanto pelo painel pós-entrada
 * quanto pela tela "Produtos sem Endereço", pra nunca duplicar essa consulta.
 */
export async function buscarSugestoesEndereco(
  sb: any, depositoId: string, produtoIds: string[],
): Promise<Map<string, SugestaoEndereco | null>> {
  const resultado = new Map<string, SugestaoEndereco | null>()
  if (produtoIds.length === 0) return resultado

  const { data: linhas } = await sb.from('produto_enderecos')
    .select('produto_id, quantidade, enderecos(id, codigo_legivel)')
    .eq('deposito_id', depositoId).in('produto_id', produtoIds).gt('quantidade', 0)

  const porProduto = new Map<string, any[]>()
  for (const l of linhas ?? []) {
    const lista = porProduto.get(l.produto_id) ?? []
    lista.push(l)
    porProduto.set(l.produto_id, lista)
  }

  for (const produtoId of produtoIds) {
    const lista = porProduto.get(produtoId) ?? []
    const distintos = new Set(lista.map(l => l.enderecos?.id).filter(Boolean))
    if (distintos.size === 1) {
      const l = lista[0]
      resultado.set(produtoId, { id: l.enderecos.id, codigoLegivel: l.enderecos.codigo_legivel, quantidadeAtual: Number(l.quantidade ?? 0) })
    } else {
      resultado.set(produtoId, null)
    }
  }

  return resultado
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
