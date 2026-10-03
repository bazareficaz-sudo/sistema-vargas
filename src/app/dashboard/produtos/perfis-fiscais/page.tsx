import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import PerfisFiscaisClient, { type PerfilComRegras } from '@/components/produtos/PerfisFiscaisClient'

export const dynamic = 'force-dynamic'

export default async function PerfisFiscaisPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id, 'empresa_id, tenant_id')
  const tenantId = profile?.tenant_id ?? ''

  const { data: perfis, error } = await supabase
    .from('perfis_fiscais')
    .select('id, nome, descricao, chave, ativo, perfil_fiscal_regras(regime, situacao, cfop, icms_situacao)')
    .eq('tenant_id', tenantId)
    .eq('ativo', true)
    .order('nome')

  // A tabela só existe depois de rodar o supabase-perfis-fiscais.sql. Sem
  // isto a tela quebraria com um erro de banco que não diz o que fazer.
  if (error) {
    return (
      <div className="max-w-2xl bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-900">
        <p className="font-semibold mb-1">Perfis fiscais ainda não foram ativados</p>
        <p>Rode o arquivo <code className="font-mono">supabase-perfis-fiscais.sql</code> no Supabase (SQL Editor) e recarregue esta página.</p>
        <p className="text-xs text-amber-700 mt-2">Detalhe técnico: {error.message}</p>
      </div>
    )
  }

  // Quais empresas do grupo emitem em cada regime — para a tela dizer "esta
  // coluna é a da Ouro e Prata", em vez de "Simples Nacional" no abstrato.
  const { data: empresas } = await supabase
    .from('empresas')
    .select('id, nome, nome_fantasia, empresa_config_fiscal!empresa_config_fiscal_empresa_id_fkey(crt)')
    .eq('tenant_id', tenantId)
    .order('nome')

  const empresaIds = (empresas ?? []).map(e => e.id)
  const empresasPorRegime: Record<'simples' | 'normal', string[]> = { simples: [], normal: [] }
  type EmpresaComCrt = { nome: string; nome_fantasia: string | null; empresa_config_fiscal: { crt: string | null } | { crt: string | null }[] | null }
  for (const e of (empresas ?? []) as unknown as EmpresaComCrt[]) {
    const cfg = Array.isArray(e.empresa_config_fiscal) ? e.empresa_config_fiscal[0] : e.empresa_config_fiscal
    const crt = String(cfg?.crt ?? '1')
    empresasPorRegime[crt === '1' || crt === '2' ? 'simples' : 'normal'].push(e.nome_fantasia || e.nome)
  }

  // Contagem por perfil com `head: true`: só o número, sem trazer as linhas —
  // o catálogo passa do limite de linhas por consulta.
  const consultaProdutos = () => supabase.from('produtos').select('id', { count: 'exact', head: true }).in('empresa_id', empresaIds)
  const contar = async (filtro: (q: ReturnType<typeof consultaProdutos>) => ReturnType<typeof consultaProdutos>) => {
    if (empresaIds.length === 0) return 0
    const { count } = await filtro(consultaProdutos())
    return count ?? 0
  }

  const [contagens, semPerfil] = await Promise.all([
    Promise.all((perfis ?? []).map(p => contar(q => q.eq('perfil_fiscal_id', p.id)))),
    contar(q => q.is('perfil_fiscal_id', null).eq('ativo', true)),
  ])

  const lista: PerfilComRegras[] = (perfis ?? []).map((p, i) => ({
    id: p.id,
    nome: p.nome,
    descricao: p.descricao,
    chave: p.chave,
    regras: (p.perfil_fiscal_regras ?? []) as PerfilComRegras['regras'],
    produtos: contagens[i],
  }))

  return (
    <PerfisFiscaisClient
      perfisIniciais={lista}
      semPerfil={semPerfil}
      empresasPorRegime={empresasPorRegime}
      tenantId={tenantId}
    />
  )
}
