import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import WhatsAppConversasClient, { type Conversa, type Mensagem, type Ficha, type OrcamentoConversa } from '@/components/integracoes/WhatsAppConversasClient'
import { ETAPAS, respostasPadrao, type RespostaRapida } from '@/lib/whatsapp/conversas'
import { BUCKET_MIDIAS, caminhoGuardado } from '@/lib/whatsapp/midias'

export const dynamic = 'force-dynamic'

// Caixa de entrada do WhatsApp: conversas com quem procurou a loja (contatos),
// com o histórico e a resposta pelo sistema. Os destinatários do Getúlio
// (dono e equipe) não são contato e não aparecem aqui.
const FILTROS = ['todas', 'aguardando', 'nao_lidas', 'hoje'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLS_ORC = 'id, numero, created_at, total, validade, status'

export default async function WhatsAppConversasPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; f?: string; q?: string; e?: string }>
}) {
  const sp = await searchParams
  const filtro = (FILTROS as readonly string[]).includes(sp.f ?? '') ? sp.f! : 'todas'
  const etapa = ETAPAS.some(e => e.id === sp.e) ? sp.e! : null
  const aberta = sp.c && UUID.test(sp.c) ? sp.c : null
  const q = (sp.q ?? '').trim().slice(0, 60)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const campos = 'id, telefone, nome_whatsapp, cliente_id, cliente_nome, status, ultima_atividade, ultima_entrada_em, aguardando, nao_lida, etapa, retorno_em, retorno_nota, retorno_vencido, orcamento_parado'
  let lista = supabase.from('whatsapp_conversas').select(campos)
    .eq('empresa_id', empresaId).neq('status', 'ignorado').not('ultima_atividade', 'is', null)
    .order('ultima_atividade', { ascending: false }).limit(80)
  if (filtro === 'aguardando') lista = lista.eq('aguardando', true)
  if (filtro === 'nao_lidas') lista = lista.eq('nao_lida', true)
  // Para hoje: lembrete de hoje ou atrasado, e orçamento sem resposta há 3 dias.
  if (filtro === 'hoje') lista = lista.or('retorno_vencido.eq.true,orcamento_parado.eq.true')
  if (etapa) lista = lista.eq('etapa', etapa)
  if (q) {
    const digitos = q.replace(/\D/g, ''), nome = q.replace(/[,()%]/g, ' ')
    lista = lista.or([`nome_whatsapp.ilike.%${nome}%`, `cliente_nome.ilike.%${nome}%`, ...(digitos.length >= 3 ? [`telefone.ilike.%${digitos}%`] : [])].join(','))
  }

  // Contagens dos filtros e das etapas numa consulta só (poucas colunas por contato).
  const [conversas, marcas, atual, mensagens] = await Promise.all([
    lista,
    supabase.from('whatsapp_conversas').select('etapa, aguardando, nao_lida, retorno_vencido, orcamento_parado')
      .eq('empresa_id', empresaId).neq('status', 'ignorado').not('ultima_atividade', 'is', null).limit(10000),
    aberta ? supabase.from('whatsapp_conversas').select(campos).eq('empresa_id', empresaId).eq('id', aberta).maybeSingle() : null,
    aberta ? supabase.from('whatsapp_mensagens')
      .select('id, tipo, conteudo, conteudo_pdf_url, status, erro, created_at, enviado_em, operador_nome')
      .eq('empresa_id', empresaId).eq('contato_id', aberta)
      .order('created_at', { ascending: false }).limit(200) : null,
  ])

  // Ficha do cliente (parte B): saldo, últimas compras e orçamentos em
  // aberto, só quando a conversa já é de um cliente cadastrado. Tudo
  // filtrado pela empresa de quem está logado.
  const conversaAberta = (atual?.data ?? null) as Conversa | null
  const clienteId = conversaAberta?.cliente_id ?? null
  const [cliente, compras, orcamentosCliente, orcamentosEnviados, modelos, cfg, empresa] = await Promise.all([
    clienteId ? supabase.from('clientes')
      .select('saldo_devedor, saldo_credito, valor_vencido, limite_credito, bloqueado_fiado, opt_out_whatsapp')
      .eq('empresa_id', empresaId).eq('id', clienteId).maybeSingle() : null,
    clienteId ? supabase.from('vendas').select('id, numero, created_at, total, canal')
      .eq('empresa_id', empresaId).eq('cliente_id', clienteId).eq('status', 'concluida')
      .order('created_at', { ascending: false }).limit(5) : null,
    clienteId ? supabase.from('orcamentos').select(COLS_ORC)
      .eq('empresa_id', empresaId).eq('cliente_id', clienteId).in('status', ['aberto', 'aprovado'])
      .order('created_at', { ascending: false }).limit(5) : null,
    // Orçamentos enviados para esta conversa (também de quem não é cliente).
    conversaAberta ? supabase.from('whatsapp_mensagens').select('referencia_id')
      .eq('empresa_id', empresaId).eq('contato_id', conversaAberta.id).eq('referencia_tipo', 'orcamento')
      .order('created_at', { ascending: false }).limit(30) : null,
    supabase.from('whatsapp_modelos').select('id, nome, conteudo')
      .eq('empresa_id', empresaId).eq('tipo', 'resposta_rapida').eq('ativo', true).order('nome'),
    supabase.from('whatsapp_config').select('horario_atendimento').eq('empresa_id', empresaId).maybeSingle(),
    supabase.from('empresas').select('nome, nome_fantasia, logradouro, numero, bairro, cidade, uf').eq('id', empresaId).maybeSingle(),
  ])

  // Arquivos guardados no bucket privado: link assinado de 1 h (o RLS do
  // Storage confere a empresa). Link da Z-API vai como veio.
  type Linha = Omit<Mensagem, 'midia_url'> & { conteudo_pdf_url: string | null }
  const linhasMsg = ((mensagens?.data ?? []) as Linha[]).reverse()
  const caminhos = [...new Set(linhasMsg.map(m => caminhoGuardado(m.conteudo_pdf_url)).filter((c): c is string => Boolean(c)))]
  const assinados = new Map<string, string>()
  if (caminhos.length) {
    const { data } = await supabase.storage.from(BUCKET_MIDIAS).createSignedUrls(caminhos, 3600)
    for (const a of data ?? []) if (a.path && a.signedUrl) assinados.set(a.path, a.signedUrl)
  }
  const listaMensagens: Mensagem[] = linhasMsg.map(({ conteudo_pdf_url, ...m }) => {
    const caminho = caminhoGuardado(conteudo_pdf_url)
    return { ...m, midia_url: caminho ? assinados.get(caminho) ?? null : (conteudo_pdf_url && /^https:\/\//.test(conteudo_pdf_url) ? conteudo_pdf_url : null) }
  })

  type Marca = { etapa: string; aguardando: boolean; nao_lida: boolean; retorno_vencido: boolean; orcamento_parado: boolean }
  const linhas = (marcas.data ?? []) as Marca[]
  const contagem = {
    aguardando: linhas.filter(m => m.aguardando).length,
    naoLidas: linhas.filter(m => m.nao_lida).length,
    hoje: linhas.filter(m => m.retorno_vencido || m.orcamento_parado).length,
    etapas: Object.fromEntries(ETAPAS.map(e => [e.id, linhas.filter(m => m.etapa === e.id).length])),
  }

  const idsEnviados = [...new Set((orcamentosEnviados?.data ?? []).map(m => m.referencia_id).filter((v): v is string => UUID.test(v ?? '')))]
  const { data: enviadosAbertos } = idsEnviados.length
    ? await supabase.from('orcamentos').select(COLS_ORC).eq('empresa_id', empresaId).in('id', idsEnviados).in('status', ['aberto', 'aprovado'])
    : { data: [] }
  const orcamentosConversa = [...new Map([...(orcamentosCliente?.data ?? []), ...(enviadosAbertos ?? [])].map(o => [o.id, o])).values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8) as OrcamentoConversa[]

  const ficha: Ficha | null = clienteId && cliente?.data ? {
    ...(cliente.data as Omit<Ficha, 'compras'>),
    compras: (compras?.data ?? []) as Ficha['compras'],
  } : null
  // Cadastradas pela loja primeiro; as padrão completam (sem repetir nome).
  const proprias = (modelos.data ?? []) as RespostaRapida[]
  const padrao = respostasPadrao({ horario: cfg.data?.horario_atendimento, endereco: empresa.data })
    .filter(p => !proprias.some(m => m.nome.trim().toLowerCase() === p.nome.toLowerCase()))
  const loja = empresa.data?.nome_fantasia || empresa.data?.nome || ''

  return (
    <WhatsAppConversasClient
      ficha={ficha}
      orcamentos={orcamentosConversa}
      respostas={[...proprias, ...padrao]}
      loja={loja}
      empresaId={empresaId}
      conversas={(conversas.data ?? []) as Conversa[]}
      aberta={conversaAberta}
      mensagens={listaMensagens}
      contagem={contagem}
      filtros={{ f: filtro, q, e: etapa }}
      // Migração da caixa de entrada ainda não aplicada: a tela explica.
      indisponivel={Boolean(conversas.error)}
    />
  )
}
