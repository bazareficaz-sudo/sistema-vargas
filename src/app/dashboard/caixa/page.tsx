import CaixaTesourariaClient from '@/components/caixa/CaixaTesourariaClient'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function CaixaPage() {
  // O nome do responsável sai daqui, e não de um campo digitado: quem
  // assina a sangria é quem está logado. O comprovante mostra esse nome; a
  // autoria que vale mesmo é `usuario_id`, gravada pela RPC.
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const { data: perfil } = user
    ? await sb.from('profiles').select('nome').eq('id', user.id).maybeSingle()
    : { data: null }

  const responsavel = perfil?.nome || user?.email || 'Operador'

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-900">Caixa da Empresa</h1>
      <p className="text-sm text-gray-500 mt-1 mb-5">
        Tesouraria e transferências com os caixas de PDV: sangria, suprimento,
        aporte, retirada de sócio, depósito no banco e ajuste de contagem.
      </p>
      <CaixaTesourariaClient responsavel={responsavel} />
    </div>
  )
}
