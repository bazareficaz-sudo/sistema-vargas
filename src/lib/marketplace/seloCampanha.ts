import {
  proximidadeDoFim, vigenciaDaCampanha,
  type CampanhaDoAnuncio, type ProximidadeFim,
} from '@/lib/precificacao/campanhas'

// O SELO DE CAMPANHA: "este anúncio está comprometido com uma campanha".
//
// É pergunta DIFERENTE de "qual preço vale agora", que `resolverPrecoEfetivo`
// já responde — e responder as duas com a mesma função deixaria dois buracos
// que aparecem na tela:
//
//   1. CAMPANHA PROGRAMADA. A janela não abriu, então ela não manda em preço
//      nenhum e `resolverPrecoEfetivo` a descarta, com razão. Mas o item já
//      está lá com preço fechado: subir o preço de venda hoje NÃO sobe o preço
//      da campanha, e quando a janela abrir o desconto será maior do que quem
//      subiu imaginava. É justamente aqui que a margem de segurança se decide.
//
//   2. ANÚNCIO COM VARIAÇÕES EM PREÇOS DIFERENTES. `itemDoAnuncio` devolve
//      nulo de propósito — não há preço único a declarar. A tesoura da "Bota
//      Fora" tem duas variações a R$ 22,41 e R$ 19,62, e hoje ela aparece na
//      precificação como se campanha nenhuma existisse. "Não sei QUAL preço"
//      não é o mesmo que "não está em campanha", e a segunda é a informação
//      que faltava.
//
// O QUE O SELO NÃO É: medição ao vivo. Ele espelha `marketplace_promocoes`,
// que só é atualizada quando alguém clica em sincronizar — não há cron. Por
// isso todo selo carrega a idade da leitura, e `espelhoVelho` fica ligado
// quando ela passa de um dia. Um selo sem data seria uma suposição com cara
// de fato.

export type EstadoSelo =
  /** Janela aberta: o preço da campanha está no ar agora. */
  | 'valendo'
  /** Janela ainda não abriu, mas o item já está dentro com preço fechado. */
  | 'programada'
  /** A janela fechou e o espelho ainda não sabe. */
  | 'expirada'

/** Passa de um dia sem sincronizar e o espelho vira memória, não medida. */
export const LIMITE_ESPELHO_HORAS = 24

export type SeloCampanha = {
  campanhaId: string
  idExterno: string | null
  nome: string
  estado: EstadoSelo
  inicio: string | null
  fim: string | null
  /** Só em `valendo`. Vem de `proximidadeDoFim`, os mesmos limites do resto. */
  proximidade: ProximidadeFim | null
  diasRestantes: number | null
  horasRestantes: number | null
  /** Só em `programada`: quantos dias até a janela abrir. */
  diasParaComecar: number | null
  /** Menor e maior preço de campanha entre as variações deste anúncio. */
  precoDe: number | null
  precoAte: number | null
  /** Quantas linhas de campanha este anúncio tem. >1 = variações. */
  itens: number
  /** true quando as variações têm preços diferentes entre si. */
  precoPorVariacao: boolean
  sincronizadoEm: string | null
  espelhoLidoHaHoras: number | null
  espelhoVelho: boolean
}

function data(v: string | null | undefined): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * O selo de UMA campanha para UM anúncio. Nulo quando o anúncio não está nela.
 *
 * Só conta item `participando`. Convite não é compromisso — quem quiser
 * convite chama `oportunidadesDoAnuncio`, que é a terceira pergunta.
 */
export function seloDaCampanha(
  c: CampanhaDoAnuncio, anuncioId: string, agora: Date,
): SeloCampanha | null {
  return montarSelo(c, c.itens.filter(i => contaParaSelo(i) && i.anuncioId === anuncioId), agora)
}

/** Item que compromete preço: participando e com preço. */
function contaParaSelo(i: CampanhaDoAnuncio['itens'][number]) {
  return i.status === 'participando' && i.precoCampanha != null
}

function montarSelo(
  c: CampanhaDoAnuncio, doAnuncio: CampanhaDoAnuncio['itens'], agora: Date,
): SeloCampanha | null {
  if (doAnuncio.length === 0) return null

  const status = c.campanha.status
  // Encerrada e rascunho não comprometem preço nenhum: uma acabou na
  // plataforma, a outra nunca foi publicada. Selo para elas seria ruído.
  if (status === 'encerrada' || status === 'rascunho') return null

  const inicio = data(c.campanha.inicio)
  const vigencia = vigenciaDaCampanha(c.campanha, agora)

  let estado: EstadoSelo
  if (vigencia.vigente) estado = 'valendo'
  else if (inicio && agora < inicio) estado = 'programada'
  else estado = 'expirada'

  const prox = estado === 'valendo' ? proximidadeDoFim(vigencia.restaMs) : null

  const precos = doAnuncio.map(i => Number(i.precoCampanha)).sort((a, b) => a - b)
  const sinc = data(c.campanha.sincronizadoEm)
  const lidoHaHoras = sinc ? Math.max(0, (agora.getTime() - sinc.getTime()) / 3_600_000) : null

  return {
    campanhaId: c.campanha.id,
    idExterno: c.campanha.idExterno,
    nome: c.campanha.nome,
    estado,
    inicio: c.campanha.inicio,
    fim: c.campanha.fim,
    proximidade: prox?.estado ?? null,
    diasRestantes: prox?.diasRestantes ?? null,
    horasRestantes: prox?.horasRestantes ?? null,
    diasParaComecar: estado === 'programada' && inicio
      ? Math.ceil((inicio.getTime() - agora.getTime()) / 86_400_000)
      : null,
    precoDe: precos[0] ?? null,
    precoAte: precos[precos.length - 1] ?? null,
    itens: doAnuncio.length,
    precoPorVariacao: new Set(precos).size > 1,
    sincronizadoEm: c.campanha.sincronizadoEm,
    espelhoLidoHaHoras: lidoHaHoras,
    espelhoVelho: lidoHaHoras != null && lidoHaHoras > LIMITE_ESPELHO_HORAS,
  }
}

