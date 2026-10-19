// Endereço que o cliente digitou na conversa → campos do cadastro.
//
// É só uma sugestão: a gaveta do cadastro abre preenchida e a pessoa confere
// antes de salvar. Com CEP, a tela completa rua, bairro e cidade pelo ViaCEP
// (o que já acontece no cadastro); sem CEP, vale o que deu para ler do texto.

export type EnderecoDaConversa = {
  cep: string; logradouro: string; numero: string; complemento: string
  bairro: string; cidade: string; estado: string
}

const UFS = 'AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO'
// Tipo do logradouro e como fica escrito por extenso no cadastro.
const TIPOS: [RegExp, string][] = [
  [/^r(ua|\.)?$/i, 'Rua'], [/^av(enida|\.)?$/i, 'Avenida'], [/^(tv|trav|travessa)\.?$/i, 'Travessa'],
  [/^(estr|est|estrada)\.?$/i, 'Estrada'], [/^(rod|rodovia)\.?$/i, 'Rodovia'], [/^(al|alameda)\.?$/i, 'Alameda'],
  [/^(p[çc]a|pra[çc]a)\.?$/i, 'Praça'], [/^largo$/i, 'Largo'], [/^beco$/i, 'Beco'], [/^ladeira$/i, 'Ladeira'],
  [/^servid[ãa]o$/i, 'Servidão'], [/^caminho$/i, 'Caminho'],
]
const TIPO = String.raw`(?:rua|r\.|avenida|av\.?|travessa|trav\.?|tv\.?|estrada|estr?\.|rodovia|rod\.|alameda|al\.|pra[çc]a|p[çc]a\.?|largo|beco|ladeira|servid[ãa]o|caminho)`
const NAO_LETRA = String.raw`(?<![\p{L}\d])`
const LOGRADOURO = new RegExp(
  `${NAO_LETRA}(${TIPO})\\s+([^,\\n;]+?)\\s*(?:,|\\s|-)\\s*(?:n[º°o]?\\.?\\s*|n[úu]mero\\s*)?(\\d{1,6}[a-z]?|s\\/?n)(?![\\p{L}\\d])`, 'iu')
const CEP = /(?<!\d)(\d{2}\.?\d{3}-\d{3}|\d{5}-\d{3})(?!\d)/
const CEP_SEM_TRACO = /cep\D{0,3}(\d{8})(?!\d)/i
const COMPLEMENTO = new RegExp(
  `${NAO_LETRA}(apartamento|ap(?:to?)?\\.?|casa|bloco|bl\\.?|lote|lt\\.?|quadra|qd\\.?|sala|loja)\\s*(?:n[º°o]?\\.?\\s*)?(\\d+[a-z]?|[a-z](?![\\p{L}]))`, 'giu')
const BAIRRO = /bairro\s*:?\s*([^,\n;]+?)\s*(?=[,\n;]|-\s|$)/i
const CIDADE_UF = new RegExp(`([\\p{L}][\\p{L} .']{1,40}?)\\s*[-/]\\s*(${UFS})(?![\\p{L}])`, 'iu')

const limpo = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '').trim()
const tipoPorExtenso = (t: string) => TIPOS.find(([re]) => re.test(t.replace(/\s+/g, '')))?.[1] ?? t

/** O texto parece trazer um endereço (CEP, ou rua/avenida com número)? */
export function pareceEndereco(texto: string | null | undefined): boolean {
  const t = String(texto ?? '')
  return CEP.test(t) || CEP_SEM_TRACO.test(t) || LOGRADOURO.test(t)
}

/** Campos que deu para ler do texto (os outros vêm vazios). */
export function extrairEndereco(texto: string | null | undefined): EnderecoDaConversa {
  const t = String(texto ?? '')
  const end: EnderecoDaConversa = { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '' }

  const cep = t.match(CEP)?.[1] ?? t.match(CEP_SEM_TRACO)?.[1]
  if (cep) end.cep = cep.replace(/\D/g, '')

  const log = t.match(LOGRADOURO)
  let resto = t
  if (log) {
    end.logradouro = limpo(`${tipoPorExtenso(log[1])} ${log[2]}`)
    end.numero = /^s\/?n$/i.test(log[3]) ? 'S/N' : log[3].toUpperCase()
    resto = t.slice((log.index ?? 0) + log[0].length)
  }

  end.complemento = [...t.matchAll(COMPLEMENTO)].map(m => limpo(m[0])).join(', ')
  if (/(?<![\p{L}])fundos(?![\p{L}])/iu.test(t)) end.complemento = [end.complemento, 'Fundos'].filter(Boolean).join(', ')

  const uf = t.match(CIDADE_UF)
  if (uf) { end.cidade = limpo(uf[1]); end.estado = uf[2].toUpperCase() }

  const bairro = t.match(BAIRRO)?.[1]
  if (bairro) end.bairro = limpo(bairro)
  else if (log) {
    // "Rua X, 12 - Centro - Niterói/RJ": o pedaço depois do número que não é
    // complemento, CEP nem a cidade costuma ser o bairro.
    const pedacos = resto.split(/[,\n;]|\s-\s|\s–\s/).map(limpo).filter(Boolean)
    const candidato = pedacos.find(p =>
      !new RegExp(`^${COMPLEMENTO.source}`, 'iu').test(p) && !/^fundos$/i.test(p) && !/\d{5}-?\d{3}/.test(p) && !/^cep/i.test(p)
      && !(end.cidade && p.toLowerCase().startsWith(end.cidade.toLowerCase())) && !new RegExp(`^(${UFS})$`, 'i').test(p)
      && /^[\p{L}][\p{L} .']{1,40}$/u.test(p))
    if (candidato) end.bairro = candidato
  }
  return end
}

/**
 * Mensagens seguidas do cliente costumam trazer o endereço em partes ("Rua X
 * 12", "bairro Y", "cep …"). Junta a mensagem escolhida com as vizinhas do
 * cliente, sem mensagem da loja no meio e com até 10 min entre uma e outra.
 */
export function blocoDoCliente<T extends { conteudo: string; quando: string; doCliente: boolean }>(lista: T[], indice: number): string {
  const perto = (a: T, b: T) => Math.abs(new Date(a.quando).getTime() - new Date(b.quando).getTime()) <= 10 * 60_000
  let ini = indice, fim = indice
  while (ini > 0 && lista[ini - 1].doCliente && perto(lista[ini - 1], lista[ini])) ini--
  while (fim < lista.length - 1 && lista[fim + 1].doCliente && perto(lista[fim + 1], lista[fim])) fim++
  return lista.slice(ini, fim + 1).map(m => m.conteudo).join('\n')
}

/** Junta o lido do texto com o ViaCEP: rua, bairro, cidade e UF do CEP valem mais. */
export function completarComCep(end: EnderecoDaConversa, viaCep: { logradouro: string; bairro: string; cidade: string; estado: string } | null): EnderecoDaConversa {
  if (!viaCep) return end
  return {
    ...end,
    logradouro: viaCep.logradouro || end.logradouro,
    bairro: viaCep.bairro || end.bairro,
    cidade: viaCep.cidade || end.cidade,
    estado: viaCep.estado || end.estado,
  }
}
