import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

// Entrada da Lista de Compra: vai direto para a lista aberta, se existir.
// Sem lista aberta, mostra as finalizadas recentes — não há "lista vazia"
// pra criar do zero aqui; ela nasce sozinha quando algo é adicionado pelo
// Auxiliar de Compras.

export default async function ComprasListaIndexPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const perfil = await perfilDaSessao(sb, user!.id)
  const empresaId = perfil?.empresa_id ?? ''

  const { data: aberta } = await sb.from('compras_listas')
    .select('id').eq('empresa_id', empresaId).eq('status', 'aberta')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (aberta) redirect(`/dashboard/compras-lista/${aberta.id}`)

  const { data: recentes } = await sb.from('compras_listas')
    .select('id, nome, status, created_at')
    .eq('empresa_id', empresaId).eq('status', 'finalizada')
    .order('updated_at', { ascending: false }).limit(10)

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <span className="text-gray-600 font-medium">lista de compra</span>
      </div>
      <h1 className="text-gray-900 text-xl font-semibold mb-1">Lista de Compra</h1>
      <p className="text-gray-500 text-sm mb-6">Nenhuma lista aberta no momento.</p>

      <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center">
        <p className="text-slate-600 text-sm mb-2">
          A lista nasce sozinha quando você adiciona produtos pelo{' '}
          <Link href="/dashboard/auxiliar-compras" className="text-blue-600 underline">Auxiliar de Compras</Link>.
        </p>
      </div>

      {recentes && recentes.length > 0 && (
        <div className="mt-8">
          <p className="text-xs font-medium text-slate-500 mb-2">Listas já finalizadas</p>
          <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            {recentes.map(l => (
              <Link key={l.id} href={`/dashboard/compras-lista/${l.id}`}
                className="flex items-center justify-between px-4 py-3 text-sm hover:bg-slate-50">
                <span className="text-slate-700">{l.nome}</span>
                <span className="text-slate-400 text-xs">{new Date(l.created_at).toLocaleDateString('pt-BR')}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
