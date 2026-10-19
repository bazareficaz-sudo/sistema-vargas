// Contas a pagar de mais de uma empresa na mesma tela.
//
// Quem tem vínculo com várias empresas (usuario_empresas) escolhe quais quer
// ver; a escolha fica num cookie para a tela abrir do mesmo jeito da próxima
// vez. O cookie é só preferência de exibição: o servidor confere cada id
// contra as empresas permitidas, e o banco (RLS por empresa_do_meu_grupo)
// trava de novo. Cookie editado à mão não mostra empresa nenhuma a mais.

export const COOKIE_EMPRESAS_PAGAR = 'cp_empresas'

export type EmpresaPagar = { id: string; nome: string; curto: string; cor: string }

const CORES = ['#2563eb', '#9333ea', '#0d9488', '#ea580c', '#db2777', '#4d7c0f']

/** "BAZAR OURO E PRATA" → "Ouro e Prata"; "Bazar Eficaz" → "Eficaz". */
export function nomeCurto(nome: string): string {
  const sem = nome.trim().replace(/^bazar\s+/i, '') || nome.trim()
  if (sem !== sem.toUpperCase()) return sem
  const minusculas = new Set(['e', 'de', 'da', 'do', 'das', 'dos'])
  return sem.toLowerCase().split(/\s+/)
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ')
}

export function montarEmpresas(lista: { id: string; nome: string }[]): EmpresaPagar[] {
  return lista.map((e, i) => ({ id: e.id, nome: e.nome, curto: nomeCurto(e.nome), cor: CORES[i % CORES.length] }))
}

/**
 * Quais empresas mostrar. Só valem ids permitidos; sem escolha válida, a
 * empresa em que a sessão está trabalhando (o comportamento de sempre).
 */
export function empresasEscolhidas(cookie: string | null | undefined, permitidas: string[], ativa: string): string[] {
  if (cookie === 'todas') return permitidas
  const ids = String(cookie ?? '').split(',').filter(id => permitidas.includes(id))
  if (ids.length) return ids
  return permitidas.includes(ativa) ? [ativa] : permitidas.slice(0, 1)
}

/** Valor do cookie para a escolha: 'todas' quando são todas (e continuam
 *  sendo se entrar uma empresa nova no grupo). */
export function valorDoCookie(escolhidas: string[], permitidas: string[]): string {
  return permitidas.every(id => escolhidas.includes(id)) ? 'todas' : escolhidas.join(',')
}

/** Mesmo fornecedor nas duas empresas é o mesmo CNPJ em dois cadastros. */
export function chaveDoFornecedor(fornecedorId: string | null, cnpj: string | null | undefined): string {
  const d = String(cnpj ?? '').replace(/\D/g, '')
  if (d.length >= 11) return `doc:${d}`
  return fornecedorId ?? '__sem__'
}
