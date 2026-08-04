// Resolve QUAL tela um endereço representa, para o controle de acesso por tela.
//
// A lista de telas do sistema já existe: é o menu (`nav-config`). Manter uma
// segunda lista de "telas protegidas" só criaria a chance de as duas
// divergirem — tela nova entraria no menu e ficaria fora do controle sem
// ninguém perceber.

import { allItems, type NavItem } from '@/components/nav-config'
import { telasBloqueadas, type Excecoes } from './permissoes'

export type TelaDoMenu = NavItem & { group: string }

/**
 * Acha a tela do menu que corresponde ao endereço aberto.
 *
 * Casa pelo prefixo mais longo, porque endereço de detalhe não está no menu:
 * `/dashboard/entradas-xml/abc-123` pertence à tela `/dashboard/entradas-xml`.
 * Sem isso, bloquear a listagem deixaria o detalhe aberto — e o detalhe é
 * justamente onde estão os dados.
 */
export function telaDoPathname(pathname: string): TelaDoMenu | null {
  let melhor: TelaDoMenu | null = null
  for (const item of allItems()) {
    if (pathname !== item.href && !pathname.startsWith(`${item.href}/`)) continue
    if (!melhor || item.href.length > melhor.href.length) melhor = item
  }
  return melhor
}

/**
 * O usuário pode abrir este endereço?
 *
 * Endereço que não corresponde a nenhuma tela do menu passa. É deliberado:
 * este controle esconde telas, e o que não está no menu não é uma tela que o
 * gestor escolheu esconder. Ação sensível continua protegida pela permissão da
 * própria rota de API, que é onde a validação de verdade acontece.
 */
export function podeAbrirTela(pathname: string, excecoes: Excecoes = {}): boolean {
  const tela = telaDoPathname(pathname)
  if (!tela) return true
  return !telasBloqueadas(excecoes).includes(tela.href)
}

/** Telas agrupadas como aparecem no menu — para a tela de permissões. */
export function telasPorGrupo(): { grupo: string; telas: TelaDoMenu[] }[] {
  const mapa = new Map<string, TelaDoMenu[]>()
  for (const item of allItems()) {
    const atual = mapa.get(item.group) ?? []
    // O mesmo endereço pode aparecer duas vezes no menu (atalho + item do
    // grupo). Uma linha só na tela de permissões, senão o gestor marca uma e
    // acha que a outra ficou de fora.
    if (atual.some(t => t.href === item.href)) continue
    atual.push(item)
    mapa.set(item.group, atual)
  }
  return [...mapa.entries()].map(([grupo, telas]) => ({ grupo, telas }))
}
