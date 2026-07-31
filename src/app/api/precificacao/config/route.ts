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
  const { data, error } = await sb.from('precificacao_config')
    .upsert(linha, { onConflict: config.canalId ? 'canal_id' : 'empresa_id,plataforma' })
    .select('id').single()

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: 'precificacao_config_alterada', tabela: 'precificacao_config',
    valorNovo: { canalId: config.canalId, plataforma: config.plataforma },
  })

  return NextResponse.json({ ok: true, id: data?.id })
}
