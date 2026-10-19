import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { hojeNaLoja } from '@/lib/whatsapp/conversas'
import { corValida, emOrdem } from '@/lib/clientes/categorias'
import EnviosCategoriaClient, { type Lote, type ItemLote, type ResumoLote } from '@/components/integracoes/EnviosCategoriaClient'

export const dynamic = 'force-dynamic'

// Envio por categoria: mensagem para uma categoria de clientes, uma por vez
// (regras em supabase/migrations/20261020180000_whatsapp_envio_categoria.sql).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function EnviosCategoriaPage({ searchParams }: { searchParams: Promise<{ l?: string }> }) {
  const { l } = await searchParams
  const aberto = l && UUID.test(l) ? l : null

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''
  const inicioHoje = `${hojeNaLoja()}T00:00:00-03:00`

  const [lotes, categorias, cfg, empresa, hoje, lote, itens] = await Promise.all([
    supabase.from('whatsapp_lotes_resumo').select('id, nome, categoria_nome, comprou_dias, status, total, criado_por_nome, created_at, pendentes, enviados, problemas, pulados, ultimo_envio')
      .eq('empresa_id', empresaId).gt('total', 0).order('created_at', { ascending: false }).limit(20),
    supabase.from('cliente_categorias_contagem').select('id, nome, cor, clientes').eq('empresa_id', empresaId),
    supabase.from('whatsapp_config').select('ativo').eq('empresa_id', empresaId).maybeSingle(),
    supabase.from('empresas').select('nome, nome_fantasia').eq('id', empresaId).maybeSingle(),
    supabase.from('whatsapp_lote_itens').select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId).in('status', ['enviando', 'enviado', 'incerto', 'erro']).gte('reservado_em', inicioHoje),
    aberto ? supabase.from('whatsapp_lotes').select('id, nome, mensagem, categoria_nome, comprou_dias, status, total, criado_por_nome, created_at')
      .eq('empresa_id', empresaId).eq('id', aberto).maybeSingle() : null,
    aberto ? supabase.from('whatsapp_lote_itens').select('id, nome, telefone, status, motivo, enviado_em, ordem')
      .eq('empresa_id', empresaId).eq('lote_id', aberto).order('ordem').limit(500) : null,
  ])

  return (
    <EnviosCategoriaClient
      empresaId={empresaId}
      indisponivel={Boolean(lotes.error)}
      lotes={(lotes.data ?? []) as ResumoLote[]}
      categorias={emOrdem((categorias.data ?? []).map(c => ({ id: c.id, nome: c.nome, cor: corValida(c.cor), clientes: Number(c.clientes ?? 0) })))}
      whatsappAtivo={Boolean(cfg.data?.ativo)}
      loja={empresa.data?.nome_fantasia || empresa.data?.nome || ''}
      enviadosHoje={hoje.count ?? 0}
      lote={(lote?.data ?? null) as Lote | null}
      itens={(itens?.data ?? []) as ItemLote[]}
    />
  )
}
