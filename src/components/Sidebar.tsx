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
  type NavItem,
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
  const [busca, setBusca] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // Painel abre ao passar o mouse sobre o ícone do rail e fecha ao clicar
  // (num item ou no próprio ícone) ou quando o mouse sai da área do rail +
  // painel. O timeout evita fechar por engano no instante em que o cursor
  // atravessa a borda entre o rail e o flyout.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function abrirPainel(id: PainelId) {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setPainel(id)
  }
  function agendarFechamento() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setPainel(null), 200)
  }
  function cancelarFechamento() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
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

  // Fecha o painel ao trocar de rota
  useEffect(() => { setPainel(null) }, [pathname])

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

  const resultadosBusca = useMemo(() => {
    if (!busca.trim()) return []
    const q = busca.toLowerCase()
    return ALL_ITEMS.filter(it => it.label.toLowerCase().includes(q) || it.href.toLowerCase().includes(q)).slice(0, 10)
  }, [busca])

  const favItems = ALL_ITEMS.filter(it => favorites.includes(it.href))
  const recentItems = recentes.map(r => ALL_ITEMS.find(it => it.href === r.href)).filter((it): it is NavItem & { group: string } => !!it)

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

  const grupoAberto = groupsData.find(g => g.group.id === painel)

  return (
    <>
      <aside
        onMouseLeave={agendarFechamento}
        className="w-[72px] flex flex-col items-center h-screen fixed left-0 top-0 z-40 bg-white border-r border-slate-200"
      >
        {/* Logo */}
        <Link href="/dashboard" title="Sistema Vargas" className="flex-shrink-0 mt-3 mb-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)' }}>
            <span className="text-white font-bold text-sm">V</span>
          </div>
        </Link>
        <p className="text-[9px] text-slate-400 text-center px-1 mb-2 leading-tight truncate w-full" title={empresa}>{empresa}</p>

        <div className="flex-1 w-full overflow-y-auto overflow-x-hidden flex flex-col items-center gap-1 px-2 pb-2">
          <RailButton icon={<IconSearch className="w-5 h-5" />} label="Buscar" active={painel === 'busca'}
            onMouseEnter={() => abrirPainel('busca')} onClick={() => setPainel(null)} />
          {favItems.length > 0 && (
            <RailButton icon={<IconStar className="w-5 h-5" />} label="Favoritos" active={painel === 'favoritos'}
              onMouseEnter={() => abrirPainel('favoritos')} onClick={() => setPainel(null)} />
          )}
          {recentItems.length > 0 && (
            <RailButton icon={<IconClock className="w-5 h-5" />} label="Recentes" active={painel === 'recentes'}
              onMouseEnter={() => abrirPainel('recentes')} onClick={() => setPainel(null)} />
          )}

          <div className="w-8 h-px bg-slate-200 my-1.5 flex-shrink-0" />

          {groupsData.map(({ group, hasActive }) => {
            const Icon = GROUP_ICONS[group.id]
            return (
              <RailButton key={group.id}
                icon={Icon ? <Icon className="w-5 h-5" /> : <span className="w-5 h-5" />}
                label={group.label}
                active={painel === group.id || hasActive}
                onMouseEnter={() => abrirPainel(group.id)}
                onClick={() => setPainel(null)}
              />
            )
          })}
        </div>

        <div className="flex-shrink-0 w-full flex flex-col items-center gap-1 px-2 pt-1 border-t border-slate-100">
          <PlanBannerSidebar collapsed />
          <RailLink href="/blog" icon={<IconNews className="w-5 h-5" />} label="Novidades" />
          <RailButton icon={<IconLogout className="w-5 h-5" />} label="Sair" onClick={logout} />
        </div>
      </aside>

      {/* ── Painel lateral (flyout) ─────────────────────────────────────────── */}
      {painel && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setPainel(null)} />
          <div
            onMouseEnter={cancelarFechamento}
            onMouseLeave={agendarFechamento}
            className="fixed left-[72px] top-0 h-screen w-72 bg-white border-r border-slate-200 shadow-2xl z-40 flex flex-col"
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
                    <Link key={r.href} href={r.href} onClick={() => setPainel(null)}
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
              <PainelLista titulo="Favoritos" itens={favItems} isActive={isActive} favorites={favorites} onToggleFav={toggleFav} onNavegar={() => setPainel(null)} />
            )}

            {painel === 'recentes' && (
              <PainelLista titulo="Recentes" itens={recentItems} isActive={isActive} favorites={favorites} onToggleFav={toggleFav} onNavegar={() => setPainel(null)} />
            )}

            {grupoAberto && (
              <div className="flex flex-col h-full">
                <div className="px-4 py-4 border-b border-slate-100 flex-shrink-0">
                  <p className="text-sm font-semibold text-slate-900">{grupoAberto.group.label}</p>
                </div>
                <div className="flex-1 overflow-y-auto px-2 py-2">
                  {grupoAberto.visibleItems.map(it => (
                    <NavLink key={it.href} item={it} active={isActive(it.href)}
                      isFav={favorites.includes(it.href)} onToggleFav={() => toggleFav(it.href)} onNavegar={() => setPainel(null)} />
                  ))}
                  {grupoAberto.visibleSubGroups.map(sg => (
                    <div key={sg.label} className="mt-3 mb-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2.5 mb-1">{sg.label}</p>
                      {sg.items.map(it => (
                        <NavLink key={it.href} item={it} active={isActive(it.href)}
                          isFav={favorites.includes(it.href)} onToggleFav={() => toggleFav(it.href)} onNavegar={() => setPainel(null)} />
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

function RailButton({ icon, label, active = false, onClick, onMouseEnter }: {
  icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; onMouseEnter?: () => void
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      title={label}
      className={`w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl transition-colors ${
        active ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
      }`}
    >
      {icon}
    </button>
  )
}

function RailLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} title={label}
      className="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
      {icon}
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
