import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { mlGet, refreshAccessTokenIfNeeded } from '@/lib/mercadolivre/client'
import type { MLChannel } from '@/lib/mercadolivre/types'
import {
  atributosDaShopee, atributosDoMercadoLivre, fichaDoAnuncio, imagensDoAnuncio,
  limitesDe, plataformaAceitaEdicao,
} from '@/lib/marketplace/conteudoAnuncio'
import { enviarEdicao, type CamposEdicao, type ImagemEdicao } from '@/lib/marketplace/edicao'

// Editar um anúncio: ler tudo que dá para editar (GET) e gravar (POST).
//
// Uma rota só para as três plataformas, e não uma por marketplace, porque o
// que muda entre elas é o formato do atributo e o endpoint de escrita —
// coisas que já moram em `lib/marketplace/edicao.ts`. Autenticação, posse,
// gravação local e registro no log são idênticos, e duplicá-los três vezes é
// como se erra em um e não nos outros.

/** Sessão + posse. Devolve o anúncio e o canal, ou a resposta de erro pronta. */
async function contexto(id: string) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { erro: NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 }) }

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return { erro: NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 }) }

  // A posse é conferida AQUI, na rota, e não só pela RLS: uma política que
  // barra em silêncio devolve "0 linhas afetadas", que é indistinguível de
  // sucesso para quem chamou.
  const { data: anuncio } = await sb
    .from('marketplace_anuncios')
    .select('id, empresa_id, canal_id, produto_id, titulo, descricao, preco_venda, preco_promocional, promo_inicio, promo_fim, estoque_reservado, estoque_externo, id_externo, url_anuncio, sku_canal, status, status_externo, categoria_externa, marca_externa, imagens, tem_variacao, dados_brutos, vendas, qualidade_score, qualidade_faltas, ultima_atualizacao_externa')
    .eq('id', id).eq('empresa_id', empresaId).maybeSingle()
  if (!anuncio) return { erro: NextResponse.json({ ok: false, erro: 'Anúncio não encontrado' }, { status: 404 }) }

  const { data: canal } = await sb
    .from('marketplace_canais')
    .select('id, nome, plataforma, empresa_id, seller_id, access_token, refresh_token, token_expira_em')
    .eq('id', anuncio.canal_id).eq('empresa_id', empresaId).maybeSingle()
  if (!canal) return { erro: NextResponse.json({ ok: false, erro: 'Canal não encontrado' }, { status: 404 }) }

  return { sb, empresaId, anuncio: anuncio as any, canal: canal as any }
}

