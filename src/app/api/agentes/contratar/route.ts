import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

// CONTRATAR, EDITAR E CANCELAR UM AGENTE.
//
// Tudo pelo servidor, e nao por escrita direta da tela, porque tres coisas
// aqui nao podem vir do navegador: se o agente esta disponivel para o plano
// da empresa, quantos dias de carencia ele tem, e quando a carencia termina.
// Uma tela que gravasse `teste_ate` sozinha estaria escolhendo o proprio
// prazo de teste.

type Corpo = {
  acao?: 'contratar' | 'instrucoes' | 'cancelar' | 'assinar'
  agenteId?: string
  instrucoes?: string
}

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const perfil = await perfilDaSessao(sb, user.id, 'empresa_id')
  const empresaId = perfil?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as Corpo
  const agenteId = String(body.agenteId ?? '').trim()
  if (!agenteId) return NextResponse.json({ ok: false, erro: 'Informe o agente.' }, { status: 400 })

  // ── Instruções do gestor ────────────────────────────────────────────────
  if (body.acao === 'instrucoes') {
    const texto = String(body.instrucoes ?? '').trim().slice(0, 4000)
    const { error } = await sb.from('empresa_agentes')
      .update({ instrucoes: texto || null, updated_at: new Date().toISOString() })
      .eq('empresa_id', empresaId).eq('agente_id', agenteId)
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // ── Cancelar ────────────────────────────────────────────────────────────
  if (body.acao === 'cancelar') {
    // A LINHA NAO E APAGADA. Fica com status 'cancelado' para o historico
    // sobreviver: quem contratou, quando, e o que o gestor tinha escrito. Um
    // delete apagaria a resposta para "por que fomos cobrados em agosto?".
    const { error } = await sb.from('empresa_agentes').update({
      status: 'cancelado',
      cancelado_em: new Date().toISOString(),
      cancelado_por: user.id,
      updated_at: new Date().toISOString(),
    }).eq('empresa_id', empresaId).eq('agente_id', agenteId)
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // ── Contratar ou assinar ────────────────────────────────────────────────
  //
  // O AGENTE PRECISA ESTAR DISPONIVEL PARA O PLANO DESTA EMPRESA. Sem esta
  // checagem, um POST com o id de um agente que a empresa nunca viu na tela
  // criaria o contrato assim mesmo.
  const { data: agente } = await sb.from('ia_agentes')
    .select('id, nome, publicado, ativo').eq('id', agenteId).maybeSingle()
  if (!agente?.publicado || !agente.ativo) {
    return NextResponse.json({ ok: false, erro: 'Agente indisponível.' }, { status: 404 })
  }

  // A assinatura vive em `subscriptions` (status 'active'), nao numa coluna
  // de `empresas`. Sem plano nao ha oferta, e sem oferta nao ha contrato.
  const { data: assinatura } = await sb.from('subscriptions')
    .select('plan_id, status').eq('empresa_id', empresaId)
    .eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle()
  const planId = assinatura?.plan_id ?? null

  const { data: oferta } = planId
    ? await sb.from('plano_agentes')
        .select('incluso, dias_carencia')
        .eq('plan_id', planId).eq('agente_id', agenteId).maybeSingle()
    : { data: null }

  if (!oferta) {
    return NextResponse.json({
      ok: false,
      erro: 'Este agente não está disponível no seu plano. Fale com o suporte para incluí-lo.',
    }, { status: 403 })
  }

  const agora = new Date()
  const jaExiste = await sb.from('empresa_agentes')
    .select('id, status, teste_ate').eq('empresa_id', empresaId).eq('agente_id', agenteId).maybeSingle()

  // "Assinar" = sair do teste e virar pago. Vale também para reativar um
  // contrato cancelado.
  if (body.acao === 'assinar') {
    if (!jaExiste.data) return NextResponse.json({ ok: false, erro: 'Ative o agente antes de assinar.' }, { status: 400 })
    const { error } = await sb.from('empresa_agentes').update({
      status: 'ativo', cancelado_em: null, cancelado_por: null, updated_at: agora.toISOString(),
    }).eq('id', jaExiste.data.id)
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, status: 'ativo' })
  }

  // A CARENCIA E CONCEDIDA UMA VEZ SO.
  //
  // Se ja existe contrato — mesmo cancelado — reativar NAO reinicia o teste.
  // Sem isso, cancelar e ativar de novo daria teste infinito, e o cliente
  // descobriria isso antes de nos.
  const jaTeveTeste = !!jaExiste.data
  const incluso = !!oferta.incluso
  const dias = Number(oferta.dias_carencia ?? 0)

  const status = incluso ? 'ativo' : (dias > 0 && !jaTeveTeste ? 'teste' : 'ativo')
  const testeAte = status === 'teste'
    ? new Date(agora.getTime() + dias * 86400000).toISOString()
    : null

  const linha = {
    empresa_id: empresaId, agente_id: agenteId, status,
    ativado_em: agora.toISOString(), teste_ate: testeAte,
    cancelado_em: null, cancelado_por: null, updated_at: agora.toISOString(),
  }

  const { error } = jaExiste.data
    ? await sb.from('empresa_agentes').update(linha).eq('id', jaExiste.data.id)
    : await sb.from('empresa_agentes').insert(linha)

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({
    ok: true, status, testeAte,
    aviso: jaTeveTeste && dias > 0 && status === 'ativo'
      ? 'Este agente já teve período de teste nesta empresa, então a ativação é direta como assinatura.'
      : null,
  })
}
