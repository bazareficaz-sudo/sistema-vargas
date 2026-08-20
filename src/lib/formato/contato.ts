// Formatação de telefone e busca de CEP — as duas coisas que todo cadastro
// de pessoa precisa e que estavam copiadas em arquivos diferentes.
//
// `formatarTelefone` vivia duplicada em EnviarPedidoWhatsappModal e
// EnviarImagensWhatsappModal; `buscarCep` vivia dentro do wizard de
// empresas, presa ao estado daquele formulário. Aqui a busca devolve os
// campos em vez de gravá-los, então serve pra qualquer tela.

export function soDigitos(v: string): string {
  return (v ?? '').replace(/\D/g, '')
}

/**
 * (21) 98888-7777 — tira o 55 da frente porque número copiado do WhatsApp
 * vem com código do país, e o campo guarda o telefone como se digita aqui.
 */
export function formatarTelefone(v: string): string {
  const d = soDigitos(v).replace(/^55/, '').slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export function formatarCep(v: string): string {
  const d = soDigitos(v).slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

export function formatarCpfCnpj(v: string): string {
  const d = soDigitos(v).slice(0, 14)
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2')
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

export type EnderecoCep = {
  logradouro: string
  bairro: string
  cidade: string
  estado: string
}

/**
 * Consulta o ViaCEP. Devolve null quando o CEP não tem 8 dígitos, não
 * existe, ou a consulta falha — quem chama decide o que fazer, e o
 * cadastro nunca trava por causa de um serviço externo fora do ar.
 */
export async function buscarCep(cep: string): Promise<EnderecoCep | null> {
  const limpo = soDigitos(cep)
  if (limpo.length !== 8) return null
  try {
    const res = await fetch(`https://viacep.com.br/ws/${limpo}/json/`)
    const data = await res.json()
    if (data?.erro) return null
    return {
      logradouro: data.logradouro ?? '',
      bairro: data.bairro ?? '',
      cidade: data.localidade ?? '',
      estado: data.uf ?? '',
    }
  } catch {
    return null
  }
}

export const ESTADOS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]
