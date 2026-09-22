// A sessão de caixa — regras puras (Fase 3).
//
// `caixa` é a gaveta, que dura anos. `caixa_sessao` é o turno: abriu 08:00,
// fechou 18:10. A mesma gaveta tem uma sessão nova a cada dia.
//
// O QUE ESTE ARQUIVO NÃO FAZ: decidir o saldo. O esperado é o saldo do
// ledger daquela gaveta, calculado no banco por `saldo_caixa_v1`, e a RPC de
// fechamento o recalcula dentro da transação. O que está aqui é a
// DECOMPOSIÇÃO — quanto veio de cada coisa — que é o demonstrativo que o
// operador lê antes de contar o dinheiro.
//
// A decomposição e o saldo precisam fechar. `conferirDemonstrativo` existe
// para provar isso: saldo de abertura + tudo que a sessão movimentou tem de
// dar exatamente o saldo atual. Se um dia uma natureza nova entrar no banco
// e ninguém classificá-la aqui, esse teste quebra — que é o ponto.

export type StatusSessao = 'aberta' | 'fechada'

// De onde veio o dinheiro que estava na gaveta quando o turno começou.
// São três coisas diferentes e tratá-las como iguais duplicaria dinheiro.
export type FundoOrigem = 'herdado' | 'tesouraria' | 'manual'

export const FUNDO_ORIGENS: { valor: FundoOrigem; label: string; ajuda: string }[] = [
  { valor: 'herdado', label: 'Já estava na gaveta',
    ajuda: 'O troco que ficou do fechamento anterior. Não movimenta dinheiro: ele já está no caixa.' },
  { valor: 'tesouraria', label: 'Veio da Tesouraria',
    ajuda: 'A empresa está entregando dinheiro para o caixa começar. É um suprimento.' },
  { valor: 'manual', label: 'Informar manualmente',
    ajuda: 'Dinheiro que já estava fisicamente na gaveta mas nunca entrou no sistema. Exige explicação.' },
]

// As categorias do demonstrativo. Quatro delas ainda não têm nenhuma
// natureza que as produza — `venda_dinheiro`, `recebimento_dinheiro`,
// `devolucao_dinheiro` e `pagamento_dinheiro` só passam a existir quando
// vendas e recebimentos forem integrados ao caixa. Estão aqui porque o
// motor precisa nascer sabendo somá-las; o banco, não: lá o CHECK só aceita
// o que algo realmente grava hoje.
export type CategoriaSessao =
  | 'fundo_abertura'
  | 'venda_dinheiro'
  | 'recebimento_dinheiro'
  | 'suprimento'
  | 'devolucao_dinheiro'
  | 'pagamento_dinheiro'
  | 'sangria'
  | 'ajuste'
  | 'diferenca_fechamento'
  | 'outros'

const CATEGORIA_DA_NATUREZA: Record<string, CategoriaSessao> = {
  // existem hoje
  fundo_abertura: 'fundo_abertura',
  suprimento: 'suprimento',
  sangria: 'sangria',
  ajuste: 'ajuste',
  diferenca_fechamento: 'diferenca_fechamento',
  // existem, mas não do lado do caixa de PDV — aparecem na tesouraria
  sangria_recebida: 'outros',
  suprimento_entregue: 'outros',
  aporte: 'outros',
  retirada_socio: 'outros',
  deposito_banco: 'outros',
  // ainda não produzidas por nada; já classificadas para quando forem
  venda_dinheiro: 'venda_dinheiro',
  recebimento_dinheiro: 'recebimento_dinheiro',
  devolucao_dinheiro: 'devolucao_dinheiro',
  pagamento_dinheiro: 'pagamento_dinheiro',
}

export function categoriaDaNatureza(natureza: string): CategoriaSessao {
  return CATEGORIA_DA_NATUREZA[natureza] ?? 'outros'
}

export const ROTULO_CATEGORIA: Record<CategoriaSessao, string> = {
  fundo_abertura: 'Fundo de abertura',
  venda_dinheiro: 'Vendas em dinheiro',
  recebimento_dinheiro: 'Recebimentos em dinheiro',
  suprimento: 'Suprimentos',
  devolucao_dinheiro: 'Devoluções em dinheiro',
  pagamento_dinheiro: 'Pagamentos em dinheiro',
  sangria: 'Sangrias',
  ajuste: 'Ajustes',
  diferenca_fechamento: 'Diferença de fechamento',
  outros: 'Outros',
}

export type MovimentoDaSessao = {
  tipo: 'entrada' | 'saida'
  natureza: string
  valor: number
}

export type LinhaDemonstrativo = {
  categoria: CategoriaSessao
  rotulo: string
  valor: number   // já com sinal: entrada positiva, saída negativa
}