/** Ordem de gravidade: o que já está no ar antes do que ainda vai entrar. */
const PESO: Record<EstadoSelo, number> = { valendo: 0, programada: 1, expirada: 2 }

/**
 * Todos os selos de um anúncio, o mais relevante primeiro.
 *
 * Um anúncio PODE estar em mais de uma campanha — `resolverPrecoEfetivo` já
 * trata disso e avisa que costuma ser erro de cadastro. A tela mostra o
 * primeiro e conta os outros, em vez de escolher em silêncio.
 */
export function selosDoAnuncio(
  campanhas: CampanhaDoAnuncio[], anuncioId: string, agora: Date,
): SeloCampanha[] {
  return campanhas
    .map(c => seloDaCampanha(c, anuncioId, agora))
    .filter((s): s is SeloCampanha => s !== null)
    .sort(porUrgencia)
}

function porUrgencia(a: SeloCampanha, b: SeloCampanha) {
  const p = PESO[a.estado] - PESO[b.estado]
  if (p !== 0) return p
  // Dentro do mesmo estado, a que termina antes primeiro: é a que exige
  // decisão mais cedo.
  return (a.diasRestantes ?? a.diasParaComecar ?? 999) - (b.diasRestantes ?? b.diasParaComecar ?? 999)
}

/**
 * Os selos de TODOS os anúncios, em uma passada.
 *
 * A listagem precisa disso e não de `selosDoAnuncio` por linha: aquela varre
 * todos os itens de todas as campanhas a cada anúncio, o que é o mesmo
 * trabalho com 7 itens e vira quadrático numa campanha de mil. Aqui cada item
 * é visitado uma vez só.
 */
export function selosPorAnuncio(
  campanhas: CampanhaDoAnuncio[], agora: Date,
): Record<string, SeloCampanha[]> {
  const saida: Record<string, SeloCampanha[]> = {}

  for (const c of campanhas) {
    const porAnuncio = new Map<string, CampanhaDoAnuncio['itens']>()
    for (const item of c.itens) {
      if (!item.anuncioId || !contaParaSelo(item)) continue
      const lista = porAnuncio.get(item.anuncioId)
      if (lista) lista.push(item)
      else porAnuncio.set(item.anuncioId, [item])
    }
    for (const [anuncioId, itens] of porAnuncio) {
      const selo = montarSelo(c, itens, agora)
      if (!selo) continue
      ;(saida[anuncioId] ??= []).push(selo)
    }
  }

  for (const lista of Object.values(saida)) lista.sort(porUrgencia)
  return saida
}

/** Texto curto do selo, para caber na linha da listagem. */
export function textoDoSelo(s: SeloCampanha): string {
  if (s.estado === 'programada') {
    return s.diasParaComecar != null ? `começa em ${s.diasParaComecar}d` : 'programada'
  }
  if (s.estado === 'expirada') return 'janela vencida'
  if (s.proximidade === 'termina_hoje') return 'termina hoje'
  if (s.proximidade === 'sem_prazo') return 'sem prazo'
  return s.diasRestantes != null ? `${s.diasRestantes}d` : 'em campanha'
}

/** A frase inteira, para o `title` — inclui a data da leitura. */
export function explicarSelo(s: SeloCampanha): string {
  const linhas: string[] = [`Campanha "${s.nome}"`]

  if (s.estado === 'valendo') {
    linhas.push(s.fim
      ? `No ar até ${dataBR(s.fim)}${s.diasRestantes != null ? ` (${s.diasRestantes} dia(s))` : ''}.`
      : 'No ar, sem prazo declarado.')
  } else if (s.estado === 'programada') {
    linhas.push(
      `Ainda não começou${s.inicio ? `: abre em ${dataBR(s.inicio)}` : ''}. ` +
      'O preço da campanha já está fechado — mudar o preço de venda aqui NÃO muda o da campanha.')
  } else {
    linhas.push('A janela desta campanha já terminou, mas o espelho local ainda não sabe. Sincronize as promoções.')
  }

  if (s.precoDe != null) {
    linhas.push(s.precoPorVariacao
      ? `Preço de campanha: ${brl(s.precoDe)} a ${brl(s.precoAte!)} (${s.itens} variações, preços diferentes).`
      : `Preço de campanha: ${brl(s.precoDe)}${s.itens > 1 ? ` (${s.itens} variações, mesmo preço)` : ''}.`)
  }

  linhas.push(s.sincronizadoEm
    ? `Lido da plataforma em ${dataBR(s.sincronizadoEm)}${s.espelhoVelho ? ' — faz mais de um dia; pode ter mudado lá.' : '.'}`
    : 'Sem data de sincronização: este selo pode estar velho.')

  return linhas.join('\n')
}

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function dataBR(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR')
}
