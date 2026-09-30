import { NextResponse } from 'next/server'
import { camposPausaManual, camposReativacao } from '@/lib/marketplace/pausa'
import { createClient } from '@/lib/supabase/server'
import { pausarProdutos, reativarProdutos } from '@/lib/tiktok/write'
import { COLUNAS_CANAL, montarCanal } from '@/lib/tiktok/canal'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export async function POST(req: Request) {
  const { canalId, anuncioIds, acao } = await req.json()
  if (!canalId || !Array.isArray(anuncioIds) || anuncioIds.length === 0) {
    return NextResponse.json({ ok: false, erro: 'canalId/anuncioIds ausente' }, { status: 400 })
  }
  if (acao !== 'pausar' && acao !== 'ativar') {
    return NextResponse.json({ ok: false, erro: 'acao inválida' }, { status: 400 })
  }

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: canalRow } = await sb
    .from('marketplace_canais')
    .select(COLUNAS_CANAL)
    .eq('id', canalId).eq('empresa_id', empresaId).eq('plataforma', 'tiktok').single()

  if (!canalRow) return NextResponse.json({ ok: false, erro: 'Canal TikTok Shop não encontrado' }, { status: 404 })
  if (!canalRow.access_token) return NextResponse.json({ ok: false, erro: 'Canal não conectado — refaça a autorização em Configurar.' }, { status: 400 })

  const { data: anuncios } = await sb
    .from('marketplace_anuncios')
    .select('id, id_externo')
    .eq('canal_id', canalId).in('id', anuncioIds)

  const todos = anuncios ?? []
  const comIdExterno = todos.filter((a: any) => a.id_externo)
  const semIdExterno = todos.length - comIdExterno.length
  if (comIdExterno.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nenhum anúncio selecionado veio de sincronização (sem ID externo).' }, { status: 400 })
  }

  const canal = montarCanal(canalRow)
  const idsExternos = comIdExterno.map((a: any) => String(a.id_externo))
  const resultado = acao === 'pausar'
    ? await pausarProdutos(sb, canal, idsExternos)
    : await reativarProdutos(sb, canal, idsExternos)

  const recusados = new Set(resultado.falhas.map(f => f.productId))
  const sucessos = comIdExterno.filter((a: any) => !recusados.has(String(a.id_externo))).map((a: any) => a.id)

  if (sucessos.length > 0) {
    await sb.from('marketplace_anuncios')
      // PAUSA MANUAL FICA MARCADA — é o que impede a fila de religar sozinha
      // um anúncio que uma pessoa desligou.
      .update(acao === 'pausar' ? camposPausaManual(user.id) : camposReativacao())
      .in('id', sucessos)
  }

  await sb.from('marketplace_sync_log').insert({
    canal_id: canalId,
    tipo: acao === 'pausar' ? 'pausar_anuncios' : 'ativar_anuncios',
    status: resultado.falhas.length === 0 ? 'ok' : 'erro',
    mensagem: `${sucessos.length} atualizado(s), ${resultado.falhas.length} falha(s)` +
      (semIdExterno > 0 ? `, ${semIdExterno} ignorado(s) (sem ID externo)` : ''),
    detalhes: { sucessos: sucessos.length, falhas: resultado.falhas },
  })

  return NextResponse.json({
    ok: resultado.falhas.length === 0,
    atualizados: sucessos,
    falhasCount: resultado.falhas.length,
    semIdExterno,
    erros: [...new Set(resultado.falhas.map(f => f.erro))],
  })
}