function centavos(v: number) {
  const r = Math.round(v * 100) / 100
  // `Math.round` devolve -0 para valores negativos minúsculos, e -0 vazaria
  // para a tela como "− R$ 0,00" numa conferência que na verdade bateu.
  return Object.is(r, -0) ? 0 : r
}

/**
 * O demonstrativo que o operador lê antes de contar: de onde veio e para
 * onde foi o dinheiro desta sessão.
 *
 * Só as categorias com movimento aparecem — uma lista de dez linhas zeradas
 * não ajuda ninguém a conferir gaveta.
 */
export function montarDemonstrativo(movimentos: MovimentoDaSessao[]): LinhaDemonstrativo[] {
  const soma = new Map<CategoriaSessao, number>()
  for (const m of movimentos) {
    const cat = categoriaDaNatureza(m.natureza)
    const v = Math.round(m.valor * 100) * (m.tipo === 'entrada' ? 1 : -1)
    soma.set(cat, (soma.get(cat) ?? 0) + v)
  }
  const ordem: CategoriaSessao[] = [
    'fundo_abertura', 'venda_dinheiro', 'recebimento_dinheiro', 'suprimento',
    'devolucao_dinheiro', 'pagamento_dinheiro', 'sangria', 'ajuste',
    'diferenca_fechamento', 'outros',
  ]
  return ordem
    .filter(c => soma.has(c))
    .map(c => ({ categoria: c, rotulo: ROTULO_CATEGORIA[c], valor: (soma.get(c) ?? 0) / 100 }))
}

/**
 * A conta que precisa fechar.
 *
 * `saldoAbertura` é o que a gaveta tinha quando a sessão começou (para
 * fundo herdado, é o próprio fundo; para as outras origens, é o que havia
 * antes de o fundo entrar). Somado a tudo que a sessão movimentou, tem de
 * dar o saldo atual — senão alguma natureza escapou da classificação.
 */
export function conferirDemonstrativo(
  saldoAbertura: number,
  movimentos: MovimentoDaSessao[],
  saldoAtual: number,
): { ok: boolean; calculado: number; diferenca: number } {
  const totalCentavos = movimentos.reduce(
    (s, m) => s + Math.round(m.valor * 100) * (m.tipo === 'entrada' ? 1 : -1), 0)
  const calculado = centavos(saldoAbertura + totalCentavos / 100)
  const diferenca = centavos(calculado - saldoAtual)
  return { ok: diferenca === 0, calculado, diferenca }
}

// ── Fechamento ────────────────────────────────────────────────────────────

export type ResultadoConferencia = {
  esperado: number
  contado: number
  diferenca: number
  /** 'conferido' quando bate exatamente. */
  situacao: 'conferido' | 'sobra' | 'falta'
}

/**
 * A diferença é `contado − esperado`, e é um FATO: negativa é falta,
 * positiva é sobra. Nunca se mexe em movimento antigo para ela dar zero.
 */
export function conferir(esperado: number, contado: number): ResultadoConferencia {
  const diferenca = centavos(contado - esperado)
  return {
    esperado: centavos(esperado),
    contado: centavos(contado),
    diferenca,
    situacao: diferenca === 0 ? 'conferido' : diferenca > 0 ? 'sobra' : 'falta',
  }
}

/**
 * Quanto vai para a tesouraria no fechamento.
 *
 * É `contado − troco`, e NÃO `esperado − troco` nem nada que some as
 * sangrias do dia. As sangrias já tiraram aquele dinheiro da gaveta e já o
 * entregaram à tesouraria quando foram feitas; somá-las de novo aqui
 * transferiria duas vezes o mesmo dinheiro. O que sai agora é só o que
 * ainda está fisicamente na gaveta — e isso é o contado.
 */
export function calcularEntrega(contado: number, mantidoTroco: number): number {
  return centavos(contado - mantidoTroco)
}

export type FechamentoInput = {
  valor_contado?: unknown
  valor_mantido_troco?: unknown
  observacao?: unknown
}

export type FechamentoValido = {
  valor_contado: number
  valor_mantido_troco: number
  observacao: string | null
}

export type ResultadoValidacao<T> = { ok: true; valor: T } | { ok: false; erro: string }

export function validarFechamento(input: FechamentoInput): ResultadoValidacao<FechamentoValido> {
  // Campo vazio NÃO é zero. `Number('')` devolve 0, e sem esta guarda um
  // fechamento enviado com o campo em branco seria lido como "contei nada
  // na gaveta" — apurando uma falta do valor inteiro do caixa e mandando
  // zero para a tesouraria.
  if (input.valor_contado == null || String(input.valor_contado).trim() === '') {
    return { ok: false, erro: 'Informe quanto foi contado na gaveta.' }
  }
  const contado = Number(input.valor_contado)
  if (!Number.isFinite(contado) || contado < 0) {
    return { ok: false, erro: 'Informe quanto foi contado na gaveta.' }
  }
  const troco = input.valor_mantido_troco == null || input.valor_mantido_troco === ''
    ? 0 : Number(input.valor_mantido_troco)
  if (!Number.isFinite(troco) || troco < 0) {
    return { ok: false, erro: 'O valor mantido para troco não pode ser negativo.' }
  }
  if (troco > contado) {
    return { ok: false, erro: 'Não é possível manter mais troco do que o dinheiro contado.' }
  }
  let observacao: string | null = null
  if (input.observacao != null && String(input.observacao).trim() !== '') {
    observacao = String(input.observacao).trim().slice(0, 500)
  }
  return { ok: true, valor: { valor_contado: centavos(contado), valor_mantido_troco: centavos(troco), observacao } }
}