// ── Leitura ─────────────────────────────────────────────────────────────────

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contexto(id)
  if (ctx.erro) return ctx.erro
  const { sb, anuncio, canal } = ctx

  const plataforma: string = canal.plataforma
  const brutos: any = anuncio.dados_brutos ?? {}

  // Descrição do Mercado Livre é endpoint separado e o sync de catálogo não a
  // traz — buscar para 7.7 mil anúncios a cada rodada dobraria as chamadas.
  // Uma leitura na hora de editar é barata, e o texto fica gravado: da
  // segunda vez em diante já está no banco.
  let descricao: string = anuncio.descricao ?? ''
  let descricaoBuscadaAgora = false
  if (!descricao.trim() && plataforma === 'mercadolivre' && canal.access_token && anuncio.id_externo) {
    try {
      const canalValido: MLChannel = await refreshAccessTokenIfNeeded(sb, {
        id: canal.id, empresaId: canal.empresa_id, sellerId: canal.seller_id,
        accessToken: canal.access_token, refreshToken: canal.refresh_token,
        tokenExpiraEm: canal.token_expira_em,
      } as MLChannel)
      const resp = await mlGet(`/items/${anuncio.id_externo}/description`, {}, canalValido.accessToken)
      const texto = typeof resp?.plain_text === 'string' && resp.plain_text.trim()
        ? resp.plain_text
        : (typeof resp?.text === 'string' ? resp.text : '')
      if (texto.trim()) {
        descricao = texto
        descricaoBuscadaAgora = true
        await sb.from('marketplace_anuncios').update({ descricao: texto }).eq('id', anuncio.id)
      }
    } catch {
      // Anúncio sem descrição, ou o ML recusou a leitura. Segue sem — o resto
      // da edição continua valendo.
    }
  }

  const { data: variacoes } = await sb
    .from('marketplace_anuncio_variacoes')
    .select('id, model_id, nome_variacao, sku_variacao, preco, estoque, status_externo, produto_id')
    .eq('anuncio_id', anuncio.id)
    .order('nome_variacao', { ascending: true })

  // Fotos do produto do sistema: é delas que sai o "trazer as fotos do
  // cadastro" da aba de imagens. Sem produto vinculado não há de onde trazer.
  let produto: any = null
  if (anuncio.produto_id) {
    const { data: p } = await sb
      .from('produtos')
      .select('id, nome, sku, ean, marca, categoria, preco_venda, preco_custo, estoque, foto_url, peso_kg, comprimento_cm, largura_cm, altura_cm')
      .eq('id', anuncio.produto_id).maybeSingle()
    if (p) {
      const { data: imgs } = await sb
        .from('produto_imagens').select('id, url, principal, ordem')
        .eq('produto_id', p.id).order('ordem', { ascending: true })
      produto = { ...p, imagens: imgs ?? [] }
    }
  }

  return NextResponse.json({
    ok: true,
    anuncio: {
      id: anuncio.id,
      produtoId: anuncio.produto_id,
      titulo: anuncio.titulo ?? '',
      descricao,
      descricaoBuscadaAgora,
      precoVenda: anuncio.preco_venda,
      precoPromocional: anuncio.preco_promocional,
      promoInicio: anuncio.promo_inicio,
      promoFim: anuncio.promo_fim,
      estoqueReservado: anuncio.estoque_reservado,
      estoqueExterno: anuncio.estoque_externo,
      idExterno: anuncio.id_externo,
      urlAnuncio: anuncio.url_anuncio,
      skuCanal: anuncio.sku_canal,
      status: anuncio.status,
      statusExterno: anuncio.status_externo,
      categoriaExterna: anuncio.categoria_externa,
      marcaExterna: anuncio.marca_externa,
      temVariacao: !!anuncio.tem_variacao,
      vendas: anuncio.vendas,
      qualidadeScore: anuncio.qualidade_score,
      qualidadeFaltas: anuncio.qualidade_faltas ?? [],
      atualizadoEm: anuncio.ultima_atualizacao_externa,
    },
    canal: { id: canal.id, nome: canal.nome, plataforma, conectado: !!canal.access_token },
    limites: limitesDe(plataforma),
    aceitaEdicaoNoCanal: plataformaAceitaEdicao(plataforma) && !!canal.access_token && !!anuncio.id_externo,
    imagens: imagensDoAnuncio(plataforma, brutos, anuncio.imagens),
    atributosShopee: plataforma === 'shopee' ? atributosDaShopee(brutos) : [],
    atributosML: plataforma === 'mercadolivre' ? atributosDoMercadoLivre(brutos) : [],
    // `description_type` decide se a descrição pode ser mandada por API.
    tipoDescricao: typeof brutos?.description_type === 'string' ? brutos.description_type : null,
    ficha: fichaDoAnuncio(plataforma, brutos),
    variacoes: variacoes ?? [],
    produto,
  })
}

// ── Gravação ────────────────────────────────────────────────────────────────

