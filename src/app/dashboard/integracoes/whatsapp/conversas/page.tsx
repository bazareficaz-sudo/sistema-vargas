import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import WhatsAppConversasClient, { type Conversa, type Mensagem } from '@/components/integracoes/WhatsAppConversasClient'

export const dynamic = 'force-dynamic'

// Caixa de entrada do WhatsApp: conversas com quem procurou a loja (contatos),
// com o histórico e a resposta pelo sistema. Os destinatários do Getúlio
// (dono e equipe) não são contato e não aparecem aqui.
const FILTROS = ['todas', 'aguardando', 'nao_lidas'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function WhatsAppConversasPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; f?: string; q?: string }>
}) {
  const sp = await searchParams
  const filtro = (FILTROS as readonly string[]).includes(sp.f ?? '') ? sp.f! : 'todas'
  const aberta = sp.c && UUID.test(sp.c) ? sp.c : null
  const q = (sp.q ?? '').trim().slice(0, 60)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const campos = 'id, telefone, nome_whatsapp, cliente_id, cliente_nome, status, ultima_atividade, ultima_entrada_em, aguardando, nao_lida'
  let lista = supabase.from('whatsapp_conversas').select(campos)
    .eq('empresa_id', empresaId).neq('status', 'ignorado').not('ultima_atividade', 'is', null)
    .order('ultima_atividade', { ascending: false }).limit(80)
  if (filtro === 'aguardando') lista = lista.eq('aguardando', true)
  if (filtro === 'nao_lidas') lista = lista.eq('nao_lida', true)
  if (q) {
    const digitos = q.replace(/\D/g, ''), nome = q.replace(/[,()%]/g, ' ')
    lista = lista.or([`nome_whatsapp.ilike.%${nome}%`, `cliente_nome.ilike.%${nome}%`, ...(digitos.length >= 3 ? [`telefone.ilike.%${digitos}%`] : [])].join(','))
  }

  const [conversas, aguardando, naoLidas, atual, mensagens] = await Promise.all([
    lista,
    supabase.from('whatsapp_conversas').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).neq('status', 'ignorado').eq('aguardando', true),
    supabase.from('whatsapp_conversas').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).neq('status', 'ignorado').eq('nao_lida', true),
    aberta ? supabase.from('whatsapp_conversas').select(campos).eq('empresa_id', empresaId).eq('id', aberta).maybeSingle() : null,
    aberta ? supabase.from('whatsapp_mensagens')
      .select('id, tipo, conteudo, status, erro, created_at, enviado_em, operador_nome')
      .eq('empresa_id', empresaId).eq('contato_id', aberta)
      .order('created_at', { ascending: false }).limit(200) : null,
  ])

  return (
    <WhatsAppConversasClient
      conversas={(conversas.data ?? []) as Conversa[]}
      aberta={(atual?.data ?? null) as Conversa | null}
      mensagens={((mensagens?.data ?? []) as Mensagem[]).reverse()}
      contagem={{ aguardando: aguardando.count ?? 0, naoLidas: naoLidas.count ?? 0 }}
      filtros={{ f: filtro, q }}
      // Migração da caixa de entrada ainda não aplicada: a tela explica.
      indisponivel={Boolean(conversas.error)}
    />
  )
}