// ── Abertura ──────────────────────────────────────────────────────────────

export type AberturaInput = {
  id?: unknown
  caixa_id?: unknown
  fundo_origem?: unknown
  fundo_inicial?: unknown
  observacao?: unknown
}

export type AberturaValida = {
  id: string
  caixa_id: string
  fundo_origem: FundoOrigem
  fundo_inicial: number
  observacao: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * `id` vem do cliente e é obrigatório: é a chave de idempotência da
 * abertura. Gerar um aqui faria cada retry abrir uma sessão nova.
 *
 * O fundo `manual` exige observação. É a única porta pela qual dinheiro
 * entra no ledger sem contraparte, e dinheiro que aparece sem explicação é
 * exatamente o que um controle de caixa existe para impedir. A RPC recusa
 * de novo — esta checagem só devolve a mensagem antes.
 */
export function validarAbertura(input: AberturaInput): ResultadoValidacao<AberturaValida> {
  const id = typeof input.id === 'string' ? input.id : ''
  if (!UUID.test(id)) return { ok: false, erro: 'Identificador da abertura ausente ou inválido.' }

  const caixa_id = typeof input.caixa_id === 'string' ? input.caixa_id : ''
  if (!UUID.test(caixa_id)) return { ok: false, erro: 'Escolha o caixa de PDV.' }

  const origem = input.fundo_origem
  if (origem !== 'herdado' && origem !== 'tesouraria' && origem !== 'manual') {
    return { ok: false, erro: 'Informe de onde vem o fundo de abertura.' }
  }

  const valor = input.fundo_inicial == null || input.fundo_inicial === ''
    ? 0 : Number(input.fundo_inicial)
  if (!Number.isFinite(valor) || valor < 0) {
    return { ok: false, erro: 'O fundo de abertura não pode ser negativo.' }
  }
  if (origem === 'tesouraria' && valor <= 0) {
    return { ok: false, erro: 'Um fundo vindo da Tesouraria precisa de valor maior que zero.' }
  }

  let observacao: string | null = null
  if (input.observacao != null && String(input.observacao).trim() !== '') {
    observacao = String(input.observacao).trim().slice(0, 500)
  }
  if (origem === 'manual' && valor > 0 && !observacao) {
    return { ok: false, erro: 'Informe de onde veio esse dinheiro — fundo manual exige explicação.' }
  }

  return { ok: true, valor: { id, caixa_id, fundo_origem: origem, fundo_inicial: centavos(valor), observacao } }
}

/** A frase que a tela mostra antes de confirmar a abertura. */
export function resumoAbertura(origem: FundoOrigem, valorFormatado: string, nomeCaixa: string): string {
  if (origem === 'tesouraria') {
    return `${valorFormatado} sairá da Tesouraria e entrará fisicamente no ${nomeCaixa}.`
  }
  if (origem === 'herdado') {
    return `${valorFormatado} já está na gaveta do ${nomeCaixa}, vindo do fechamento anterior. Nenhum dinheiro será movimentado.`
  }
  return `${valorFormatado} será registrado como dinheiro que já estava fisicamente no ${nomeCaixa}.`
}

/** A frase do fechamento, com os três números que importam. */
export function resumoFechamento(
  nomeCaixa: string, trocoFormatado: string, entregaFormatada: string, diferencaFormatada: string,
): string {
  return `${trocoFormatado} permanecerá no ${nomeCaixa}. `
       + `${entregaFormatada} será transferido para a Tesouraria. `
       + `Diferença do fechamento: ${diferencaFormatada}.`
}

// Estados que as RPCs de sessão devolvem.
export const ESTADOS_SUCESSO_SESSAO = ['aberta', 'ja_aberta', 'fechada', 'ja_fechada']

export function statusDoEstadoSessao(estado: string): number {
  if (ESTADOS_SUCESSO_SESSAO.includes(estado)) return 200
  if (estado === 'payload_invalido') return 400
  if (estado === 'nao_encontrada') return 404
  // ja_existe_sessao_aberta, fundo_herdado_divergente, conflito_esperado,
  // empresas_diferentes, caixa_invalido, falha_no_fundo, falha_na_entrega:
  // o pedido é coerente mas contradiz o estado do sistema.
  return 409
}
