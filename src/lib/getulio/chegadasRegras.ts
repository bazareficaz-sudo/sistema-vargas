// BOLETIM "CHEGOU NA LOJA" — as regras, sem banco (testáveis).
//
// O vendedor precisa saber de três coisas diferentes, e cada uma pesa
// diferente na mensagem:
//
//   🆕 NOVIDADE   produto que a loja nunca teve. O vendedor não conhece —
//                 vai com preço e endereço, um por linha.
//   🔄 VOLTOU     estava zerado ou na lista de faltas. É venda na hora
//                 ("tinha 2 clientes esperando"). Também um por linha.
//   📦 REPOSIÇÃO  item que nunca faltou. Só os nomes, numa linha corrida —
//                 senão uma nota de 80 itens enterra as duas listas acima.
//
// Produto SEM PREÇO de venda não vai para o grupo: o vendedor anunciaria e
// não teria como vender. Vai para o dono, como alerta.

export type ClasseChegada = 'novidade' | 'voltou' | 'reposicao'

export type ItemChegada = {
  produtoId: string
  nome: string
  sku: string | null
  quantidade: number
  /** Estoque atual, depois da nota. */
  estoque: number
  unidade: string
  preco: number
  /** Preço promocional vigente, quando há. */
  promo: number | null
  localizacao: string | null
  classe: ClasseChegada
  /** Faltas anotadas no balcão que esta nota atendeu. */
  faltas: number
  /** Dessas, quantas têm cliente para avisar. */
  clientesEsperando: number
  semPreco: boolean
}

export type BoletimChegada = {
  rotulo: string | null
  fornecedor: string | null
  itens: ItemChegada[]
}

/**
 * Produto cadastrado há mais que isto não é "novidade", mesmo sem entrada
 * registrada antes. Curto de propósito: produto novo é cadastrado junto com
 * a nota (ou poucos dias antes). Com 60 dias, medido em 14/10/2026, a
 * importação em massa de 18/08 da Ouro e Prata viraria "novidade" inteira.
 */
export const DIAS_NOVIDADE = 15
/** Itens listados um por linha em cada seção; o resto vira "e mais N". */
export const MAX_POR_SECAO = 12
/** Nomes citados na linha de reposição. */
export const MAX_REPOSICAO = 8

export type MovNota = {
  tipo: string
  quantidade: number
  estoque_anterior: number | null
  estoque_novo?: number | null
  created_at: string
}

/**
 * Quanto o produto tinha ANTES da nota.
 *
 * A entrada com "zerar estoque antes" grava dois movimentos: o ajuste que
 * zera (com o saldo real em `estoque_anterior`) e a entrada partindo de 0.
 * Olhar só a entrada faria todo item zerado-antes parecer "voltou ao
 * estoque" — o saldo que vale é o do primeiro movimento da nota.
 */
export function estoqueAntesDaNota(movs: MovNota[]): number {
  if (movs.length === 0) return 0
  const ordenados = [...movs].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const ajuste = ordenados.find(m => m.tipo === 'ajuste_saida' || m.tipo === 'ajuste_entrada')
  return Number((ajuste ?? ordenados[0]).estoque_anterior ?? 0)
}

/** Movimentos que trazem mercadoria: nota de entrada ou remessa recebida de outra empresa do grupo. */
export const TIPOS_CHEGADA = ['entrada_compra', 'entrada_nfe', 'transferencia_entrada']

export function quantidadeDaNota(movs: MovNota[]): number {
  return movs
    .filter(m => TIPOS_CHEGADA.includes(m.tipo))
    .reduce((s, m) => s + Number(m.quantidade ?? 0), 0)
}

