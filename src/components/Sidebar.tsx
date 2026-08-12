'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePlan } from '@/contexts/PlanContext'
import { PlanBannerSidebar } from '@/components/plan/PlanBanner'
import { useLS } from '@/hooks/useLS'
import { GROUP_ICONS, IconClock, IconLogout, IconNews, IconSearch, IconStar } from '@/components/nav-icons'
import {
  NAV, ALL_ITEMS, temModulo as temModuloBase, filtrarItens as filtrarItensBase, isActive as isActiveBase,
  telaBloqueada, type NavItem,
} from '@/components/nav-config'

// ─── Componente principal ─────────────────────────────────────────────────────
// Rail claro e fixo (sempre estreito) + painel lateral (flyout) que abre ao
// clicar num grupo — substitui o antigo modelo de "expandir a barra inteira +
// acordeão". Busca, favoritos e recentes viram só mais um painel, no mesmo
// mecanismo.

type PainelId = string | null // group.id | 'busca' | 'favoritos' | 'recentes' | null

export default function Sidebar({ empresa }: { empresa: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const plan = usePlan()

  function temModulo(modulo?: string) {
    return temModuloBase(plan, modulo)
  }
  function filtrarItens(items: NavItem[]) {
    return filtrarItensBase(plan, items)
  }
  function isActive(href: string) {
    return isActiveBase(pathname, href)
  }

  const [favorites, setFavorites] = useLS<string[]>('sb_favs', [])
  const [recentes, setRecentes] = useLS<{ href: string; label: string }[]>('sb_recents', [])
  const [painel, setPainel] = useState<PainelId>(null)
  const [railHover, setRailHover] = useState(false)
  // Gaveta do celular. O trilho de 72px é ótimo no desktop e péssimo num
  // aparelho de 360px, onde comeria 20% da largura o tempo todo.
  const [gaveta, setGaveta] = useState(false)
  // Dentro da gaveta o menu está sempre largo, então mostra os rótulos —
  // o trilho só de ícones existe pra economizar espaço no desktop.
  const expandido = railHover || gaveta
  const [busca, setBusca] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // Painel abre ao passar o mouse sobre o ícone do rail e fecha ao clicar
  // (num item ou no próprio ícone) ou quando o mouse sai da área do rail +
  // painel. O timeout evita fechar por engano no instante em que o cursor
  // atravessa a borda entre o rail e o flyout. `railHover` (o rail em si
  // alargando pra mostrar o texto de cada item, não só o ícone) usa o
  // mesmo timer — sempre abre/fecha junto com o flyout, pra não descolar
  // da posição do flyout (que passa a nascer na borda direita do rail
  // largo, não mais num "72px" fixo).
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function abrirPainel(id: PainelId) {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setPainel(id)
    setRailHover(true)
  }
  function agendarFechamento() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => { setPainel(null); setRailHover(false) }, 200)
  }
  function cancelarFechamento() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
  }
  // Ao navegar de verdade (clicar num link), fecha o painel E recolhe o
  // rail — diferente de clicar num ícone do rail só pra alternar o painel
  // (aí o mouse continua ali, não faz sentido recolher).
  function fecharNavegando() {
    setPainel(null)
    setRailHover(false)
  }

  // Registra página atual nos recentes
  useEffect(() => {
    const current = ALL_ITEMS.find(it => it.href === pathname || pathname.startsWith(it.href + '/'))
    if (!current) return
    setRecentes(
      [{ href: current.href, label: current.label }, ...recentes.filter(r => r.href !== current.href)].slice(0, 5)
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Fecha o painel e recolhe o rail ao trocar de rota (rede de segurança —
  // os cliques em links já chamam fecharNavegando() diretamente)
  useEffect(() => { setPainel(null); setRailHover(false) }, [pathname])

  useEffect(() => {
    if (painel === 'busca') setTimeout(() => searchRef.current?.focus(), 50)
  }, [painel])

  function toggleFav(href: string) {
    setFavorites(favorites.includes(href) ? favorites.filter(f => f !== href) : [...favorites, href])
  }

  async function logout() {
    const sb = createClient()
    await sb.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  // Busca, favoritos e recentes partem da lista completa — sem este filtro,
  // uma tela bloqueada some do menu mas reaparece por qualquer um dos três.
  const itensPermitidos = useMemo(
    () => ALL_ITEMS.filter(it => temModuloBase(plan, it.modulo) && !telaBloqueada(plan, it.href)),
    [plan],
  )

  const resultadosBusca = useMemo(() => {
    if (!busca.trim()) return []
    const q = busca.toLowerCase()
    return itensPermitidos.filter(it => it.label.toLowerCase().includes(q) || it.href.toLowerCase().includes(q)).slice(0, 10)
  }, [busca, itensPermitidos])

  const favItems = itensPermitidos.filter(it => favorites.includes(it.href))
  const recentItems = recentes.map(r => itensPermitidos.find(it => it.href === r.href)).filter((it): it is NavItem & { group: string } => !!it)

  // Metadados de cada grupo visível — usado tanto pro rail quanto pro conteúdo do flyout.
  const groupsData = useMemo(() => {
    return NAV.filter(group => temModulo(group.modulo)).map(group => {
      const visibleItems = filtrarItens(group.items ?? [])
      const visibleSubGroups = (group.subGroups ?? [])
        .map(sg => ({ ...sg, items: filtrarItens(sg.items) }))
        .filter(sg => sg.items.length > 0)
      const allGroupItems = [...visibleItems, ...visibleSubGroups.flatMap(sg => sg.items)]
      const hasActive = allGroupItems.some(it => isActive(it.href))
      return { group, visibleItems, visibleSubGroups, allGroupItems, hasActive }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }).filter(g => g.allGroupItems.length > 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, pathname])

  // Navegou: a gaveta tem que sair da frente sozinha.
  useEffect(() => { setGaveta(false) }, [pathname])

  const grupoAberto = groupsData.find(g => g.group.id === painel)

  return (
    <>
      {/* Barra do celular: só ela fica visível abaixo de md. O botão abre o
          mesmo menu de sempre — nenhum item foi duplicado ou reescrito. */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 z-50 bg-white border-b border-slate-200 flex items-center gap-3 px-3">
        <button
          onClick={() => setGaveta(true)}
          aria-label="Abrir menu"
          className="w-10 h-10 -ml-1 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 active:bg-slate-200"
        >
          <span className="flex flex-col gap-[3px]">
            <span className="block w-5 h-0.5 bg-current rounded" />
            <span className="block w-5 h-0.5 bg-current rounded" />
            <span className="block w-5 h-0.5 bg-current rounded" />
          </span>
        </button>
        <Link href="/dashboard" className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)' }}>
            <span className="text-white font-bold text-xs">V</span>
          </div>
          <span className="text-sm font-medium text-slate-700 truncate">{empresa}</span>
        </Link>
      </div>

      {/* Fundo escuro da gaveta. Fechar tocando fora é o gesto que todo
          aplicativo de celular tem — sem ele a pessoa procura um X. */}
      {gaveta && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setGaveta(false)} />
      )}

      <aside
        onMouseEnter={() => { cancelarFechamento(); setRailHover(true) }}
        onMouseLeave={agendarFechamento}
        className={`${railHover ? 'md:w-[216px]' : 'md:w-[72px]'} w-[272px] ${
          gaveta ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0 flex flex-col items-center h-screen fixed left-0 top-0 z-50 md:z-40 bg-white border-r border-slate-200 transition-transform md:transition-[width] duration-150 ease-out overflow-hidden`}
      >
        {/* Logo */}
        <div className={`flex-shrink-0 mt-3 mb-2 w-full flex items-center gap-2 px-[14px] ${expandido ? '' : 'justify-center'}`}>
          <Link href="/dashboard" title="Sistema Vargas" className="flex-shrink-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)' }}>
              <span className="text-white font-bold text-sm">V</span>
            </div>
          </Link>
          {expandido && <span className="text-sm font-semibold text-slate-700 truncate">Sistema Vargas</span>}
        </div>
        <p className={`text-[9px] text-slate-400 px-1 mb-2 leading-tight truncate w-full ${expandido ? 'text-left px-3' : 'text-center'}`} title={empresa}>{empresa}</p>

        <div className="flex-1 w-full overflow-y-auto overflow-x-hidden flex flex-col items-center gap-1 px-2 pb-2">
          <RailButton icon={<IconSearch className="w-5 h-5" />} label="Buscar" active={painel === 'busca'} expanded={expandido}
            onMouseEnter={() => abrirPainel('busca')} onClick={() => setPainel(null)} />
          {favItems.length > 0 && (
            <RailButton icon={<IconStar className="w-5 h-5" />} label="Favoritos" active={painel === 'favoritos'} expanded={expandido}
              onMouseEnter={() => abrirPainel('favoritos')} onClick={() => setPainel(null)} />
          )}
          {recentItems.length > 0 && (
            <RailButton icon={<IconClock className="w-5 h-5" />} label="Recentes" active={painel === 'recentes'} expanded={expandido}
              onMouseEnter={() => abrirPainel('recentes')} onClick={() => setPainel(null)} />
          )}

          <div className={`h-px bg-slate-200 my-1.5 flex-shrink-0 ${expandido ? 'w-full' : 'w-8'}`} />

          {groupsData.map(({ group, hasActive }) => {
            const Icon = GROUP_ICONS[group.id]
            return (
              <RailButton key={group.id}
                icon={Icon ? <Icon className="w-5 h-5" /> : <span className="w-5 h-5" />}
                label={group.label}
                active={painel === group.id || hasActive}
                expanded={expandido}
                onMouseEnter={() => abrirPainel(group.id)}
                onClick={() => setPainel(null)}
              />
            )
          })}
        </div>

        <div className="flex-shrink-0 w-full flex flex-col items-center gap-1 px-2 pt-1 border-t border-slate-100">
          <PlanBannerSidebar collapsed />
          <RailLink href="/blog" icon={<IconNews className="w-5 h-5" />} label="Novidades" expanded={expandido} />
          <RailButton icon={<IconLogout className="w-5 h-5" />} label="Sair" onClick={logout} expanded={expandido} />
        </div>
      </aside>

      {/* ── Painel lateral (flyout) ─────────────────────────────────────────── */}
      {painel && (
        <>
          <div className="fixed inset-0 z-30" onClick={fecharNavegando} />
          <div
            onMouseEnter={cancelarFechamento}
            onMouseLeave={agendarFechamento}
            className={`fixed top-0 h-screen w-72 bg-white border-r border-slate-200 shadow-2xl z-40 flex flex-col ${expandido ? 'left-[216px]' : 'left-[72px]'}`}
          >

            {painel === 'busca' && (
              <div className="p-4 flex flex-col h-full">
                <p className="text-sm font-semibold text-slate-900 mb-3">Buscar módulo</p>
                <input
                  ref={searchRef}
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="Digite o nome do módulo..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 mb-3"
                />
                <div className="flex-1 overflow-y-auto -mx-1">
                  {resultadosBusca.map(r => (
                    <Link key={r.href} href={r.href} onClick={fecharNavegando}
                      className={`flex flex-col px-3 py-2 mx-1 rounded-lg text-sm transition-colors ${isActive(r.href) ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                      <span className="font-medium">{r.label}</span>
                      <span className="text-xs text-slate-400">{r.group}</span>
                    </Link>
                  ))}
                  {busca && resultadosBusca.length === 0 && (
                    <p className="text-sm text-slate-400 text-center mt-4">Nenhum resultado para "{busca}"</p>
                  )}
                </div>
              </div>
            )}

            {painel === 'favoritos' && (
              <PainelLista titulo="Favoritos" itens={favItems} isActive={isActive} favorites={favorites} onToggleFav={toggleFav} onNavegar={fecharNavegando} />
            )}

            {painel === 'recentes' && (
              <PainelLista titulo="Recentes" itens={recentItems} isActive={isActive} favorites={favorites} onToggleFav={toggleFav} onNavegar={fecharNavegando} />
            )}

            {grupoAberto && (
              <div className="flex flex-col h-full">
                <div className="px-4 py-4 border-b border-slate-100 flex-shrink-0">
                  <p className="text-sm font-semibold text-slate-900">{grupoAberto.group.label}</p>
                </div>
                <div className="flex-1 overflow-y-auto px-2 py-2">
                  {grupoAberto.visibleItems.map(it => (
                    <NavLink key={it.href} item={it} active={isActive(it.href)}
                      isFav={favorites.includes(it.href)} onToggleFav={() => toggleFav(it.href)} onNavegar={fecharNavegando} />
                  ))}
                  {grupoAberto.visibleSubGroups.map(sg => (
                    <div key={sg.label} className="mt-3 mb-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2.5 mb-1">{sg.label}</p>
                      {sg.items.map(it => (
                        <NavLink key={it.href} item={it} active={isActive(it.href)}
                          isFav={favorites.includes(it.href)} onToggleFav={() => toggleFav(it.href)} onNavegar={fecharNavegando} />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}

// ─── Peças reutilizáveis ──────────────────────────────────────────────────────

function RailButton({ icon, label, active = false, expanded = false, onClick, onMouseEnter }: {
  icon: React.ReactNode; label: string; active?: boolean; expanded?: boolean; onClick: () => void; onMouseEnter?: () => void
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      title={expanded ? undefined : label}
      className={`h-11 flex-shrink-0 flex items-center rounded-xl transition-colors ${expanded ? 'w-full gap-3 px-2.5' : 'w-11 justify-center'} ${
        active ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
      }`}
    >
      <span className="flex-shrink-0 flex items-center justify-center w-5 h-5">{icon}</span>
      {expanded && <span className="text-sm truncate">{label}</span>}
    </button>
  )
}

function RailLink({ href, icon, label, expanded = false }: { href: string; icon: React.ReactNode; label: string; expanded?: boolean }) {
  return (
    <Link href={href} title={expanded ? undefined : label}
      className={`h-11 flex-shrink-0 flex items-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors ${expanded ? 'w-full gap-3 px-2.5' : 'w-11 justify-center'}`}>
      <span className="flex-shrink-0 flex items-center justify-center w-5 h-5">{icon}</span>
      {expanded && <span className="text-sm truncate">{label}</span>}
    </Link>
  )
}

function PainelLista({ titulo, itens, isActive, favorites, onToggleFav, onNavegar }: {
  titulo: string
  itens: NavItem[]
  isActive: (href: string) => boolean
  favorites: string[]
  onToggleFav: (href: string) => void
  onNavegar: () => void
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-4 border-b border-slate-100 flex-shrink-0">
        <p className="text-sm font-semibold text-slate-900">{titulo}</p>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {itens.map(it => (
          <NavLink key={it.href} item={it} active={isActive(it.href)}
            isFav={favorites.includes(it.href)} onToggleFav={() => onToggleFav(it.href)} onNavegar={onNavegar} />
        ))}
        {itens.length === 0 && <p className="text-sm text-slate-400 text-center mt-4 px-2">Nada por aqui ainda.</p>}
      </div>
    </div>
  )
}

function NavLink({ item, active, isFav, onToggleFav, onNavegar }: {
  item: NavItem
  active: boolean
  isFav: boolean
  onToggleFav: () => void
  onNavegar: () => void
}) {
  return (
    <div className="relative group">
      <Link
        href={item.href}
        onClick={onNavegar}
        className={`flex items-center px-2.5 py-2 rounded-lg text-sm transition-colors ${
          active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
        }`}
      >
        <span className="flex-1 truncate">{item.label}</span>
      </Link>
      <button
        onClick={e => { e.preventDefault(); onToggleFav() }}
        className={`absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity ${isFav ? '!opacity-100 text-amber-400' : 'text-slate-300 hover:text-amber-400'}`}
        title={isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
      >
        <IconStar className="w-3.5 h-3.5" filled={isFav} />
      </button>
    </div>
  )
}
