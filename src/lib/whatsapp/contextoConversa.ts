import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import type { ZAPIConfig } from '@/lib/zapi'
import { numeroOculto } from './contatos'

// O que toda rota que ENVIA na conversa confere antes: sessão, empresa da
// sessão (nunca do corpo), conversa da empresa, número conhecido, WhatsApp
// ativo e opt-out do cliente.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ContextoConversa = {
  supabase: Awaited<ReturnType<typeof createClient>>
  usuarioId: string
  empresaId: string
  empresaNome: string | null
  operador: string | null
  contato: { id: string; telefone: string; cliente_id: string | null; cliente_nome: string | null; nome_whatsapp: string | null }
  /** Nulo quando a rota não envia nada (opcoes.enviar = false). */
  zapi: ZAPIConfig | null
}

export async function contextoDaConversa(contatoId: unknown, opcoes: { enviar?: boolean } = {}): Promise<{ ok: true; ctx: ContextoConversa } | { ok: false; erro: string; status: number }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, erro: 'Não autenticado', status: 401 }
  const profile = await perfilDaSessao(supabase, user.id, 'empresa_id, nome')
  const empresaId = profile?.empresa_id
  if (!empresaId) return { ok: false, erro: 'Empresa não encontrada', status: 400 }
  if (typeof contatoId !== 'string' || !UUID.test(contatoId)) return { ok: false, erro: 'Conversa inválida', status: 400 }

  const [{ data: contato }, { data: cfg }, { data: empresa }] = await Promise.all([
    supabase.from('whatsapp_conversas').select('id, telefone, cliente_id, cliente_nome, nome_whatsapp')
      .eq('empresa_id', empresaId).eq('id', contatoId).maybeSingle(),
    supabase.from('whatsapp_config').select('instance_id, token, client_token, url_base, ativo').eq('empresa_id', empresaId).maybeSingle(),
    supabase.from('empresas').select('nome, nome_fantasia').eq('id', empresaId).maybeSingle(),
  ])
  if (!contato) return { ok: false, erro: 'Conversa não encontrada', status: 404 }
  const enviar = opcoes.enviar !== false
  if (!enviar) return {
    ok: true,
    ctx: { supabase, usuarioId: user.id, empresaId, empresaNome: empresa?.nome_fantasia || empresa?.nome || null, operador: profile?.nome ?? null, contato, zapi: null },
  }
  if (numeroOculto(contato.telefone)) return { ok: false, erro: 'O WhatsApp escondeu o número desta pessoa: responda pelo celular.', status: 400 }
  if (!cfg?.ativo || !cfg.instance_id || !cfg.token) return { ok: false, erro: 'WhatsApp não configurado ou inativo', status: 400 }
  if (contato.cliente_id) {
    const { data: cli } = await supabase.from('clientes').select('opt_out_whatsapp').eq('id', contato.cliente_id).maybeSingle()
    if (cli?.opt_out_whatsapp) return { ok: false, erro: 'Cliente optou por não receber mensagens via WhatsApp', status: 400 }
  }
  return {
    ok: true,
    ctx: {
      supabase, usuarioId: user.id, empresaId,
      empresaNome: empresa?.nome_fantasia || empresa?.nome || null,
      operador: profile?.nome ?? null,
      contato,
      zapi: { instanceId: cfg.instance_id, token: cfg.token, clientToken: cfg.client_token, urlBase: cfg.url_base },
    },
  }
}

/** O orçamento é desta conversa? (do cliente dela, ou enviado para ela pelo WhatsApp). */
export async function orcamentoDaConversa(ctx: ContextoConversa, orcamentoId: unknown) {
  if (typeof orcamentoId !== 'string' || !UUID.test(orcamentoId)) return null
  const { data: orc } = await ctx.supabase.from('orcamentos').select('id, numero, status, cliente_id, venda_id')
    .eq('empresa_id', ctx.empresaId).eq('id', orcamentoId).maybeSingle()
  if (!orc) return null
  if (ctx.contato.cliente_id && orc.cliente_id === ctx.contato.cliente_id) return orc
  const { count } = await ctx.supabase.from('whatsapp_mensagens').select('id', { count: 'exact', head: true })
    .eq('empresa_id', ctx.empresaId).eq('contato_id', ctx.contato.id).eq('referencia_tipo', 'orcamento').eq('referencia_id', orc.id)
  return (count ?? 0) > 0 ? orc : null
}
