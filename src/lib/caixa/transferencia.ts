// Regras puras da transferência entre caixas (Fase 2 — sangria e suprimento).
//
// Sem rede e sem banco, pelo mesmo motivo de `movimento.ts`: é a parte que
// decide para onde o dinheiro vai, e isso precisa ser conferível sozinho.
//
// A AUTORIDADE É A RPC, NÃO ESTE ARQUIVO. `transferir_caixa_v1` revalida
// tudo o que está aqui — espécie, valor, tipos de caixa, empresa — porque é
// ela que roda numa transação e é ela que o banco protege. Isto aqui existe
// para recusar cedo, com mensagem legível, e para descrever a direção
// econômica num lugar que a tela também possa usar.

export type EspecieTransferencia = 'sangria' | 'suprimento'

export type TipoCaixa = 'pdv' | 'tesouraria' | 'banco'

export type NaturezaTransferencia =
  | 'sangria' | 'sangria_recebida'
  | 'suprimento' | 'suprimento_entregue'

/**
 * A direção econômica de cada espécie — a mesma tabela que a RPC aplica.
 *
 * Sangria sai do PDV e entra na tesouraria; suprimento faz o contrário.
 * Banco ↔ tesouraria não entra nesta fase: nenhum caixa `banco` existe, e
 * criar a combinação antes do caso de uso é construir à frente da
 * necessidade.
 */
export const DIRECAO: Record<EspecieTransferencia, {
  tipoOrigem: TipoCaixa
  tipoDestino: TipoCaixa
  naturezaSaida: NaturezaTransferencia
  naturezaEntrada: NaturezaTransferencia
}> = {
  sangria: {
    tipoOrigem: 'pdv', tipoDestino: 'tesouraria',
    naturezaSaida: 'sangria', naturezaEntrada: 'sangria_recebida',
  },
  suprimento: {
    tipoOrigem: 'tesouraria', tipoDestino: 'pdv',
    naturezaSaida: 'suprimento_entregue', naturezaEntrada: 'suprimento',
  },
}

/** Como cada natureza aparece no extrato, do ponto de vista do caixa que a tem. */
export const ROTULO_NATUREZA: Record<string, string> = {
  aporte: 'Aporte',
  retirada_socio: 'Retirada de sócio',
  deposito_banco: 'Depósito no banco',
  ajuste: 'Ajuste de contagem',
  sangria: 'Sangria enviada',
  sangria_recebida: 'Sangria recebida',
  suprimento_entregue: 'Suprimento enviado',
  suprimento: 'Suprimento recebido',
}

/** Nomeia a contraparte no extrato: quem recebeu, ou de quem veio. */
export function rotuloContraparte(natureza: string): 'Destino' | 'Origem' | null {
  if (natureza === 'sangria' || natureza === 'suprimento_entregue') return 'Destino'
  if (natureza === 'sangria_recebida' || natureza === 'suprimento') return 'Origem'
  return null
}

export function ehNaturezaDeTransferencia(natureza: string): boolean {
  return natureza in DIRECAO || natureza === 'sangria_recebida' || natureza === 'suprimento_entregue'
}

export type CaixaParaTransferencia = {
  id: string
  tipo: TipoCaixa
  empresa_id: string
  ativo?: boolean
}

export type NovaTransferenciaInput = {
  id?: unknown
  especie?: unknown
  caixa_origem_id?: unknown
  caixa_destino_id?: unknown
  valor?: unknown
  observacao?: unknown
}

export type NovaTransferenciaValida = {
  id: string
  especie: EspecieTransferencia
  caixa_origem_id: string
  caixa_destino_id: string
  valor: number
  observacao: string | null
}

