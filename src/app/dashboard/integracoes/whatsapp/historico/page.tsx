import { createClient } from '@/lib/supabase/server'
import WhatsAppHistoricoClient from '@/components/integracoes/WhatsAppHistoricoClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function WhatsAppHistoricoPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tipo?: string; q?: string; pagina?: string }>
}) {
  const { status = '', tipo = '', q = '', pagina = '1' } = await searchParams
  const pg = Math.max(1, parseInt(pagina))
  const POR_PAGINA = 50
  const offset = (pg - 1) * POR_PAGINA

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  let query = supabase
    .from('whatsapp_mensagens')
    .select('*', { count: 'exact' })
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })
    .range(offset, offset + POR_PAGINA - 1)

  if (status) query = query.eq('status', status)
  if (tipo) query = query.eq('tipo', tipo)
  if (q) query = query.or(`cliente_nome.ilike.%${q}%,telefone.ilike.%${q}%`)

  const { data: mensagens, count } = await query

  // Stats
  const [totalRes, enviadosRes, errosRes, recebidasRes] = await Promise.all([
    supabase.from('whatsapp_mensagens').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).neq('tipo', 'recebida'),
    supabase.from('whatsapp_mensagens').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('status', 'enviado'),
    supabase.from('whatsapp_mensagens').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('status', 'erro'),
    supabase.from('whatsapp_mensagens').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('tipo', 'recebida'),
  ])

  return (
    <WhatsAppHistoricoClient
      mensagens={mensagens ?? []}
      total={count ?? 0}
      pagina={pg}
      totalPaginas={Math.ceil((count ?? 0) / POR_PAGINA)}
      stats={{
        total: totalRes.count ?? 0,
        enviados: enviadosRes.count ?? 0,
        erros: errosRes.count ?? 0,
        recebidas: recebidasRes.count ?? 0,
      }}
      filtros={{ status, tipo, q }}
    />
  )
}
