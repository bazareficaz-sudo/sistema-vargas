import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import AuditoriaPedidosClient from '@/components/pedidos/AuditoriaPedidosClient'

export const dynamic = 'force-dynamic'

// Histórico de alterações dos pedidos.
//
// Serve para a pergunta que só aparece depois do problema: "quem marcou
// este pedido como despachado?". Por isso `pedido_eventos` é append-only —
// não há tela nenhuma no sistema que edite ou apague um evento.

export default async function AuditoriaPedidosPage() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'realizar_vendas')
  if (!guarda.ok) {
    return (
      <div className="p-8">
        <div className="max-w-md bg-white border border-gray-200 rounded-xl p-6">
          <h1 className="text-lg font-semibold text-gray-900">Sem acesso</h1>
          <p className="text-sm text-gray-500 mt-1">Você não tem permissão para ver o histórico de pedidos.</p>
        </div>
      </div>
    )
  }

  const { data: usuarios } = await sb.from('profiles')
    .select('id, nome').eq('empresa_id', guarda.empresaId).order('nome')

  return <AuditoriaPedidosClient usuarios={usuarios ?? []} />
}
