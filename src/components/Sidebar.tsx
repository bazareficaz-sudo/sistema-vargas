'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { usePlan } from '@/contexts/PlanContext'
import { PlanBannerSidebar } from '@/components/plan/PlanBanner'
import { useLS } from '@/hooks/useLS'
import {
  NAV, ALL_ITEMS, temModulo as temModuloBase, filtrarItens as filtrarItensBase, isActive as isActiveBase,
  type NavItem,
} from '@/components/nav-config'

// ─── Componente principal ─────────────────────────────────────────────────────

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

  const [collapsed, setCollapsed] = useLS<boolean>('sb_collapsed', false)
  const [openGroups, setOpenGroups] = useLS<Record<string, boolean>>('sb_open', {})
  const [favorites, setFavorites] = useLS<string[]>('sb_favs', [])
  const [recentes, setRecentes] = useLS<{ href: string; label: string; icon: string }[]>('sb_recents', [])
  const [busca, setBusca] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // Inicializa grupos abertos por padrão
  useEffect(() => {
    const stored = localStorage.getItem('sb_open')
    if (!stored) {
      const def: Record<string, boolean> = {}
      for (const g of NAV) def[g.id] = g.defaultOpen ?? false
      setOpenGroups(def)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Registra página atual nos recentes
  useEffect(() => {
    const current = ALL_ITEMS.find(it => it.href === pathname || pathname.startsWith(it.href + '/'))
    if (!current) return
    setRecentes(
      [{ href: current.href, label: current.label, icon: current.icon ?? '📄' }, ...recentes.filter(r => r.href !== current.href)].slice(0, 5)
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Ajusta margem do main ao recolher/expandir
  useEffect(() => {
    const main = document.getElementById('main-content')
    if (main) main.style.marginLeft = collapsed ? '3.5rem' : '15rem'
  }, [collapsed])

  // Ao digitar na busca, abre o sidebar se estiver colapsado
  function handleBusca(v: string) {
    setBusca(v)
    if (v && collapsed) setCollapsed(false)
  }

  // Resultados da busca
  const resultados = useMemo(() => {
    if (!busca.trim()) return []
    const q = busca.toLowerCase()
    return ALL_ITEMS.filter(it =>
      it.label.toLowerCase().includes(q) || it.href.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [busca])

  function toggleGroup(id: string) {
    setOpenGroups({ ...openGroups, [id]: !openGroups[id] })
  }

  function toggleFav(href: string) {
    setFavorites(favorites.includes(href)
      ? favorites.filter(f => f !== href)
      : [...favorites, href]
    )
  }

  function isActive(href: string) {
    return isActiveBase(pathname, href)
  }

  async function logout() {
    const sb = createClient()
    await sb.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const favItems = ALL_ITEMS.filter(it => favorites.includes(it.href))

  // ─── Render ───────────────────────────────────────────────────────────────

  const W = collapsed ? 'w-14' : 'w-60'

  return (
    <aside
      className={`${W} flex flex-col h-screen fixed left-0 top-0 shadow-xl z-40 transition-[width] duration-300 overflow-hidden`}
      style={{ background: 'linear-gradient(180deg,#0f172a 0%,#1e293b 100%)' }}
    >
      {/* ── Logo + collapse button ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-3 py-3.5 border-b border-white/10 flex-shrink-0">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)' }}>
          <span className="text-white font-bold text-sm">V</span>
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm leading-tight truncate">Sistema Vargas</p>
            <p className="text-slate-400 text-xs truncate">{empresa}</p>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:text-white hover:bg-white/10 transition-colors"
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          <span className="text-sm">{collapsed ? '›' : '‹'}</span>
        </button>
      </div>

      {/* ── Busca ─────────────────────────────────────────────────────────── */}
      {!collapsed && (
        <div className="px-3 py-2 border-b border-white/10 flex-shrink-0 relative">
          <div className="flex items-center gap-2 bg-white/8 rounded-lg px-2.5 py-1.5">
            <span className="text-slate-400 text-sm">🔍</span>
            <input
              ref={searchRef}
              value={busca}
              onChange={e => handleBusca(e.target.value)}
              placeholder="Buscar módulo..."
              className="flex-1 bg-transparent text-white text-xs placeholder-slate-500 outline-none"
            />
            {busca && (
              <button onClick={() => setBusca('')} className="text-slate-400 hover:text-white text-xs">✕</button>
            )}
          </div>

          {/* Resultados da busca */}
          {resultados.length > 0 && (
            <div className="absolute left-3 right-3 top-full mt-1 bg-slate-800 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
              {resultados.map(r => (
                <Link key={r.href} href={r.href}
                  onClick={() => setBusca('')}
                  className={`flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-white/10 transition-colors ${isActive(r.href) ? 'bg-white/10 text-white' : 'text-slate-300'}`}>
                  <span>{r.icon}</span>
                  <div>
                    <p className="font-medium">{r.label}</p>
                    <p className="text-slate-500" style={{ fontSize: 10 }}>{r.group}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
          {busca && resultados.length === 0 && (
            <div className="absolute left-3 right-3 top-full mt-1 bg-slate-800 border border-white/10 rounded-xl shadow-2xl p-3 z-50">
              <p className="text-xs text-slate-500 text-center">Nenhum resultado para "{busca}"</p>
            </div>
          )}
        </div>
      )}

      {/* ── Nav scrollable ─────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-2">

        {/* ── Favoritos ─────────────────────────────────────────────────── */}
        {!collapsed && favItems.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest px-2 mb-1">⭐ Favoritos</p>
            <div className="space-y-0.5">
              {favItems.map(it => (
                <NavLink key={it.href} item={it} active={isActive(it.href)} collapsed={collapsed}
                  isFav={true} onToggleFav={() => toggleFav(it.href)} />
              ))}
            </div>
          </div>
        )}

        {/* ── Recentes ──────────────────────────────────────────────────── */}
        {!collapsed && recentes.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest px-2 mb-1">🕐 Recentes</p>
            <div className="space-y-0.5">
              {recentes.map(it => (
                <NavLink key={it.href} item={it} active={isActive(it.href)} collapsed={collapsed}
                  isFav={favorites.includes(it.href)} onToggleFav={() => toggleFav(it.href)} />
              ))}
            </div>
          </div>
        )}

        {/* ── Grupos principais ─────────────────────────────────────────── */}
        {NAV.filter(group => temModulo(group.modulo)).map(group => {
          const visibleItems = filtrarItens(group.items ?? [])
          const visibleSubGroups = group.subGroups?.map(sg => ({
            ...sg,
            items: filtrarItens(sg.items),
          })).filter(sg => sg.items.length > 0) ?? []

          const allGroupItems = [
            ...visibleItems,
            ...visibleSubGroups.flatMap(sg => sg.items),
          ]
          if (allGroupItems.length === 0) return null

          const isOpen = openGroups[group.id] ?? group.defaultOpen ?? false
          const hasActive = allGroupItems.some(it => isActive(it.href))

          return (
            <div key={group.id} className="mb-1">
              {/* Cabeçalho do grupo */}
              <button
                onClick={() => { if (collapsed) setCollapsed(false); toggleGroup(group.id) }}
                title={collapsed ? group.label : undefined}
                className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-xs font-semibold uppercase tracking-widest transition-all ${
                  hasActive
                    ? 'text-white bg-white/8'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                }`}
              >
                <span className={`w-6 h-6 flex items-center justify-center rounded-md text-sm flex-shrink-0 ${hasActive ? group.color : 'bg-transparent'}`}>
                  {group.icon}
                </span>
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">{group.label}</span>
                    <span className={`transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} style={{ fontSize: 10 }}>›</span>
                  </>
                )}
              </button>

              {/* Itens do grupo */}
              {isOpen && !collapsed && (
                <div className="mt-0.5 ml-2 space-y-0.5">
                  {/* Itens diretos */}
                  {visibleItems.map(it => (
                    <NavLink key={it.href} item={it} active={isActive(it.href)} collapsed={false}
                      isFav={favorites.includes(it.href)} onToggleFav={() => toggleFav(it.href)} />
                  ))}

                  {/* Sub-grupos */}
                  {visibleSubGroups.map(sg => (
                    <div key={sg.label} className="mt-2 mb-1">
                      <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest px-2 mb-1">{sg.label}</p>
                      {sg.items.map(it => (
                        <NavLink key={it.href} item={it} active={isActive(it.href)} collapsed={false}
                          isFav={favorites.includes(it.href)} onToggleFav={() => toggleFav(it.href)} />
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* Tooltip lista quando colapsado + grupo ativo */}
              {collapsed && hasActive && (
                <div className="ml-1 mt-0.5 space-y-0.5">
                  {allGroupItems.filter(it => isActive(it.href)).map(it => (
                    <div key={it.href} className="w-1 h-1 rounded-full bg-blue-400 mx-auto" />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* ── Rodapé ─────────────────────────────────────────────────────────── */}
      <div className="px-2 py-2 border-t border-white/10 flex-shrink-0">
        <PlanBannerSidebar collapsed={collapsed} />
        <button
          onClick={logout}
          title="Sair"
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/8 transition-all"
        >
          <span className="text-base w-5 text-center flex-shrink-0">↩</span>
          {!collapsed && <span>Sair</span>}
        </button>
      </div>
    </aside>
  )
}

// ─── NavLink ──────────────────────────────────────────────────────────────────

function NavLink({
  item, active, collapsed, isFav, onToggleFav,
}: {
  item: NavItem
  active: boolean
  collapsed: boolean
  isFav: boolean
  onToggleFav: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="relative group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Link
        href={item.href}
        title={collapsed ? item.label : undefined}
        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all ${
          active
            ? 'text-white font-semibold'
            : 'text-slate-400 hover:text-white hover:bg-white/8'
        }`}
        style={active ? {
          background: 'linear-gradient(90deg,rgba(59,130,246,0.22) 0%,rgba(99,102,241,0.08) 100%)',
          borderLeft: '2px solid #3b82f6',
          paddingLeft: '6px',
        } : {}}
      >
        {item.icon && (
          <span className="text-sm w-4 text-center flex-shrink-0 leading-none">{item.icon}</span>
        )}
        {!collapsed && (
          <span className="flex-1 truncate">{item.label}</span>
        )}
      </Link>

      {/* Botão estrela — aparece no hover */}
      {!collapsed && hovered && (
        <button
          onClick={e => { e.preventDefault(); onToggleFav() }}
          className={`absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] transition-colors ${isFav ? 'text-yellow-400' : 'text-slate-600 hover:text-yellow-400'}`}
          title={isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        >
          ★
        </button>
      )}

      {/* Tooltip quando colapsado */}
      {collapsed && hovered && (
        <div className="fixed left-16 z-50 bg-slate-900 text-white text-xs px-3 py-1.5 rounded-lg shadow-xl border border-white/10 pointer-events-none whitespace-nowrap"
          style={{ top: 'var(--tooltip-y, 50%)' }}>
          {item.label}
        </div>
      )}
    </div>
  )
}
