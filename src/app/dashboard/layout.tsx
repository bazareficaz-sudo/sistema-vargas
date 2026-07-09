import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/Sidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, role, empresas(nome)')
    .eq('id', user.id)
    .single()

  const empresaNome = (profile?.empresas as unknown as { nome: string } | null)?.nome ?? 'Minha Empresa'

  return (
    <div className="min-h-screen flex" style={{ background: '#f1f5f9' }}>
      <Sidebar empresa={empresaNome} />
      <main
        id="main-content"
        className="flex-1 p-7 overflow-auto min-h-screen transition-[margin] duration-300"
        style={{ marginLeft: '15rem' }}
      >
        {children}
      </main>
    </div>
  )
}
