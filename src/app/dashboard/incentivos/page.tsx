import { createClient } from '@/lib/supabase/server'
import IncentivoClient from '@/components/incentivos/IncentivoClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function IncentivoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const profile = await perfilDaSessao(supabase, user!.id, 'empresa_id, role, tenant_id')

  const empresaId = profile?.empresa_id ?? ''

  const { data: planos } = await supabase
    .from('incentivo_planos')
    .select(`
      *,
      incentivo_regras(id, tipo, alvo_tipo, valor, ativo),
      incentivo_metas(id, nome, tipo, valor_meta, periodo),
      incentivo_bonus(id, nome, tipo, valor),
      incentivo_participantes(id, vendedor_id, todos_vendedores)
    `)
    .eq('empresa_id', empresaId)
    .order('prioridade', { ascending: false })
    .order('created_at', { ascending: false })

  const { data: vendedores } = await supabase
    .from('vendedores')
    .select('id, codigo, nome, apelido, status')
    .eq('empresa_id', empresaId)
    .eq('status', 'ativo')
    .order('nome')

  const { data: resultados } = await supabase
    .from('incentivo_resultados')
    .select(`*, vendedores(id, nome, apelido)`)
    .eq('empresa_id', empresaId)
    .order('percentual_meta', { ascending: false })

  const { data: historico } = await supabase
    .from('incentivo_historico')
    .select('*')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })
    .limit(100)

  // Stats rápidos
  const planosAtivos   = (planos ?? []).filter(p => p.status === 'ativo').length
  const participantes  = (planos ?? []).reduce((s, p) =>
    s + (p.incentivo_participantes?.filter((x: any) => !x.todos_vendedores).length ?? 0), 0)
  const pendente       = (resultados ?? [])
    .filter(r => r.status === 'pendente')
    .reduce((s, r) => s + (r.comissao_calculada ?? 0) + (r.bonus_calculado ?? 0), 0)

  return (
    <IncentivoClient
      planos={(planos ?? []) as any[]}
      vendedores={(vendedores ?? []) as any[]}
      resultados={(resultados ?? []) as any[]}
      historico={(historico ?? []) as any[]}
      empresaId={empresaId}
      role={profile?.role ?? 'gerente'}
      stats={{ planosAtivos, participantes, pendente }}
    />
  )
}
