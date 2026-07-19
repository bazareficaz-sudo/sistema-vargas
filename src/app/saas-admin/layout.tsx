import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function SaasAdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: admin } = await supabase
    .from('system_admins')
    .select('nome, nivel')
    .eq('id', user.id)
    .eq('ativo', true)
    .single()

  if (!admin) redirect('/dashboard')

  const NAV = [
    { href: '/saas-admin', label: '📊 Visão Geral', exact: true },
    { href: '/saas-admin/clientes', label: '🏢 Clientes' },
    { href: '/saas-admin/planos', label: '📋 Planos' },
    { href: '/saas-admin/fiscal', label: '🧾 Fiscal' },
    { href: '/saas-admin/blog', label: '📰 Blog' },
  ]

  return (
    <div className="min-h-screen flex bg-slate-950">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
        <div className="px-4 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-purple-600 flex items-center justify-center text-white text-xs font-bold">SA</div>
            <div>
              <p className="text-xs font-bold text-white">Admin SaaS</p>
              <p className="text-[10px] text-slate-400">{admin.nivel}</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV.map(n => (
            <Link key={n.href} href={n.href}
              className="block px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white rounded-lg transition-colors">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-slate-800">
          <Link href="/dashboard" className="text-xs text-slate-500 hover:text-slate-300">
            ← Voltar ao sistema
          </Link>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">{children}</div>
      </main>
    </div>
  )
}
