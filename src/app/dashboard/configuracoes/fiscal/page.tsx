import { createClient } from '@/lib/supabase/server'
import TabelaNcmClient from '@/components/fiscal/TabelaNcmClient'

export const dynamic = 'force-dynamic'

// CONFIGURACOES FISCAIS.
//
// Criada em 02/09/2026 para dar casa a carga da tabela NCM. A rota
// `/api/fiscal/ncm/atualizar` existia desde 31/08 e nunca tinha sido
// executada — nao por falta de vontade, mas porque nao havia botao em tela
// nenhuma, e a unica instrucao possivel era rodar um fetch no console do
// navegador.
export default async function ConfiguracoesFiscaisPage() {
  const sb = await createClient()

  // A TABELA NCM E FEDERAL: a mesma para todas as empresas. Por isso a
  // contagem nao filtra por empresa — filtrar daria zero e faria parecer que
  // cada empresa precisa da sua carga.
  const [{ count }, { data: recente }] = await Promise.all([
    sb.from('ncm_tabela').select('codigo', { count: 'exact', head: true }),
    sb.from('ncm_tabela').select('atualizado_em, ato').order('atualizado_em', { ascending: false }).limit(1).maybeSingle(),
  ])

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-900">Fiscal</h1>
      <p className="mb-5 mt-1 text-sm text-gray-500">
        Tabelas oficiais que a emissão usa para conferir o cadastro antes de mandar a nota.
      </p>

      <h2 className="mb-3 text-sm font-semibold text-gray-800">Tabela NCM</h2>
      <TabelaNcmClient
        inicial={{
          linhas: count ?? 0,
          ultimaCarga: recente?.atualizado_em ?? null,
          ato: recente?.ato ?? null,
        }}
      />
    </div>
  )
}
