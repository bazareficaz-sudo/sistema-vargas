// AVISO DE CHEGADA — a mensagem que o cliente da falta/encomenda recebe
// quando o produto volta ao estoque. Sem banco nem rede, para poder ser
// usada pela tela de Automações (pré-visualização) e testada.

export const MENSAGEM_PADRAO_AVISO =
  'Olá, {nome}! O produto {produto} que você procurou na {loja} já chegou. Estamos te esperando! 😊'

export const MARCADORES_AVISO = ['{nome}', '{produto}', '{loja}'] as const

/** Primeiro nome, com a primeira letra maiúscula: "JOÃO DA SILVA" → "João". */
export function primeiroNome(nome: string | null | undefined): string {
  const p = (nome ?? '').trim().split(/\s+/)[0] ?? ''
  if (!p) return ''
  return p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1).toLocaleLowerCase('pt-BR')
}

/**
 * Preenche o modelo. Sem nome do cliente, o marcador sai junto com a vírgula
 * ou espaço que o precede ("Olá, {nome}!" → "Olá!") em vez de deixar
 * "Olá, !" na tela do cliente.
 */
export function montarAvisoChegada(
  modelo: string | null | undefined,
  dados: { nome?: string | null; produto: string; loja: string },
): string {
  const base = (modelo ?? '').trim() || MENSAGEM_PADRAO_AVISO
  const nome = primeiroNome(dados.nome)
  const comNome = nome ? base.replace(/\{nome\}/g, nome) : base.replace(/,?\s*\{nome\}/g, '')
  return comNome
    .replace(/\{produto\}/g, dados.produto.trim())
    .replace(/\{loja\}/g, dados.loja.trim() || 'nossa loja')
}

/** Telefone que dá para mandar mensagem: DDD + número (10 ou 11 dígitos), com ou sem 55. */
export function telefoneAvisavel(v: string | null | undefined): string | null {
  let d = (v ?? '').replace(/\D/g, '')
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2)
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1)
  return d.length === 10 || d.length === 11 ? d : null
}
