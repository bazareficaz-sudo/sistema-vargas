'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import TopMenu from '@/components/TopMenu'
import { PlanAlertBanner } from '@/components/plan/PlanBanner'

export type LayoutMenu = 'sidebar' | 'topbar'
export const LAYOUT_MENU_KEY = 'layout_menu'
export const LAYOUT_MENU_EVENT = 'layout-menu-changed'

function readLayoutPreference(): LayoutMenu {
  if (typeof document === 'undefined') return 'sidebar'
  return document.documentElement.dataset.layoutMenu === 'topbar' ? 'topbar' : 'sidebar'
}

export default function DashboardShell({ empresa, children }: { empresa: string; children: React.ReactNode }) {
  const [layout, setLayout] = useState<LayoutMenu>(() => readLayoutPreference())

  useEffect(() => {
    function onChange() { setLayout(readLayoutPreference()) }
    window.addEventListener(LAYOUT_MENU_EVENT, onChange)
    return () => window.removeEventListener(LAYOUT_MENU_EVENT, onChange)
  }, [])

  if (layout === 'topbar') {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: '#f1f5f9' }} suppressHydrationWarning>
        <TopMenu empresa={empresa} />
        <main
          id="main-content"
          className="flex-1 overflow-auto min-h-screen flex flex-col"
          style={{ marginLeft: 0, paddingTop: '3.5rem' }}
        >
          <PlanAlertBanner />
          <div className="flex-1 p-7">{children}</div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex" style={{ background: '#f1f5f9' }} suppressHydrationWarning>
      <Sidebar empresa={empresa} />
      <main
        id="main-content"
        className="flex-1 overflow-auto min-h-screen transition-[margin] duration-300 flex flex-col"
        style={{ marginLeft: '15rem' }}
      >
        <PlanAlertBanner />
        <div className="flex-1 p-7">{children}</div>
      </main>
    </div>
  )
}
