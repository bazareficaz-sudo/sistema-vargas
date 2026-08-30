// Validação de NCM contra a nomenclatura oficial (`ncm_tabela`).
//
// Por que consulta em vez de confiar no cadastro: a venda #201722 foi recusada
// com "Rejeição 778: Informado NCM fora do período de vigência ou inexistente".
// O código 32100090 tinha sido preenchido pela IA e não existe — a posição
// 3210.00 tem .10, .20 e .30, e nenhum .90.
//
// O formato já era conferido (8 dígitos). Formato certo não é código certo:
// 32100090 tem oito dígitos e passou por toda a validação estrutural que
// existia, até a SEFAZ.
//
// A REJEIÇÃO 778 TEM DOIS MOTIVOS NUM TEXTO SÓ, e eles pedem coisas
// diferentes de quem for corrigir:
//
//   'inexistente' → o código nunca existiu; alguém precisa escolher outro
//   'extinto'     → existiu e foi revogado por Resolução Gecex posterior;
//                   o produto está com classificação velha, e há um sucessor
//
// Por isso `verificarNcm` devolve os dois separados, e não um booleano.

export type SituacaoNcm =
  | { situacao: 'vigente'; codigo: string; descricao: string }
  | { situacao: 'extinto'; codigo: string; descricao: string; dataFim: string }
  | { situacao: 'inexistente'; codigo: string }
  | { situacao: 'malformado'; informado: string }
  /** A tabela não pôde ser consultada. NÃO é o mesmo que "não existe". */
  | { situacao: 'nao_verificavel'; codigo: string; motivo: string }

export type CandidatoNcm = { codigo: string; descricao: string }

export function apenasDigitos(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '')
}

/**
 * Confere um NCM contra a tabela oficial, na data informada.
 *
 * `agora` é parâmetro e não `new Date()` porque a mesma nota pode ser
 * reemitida depois, e porque isso é o que torna a função testável sem
 * congelar o relógio.
 */
export async function verificarNcm(sb: any, informado: unknown, agora = new Date()): Promise<SituacaoNcm> {
  const codigo = apenasDigitos(informado)
  if (codigo.length !== 8) return { situacao: 'malformado', informado: String(informado ?? '') }

  const { data, error } = await sb.from('ncm_tabela')
    .select('codigo, descricao, data_inicio, data_fim')
    .eq('codigo', codigo)
    .maybeSingle()

  // Tabela ausente, sem permissão, rede caída — nenhum desses é "o código não
  // existe". Confundir os dois foi o que fez a tabela CEST ausente passar por
  // resposta fiscal durante meses.
  if (error) return { situacao: 'nao_verificavel', codigo, motivo: error.message }
  if (!data) return { situacao: 'inexistente', codigo }

  const fim = data.data_fim ? new Date(`${data.data_fim}T23:59:59`) : null
  if (fim && fim < agora) {
    return { situacao: 'extinto', codigo, descricao: data.descricao, dataFim: data.data_fim }
  }
  return { situacao: 'vigente', codigo, descricao: data.descricao }
}

/**
 * Códigos vigentes que compartilham prefixo com o informado, do mais próximo
 * para o mais distante.
 *
 * Serve para o caso real: 32100090 não existe, mas 3210.00.10, .20 e .30 sim.
 * Quem errou o último par de dígitos está a um clique do certo — e oferecer a
 * lista é melhor que mandar a pessoa procurar a nomenclatura inteira.
 *
 * Não devolve nada com prefixo menor que 4 dígitos: "tudo que começa com 32"
 * são centenas de códigos e não ajuda ninguém a escolher.
 */
export async function vizinhosDoNcm(sb: any, informado: unknown, agora = new Date()): Promise<CandidatoNcm[]> {
  const codigo = apenasDigitos(informado)
  if (codigo.length < 4) return []

  for (const tamanho of [6, 4]) {
    if (codigo.length < tamanho) continue
    const { data } = await sb.from('ncm_tabela')
      .select('codigo, descricao, data_fim')
      .like('codigo', `${codigo.slice(0, tamanho)}%`)
      .order('codigo')
      .limit(30)
    const vigentes = (data ?? []).filter((l: { data_fim: string | null }) =>
      !l.data_fim || new Date(`${l.data_fim}T23:59:59`) >= agora)
    if (vigentes.length > 0) {
      return vigentes.map((l: { codigo: string; descricao: string }) => ({ codigo: l.codigo, descricao: l.descricao }))
    }
  }
  return []
}

/** A frase que vai para a tela, no lugar do número da rejeição. */
export function explicarNcm(s: SituacaoNcm): string | null {
  switch (s.situacao) {
    case 'vigente': return null
    case 'malformado':
      return s.informado.trim() === ''
        ? 'sem NCM cadastrado. A NFC-e exige o código em todo item.'
        : `NCM "${s.informado}" não tem 8 dígitos. A SEFAZ recusa com "Rejeição 778".`
    case 'inexistente':
      return `NCM ${s.codigo} não existe na nomenclatura oficial. A SEFAZ recusa com "Rejeição 778: informado NCM fora do período de vigência ou inexistente".`
    case 'extinto':
      return `NCM ${s.codigo} (${s.descricao}) foi extinto em ${s.dataFim.split('-').reverse().join('/')}. Continua válido em notas antigas, mas não em novas — "Rejeição 778".`
    case 'nao_verificavel':
      return `Não foi possível conferir o NCM ${s.codigo} na nomenclatura oficial (${s.motivo}). Isso NÃO quer dizer que ele esteja errado — quer dizer que não deu para conferir.`
  }
}
