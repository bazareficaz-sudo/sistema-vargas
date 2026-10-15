import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import WhatsAppConversasClient, { type Conversa, type Mensagem, type Ficha } from '@/components/integracoes/WhatsAppConversasClient'
import { respostasPadrao, type RespostaRapida } from '@/lib/whatsapp/conversas'

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

  // Ficha do cliente (parte B): saldo, últimas compras e orçamentos em
  // aberto, só quando a conversa já é de um cliente cadastrado. Tudo
  // filtrado pela empresa de quem está logado.
  const conversaAberta = (atual?.data ?? null) as Conversa | null
  const clienteId = conversaAberta?.cliente_id ?? null
  const [cliente, compras, orcamentos, modelos, cfg, empresa] = await Promise.all([
    clienteId ? supabase.from('clientes')
      .select('saldo_devedor, saldo_credito, valor_vencido, limite_credito, bloqueado_fiado, opt_out_whatsapp')
      .eq('empresa_id', empresaId).eq('id', clienteId).maybeSingle() : null,
    clienteId ? supabase.from('vendas').select('id, numero, created_at, total, canal')
      .eq('empresa_id', empresaId).eq('cliente_id', clienteId).eq('status', 'concluida')
      .order('created_at', { ascending: false }).limit(5) : null,
    clienteId ? supabase.from('orcamentos').select('id, numero, created_at, total, validade')
      .eq('empresa_id', empresaId).eq('cliente_id', clienteId).eq('status', 'aberto')
      .order('created_at', { ascending: false }).limit(5) : null,
    supabase.from('whatsapp_modelos').select('id, nome, conteudo')
      .eq('empresa_id', empresaId).eq('tipo', 'resposta_rapida').eq('ativo', true).order('nome'),
    supabase.from('whatsapp_config').select('horario_atendimento').eq('empresa_id', empresaId).maybeSingle(),
    supabase.from('empresas').select('nome, nome_fantasia, logradouro, numero, bairro, cidade, uf').eq('id', empresaId).maybeSingle(),
  ])

  const ficha: Ficha | null = clienteId && cliente?.data ? {
    ...(cliente.data as Omit<Ficha, 'compras' | 'orcamentos'>),
    compras: (compras?.data ?? []) as Ficha['compras'],
    orcamentos: (orcamentos?.data ?? []) as Ficha['orcamentos'],
  } : null
  // Cadastradas pela loja primeiro; as padrão completam (sem repetir nome).
  const proprias = (modelos.data ?? []) as RespostaRapida[]
  const padrao = respostasPadrao({ horario: cfg.data?.horario_atendimento, endereco: empresa.data })
    .filter(p => !proprias.some(m => m.nome.trim().toLowerCase() === p.nome.toLowerCase()))
  const loja = empresa.data?.nome_fantasia || empresa.data?.nome || ''

  return (
    <WhatsAppConversasClient
      ficha={ficha}
      respostas={[...proprias, ...padrao]}
      loja={loja}
      empresaId={empresaId}
      conversas={(conversas.data ?? []) as Conversa[]}
      aberta={conversaAberta}
      mensagens={((mensagens?.data ?? []) as Mensagem[]).reverse()}
      contagem={{ aguardando: aguardando.count ?? 0, naoLidas: naoLidas.count ?? 0 }}
      filtros={{ f: filtro, q }}
      // Migração da caixa de entrada ainda não aplicada: a tela explica.
      indisponivel={Boolean(conversas.error)}
    />
  )
}
