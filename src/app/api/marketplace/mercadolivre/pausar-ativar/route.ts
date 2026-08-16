import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { pausarAnuncio, reativarAnuncio } from '@/lib/mercadolivre/write'
import type { MLChannel } from '@/lib/mercadolivre/types'
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
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em')
    .eq('id', canalId).eq('empresa_id', empresaId).eq('plataforma', 'mercadolivre').single()

  if (!canalRow) return NextResponse.json({ ok: false, erro: 'Canal Mercado Livre não encontrado' }, { status: 404 })
  if (!canalRow.access_token) return NextResponse.json({ ok: false, erro: 'Canal não conectado — refaça a autenticação em Configurar.' }, { status: 400 })

  const { data: anuncios } = await sb
    .from('marketplace_anuncios')
    .select('id, id_externo')
    .eq('empresa_id', empresaId).eq('canal_id', canalId).in('id', anuncioIds)

  const todos = anuncios ?? []
  const comIdExterno = todos.filter((a: any) => a.id_externo)
  const semIdExterno = todos.length - comIdExterno.length
  if (comIdExterno.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nenhum anúncio selecionado veio de sincronização (sem ID externo).' }, { status: 400 })
  }

  const canal: MLChannel = {
    id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token, tokenExpiraEm: canalRow.token_expira_em,
  }

  const acaoFn = acao === 'pausar' ? pausarAnuncio : reativarAnuncio
  const sucessos: string[] = []
  const falhas: { itemId: string; erro: string }[] = []

  for (const a of comIdExterno) {
    const resultado = await acaoFn(sb, canal, a.id_externo)
    if (resultado.ok) sucessos.push(a.id)
    else falhas.push({ itemId: a.id_externo, erro: resultado.erro ?? 'Erro desconhecido' })
  }

  if (sucessos.length > 0) {
    await sb.from('marketplace_anuncios')
      .update({ status: acao === 'pausar' ? 'pausado' : 'ativo', updated_at: new Date().toISOString() })
      .in('id', sucessos)
  }

  await sb.from('marketplace_sync_log').insert({
    canal_id: canalId,
    tipo: acao === 'pausar' ? 'pausar_anuncios' : 'ativar_anuncios',
    status: falhas.length === 0 ? 'ok' : 'erro',
    mensagem: `${sucessos.length} atualizado(s), ${falhas.length} falha(s)` +
      (semIdExterno > 0 ? `, ${semIdExterno} ignorado(s) (sem ID externo)` : ''),
    detalhes: { sucessos: sucessos.length, falhas },
  })

  return NextResponse.json({
    ok: falhas.length === 0,
    atualizados: sucessos,
    falhasCount: falhas.length,
    semIdExterno,
    erros: [...new Set(falhas.map(f => f.erro))],
  })
}
