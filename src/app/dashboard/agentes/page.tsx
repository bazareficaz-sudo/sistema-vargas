import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import AgentesClient, { type AgenteNaVitrine } from '@/components/agentes/AgentesClient'

export const dynamic = 'force-dynamic'

export default async function AgentesPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const perfil = await perfilDaSessao(sb, user!.id)
  const empresaId = perfil?.empresa_id ?? ''

  // O plano decide O QUE APARECE. Sem assinatura ativa nao ha oferta, e a
  // vitrine fica vazia em vez de mostrar agentes que nao dao para contratar.
  const { data: assinatura } = await sb.from('subscriptions')
    .select('plan_id').eq('empresa_id', empresaId).eq('status', 'active')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  const [{ data: agentes }, { data: ofertas }, { data: contratos }] = await Promise.all([
    // So publicados e ativos: um agente em rascunho no saas-admin nao pode
    // aparecer para cliente nenhum.
    sb.from('ia_agentes').select('id, nome, area, descricao, icone, preco_mensal')
      .eq('publicado', true).eq('ativo', true).order('ordem').order('nome'),
    assinatura?.plan_id
      ? sb.from('plano_agentes').select('agente_id, incluso, dias_carencia').eq('plan_id', assinatura.plan_id)
      : Promise.resolve({ data: [] as { agente_id: string; incluso: boolean; dias_carencia: number }[] }),
    sb.from('empresa_agentes').select('agente_id, status, instrucoes, teste_ate').eq('empresa_id', empresaId),
  ])

  const porOferta = new Map((ofertas ?? []).map(o => [o.agente_id, o]))
  const porContrato = new Map((contratos ?? []).map(c => [c.agente_id, c]))

  const vitrine: AgenteNaVitrine[] = (agentes ?? []).map(a => ({
    id: a.id, nome: a.nome, area: a.area, descricao: a.descricao,
    icone: a.icone, preco_mensal: Number(a.preco_mensal ?? 0),
    oferta: porOferta.get(a.id)
      ? { incluso: !!porOferta.get(a.id)!.incluso, dias_carencia: Number(porOferta.get(a.id)!.dias_carencia ?? 0) }
      : null,
    contrato: (porContrato.get(a.id) ?? null) as AgenteNaVitrine['contrato'],
  }))

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-900">Agentes de IA</h1>
      <p className="mb-5 mt-1 text-sm text-gray-500">
        Assistentes especializados por área. Cada um consulta os dados da sua empresa e responde
        dizendo de onde veio cada número.
      </p>
      <AgentesClient agentes={vitrine} />
    </div>
  )
}
