import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'
import { refreshAccessTokenIfNeeded as refreshShopee } from '@/lib/shopee/client'
import { refreshAccessTokenIfNeeded as refreshML } from '@/lib/mercadolivre/client'
import { pushPrecoEstoque } from '@/lib/shopee/write'
import { atualizarPrecoEstoque } from '@/lib/mercadolivre/write'
import { resolverPrecoEfetivo } from '@/lib/precificacao/precos'
import { criarResolvedor } from '@/lib/precificacao/contexto'

// Aplica o recálculo APENAS nos itens que o usuário aprovou na prévia.
//
// A rota nunca recalcula por conta própria: ela recebe o preço já revisado.
// Isso evita a armadilha clássica de a prévia mostrar um número e a aplicação
// gravar outro porque algo mudou no meio do caminho.
//
// PREÇO RETIDO (Fases 1 e 2)
//
// Anúncio cujo preço efetivo NÃO vem do preço base não recebe preço. Gravar
// `preco_venda` enquanto uma campanha da plataforma ou uma promoção local
// está valendo não muda o que o cliente paga: o preço efetivo continua sendo
// o promocional, e o sistema passaria a exibir um número que não está no ar.
//
// A Fase 2 estendeu a trava para CAMPANHA REAL, que é o caso que mais
// importa: quem manda no preço de um item em campanha é a campanha, e o
// endpoint de preço do catálogo não a sobrescreve.
//
// É o mesmo cuidado que a fila de envio já tinha para campanha da Shopee
// (lib/marketplace/fila.ts): "gravar o preço retido faria o espelho jurar que
// o canal está com um número que ele nunca recebeu". A diferença é que o
// aplicar do recálculo não tinha essa trava — agora tem, e diz quantos reteve.

export const maxDuration = 300

const MAX_POR_LOTE = 200