type CorpoEdicao = {
  /** Enviar para o marketplace além de gravar aqui. */
  enviar?: boolean
  local?: {
    produtoId?: string | null
    titulo?: string
    descricao?: string | null
    precoVenda?: number | null
    precoPromocional?: number | null
    promoInicio?: string | null
    promoFim?: string | null
    estoqueReservado?: number | null
    skuCanal?: string | null
    idExterno?: string | null
    urlAnuncio?: string | null
    status?: string
    imagens?: string[]
  }
  canal?: CamposEdicao & { imagens?: ImagemEdicao[] }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const corpo: CorpoEdicao = await req.json().catch(() => ({}))
  const ctx = await contexto(id)
  if (ctx.erro) return ctx.erro
  const { sb, anuncio, canal } = ctx

  const local = corpo.local ?? {}
  if (local.titulo != null && !local.titulo.trim()) {
    return NextResponse.json({ ok: false, erro: 'O título não pode ficar vazio.' }, { status: 400 })
  }

  // Lista branca de colunas: o corpo vem do navegador, e um `empresa_id` ou
  // um `canal_id` colado nele mudaria o dono do anúncio.
  const patch: Record<string, any> = { updated_at: new Date().toISOString() }
  if (local.produtoId !== undefined) patch.produto_id = local.produtoId || null
  if (local.titulo !== undefined) patch.titulo = local.titulo.trim()
  if (local.descricao !== undefined) patch.descricao = local.descricao || null
  if (local.precoVenda !== undefined) patch.preco_venda = local.precoVenda ?? 0
  if (local.precoPromocional !== undefined) patch.preco_promocional = local.precoPromocional
  if (local.promoInicio !== undefined) patch.promo_inicio = local.promoInicio || null
  if (local.promoFim !== undefined) patch.promo_fim = local.promoFim || null
  if (local.estoqueReservado !== undefined) patch.estoque_reservado = local.estoqueReservado ?? 0
  if (local.skuCanal !== undefined) patch.sku_canal = local.skuCanal || null
  if (local.idExterno !== undefined) patch.id_externo = local.idExterno || null
  if (local.urlAnuncio !== undefined) patch.url_anuncio = local.urlAnuncio || null
  if (local.status !== undefined) patch.status = local.status
  if (local.imagens !== undefined) patch.imagens = local.imagens

  const { error: erroLocal } = await sb.from('marketplace_anuncios').update(patch).eq('id', anuncio.id)
  if (erroLocal) return NextResponse.json({ ok: false, erro: erroLocal.message }, { status: 400 })

  let envio: { ok: boolean; erro?: string; avisos: string[]; ressincronizado: boolean } | null = null

  if (corpo.enviar) {
    if (!anuncio.id_externo) {
      envio = {
        ok: false, avisos: [], ressincronizado: false,
        erro: 'Este anúncio não tem ID externo — ele não veio de sincronização, então não há o que atualizar no marketplace.',
      }
    } else {
      envio = await enviarEdicao(sb, canal, anuncio.id_externo, corpo.canal ?? {})

      await sb.from('marketplace_sync_log').insert({
        canal_id: canal.id,
        tipo: 'editar_anuncio',
        status: envio.ok ? 'ok' : 'erro',
        mensagem: envio.ok
          ? `Anúncio ${anuncio.id_externo} atualizado${envio.avisos.length > 0 ? ` (${envio.avisos.length} aviso(s))` : ''}`
          : `Falha ao atualizar o anúncio ${anuncio.id_externo}: ${envio.erro}`,
        detalhes: { anuncioId: anuncio.id, idExterno: anuncio.id_externo, avisos: envio.avisos, erro: envio.erro ?? null },
      })
    }
  }

  // Relê sempre: quando houve envio, a linha já foi reescrita pelo sync de
  // volta; quando não houve, é o que acabou de ser gravado. Nos dois casos a
  // tela recebe o estado real em vez do que ela mandou.
  const { data: atualizado } = await sb
    .from('marketplace_anuncios')
    .select('*, produtos(id,nome,sku,preco_venda,estoque,tipo,tags)')
    .eq('id', anuncio.id).single()

  return NextResponse.json({
    ok: envio ? envio.ok : true,
    erro: envio?.erro ?? null,
    avisos: envio?.avisos ?? [],
    enviado: !!envio?.ok,
    ressincronizado: !!envio?.ressincronizado,
    anuncio: atualizado,
  })
}
