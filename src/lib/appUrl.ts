// Endereço público do sistema — fonte única.
//
// Existia espalhado como `process.env.NEXT_PUBLIC_APP_URL ?? 'https://...'` em
// cinco arquivos. Na troca de domínio de vargasnexus.com.br para
// sistemavargas.com.br isso significaria cinco lugares para lembrar, e o que
// ficasse para trás só apareceria quando um convite de usuário caísse em
// domínio morto ou a Shopee recusasse o retorno do OAuth — longe da causa.
//
// A variável de ambiente continua mandando. O valor abaixo é só a rede de
// segurança para quando ela não estiver configurada.
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.sistemavargas.com.br'

/** URL absoluta a partir de um caminho começando com "/". */
export function urlDoApp(caminho: string): string {
  return `${APP_URL}${caminho}`
}
