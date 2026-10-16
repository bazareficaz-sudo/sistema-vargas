import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { mesAnterior } from '@/lib/fiscal/fechamento'
import FechamentoContadorClient from '@/components/fiscal/FechamentoContadorClient'

export const dynamic = 'force-dynamic'

// Fechamento do contador: os XMLs de venda e de compra do mês num .zip.
export default async function FechamentoContadorPage() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'exportar_dados')
  if (!guarda.ok) {
    return <div className="p-8 text-sm text-gray-600">Você não tem permissão para exportar dados. Peça acesso a um administrador.</div>
  }
  const { data: empresa } = await sb.from('empresas')
    .select('nome_fantasia, razao_social, cnpj, contador, email_contador').eq('id', guarda.empresaId).maybeSingle()

  return (
    <FechamentoContadorClient
      mesInicial={mesAnterior()}
      empresa={{
        nome: empresa?.nome_fantasia ?? empresa?.razao_social ?? '',
        cnpj: String(empresa?.cnpj ?? ''),
        contador: empresa?.contador ?? null,
        emailContador: empresa?.email_contador ?? null,
      }}
    />
  )
}
