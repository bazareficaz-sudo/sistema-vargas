'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { usePlan } from '@/contexts/PlanContext'
import { NAV, ALL_ITEMS, temModulo as temModuloBase, filtrarItens as filtrarItensBase, isActive as isActiveBase } from '@/components/nav-config'

export default function TopMenu({ empresa }: { empresa: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const plan = usePlan()

  const [openId, setOpenId] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  function temModulo(modulo?: string) {
    return temModuloBase(plan, modulo)
  }
  function filtrarItens(items: Parameters<typeof filtrarItensBase>[1]) {
    return filtrarItensBase(plan, items)
  }
  function isActive(href: string) {
    return isActiveBase(pathname, href)
  }

  // Fecha dropdown ao trocar de página
  useEffect(() => { setOpenId(null) }, [pathname])

  // Fecha ao clicar fora ou pressionar Esc
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpenId(null)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenId(null)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEsc)
    }
  }, [])

  const resultados = useMemo(() => {
    if (!busca.trim()) return []
    const q = busca.toLowerCase()
    return ALL_ITEMS.filter(it =>
      it.label.toLowerCase().includes(q) || it.href.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [busca])

  async function logout() {
    const sb = createClient()
    await sb.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const grupos = NAV.filter(group => temModulo(group.modulo)).map(group => {
    const visibleItems = filtrarItens(group.items ?? [])
    const visibleSubGroups = group.subGroups?.map(sg => ({
      ...sg,
      items: filtrarItens(sg.items),
    })).filter(sg => sg.items.length > 0) ?? []
    const allGroupItems = [...visibleItems, ...visibleSubGroups.flatMap(sg => sg.items)]
    return { group, visibleItems, visibleSubGroups, allGroupItems }
  }).filter(g => g.allGroupItems.length > 0)

  return (
    <div
      ref={containerRef}
      className="fixed top-0 left-0 right-0 z-40 shadow-xl"
      style={{ background: 'linear-gradient(90deg,#0f172a 0%,#1e293b 100%)' }}
    >
      <div className="flex items-center gap-1 px-3 h-14">
        {/* Logo + empresa */}
        <div className="flex items-center gap-2.5 pr-3 mr-1 border-r border-white/10 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)' }}>
            <span className="text-white font-bold text-sm">V</span>
          </div>
          <div className="hidden sm:block min-w-0">
            <p className="text-white font-semibold text-xs leading-tight truncate">Sistema Vargas</p>
            <p className="text-slate-400 truncate" style={{ fontSize: 10 }}>{empresa}</p>
          </div>
        </div>

        {/* Grupos — rola horizontalmente se não couber */}
        <nav className="flex items-center gap-0.5 overflow-x-auto flex-1 min-w-0 h-full">
          {grupos.map(({ group, visibleItems, visibleSubGroups, allGroupItems }) => {
            const hasActive = allGroupItems.some(it => isActive(it.href))
            const isOpen = openId === group.id
            return (
              <div key={group.id} className="relative flex-shrink-0 h-full flex items-center">
                <button
                  onClick={() => setOpenId(isOpen ? null : group.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                    hasActive || isOpen ? 'text-white bg-white/10' : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span className="text-sm leading-none">{group.icon}</span>
                  <span>{group.label}</span>
                  <span className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} style={{ fontSize: 9 }}>▾</span>
                </button>

                {isOpen && (
                  <div className="absolute left-0 top-full mt-1 min-w-[220px] bg-slate-800 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 py-1.5">
                    {visibleItems.map(it => (
                      <Link key={it.href} href={it.href}
                        className={`flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
                          isActive(it.href) ? 'bg-white/10 text-white font-medium' : 'text-slate-300 hover:bg-white/8 hover:text-white'
                        }`}>
                        {it.icon && <span className="w-4 text-center flex-shrink-0">{it.icon}</span>}
                        <span className="truncate">{it.label}</span>
                      </Link>
                    ))}
                    {visibleSubGroups.map(sg => (
                      <div key={sg.label} className="mt-1 first:mt-0">
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest px-3 pt-1.5 pb-1">{sg.label}</p>
                        {sg.items.map(it => (
                          <Link key={it.href} href={it.href}
                            className={`flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
                              isActive(it.href) ? 'bg-white/10 text-white font-medium' : 'text-slate-300 hover:bg-white/8 hover:text-white'
                            }`}>
                            {it.icon && <span className="w-4 text-center flex-shrink-0">{it.icon}</span>}
                            <span className="truncate">{it.label}</span>
                          </Link>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* Busca */}
        <div className="relative flex-shrink-0 ml-1">
          <div className="flex items-center gap-2 bg-white/8 rounded-lg px-2.5 py-1.5 w-40 md:w-56">
            <span className="text-slate-400 text-sm">🔍</span>
            <input
              ref={searchRef}
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar módulo..."
              className="flex-1 min-w-0 bg-transparent text-white text-xs placeholder-slate-500 outline-none"
            />
            {busca && (
              <button onClick={() => setBusca('')} className="text-slate-400 hover:text-white text-xs flex-shrink-0">✕</button>
            )}
          </div>

          {resultados.length > 0 && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-slate-800 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
              {resultados.map(r => (
                <Link key={r.href} href={r.href}
                  onClick={() => setBusca('')}
                  className={`flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-white/10 transition-colors ${isActive(r.href) ? 'bg-white/10 text-white' : 'text-slate-300'}`}>
                  <span>{r.icon}</span>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{r.label}</p>
                    <p className="text-slate-500 truncate" style={{ fontSize: 10 }}>{r.group}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
          {busca && resultados.length === 0 && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-slate-800 border border-white/10 rounded-xl shadow-2xl p-3 z-50">
              <p className="text-xs text-slate-500 text-center">Nenhum resultado para "{busca}"</p>
            </div>
          )}
        </div>

        {/* Sair */}
        <button
          onClick={logout}
          title="Sair"
          className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-2 ml-1 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/8 transition-all"
        >
          <span className="text-sm leading-none">↩</span>
          <span className="hidden lg:inline">Sair</span>
        </button>
      </div>
    </div>
  )
}