export function classificar(p: {
  antes: number
  /** Já houve entrada de mercadoria deste produto antes desta nota. */
  teveEntradaAntes: boolean
  criadoEm: string | null
  faltas: number
  agora: Date
}): ClasseChegada {
  const criado = p.criadoEm ? new Date(p.criadoEm).getTime() : NaN
  const recente = Number.isFinite(criado) && p.agora.getTime() - criado <= DIAS_NOVIDADE * 86_400_000
  // Produto antigo sem entrada registrada é o que veio da importação de
  // junho (estoque gravado sem movimento) — não é novidade para ninguém.
  if (!p.teveEntradaAntes && p.antes <= 0 && recente) return 'novidade'
  if (p.antes <= 0 || p.faltas > 0) return 'voltou'
  return 'reposicao'
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const qtd = (v: number) => Number.isInteger(v) ? String(v) : v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

function linhaItem(i: ItemChegada): string {
  const preco = i.promo != null ? `🔥 ${brl(i.promo)} (de ${brl(i.preco)})` : brl(i.preco)
  const partes = [preco, `${qtd(i.estoque)} ${i.unidade.toLowerCase()}`]
  if (i.localizacao) partes.push(`📍 ${i.localizacao}`)
  if (i.clientesEsperando > 0) partes.push(`👥 ${i.clientesEsperando} cliente${i.clientesEsperando > 1 ? 's' : ''} esperando`)
  return `• ${i.nome} — ${partes.join(' · ')}`
}

function secao(titulo: string, itens: ItemChegada[]): string[] {
  if (itens.length === 0) return []
  const linhas = [`${titulo} (${itens.length})`, ...itens.slice(0, MAX_POR_SECAO).map(linhaItem)]
  if (itens.length > MAX_POR_SECAO) linhas.push(`_e mais ${itens.length - MAX_POR_SECAO}_`)
  return ['', ...linhas]
}

/** O que vai para o grupo — só itens com preço. */
export function itensParaGrupo(b: BoletimChegada, incluirReposicao: boolean) {
  const comPreco = b.itens.filter(i => !i.semPreco)
  return {
    novidades: comPreco.filter(i => i.classe === 'novidade'),
    voltaram: comPreco.filter(i => i.classe === 'voltou'),
    repostos: incluirReposicao ? comPreco.filter(i => i.classe === 'reposicao') : [],
  }
}

/**
 * Texto do boletim para o grupo dos vendedores. `null` quando não há nada
 * para contar (nota só de itens sem preço, ou só reposição com a reposição
 * desligada) — aí não sai mensagem.
 */
export function montarTextoChegada(b: BoletimChegada, opcoes: { incluirReposicao: boolean }): string | null {
  const { novidades, voltaram, repostos } = itensParaGrupo(b, opcoes.incluirReposicao)
  if (novidades.length + voltaram.length + repostos.length === 0) return null

  const origem = [b.rotulo, b.fornecedor].filter(Boolean).join(' · ')
  const linhas = ['📦 *Chegou mercadoria na loja!*']
  if (origem) linhas.push(origem)
  linhas.push(...secao('🆕 *Novidades*', novidades))
  linhas.push(...secao('🔄 *Voltaram ao estoque*', voltaram))
  if (repostos.length > 0) {
    const nomes = repostos.slice(0, MAX_REPOSICAO).map(i => i.nome).join(', ')
    const resto = repostos.length > MAX_REPOSICAO ? ` e mais ${repostos.length - MAX_REPOSICAO}` : ''
    linhas.push('', `📦 *Reposição* (${repostos.length})`, `${nomes}${resto}.`)
  }
  linhas.push('', 'A lista completa está no PDV, em "Chegou hoje".')
  return linhas.join('\n')
}

/** Alerta para o dono: chegou mercadoria sem preço de venda. */
export function montarAlertaSemPreco(b: BoletimChegada): string | null {
  const sem = b.itens.filter(i => i.semPreco)
  if (sem.length === 0) return null
  const origem = [b.rotulo, b.fornecedor].filter(Boolean).join(' · ')
  const linhas = [
    `⚠️ *Chegou mercadoria sem preço de venda*${origem ? ` — ${origem}` : ''}`,
    '',
    ...sem.slice(0, MAX_POR_SECAO).map(i => `• ${i.nome}${i.sku ? ` (SKU ${i.sku})` : ''} — ${qtd(i.estoque)} ${i.unidade.toLowerCase()}`),
  ]
  if (sem.length > MAX_POR_SECAO) linhas.push(`_e mais ${sem.length - MAX_POR_SECAO}_`)
  linhas.push('', 'Esses itens ficaram fora do aviso aos vendedores. Cadastre o preço antes de vender.')
  return linhas.join('\n')
}

/** Contagens gravadas no boletim (o que o PDV e a Central mostram). */
export function contarBoletim(b: BoletimChegada) {
  const comPreco = b.itens.filter(i => !i.semPreco)
  return {
    novidades: comPreco.filter(i => i.classe === 'novidade').length,
    voltaram: comPreco.filter(i => i.classe === 'voltou').length,
    repostos: comPreco.filter(i => i.classe === 'reposicao').length,
    sem_preco: b.itens.length - comPreco.length,
  }
}

/** ID de grupo do WhatsApp (formato da Z-API) — não é telefone. */
export function ehIdDeGrupo(destino: string): boolean {
  const d = destino.trim()
  return /-group$/i.test(d) || /@g\.us$/i.test(d) || /^\d{10,15}-\d{9,11}$/.test(d)
}
