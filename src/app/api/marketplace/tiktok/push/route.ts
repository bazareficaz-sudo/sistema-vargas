import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { atualizarPrecoEstoque, type AlvoSku } from '@/lib/tiktok/write'
import { COLUNAS_CANAL, montarCanal } from '@/lib/tiktok/canal'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// Envia para a TikTok o preço/estoque que JÁ ESTÁ SALVO no anúncio (ou nas
// variações). Mesmo contrato da rota da Shopee: o modal grava os números e
// chama esta rota.
export async function POST(req: Request) {
  const { canalId, anuncioId } = await req.json()
  if (!canalId || !anuncioId) return NextResponse.json({ ok: false, erro: 'canalId/anuncioId ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: canalRow } = await sb
    .from('marketplace_canais')
    .select(COLUNAS_CANAL)
    .eq('id', canalId).eq('empresa_id', empresaId).eq('plataforma', 'tiktok')
    .single()

  if (!canalRow) return NextResponse.json({ ok: false, erro: 'Canal TikTok Shop não encontrado' }, { status: 404 })
  if (!canalRow.access_token) {
    return NextResponse.json({ ok: false, erro: 'Canal não conectado — refaça a autorização em Configurar.' }, { status: 400 })
  }

  const { data: anuncio } = await sb
    .from('marketplace_anuncios')
    .select('id, canal_id, id_externo, tem_variacao, preco_venda, estoque_reservado')
    .eq('id', anuncioId).eq('canal_id', canalId)
    .single()

  if (!anuncio) return NextResponse.json({ ok: false, erro: 'Anúncio não encontrado' }, { status: 404 })
  if (!anuncio.id_externo) return NextResponse.json({ ok: false, erro: 'Anúncio sem ID externo — não veio de sincronização.' }, { status: 400 })

  let alvos: AlvoSku[]
  if (anuncio.tem_variacao) {
    const { data: variacoes } = await sb
      .from('marketplace_anuncio_variacoes')
      .select('model_id, preco, estoque')
      .eq('anuncio_id', anuncio.id)
    alvos = (variacoes ?? []).map((v: any) => ({ skuId: v.model_id, preco: v.preco, estoque: v.estoque }))
    if (alvos.length === 0) {
      return NextResponse.json({ ok: false, erro: 'Anúncio com variação sem variações gravadas — sincronize o anúncio antes.' }, { status: 400 })
    }
  } else {
    alvos = [{ preco: anuncio.preco_venda, estoque: anuncio.estoque_reservado }]
  }

  try {
    const resultado = await atualizarPrecoEstoque(sb, montarCanal(canalRow), String(anuncio.id_externo), alvos)

    await sb.from('marketplace_sync_log').insert({
      canal_id: canalId,
      tipo: 'push_preco_estoque',
      status: resultado.ok ? 'ok' : 'erro',
      mensagem: [
        resultado.erro,
        resultado.precoOk ? null : resultado.erroPreco && `Preço: ${resultado.erroPreco}`,
        resultado.estoqueOk ? null : resultado.erroEstoque && `Estoque: ${resultado.erroEstoque}`,
      ].filter(Boolean).join(' · ') || 'Preço e estoque enviados com sucesso.',
      detalhes: resultado,
    })

    if (resultado.ok) {
      await sb.from('marketplace_anuncios').update({
        // O espelho passa a ser o que foi mandado — sem isto a fila veria o
        // número antigo e reenviaria o mesmo estoque.
        ...(anuncio.tem_variacao ? {} : { estoque_externo: anuncio.estoque_reservado }),
        ultima_atualizacao: new Date().toISOString(),
        sincronizado_em: new Date().toISOString(),
      }).eq('id', anuncio.id)
    }

    return NextResponse.json(resultado)
  } catch (e: any) {
    const erro = e?.message ?? 'Erro ao enviar para a TikTok Shop'
    await sb.from('marketplace_sync_log').insert({
      canal_id: canalId, tipo: 'push_preco_estoque', status: 'erro', mensagem: erro, detalhes: { error: erro },
    })
    return NextResponse.json({ ok: false, erro }, { status: 400 })
  }
}
