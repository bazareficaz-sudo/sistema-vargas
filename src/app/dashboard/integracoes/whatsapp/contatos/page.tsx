import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import WhatsAppContatosClient, { type ContatoWhatsApp } from '@/components/integracoes/WhatsAppContatosClient'

export const dynamic = 'force-dynamic'

// Contatos do WhatsApp: quem mandou mensagem para a loja (pré-cadastro feito
// pelo webhook). Padrão: os novos, que ainda não são clientes — é a lista de
// quem procurou a loja e pode virar venda.
const STATUS = ['novo', 'cliente', 'ignorado', 'todos'] as const
const seteDiasAtras = () => new Date(Date.now() - 7 * 86_400_000).toISOString()

export default async function WhatsAppContatosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; pagina?: string }>
}) {
  const sp = await searchParams
  const status = (STATUS as readonly string[]).includes(sp.status ?? '') ? sp.status! : 'novo'
  const q = (sp.q ?? '').trim().slice(0, 60)
  const pg = Math.max(1, parseInt(sp.pagina ?? '1') || 1)
  const POR_PAGINA = 50
  const offset = (pg - 1) * POR_PAGINA

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  let query = supabase
    .from('whatsapp_contatos')
    .select('id, telefone, nome_whatsapp, status, primeira_mensagem, primeira_em, ultima_em, total_mensagens, cliente_id, clientes(nome)', { count: 'exact' })
    .eq('empresa_id', empresaId)
    .order('ultima_em', { ascending: false })
    .range(offset, offset + POR_PAGINA - 1)
  if (status !== 'todos') query = query.eq('status', status)
  if (q) {
    const digitos = q.replace(/\D/g, '')
    // Vírgula e parênteses quebram o filtro "or" do PostgREST.
    const nome = q.replace(/[,()%]/g, ' ')
    query = query.or([`nome_whatsapp.ilike.%${nome}%`, ...(digitos.length >= 3 ? [`telefone.ilike.%${digitos}%`] : [])].join(','))
  }
  const [{ data, count, error }, novos, clientes, semana, semNome] = await Promise.all([
    query,
    supabase.from('whatsapp_contatos').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('status', 'novo'),
    supabase.from('whatsapp_contatos').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('status', 'cliente'),
    supabase.from('whatsapp_contatos').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).gte('primeira_em', seteDiasAtras()),
    // Sem nome e com número conhecido (o código @lid a Z-API não consulta).
    supabase.from('whatsapp_contatos').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).is('nome_whatsapp', null).not('chave', 'like', 'x%'),
  ])

  return (
    <WhatsAppContatosClient
      empresaId={empresaId}
      contatos={(data ?? []) as unknown as ContatoWhatsApp[]}
      total={count ?? 0}
      pagina={pg}
      totalPaginas={Math.ceil((count ?? 0) / POR_PAGINA)}
      stats={{ novos: novos.count ?? 0, clientes: clientes.count ?? 0, semana: semana.count ?? 0, semNome: semNome.count ?? 0 }}
      filtros={{ status, q }}
      // Migração ainda não aplicada: a tela explica em vez de quebrar.
      indisponivel={Boolean(error)}
    />
  )
}
