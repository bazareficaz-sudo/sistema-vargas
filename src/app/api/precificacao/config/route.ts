import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'
import { buscarConfigDoCanal, configParaLinha } from '@/lib/precificacao/config'

// Configuração de taxas por canal. Um GET devolve todos os canais da empresa
// já com a configuração que vale pra cada um (própria, herdada da plataforma
// ou preset de partida) — a tela não precisa resolver essa cascata sozinha.

export async function GET() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: canais } = await sb.from('marketplace_canais')
    .select('id, nome, plataforma').eq('empresa_id', guarda.empresaId).order('nome')

  const itens = []
  for (const c of canais ?? []) {
    const { cfg, origem } = await buscarConfigDoCanal(sb, guarda.empresaId, c)
    itens.push({ canal: c, config: cfg, origem })
  }

  return NextResponse.json({ ok: true, itens })
}

export async function PUT(req: Request) {
  const { config } = await req.json()
  if (!config?.plataforma) {
    return NextResponse.json({ ok: false, erro: 'Configuração inválida' }, { status: 400 })
  }

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  // Canal precisa ser da empresa de quem está salvando.
  if (config.canalId) {
    const { data: canal } = await sb.from('marketplace_canais')
      .select('id').eq('id', config.canalId).eq('empresa_id', guarda.empresaId).maybeSingle()
    if (!canal) return NextResponse.json({ ok: false, erro: 'Canal não encontrado' }, { status: 404 })
  }

  const linha = { ...configParaLinha(config, guarda.empresaId), criado_por: guarda.userId }

  // Procura antes de gravar, em vez de upsert com ON CONFLICT.
  //
  // Os índices únicos desta tabela são PARCIAIS (um vale só quando canal_id
  // está preenchido, o outro só quando está nulo — é o que permite conviver
  // a configuração de um canal e a padrão da plataforma). O Postgres só
  // aceita ON CONFLICT em índice parcial se a instrução repetir a condição
  // do índice, e a API do Supabase não tem como expressar isso: o resultado
  // era "there is no unique or exclusion constraint matching the ON CONFLICT
  // specification" ao salvar.
  const busca = sb.from('precificacao_config').select('id').eq('plataforma', config.plataforma)
  const { data: existente } = config.canalId
    ? await busca.eq('canal_id', config.canalId).maybeSingle()
    : await busca.eq('empresa_id', guarda.empresaId).is('canal_id', null).maybeSingle()

  const resposta = existente
    ? await sb.from('precificacao_config').update(linha).eq('id', existente.id).select('id').single()
    : await sb.from('precificacao_config').insert(linha).select('id').single()

  const { data, error } = resposta
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: 'precificacao_config_alterada', tabela: 'precificacao_config',
    valorNovo: { canalId: config.canalId, plataforma: config.plataforma },
  })

  return NextResponse.json({ ok: true, id: data?.id })
}
