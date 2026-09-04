import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { canalAceitaEnvio } from '@/lib/marketplace/canais'

// PEDIR À FILA QUE OLHE ESTES PRODUTOS.
//
// A fila é dirigida por EVENTO: `trg_fila_produto` enfileira quando o estoque
// ou o preço de um produto mudam. Isso cobre venda, entrada de mercadoria e
// ajuste — e não cobre a coisa mais óbvia do mundo:
//
//   MUDAR A REGRA NÃO É MOVIMENTAÇÃO. Vincular "Est +1000" a 300 anúncios
//   muda o que DEVERIA estar no canal e não toca no estoque de ninguém.
//   Nenhum produto é enfileirado, nenhuma rodada tem o que fazer, e a regra
//   só passa a valer na próxima venda de cada produto — para a maioria, isso
//   é "nunca". Foi assim que o gestor ficou com a fila vazia, os anúncios
//   marcados "enviando" e nada acontecendo.
//
// Esta rota é o pedido explícito. Ela NÃO decide o que enviar: enfileira, e a
// rodada decide anúncio por anúncio, com as mesmas regras de sempre —
// inclusive gravar `sem_mudanca` no que já estiver certo. Enfileirar demais
// custa uma linha de registro; enfileirar de menos custa preço errado no ar.

const LOTE = 500

export async function POST(req: Request) {
  const { anuncioIds, canalId, tudo } = await req.json().catch(() => ({}))

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  let consulta = sb
    .from('marketplace_anuncios')
    .select('id, produto_id, canal_id, regra_id')
    .eq('empresa_id', guarda.empresaId)
    .not('produto_id', 'is', null)

  if (Array.isArray(anuncioIds) && anuncioIds.length > 0) {
    consulta = consulta.in('id', anuncioIds.slice(0, 5000))
  } else if (canalId) {
    consulta = consulta.eq('canal_id', canalId)
  } else if (!tudo) {
    return NextResponse.json({ ok: false, erro: 'Diga o que enfileirar: anuncioIds, canalId ou tudo.' }, { status: 400 })
  }

  // Paginado: o PostgREST corta em 1000 linhas sem avisar, e um canal grande
  // passa disso com folga.
  type Linha = { id: string; produto_id: string | null; canal_id: string; regra_id: string | null }
  const linhas: Linha[] = []
  for (let offset = 0; offset < 50 * 1000; offset += 1000) {
    const { data, error } = await consulta.order('id', { ascending: true }).range(offset, offset + 999)
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
    const pagina = (data ?? []) as Linha[]
    linhas.push(...pagina)
    if (pagina.length < 1000) break
  }

  // SÓ CANAIS QUE ACEITAM ENVIO. Enfileirar produto de um canal desligado
  // encheria a fila de linhas `canal_desligado` e empurraria para trás os
  // produtos que têm para onde ir — a rodada tem teto.
  const { data: canais } = await sb
    .from('marketplace_canais')
    .select('id, plataforma, sincronizar_estoque, atualizar_estoque_canal')
    .eq('empresa_id', guarda.empresaId)
  const enviaveis = new Set(
    (canais ?? []).filter(c => canalAceitaEnvio(c)).map((c: { id: string }) => c.id))

  const uteis = linhas.filter(l => enviaveis.has(l.canal_id))
  const semRegra = uteis.filter(l => !l.regra_id).length
  const produtoIds = [...new Set(uteis.map(l => l.produto_id).filter(Boolean) as string[])]

  if (produtoIds.length === 0) {
    return NextResponse.json({
      ok: true, enfileirados: 0, anuncios: 0, semRegra,
      erro: linhas.length > 0
        ? 'Nenhum destes anúncios está em canal que aceita envio (Configurar → canal).'
        : undefined,
    })
  }

  const agora = new Date().toISOString()
  for (let i = 0; i < produtoIds.length; i += LOTE) {
    const { error } = await sb.from('marketplace_fila').upsert(
      produtoIds.slice(i, i + LOTE).map(produto_id => ({
        empresa_id: guarda.empresaId,
        produto_id,
        sujo_em: agora,
        motivo: 'pedido manual (regra ou reconciliação)',
        prioridade: 0,
        // "Pendente" nesta fila é `enviado_em IS NULL` — ver
        // supabase-fila-pendente-consertar.sql. Sem zerar aqui, reenfileirar
        // não faria o produto voltar a ser atendido.
        enviado_em: null,
        tentativas: 0,
      })),
      { onConflict: 'empresa_id,produto_id' },
    )
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    enfileirados: produtoIds.length,
    anuncios: uteis.length,
    // Anúncio sem regra é enfileirado do mesmo jeito (a fila espelha o estoque
    // do produto), mas quem acabou de aplicar uma regra em massa precisa saber
    // se sobrou algum de fora.
    semRegra,
  })
}
