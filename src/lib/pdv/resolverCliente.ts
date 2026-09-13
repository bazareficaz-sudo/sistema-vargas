// QUEM É A MESMA PESSOA — a decisão, separada do banco.
//
// ── POR QUE ISTO EXISTE EM TYPESCRIPT ────────────────────────────────────
//
// Esta regra já existe em dois lugares e os dois são o PDV: `_mesmoCliente`
// em `api.js` (contra o Supabase) e `_acharEquivalente` em `database.js`
// (contra o SQLite). Trazer o cadastro de cliente para uma rota autenticada
// obriga a existir um terceiro. Se ele divergir dos outros dois, o resultado
// não é um erro visível — é cadastro duplicado, que foi exatamente o que
// aconteceu nos dois surtos registrados no comentário do `registrarCliente`:
// 8 cópias em 07/08 e 33 em 24/08, todas no mesmo minuto.
//
// Então a regra fica aqui, pura, sem `supabase` nem `fetch` dentro, e os
// casos que a definem viram teste. Quem quiser mudar o critério muda num
// lugar e vê imediatamente qual caso real quebra.
//
// ── A REGRA, LITERAL ─────────────────────────────────────────────────────
//
// Dois cadastros são a mesma pessoa quando o NOME bate e nada os desmente:
// telefone e CPF/CNPJ ou são iguais, ou um dos lados está vazio.
//
// Telefone diferente NÃO separa sozinho — a loja tem "SILVANO" e "SILVANO
// VARGAS" no mesmo número, gente de casa dividindo telefone. E telefone
// vazio de um lado também não pode inventar cadastro novo: era esse "vazio
// de um lado" que fazia o par parecer gente diferente na rodada seguinte.
//
// CPF/CNPJ tem prioridade sobre tudo: é identidade de verdade, vale mesmo
// com o nome escrito diferente.

const ACENTOS: Record<string, string> = {
  á: 'a', à: 'a', ã: 'a', â: 'a', ä: 'a',
  é: 'e', è: 'e', ê: 'e', ë: 'e',
  í: 'i', ì: 'i', î: 'i', ï: 'i',
  ó: 'o', ò: 'o', õ: 'o', ô: 'o', ö: 'o',
  ú: 'u', ù: 'u', û: 'u', ü: 'u',
  ç: 'c', ñ: 'n',
}

/**
 * O nome reduzido ao que dá para comparar.
 *
 * Sem acento e em maiúscula porque é assim que o nome chega: "Thainá"
 * digitado no balcão e "THAINA" gravado no sistema web são a mesma pessoa, e
 * um til não pode abrir cadastro.
 */
export function chaveNome(nome: string | null | undefined): string {
  return String(nome ?? '')
    .toLowerCase()
    .replace(/[áàãâäéèêëíìîïóòõôöúùûüçñ]/g, (c) => ACENTOS[c] ?? c)
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

/** Só os dígitos — máscara de CPF e de telefone não são dado. */
export function soDigitos(v: string | null | undefined): string {
  return String(v ?? '').replace(/\D/g, '')
}

export type ClienteComparavel = {
  id?: string
  nome?: string | null
  telefone?: string | null
  cpf_cnpj?: string | null
  mesclado_em?: string | null
}

/** Nada desmente que sejam a mesma pessoa? */
export function mesmoCliente(local: ClienteComparavel, remoto: ClienteComparavel): boolean {
  if (chaveNome(local.nome) !== chaveNome(remoto.nome)) return false
  const telL = soDigitos(local.telefone)
  const telR = soDigitos(remoto.telefone)
  if (telL && telR && telL !== telR) return false
  const docL = soDigitos(local.cpf_cnpj)
  const docR = soDigitos(remoto.cpf_cnpj)
  if (docL && docR && docL !== docR) return false
  return true
}

/**
 * Entre os cadastros da empresa, qual é este cliente — ou nenhum.
 *
 * Documento primeiro, e por identidade, não por nome. Depois nome +
 * compatibilidade. A ordem importa: um cadastro com o CPF certo e o nome
 * escrito errado é a mesma pessoa; dois homônimos com CPFs diferentes não são.
 */
export function escolherCliente(
  local: ClienteComparavel,
  candidatos: ClienteComparavel[],
): ClienteComparavel | null {
  const doc = soDigitos(local.cpf_cnpj)
  if (doc) {
    const porDoc = candidatos.find((c) => soDigitos(c.cpf_cnpj) === doc)
    if (porDoc) return porDoc
  }
  return candidatos.find((c) => mesmoCliente(local, c)) ?? null
}

/**
 * Segue `mesclado_em` até o sobrevivente.
 *
 * Um cadastro unificado no sistema web continua existindo; devolver o id dele
 * faria a venda nascer pendurada num cliente morto — e como
 * `sincronizarClientes` só traz os ativos, o terminal nunca mais receberia
 * atualização daquela linha. Sem erro, só sem notícia.
 *
 * O teto de saltos não é paranoia decorativa: `mesclado_em` é um ponteiro
 * comum, e um ciclo (A→B→A, criado por duas unificações em sentidos opostos)
 * daria laço infinito dentro de uma requisição.
 *
 * Puro de propósito: recebe o mapa já lido, não vai ao banco.
 */
export function seguirMesclado(
  inicio: ClienteComparavel,
  porId: Map<string, ClienteComparavel>,
  maxSaltos = 10,
): ClienteComparavel {
  let atual = inicio
  const vistos = new Set<string>(atual.id ? [atual.id] : [])
  for (let i = 0; i < maxSaltos; i++) {
    const proximoId = atual.mesclado_em
    if (!proximoId || vistos.has(proximoId)) return atual
    const proximo = porId.get(proximoId)
    if (!proximo) return atual
    vistos.add(proximoId)
    atual = proximo
  }
  return atual
}

/**
 * O que o cadastro achado NÃO tem e o balcão acabou de digitar.
 *
 * Completar em vez de descartar é o que impede o par de voltar a parecer
 * gente diferente na próxima rodada — um lado vazio faz `mesmoCliente`
 * aceitar qualquer coisa, e aí o primeiro cadastro com telefone diferente
 * vira uma segunda linha.
 *
 * Só preenche vazio. Nunca sobrescreve o que o sistema web já sabe: um
 * terminal com dado velho em cache não pode desfazer uma correção feita no
 * ERP.
 */
export function camposParaCompletar(
  achado: ClienteComparavel,
  local: ClienteComparavel,
): { telefone?: string; cpf_cnpj?: string } {
  const completar: { telefone?: string; cpf_cnpj?: string } = {}
  if (!soDigitos(achado.telefone) && local.telefone) completar.telefone = local.telefone
  if (!soDigitos(achado.cpf_cnpj) && local.cpf_cnpj) completar.cpf_cnpj = local.cpf_cnpj
  return completar
}
