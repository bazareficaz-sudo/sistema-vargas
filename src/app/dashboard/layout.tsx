import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadPlanData } from '@/lib/plans/access'
import { permissoesEfetivas, buscarExcecoes, type Papel } from '@/lib/auth/permissoes'
import type { PlanData } from '@/lib/plans/types'
import { provisionarEmpresaEUsuario } from '@/lib/signup/provisionar'
import PlanProvider from '@/components/plan/PlanProvider'
import DashboardShell from '@/components/DashboardShell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, role, status, empresas(nome)')
    .eq('id', user.id)
    .single()

  // Rede de segurança: se o usuário se cadastrou pelo site mas ainda não tem
  // perfil (ex.: confirmou o e-mail e entrou direto por /login em vez de
  // passar pelo /auth/callback, que é onde isso normalmente aconteceria),
  // completa o provisionamento aqui — primeira vez que abre o painel.
  if (!profile && user.user_metadata?.pending_signup) {
    await provisionarEmpresaEUsuario(createAdminClient(), user.id, user.user_metadata)
    const retry = await supabase
      .from('profiles')
      .select('empresa_id, role, status, empresas(nome)')
      .eq('id', user.id)
      .single()
    profile = retry.data
  }

  // Usuário bloqueado/inativado por um admin perde acesso na hora — não
  // basta esconder menu, tem que deslogar de verdade.
  if (profile?.status === 'inativo' || profile?.status === 'bloqueado') {
    await supabase.auth.signOut()
    redirect('/login?erro=acesso_bloqueado')
  }

  // Primeiro login depois de aceitar um convite — promove pra ativo.
  if (profile?.status === 'convite_pendente') {
    await supabase.from('profiles').update({ status: 'ativo' }).eq('id', user.id)
    profile.status = 'ativo'
  }

  const empresaId = profile?.empresa_id ?? ''
  const empresaNome = (profile?.empresas as unknown as { nome: string } | null)?.nome ?? 'Minha Empresa'

  // Acesso de suporte — pega a sessão mais recente pra esse usuário. Se
  // estiver ativa mas vencida, encerra e desloga (mesma lógica do bloqueio
  // acima). Se estiver ativa e válida, ou foi encerrada há menos de 24h,
  // vira o aviso mostrado no dashboard (SupportModeBanner).
  const { data: suporteRow } = await supabase
    .from('suporte_acessos')
    .select('id, motivo, status, expira_em, encerrado_em, empresas(nome, nome_fantasia)')
    .eq('usuario_alvo_id', user.id)
    .order('iniciado_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  let suporte: PlanData['suporte'] = null
  if (suporteRow?.status === 'ativa') {
    if (new Date(suporteRow.expira_em) < new Date()) {
      await supabase.from('suporte_acessos').update({ status: 'expirada' }).eq('id', suporteRow.id)
      await supabase.auth.signOut()
      redirect('/login')
    }
    const empresaSuporte = suporteRow.empresas as unknown as { nome: string; nome_fantasia: string | null } | null
    suporte = {
      sessionId: suporteRow.id, tipo: 'ativa', motivo: suporteRow.motivo,
      empresaNome: empresaSuporte?.nome_fantasia ?? empresaSuporte?.nome ?? '',
      expiraEm: suporteRow.expira_em, encerradoEm: null,
    }
  } else if (suporteRow?.status === 'encerrada' && suporteRow.encerrado_em) {
    const horasDesde = (Date.now() - new Date(suporteRow.encerrado_em).getTime()) / 3600000
    if (horasDesde < 24) {
      const empresaSuporte = suporteRow.empresas as unknown as { nome: string; nome_fantasia: string | null } | null
      suporte = {
        sessionId: suporteRow.id, tipo: 'encerrada_recente', motivo: suporteRow.motivo,
        empresaNome: empresaSuporte?.nome_fantasia ?? empresaSuporte?.nome ?? '',
        expiraEm: null, encerradoEm: suporteRow.encerrado_em,
      }
    }
  }

  // Permissoes efetivas resolvidas uma vez por carga do dashboard: papel do
  // usuario mais as excecoes configuradas em Usuarios -> Permissoes.
  const excecoes = await buscarExcecoes(supabase, user.id)
  const permissoes = permissoesEfetivas((profile?.role ?? null) as Papel | null, excecoes)
  const planData = { ...(await loadPlanData(empresaId, user.id)), role: profile?.role ?? null, permissoes, suporte }

  return (
    <PlanProvider data={planData}>
      <DashboardShell empresa={empresaNome}>{children}</DashboardShell>
    </PlanProvider>
  )
}
