// "Sair na virada do dia": a sessão é de um dia anterior?
//
// O dia do login vem do SERVIDOR (`last_sign_in_at` do usuário no Supabase),
// e não de uma marca guardada no navegador. A marca no navegador sobrava de
// um login antigo quando a pessoa saía pelo botão "Sair" (só o logout
// automático a apagava): no dia seguinte ela entrava e era derrubada ~20 s
// depois com "Sua sessão do dia anterior expirou".

/** AAAA-MM-DD no fuso do navegador. */
export function diaLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * true quando o login foi feito num dia anterior ao de `agora`.
 * Sem data de login (ou data inválida), não derruba ninguém.
 */
export function loginDeOutroDia(loginEm: string | null | undefined, agora: Date = new Date()): boolean {
  if (!loginEm) return false
  const login = new Date(loginEm)
  if (Number.isNaN(login.getTime())) return false
  return diaLocal(login) < diaLocal(agora)
}
