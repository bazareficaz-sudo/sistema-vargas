import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadPlanData } from '@/lib/plans/access'
import { permissoesEfetivas, buscarExcecoes, telasBloqueadas, type Papel } from '@/lib/auth/permissoes'
import { podeAbrirTela, telaDoPathname } from '@/lib/auth/telas'
import type { PlanData } from '@/lib/plans/types'
import { provisionarEmpresaEUsuario } from '@/lib/signup/provisionar'
import PlanProvider from '@/components/plan/PlanProvider'
import DashboardShell from '@/components/DashboardShell'
import { perfilDaSessao, empresasDoUsuario } from '@/lib/auth/empresaAtiva'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let profile = await perfilDaSessao(supabase, user.id, 'empresa_id, role, status, empresas(nome)')

  // Rede de segurança: se o usuário se cadastrou pelo site mas ainda não tem
  // perfil (ex.: confirmou o e-mail e entrou direto por /login em vez de
  // passar pelo /auth/callback, que é onde isso normalmente aconteceria),
  // completa o provisionamento aqui — primeira vez que abre o painel.
  if (!profile && user.user_metadata?.pending_signup) {
    await provisionarEmpresaEUsuario(createAdminClient(), user.id, user.user_metadata)
    profile = await perfilDaSessao(supabase, user.id, 'empresa_id, role, status, empresas(nome)')
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

  // Estas quatro leituras não dependem uma da outra — só do usuário e da
  // empresa, que já temos. Em sequência eram quatro idas ao banco somadas
  // em TODA carga de tela do painel; juntas, custam o tempo da mais lenta.
  //
  //  · empresas que este usuário pode operar (com uma só, o seletor nem aparece)
  //  · acesso de suporte mais recente (vira o aviso do SupportModeBanner)
  //  · exceções de permissão configuradas em Usuários → Permissões
  //  · plano/assinatura da empresa
  const [empresasDoOperador, { data: suporteRow }, excecoes, planoBase] = await Promise.all([
    empresasDoUsuario(supabase, user.id),
    supabase
      .from('suporte_acessos')
      .select('id, motivo, status, expira_em, encerrado_em, empresas(nome, nome_fantasia)')
      .eq('usuario_alvo_id', user.id)
      .order('iniciado_em', { ascending: false })
      .limit(1)
      .maybeSingle(),
    buscarExcecoes(supabase, user.id),
    loadPlanData(empresaId, user.id),
  ])

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
  const permissoes = permissoesEfetivas((profile?.role ?? null) as Papel | null, excecoes)
  const bloqueadas = telasBloqueadas(excecoes)
  const planData = {
    ...planoBase,
    role: profile?.role ?? null, permissoes, suporte, telasBloqueadas: bloqueadas,
  }

  // Controle de acesso por tela. Este layout é por onde toda página do
  // dashboard passa, e o proxy manda o endereço no cabeçalho — é o único
  // ponto onde dá para checar as 71 telas sem editar as 71.
  //
  // Esconder o item do menu não basta: o endereço digitado na barra continua
  // abrindo a tela. Por isso a decisão acontece aqui, no servidor, e não no
  // componente que desenha o menu.
  const pathname = (await headers()).get('x-pathname') ?? ''
  if (pathname && !podeAbrirTela(pathname, excecoes)) {
    const tela = telaDoPathname(pathname)
    return (
      <PlanProvider data={planData}>
        <DashboardShell empresa={empresaNome} empresas={empresasDoOperador} empresaAtivaId={empresaId}>
          <div className="p-6 max-w-lg">
            <div className="bg-white border border-slate-200 rounded-2xl p-6">
              <span className="text-3xl block mb-2">🔒</span>
              <h1 className="text-lg font-semibold text-slate-900">Sem acesso a esta tela</h1>
              <p className="text-sm text-slate-600 mt-1">
                {tela ? <>A tela <b>{tela.label}</b> não está liberada para o seu usuário.</> : 'Esta tela não está liberada para o seu usuário.'}
              </p>
              <p className="text-xs text-slate-500 mt-3">
                Quem libera é um administrador, em Configurações → Usuários → Permissões.
              </p>
              <Link href="/dashboard"
                className="inline-block mt-4 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm hover:bg-slate-700">
                Voltar para a Visão Geral
              </Link>
            </div>
          </div>
        </DashboardShell>
      </PlanProvider>
    )
  }

  return (
    <PlanProvider data={planData}>
      <DashboardShell empresa={empresaNome} empresas={empresasDoOperador} empresaAtivaId={empresaId}>{children}</DashboardShell>
    </PlanProvider>
  )
}
