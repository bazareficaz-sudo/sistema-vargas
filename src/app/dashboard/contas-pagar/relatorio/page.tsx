import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import VisaoGeralPagar from '@/components/contas-pagar/VisaoGeralPagar'
import RelatorioPagamentos from '@/components/contas-pagar/RelatorioPagamentos'

export const dynamic = 'force-dynamic'

// Relatórios do Contas a Pagar, em duas abas que respondem perguntas
// diferentes: "Visão geral" olha o VENCIMENTO (o que vence, o que venceu,
// mês a mês); "Pagamentos" olha o PAGAMENTO (o que saiu do caixa, com juros).
export default async function RelatorioContasPagarPage({
  searchParams,
}: { searchParams: Promise<{ aba?: string; de?: string; ate?: string }> }) {
  const sp = await searchParams
  // Link antigo com período (?de=&ate=) era do relatório de pagamentos.
  const aba = sp.aba === 'pagamentos' || (!sp.aba && (sp.de || sp.ate)) ? 'pagamentos' : 'visao'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''
  const hojeIso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

  const abas: [string, string, string][] = [
    ['visao', '📅 Visão geral', '/dashboard/contas-pagar/relatorio'],
    ['pagamentos', '💸 Pagamentos do período', '/dashboard/contas-pagar/relatorio?aba=pagamentos'],
  ]

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-3">
        <Link href="/dashboard/contas-pagar" className="hover:text-gray-600">Contas a Pagar</Link>
        <span>›</span><span className="text-gray-600">Relatórios</span>
      </div>
      <h1 className="text-xl font-semibold text-gray-900 mb-3">Relatórios de Contas a Pagar</h1>
      <div className="flex gap-1 border-b border-gray-200 mb-5 overflow-x-auto">
        {abas.map(([k, l, href]) => (
          <Link key={k} href={href}
            className={`shrink-0 px-3 py-2 text-sm border-b-2 -mb-px ${aba === k ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {l}
          </Link>
        ))}
      </div>

      {aba === 'visao'
        ? <VisaoGeralPagar supabase={supabase} empresaId={empresaId} hojeIso={hojeIso} />
        : <RelatorioPagamentos supabase={supabase} empresaId={empresaId} sp={sp} />}
    </div>
  )
}