export type ResultadoValidacao =
  | { ok: true; transferencia: NovaTransferenciaValida }
  | { ok: false; erro: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function centavos(v: number) {
  return Math.round(v * 100) / 100
}

/**
 * O contrato do que pode virar uma transferência.
 *
 * `id` é obrigatório e vem do CLIENTE: é a chave de idempotência, gerada ao
 * abrir o diálogo. Gerar um aqui quando falta seria transformar cada retry
 * numa transferência nova — exatamente o que a idempotência existe para
 * impedir. Por isso falta de id é recusa.
 */
export function validarNovaTransferencia(input: NovaTransferenciaInput): ResultadoValidacao {
  const id = typeof input.id === 'string' ? input.id : ''
  if (!UUID.test(id)) {
    return { ok: false, erro: 'Identificador da transferência ausente ou inválido.' }
  }

  const especie = input.especie
  if (especie !== 'sangria' && especie !== 'suprimento') {
    return { ok: false, erro: 'Espécie deve ser sangria ou suprimento.' }
  }

  const origem = typeof input.caixa_origem_id === 'string' ? input.caixa_origem_id : ''
  const destino = typeof input.caixa_destino_id === 'string' ? input.caixa_destino_id : ''
  if (!UUID.test(origem) || !UUID.test(destino)) {
    return { ok: false, erro: 'Caixa de origem e destino são obrigatórios.' }
  }
  if (origem === destino) {
    return { ok: false, erro: 'Origem e destino não podem ser o mesmo caixa.' }
  }

  const valor = Number(input.valor)
  if (!Number.isFinite(valor) || valor <= 0) {
    return { ok: false, erro: 'Valor deve ser maior que zero.' }
  }

  let observacao: string | null = null
  if (input.observacao != null && String(input.observacao).trim() !== '') {
    observacao = String(input.observacao).trim().slice(0, 500)
  }

  return {
    ok: true,
    transferencia: {
      id, especie, caixa_origem_id: origem, caixa_destino_id: destino,
      valor: centavos(valor), observacao,
    },
  }
}

export type ResultadoCombinacao = { ok: true } | { ok: false; erro: string }

/**
 * Origem e destino combinam com a espécie, são da mesma empresa, e essa
 * empresa é a do contexto validado.
 *
 * A checagem de empresa não pode depender da RLS: `empresa_do_meu_grupo()` é
 * por GRUPO, então um usuário com vínculo em duas empresas passaria por ela
 * movendo dinheiro de um CNPJ para outro. A RPC faz a mesma checagem com os
 * caixas relidos do banco — esta é a versão que responde cedo e testável.
 */
export function validarCombinacao(
  especie: EspecieTransferencia,
  origem: CaixaParaTransferencia | null | undefined,
  destino: CaixaParaTransferencia | null | undefined,
  empresaAtiva: string,
): ResultadoCombinacao {
  if (!origem) return { ok: false, erro: 'Caixa de origem não encontrado.' }
  if (!destino) return { ok: false, erro: 'Caixa de destino não encontrado.' }

  if (origem.empresa_id !== empresaAtiva || destino.empresa_id !== empresaAtiva) {
    return { ok: false, erro: 'A transferência precisa ficar dentro da empresa ativa.' }
  }
  if (origem.ativo === false || destino.ativo === false) {
    return { ok: false, erro: 'Caixa inativo não movimenta dinheiro.' }
  }

  const d = DIRECAO[especie]
  if (origem.tipo !== d.tipoOrigem || destino.tipo !== d.tipoDestino) {
    return {
      ok: false,
      erro: especie === 'sangria'
        ? 'Sangria vai de um caixa de PDV para a tesouraria.'
        : 'Suprimento vai da tesouraria para um caixa de PDV.',
    }
  }
  return { ok: true }
}

/**
 * Os dois movimentos que a transferência produz — a mesma derivação que a
 * RPC faz, exposta para teste e para a tela poder explicar a operação antes
 * de confirmar.
 */
export function efeitosDaTransferencia(t: NovaTransferenciaValida) {
  const d = DIRECAO[t.especie]
  return [
    { caixa_id: t.caixa_origem_id, tipo: 'saida' as const, natureza: d.naturezaSaida,
      valor: t.valor, contraparte_caixa_id: t.caixa_destino_id },
    { caixa_id: t.caixa_destino_id, tipo: 'entrada' as const, natureza: d.naturezaEntrada,
      valor: t.valor, contraparte_caixa_id: t.caixa_origem_id },
  ]
}

/**
 * A espécie do estorno é a OPOSTA: devolver uma sangria é, economicamente,
 * um suprimento. Quem lê o extrato do PDV vê dinheiro voltando, que foi o
 * que de fato aconteceu.
 */
export function especieDoEstorno(original: EspecieTransferencia): EspecieTransferencia {
  return original === 'sangria' ? 'suprimento' : 'sangria'
}

/** A frase que a tela mostra antes de confirmar. */
export function resumoDaOperacao(
  especie: EspecieTransferencia,
  nomeOrigem: string,
  nomeDestino: string,
  valorFormatado: string,
): string {
  return especie === 'sangria'
    ? `${valorFormatado} sairá do Caixa PDV ${nomeOrigem} e entrará na Tesouraria da empresa.`
    : `${valorFormatado} sairá da Tesouraria e entrará no Caixa PDV ${nomeDestino}.`
}

// Estados que as RPCs devolvem, e o HTTP de cada um. Sucesso é só
// `aplicada`, `ja_aplicada` e `estornada` — `ja_estornada` também é sucesso
// porque o pedido já foi atendido, e repetir não é erro de quem chamou.
export const ESTADOS_SUCESSO = ['aplicada', 'ja_aplicada', 'estornada', 'ja_estornada']

export function statusDoEstado(estado: string): number {
  if (ESTADOS_SUCESSO.includes(estado)) return 200
  if (estado === 'payload_invalido') return 400
  if (estado === 'nao_encontrada') return 404
  // conflito_payload, empresas_diferentes, combinacao_invalida,
  // caixa_invalido, nao_estorna_estorno: o pedido é coerente mas contradiz o
  // estado do sistema — 409, para o cliente distinguir de erro de digitação.
  return 409
}
