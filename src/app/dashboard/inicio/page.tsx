import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { buscarExcecoes, telasBloqueadas } from '@/lib/auth/permissoes'
import { loadPlanData } from '@/lib/plans/access'
import { temModulo } from '@/components/nav-config'
import { ATALHOS_VENDEDOR, atalhosVisiveis, resumoDespacho, resumoOrcamentos } from '@/lib/inicio/inicioVendedor'
import InicioVendedorView from '@/components/inicio/InicioVendedorView'

export const dynamic = 'force-dynamic'

// Início do vendedor: para quem não vê a Visão Geral (que é do gestor), a
// entrada do sistema é esta — botões grandes para o trabalho do dia e o que
// está esperando por ele. Ver src/lib/inicio/inicioVendedor.ts.

const URL_CONVERSAS = '/dashboard/integracoes/whatsapp/conversas'
const URL_PEDIDOS = '/dashboard/pedidos-ecommerce'
const URL_ORCAMENTOS = '/dashboard/orcamentos'

// Mesmo recorte da tela de pedidos: em aberto, dos últimos 45 dias.
const FINALIZADOS_STATUS = '(enviado,entregue,cancelado,devolvido)'
const FINALIZADOS_ETAPA = '(concluido,cancelado,enviado)'

export default async function InicioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id, 'empresa_id, nome')
  const empresaId = profile?.empresa_id ?? ''

  const [plan, excecoes, { data: empresa }] = await Promise.all([
    loadPlanData(empresaId, user!.id),
    buscarExcecoes(supabase, user!.id),
    supabase.from('empresas').select('nome, nome_fantasia').eq('id', empresaId).maybeSingle(),
  ])
  const bloqueadas = new Set(telasBloqueadas(excecoes))
  const atalhos = atalhosVisiveis(ATALHOS_VENDEDOR, item => temModulo(plan, item.modulo) && !bloqueadas.has(item.href))
  const ve = (href: string) => atalhos.some(a => a.href === href)

  const agora = new Date()
  const hoje = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const desde = new Date(agora.getTime() - 45 * 86_400_000).toISOString()

  // Só consulta o que a pessoa pode abrir: número de uma tela bloqueada não
  // aparece, nem custa consulta.
  const [pedidos, conversas, orcamentos] = await Promise.all([
    ve(URL_PEDIDOS)
      ? supabase.from('marketplace_pedidos')
          .select('status, status_externo, etapa_interna, envio_substatus, prazo_postagem')
          .eq('empresa_id', empresaId)
          .not('status', 'in', FINALIZADOS_STATUS)
          .or(`etapa_interna.is.null,etapa_interna.not.in.${FINALIZADOS_ETAPA}`)
          .gte('data_pedido', desde)
          .limit(2000)
          .then(r => resumoDespacho(r.data ?? [], agora))
      : null,
    ve(URL_CONVERSAS)
      ? supabase.from('whatsapp_conversas').select('id', { count: 'exact', head: true })
          .eq('empresa_id', empresaId).neq('status', 'ignorado').not('ultima_atividade', 'is', null)
          .eq('aguardando', true)
          .then(r => r.count ?? 0)
      : null,
    ve(URL_ORCAMENTOS)
      ? supabase.from('orcamentos').select('status, validade').eq('empresa_id', empresaId).eq('status', 'aberto').limit(5000)
          .then(r => resumoOrcamentos(r.data ?? [], hoje))
      : null,
  ])

  return (
    <InicioVendedorView
      agora={agora}
      nome={String(profile?.nome ?? '')}
      nomeEmpresa={empresa?.nome_fantasia || empresa?.nome || ''}
      atalhos={atalhos}
      pedidos={pedidos}
      conversas={conversas}
      orcamentos={orcamentos}
    />
  )
}
