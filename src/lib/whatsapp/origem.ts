// ORIGEM DO CONTATO: código da publicação do Vargas Marketing na mensagem do
// cliente (migração 20261018120000_whatsapp_origem.sql).
//
// O link do post já traz "… (código T7K2) …"; no Instagram o cliente digita.
// Formato fixo, o mesmo do Marketing (src/lib/ref-code.ts lá): letra, dígito,
// letra, dígito, sem I, O, 0 e 1 — palavra solta, maiúscula ou minúscula.
// O ERP não conhece a lista de códigos: o Marketing descarta o que não é dele.

const CODIGO = /(?<![\p{L}\p{N}])([A-HJ-NP-Z][2-9][A-HJ-NP-Z][2-9])(?![\p{L}\p{N}])/iu
export const FORMATO_CODIGO = /^[A-HJ-NP-Z][2-9][A-HJ-NP-Z][2-9]$/

/** Primeiro código de publicação no texto, em maiúsculas; nulo se não houver. */
export function codigoDeOrigem(texto: string | null | undefined): string | null {
  const m = CODIGO.exec(String(texto ?? ''))
  return m ? m[1].toUpperCase() : null
}

type Admin = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** Grava a origem se o contato ainda não tem uma (só a primeira vale). */
export async function gravarOrigem(admin: Admin, contatoId: string, codigo: string, agora: Date = new Date()) {
  if (!FORMATO_CODIGO.test(codigo)) return
  await admin.from('whatsapp_contatos').update({ origem_codigo: codigo, origem_em: agora.toISOString() })
    .eq('id', contatoId).is('origem_codigo', null)
}