export async function POST(req: Request) {
  const { itens, enviarAoMarketplace } = await req.json() as {
    itens: { anuncioId: string; precoNovo: number; regraId?: string; regraNome?: string; regraObjetivo?: string; custo?: number; margemAtual?: number; margemNova?: number }[]
    enviarAoMarketplace?: boolean
  }

  if (!Array.isArray(itens) || itens.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nenhum item para aplicar' }, { status: 400 })
  }

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: perfil } = await sb.from('profiles').select('nome').eq('id', guarda.userId).maybeSingle()
  const operador = perfil?.nome ?? null

  const doLote = itens.slice(0, MAX_POR_LOTE)
  const naoProcessados = itens.length - doLote.length

  // Traz os anúncios de uma vez e confere a posse aqui — nunca confia no id
  // que veio da tela.
  const { data: anuncios } = await sb.from('marketplace_anuncios')
    .select('id, canal_id, produto_id, id_externo, preco_venda, preco_promocional, promo_inicio, promo_fim, tem_variacao, estoque_reservado, titulo')
    .in('id', doLote.map(i => i.anuncioId))
    .eq('empresa_id', guarda.empresaId)
  const porId = new Map((anuncios ?? []).map((a: any) => [a.id, a]))

  const canaisNecessarios = [...new Set((anuncios ?? []).map((a: any) => a.canal_id))]
  const { data: canaisRows } = await sb.from('marketplace_canais')
    .select('id, nome, plataforma, empresa_id, seller_id, access_token, refresh_token, token_expira_em')
    .in('id', canaisNecessarios).eq('empresa_id', guarda.empresaId)
  const canalPorId = new Map((canaisRows ?? []).map((c: any) => [c.id, c]))
  // Renova o token uma vez por canal, não uma vez por anúncio.
  const canalPronto = new Map<string, any>()

  const resultados: { anuncioId: string; ok: boolean; erro?: string; enviado: boolean }[] = []
  const retidos: { anuncioId: string; titulo: string; motivo: string }[] = []
  const historico: any[] = []
  const agora = new Date()

  // Campanhas dos canais envolvidos: uma consulta por canal, reaproveitada
  // por todos os anúncios do lote.
  const resolvedor = criarResolvedor(sb, guarda.empresaId, agora)
  const campanhasPorCanal = new Map<string, Awaited<ReturnType<typeof resolvedor.campanhas>>>()
  for (const c of canaisRows ?? []) {
    campanhasPorCanal.set(c.id, await resolvedor.campanhas(c))
  }

  for (const item of doLote) {
    const a = porId.get(item.anuncioId)
    if (!a) { resultados.push({ anuncioId: item.anuncioId, ok: false, erro: 'Anúncio não encontrado', enviado: false }); continue }
    const preco = Number(item.precoNovo)
    if (!(preco > 0)) { resultados.push({ anuncioId: item.anuncioId, ok: false, erro: 'Preço inválido', enviado: false }); continue }

    // Campanha ou promoção vigente: o preço novo não teria efeito nenhum,
    // então não grava e não envia — e o operador fica sabendo por quê.
    const precos = resolverPrecoEfetivo({
      anuncio: a, campanhas: campanhasPorCanal.get(a.canal_id) ?? [], agora,
    })
    if (precos.origemEfetivo !== 'base') {
      const de = precos.origemEfetivo === 'campanha'
        ? `a campanha "${precos.campanha?.nome ?? ''}"`
        : 'a promoção local'
      retidos.push({
        anuncioId: a.id, titulo: a.titulo ?? '',
        motivo: `${de} está vigente a R$ ${precos.efetivo.toFixed(2)} — o preço novo não valeria`,
      })
      continue
    }

    const precoAnterior = Number(a.preco_venda ?? 0)

    const { error } = await sb.from('marketplace_anuncios')
      .update({ preco_venda: preco, updated_at: new Date().toISOString() })
      .eq('id', a.id).eq('empresa_id', guarda.empresaId)
    if (error) { resultados.push({ anuncioId: a.id, ok: false, erro: error.message, enviado: false }); continue }

    let enviado = false
    let erroEnvio: string | null = null

    if (enviarAoMarketplace !== false && a.id_externo) {
      const canalRow = canalPorId.get(a.canal_id)
      try {
        if (!canalRow?.access_token) throw new Error('Canal sem conexão ativa')

        if (canalRow.plataforma === 'shopee') {
          if (!canalPronto.has(a.canal_id)) {
            canalPronto.set(a.canal_id, await refreshShopee(sb, {
              id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
              accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token, tokenExpiraEm: canalRow.token_expira_em,
            }))
          }
          const canal = canalPronto.get(a.canal_id)
          // Anúncio com variação: a Shopee cobra preço por variação, e este
          // recálculo trabalha no preço do anúncio. Não invento uma
          // distribuição entre as variações — deixo explícito.
          if (a.tem_variacao) throw new Error('Anúncio com variações — ajuste o preço de cada variação pela tela do anúncio')
          const r = await pushPrecoEstoque({ sb, canal }, Number(a.id_externo), [{ preco }])
          if (!r.precoOk) throw new Error(r.erroPreco ?? 'A Shopee recusou o preço')
          enviado = true
        } else if (canalRow.plataforma === 'mercadolivre') {
          if (!canalPronto.has(a.canal_id)) {
            canalPronto.set(a.canal_id, await refreshML(sb, {
              id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
              accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token, tokenExpiraEm: canalRow.token_expira_em,
            }))
          }
          const canal = canalPronto.get(a.canal_id)
          const r = await atualizarPrecoEstoque(sb, canal, String(a.id_externo), { preco })
          if (!r.ok) throw new Error(r.erro ?? 'O Mercado Livre recusou o preço')
          enviado = true
        }
      } catch (e: any) {
        erroEnvio = e?.message ?? 'Erro ao enviar ao marketplace'
      }
    }

    historico.push({
      empresa_id: guarda.empresaId, anuncio_id: a.id, canal_id: a.canal_id, produto_id: a.produto_id,
      preco_anterior: precoAnterior, preco_novo: preco,
      custo_no_momento: item.custo ?? null,
      margem_anterior: item.margemAtual ?? null, margem_nova: item.margemNova ?? null,
      regra_id: item.regraId ?? null, regra_nome: item.regraNome ?? null, regra_objetivo: item.regraObjetivo ?? null,
      origem: 'recalculo_massa',
      enviado_marketplace: enviado, erro_envio: erroEnvio,
      usuario_id: guarda.userId, usuario_nome: operador,
    })

    resultados.push({ anuncioId: a.id, ok: true, enviado, erro: erroEnvio ?? undefined })
  }

  if (historico.length > 0) await sb.from('precificacao_historico').insert(historico)

  const aplicados = resultados.filter(r => r.ok).length
  const enviados = resultados.filter(r => r.enviado).length

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: 'precos_recalculados', tabela: 'marketplace_anuncios',
    valorNovo: { aplicados, enviados, falhas: resultados.length - aplicados },
  })

  return NextResponse.json({
    ok: true, aplicados, enviados,
    falhas: resultados.filter(r => !r.ok),
    errosEnvio: resultados.filter(r => r.ok && r.erro),
    naoProcessados,
    retidos,
  })
}
