'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'

const nav = [
  {
    section: 'Principal',
    items: [
      { href: '/dashboard',                    label: 'Dashboard',        icon: '⊞' },
      { href: '/pdv',                          label: 'PDV',              icon: '🖥' },
      { href: '/dashboard/vendas',             label: 'Vendas',           icon: '🛒' },
      { href: '/dashboard/orcamentos',         label: 'Orçamentos',       icon: '📋' },
    ]
  },
  {
    section: 'Financeiro',
    items: [
      { href: '/dashboard/contas-receber',     label: 'A Receber',        icon: '💰' },
      { href: '/dashboard/creditos-clientes',  label: 'Créditos',         icon: '🎫' },
      { href: '/dashboard/cobranca',           label: 'Cobrança',         icon: '📞' },
    ]
  },
  {
    section: 'Cadastros',
    items: [
      { href: '/dashboard/produtos',    label: 'Produtos',    icon: '📦' },
      { href: '/dashboard/categorias',  label: 'Categorias',  icon: '🗂' },
      { href: '/dashboard/marcas',      label: 'Marcas',      icon: '🏷' },
      { href: '/dashboard/clientes',    label: 'Clientes',    icon: '👥' },
      { href: '/dashboard/vendedores',  label: 'Vendedores',  icon: '🤝' },
    ]
  },
  {
    section: 'Comercial',
    items: [
      { href: '/dashboard/incentivos', label: 'Incentivos',  icon: '🏆' },
    ]
  },
  {
    section: 'Gestão',
    items: [
      { href: '/dashboard/precos',       label: 'Preços',       icon: '💲' },
      { href: '/dashboard/depositos',    label: 'Depósitos',    icon: '🏭' },
      { href: '/dashboard/inventarios',  label: 'Inventário',   icon: '🔢' },
      { href: '/dashboard/marketplaces', label: 'Marketplaces', icon: '🏪' },
    ]
  },
  {
    section: 'Compras',
    items: [
      { href: '/dashboard/fornecedores', label: 'Fornecedores',    icon: '🏭' },
      { href: '/dashboard/entradas',     label: 'Entradas',        icon: '📥' },
      { href: '/dashboard/entradas-xml', label: 'Entrada XML/NF-e',icon: '📄' },
      { href: '/dashboard/contas-pagar', label: 'Contas a Pagar',  icon: '💳' },
    ]
  },
  {
    section: 'Config',
    items: [
      { href: '/dashboard/empresas',                    label: 'Empresas',      icon: '🏢' },
      { href: '/dashboard/terminais',                   label: 'Terminais PDV', icon: '🖥️' },
      { href: '/dashboard/configuracoes/integracoes',   label: 'Integrações',   icon: '🔌' },
    ]
  },
]

export default function Sidebar({ empresa }: { empresa: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const [menuAberto, setMenuAberto] = useState(false)

  async function logout() {
    const sb = createClient()
    await sb.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === href
    return pathname.startsWith(href)
  }

  return (
    <aside className="w-56 flex flex-col h-screen fixed left-0 top-0 shadow-xl"
      style={{ background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)' }}>

      {/* Logo */}
      <div className="px-4 py-4 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}>
            <span className="text-white font-bold text-sm">V</span>
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-tight">Sistema Vargas</p>
            <p className="text-slate-400 text-xs truncate max-w-[120px]">{empresa}</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2.5 py-3 overflow-y-auto">
        {nav.map(group => (
          <div key={group.section} className="mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest px-2 mb-1.5">
              {group.section}
            </p>
            <div className="space-y-0.5">
              {group.items.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-150 ${
                    isActive(item.href)
                      ? 'text-white font-medium shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-white/8'
                  }`}
                  style={isActive(item.href) ? {
                    background: 'linear-gradient(90deg, rgba(59,130,246,0.25) 0%, rgba(99,102,241,0.1) 100%)',
                    borderLeft: '3px solid #3b82f6',
                    paddingLeft: '9px',
                  } : {}}
                >
                  <span className="text-base leading-none w-4 text-center">{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Rodapé */}
      <div className="px-2.5 py-3 border-t border-white/10">
        <button
          onClick={logout}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/8 transition-all"
        >
          <span className="text-base w-4 text-center">↩</span>
          Sair
        </button>
      </div>
    </aside>
  )
}
