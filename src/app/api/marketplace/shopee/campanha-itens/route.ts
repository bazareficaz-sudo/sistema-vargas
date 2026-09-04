import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { refreshAccessTokenIfNeeded } from '@/lib/shopee/client'
import { adicionarItens, atualizarItens, removerItem, type ItemParaCampanha } from '@/lib/shopee/discountWrite'
import { economiaDosItens } from '@/lib/marketplace/economiaCampanha'
import { avaliarParaCampanha, resumirVeredito, type Veredito } from '@/lib/marketplace/travaCampanha'
import type { ShopeeChannel } from '@/lib/shopee/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// INCLUIR, ALTERAR E REMOVER ITENS DE UMA CAMPANHA DA SHOPEE.
//
// A PRIMEIRA ESCRITA DESTE SISTEMA EM CAMPANHA. Preco promocional e preco no
// ar, com prazo: a "Bota Fora" vai ate 31/10, e um item que entra errado vende
// errado por dois meses antes de alguem somar.
//
// POR ISSO A ROTA TEM DOIS MODOS. `simular: true` calcula tudo, aplica a trava
// e devolve o veredito de cada item SEM chamar a Shopee. A tela usa isso para
// mostrar o que vai acontecer antes de o operador confirmar. Sem o modo de
// simulacao, a unica forma de saber o resultado seria produzi-lo.
//
// A TRAVA NAO E CONSELHO. Item sem custo calculavel nao passa nem com
// confirmacao: mandar as cegas para uma campanha com prazo e o pior dos casos.
// Prejuizo e margem abaixo do piso passam COM confirmacao explicita — sao
// decisoes comerciais legitimas (queima de estoque parado), e o que nao pode
// e acontecerem sem ninguem ver o numero.

type Corpo = {
  canalId?: string
  /** `id_externo` da campanha na Shopee. */
  discountId?: string
  acao?: 'adicionar' | 'atualizar' | 'remover'
  /** Calcula e devolve o veredito sem chamar a Shopee. */
  simular?: boolean
  /** Confirmacao de quem opera, para itens que exigem. */
  confirmado?: boolean
  itens?: {
    /** Id do anuncio NO SISTEMA — a rota resolve o id externo. */
    anuncioId: string
    precoPromocional: number
    modelId?: string | number | null
    limitePorCompra?: number
    estoquePromocao?: number
  }[]
}

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({})) as Corpo
  const { canalId, discountId, acao = 'adicionar' } = body
  const itens = body.itens ?? []
  if (!canalId || !discountId) {
    return NextResponse.json({ ok: false, erro: 'Informe o canal e a campanha.' }, { status: 400 })
  }
  if (itens.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nenhum item informado.' }, { status: 400 })
  }

  const { data: row } = await sb.from('marketplace_canais')
    .select('id, nome, plataforma, empresa_id, seller_id, access_token, refresh_token, token_expira_em')
    .eq('id', canalId).eq('empresa_id', guarda.empresaId).eq('plataforma', 'shopee').maybeSingle()
  if (!row?.access_token) {
    return NextResponse.json({ ok: false, erro: 'Canal Shopee não encontrado ou não conectado.' }, { status: 404 })
  }

  // A CAMPANHA PRECISA SER DESTE CANAL. Sem esta checagem, um `discountId` de
  // outra loja passaria adiante — a Shopee recusaria, mas so depois de a
  // chamada sair, e o erro dela nao diria o que aconteceu.
  const { data: campanha } = await sb.from('marketplace_promocoes')
    .select('id, nome, status, id_externo')
    .eq('canal_id', canalId).eq('id_externo', discountId).maybeSingle()
  if (!campanha) {
    return NextResponse.json({
      ok: false,
      erro: 'Campanha não encontrada neste canal. Use "Puxar campanhas da Shopee" antes.',
    }, { status: 404 })
  }
  if (campanha.status === 'encerrada') {
    return NextResponse.json({ ok: false, erro: `A campanha "${campanha.nome}" está encerrada.` }, { status: 400 })
  }

  const { data: anuncios } = await sb.from('marketplace_anuncios')
    .select('id, id_externo, titulo, preco_venda')
    .eq('empresa_id', guarda.empresaId).eq('canal_id', canalId)
    .in('id', itens.map(i => i.anuncioId))
  // Tipado porque o cliente do Supabase e `any` e o Map sairia sem forma —
  // o compilador precisa cobrar quando uma coluna sair do select acima.
  type AnuncioLinha = { id: string; id_externo: string | null; titulo: string | null; preco_venda: number | null }
  const porId = new Map<string, AnuncioLinha>((anuncios ?? []).map((a: AnuncioLinha) => [a.id, a]))

  // ── REMOVER: nao precisa de economia, so do id externo ──────────────────
  if (acao === 'remover') {
    let canal: ShopeeChannel = {
      id: row.id, empresaId: row.empresa_id, sellerId: row.seller_id,
      accessToken: row.access_token, refreshToken: row.refresh_token, tokenExpiraEm: row.token_expira_em,
    }
    canal = await refreshAccessTokenIfNeeded(sb, canal)

    const resultados = []
    for (const i of itens) {
      const a = porId.get(i.anuncioId)
      if (!a?.id_externo) { resultados.push({ anuncioId: i.anuncioId, ok: false, erro: 'anúncio sem id no canal' }); continue }
      const r = await removerItem({ sb, canal }, discountId, Number(a.id_externo), i.modelId ? Number(i.modelId) : undefined)
      resultados.push({ anuncioId: i.anuncioId, titulo: a.titulo, ok: r.ok, erro: r.erro, mensagem: r.mensagem })
      await new Promise(res => setTimeout(res, 300))
    }
    return NextResponse.json({ ok: resultados.every(r => r.ok), acao: 'remover', resultados })
  }

  // ── VARIAÇÕES: preço e CUSTO podem ser por modelo ──────────────────────
  //
  // `marketplace_anuncio_variacoes.produto_id` existe e esta preenchido em 49
  // das 225 variacoes da Shp Ouro. Quando a variacao aponta para produto
  // proprio, o custo dela e OUTRO — calcular a margem pelo produto do anuncio
  // daria o numero errado justamente onde as variacoes diferem de preco.
  const modelIds = itens.map(i => i.modelId).filter(Boolean).map(String)
  const { data: variacoes } = modelIds.length
    ? await sb.from('marketplace_anuncio_variacoes')
        .select('anuncio_id, model_id, nome_variacao, preco, produto_id')
        .eq('empresa_id', guarda.empresaId)
        .in('anuncio_id', [...new Set(itens.map(i => i.anuncioId))])
    : { data: [] }
  type VariacaoLinha = { anuncio_id: string; model_id: string; nome_variacao: string | null; preco: number | null; produto_id: string | null }
  const porModelo = new Map<string, VariacaoLinha>(
    (variacoes ?? []).map((v: VariacaoLinha) => [`${v.anuncio_id}|${v.model_id}`, v]))

  // ── A ECONOMIA DE CADA ITEM, pela mesma engine do recálculo ─────────────
  const paraCalculo = itens.map((i, idx) => {
    const vari = i.modelId ? porModelo.get(`${i.anuncioId}|${i.modelId}`) : null
    return {
      id: String(idx),
      anuncio_id: i.anuncioId,
      // O preço "de" da variação é o dela, não o do anúncio: numa tesoura com
      // dois modelos a R$ 24,90 e R$ 21,79, comparar os dois contra um preço
      // só faria um desconto parecer maior que o outro sem ser.
      preco_original: vari?.preco ?? porId.get(i.anuncioId)?.preco_venda ?? null,
      preco_promocional: i.precoPromocional,
      produto_id_override: vari?.produto_id ?? null,
    }
  })
  const economia = await economiaDosItens(sb, guarda.empresaId, row, paraCalculo)

  const { data: regra } = await sb.from('marketplace_regras_preco')
    .select('margem_minima').eq('canal_id', canalId).eq('ativo', true)
    .order('created_at').limit(1).maybeSingle()
  const piso = regra?.margem_minima != null ? Number(regra.margem_minima) : null

  /** O preço "de" é o da VARIAÇÃO quando existe; só então o do anúncio. */
  function precoNormalDe(i: { anuncioId: string; modelId?: string | number | null }, a?: AnuncioLinha) {
    const vari = i.modelId ? porModelo.get(`${i.anuncioId}|${i.modelId}`) : null
    const p = vari?.preco ?? a?.preco_venda
    return p != null ? Number(p) : null
  }

  const avaliados = itens.map((i, idx) => {
    const a = porId.get(i.anuncioId)
    const ec = economia.get(String(idx))
    const veredito: Veredito = avaliarParaCampanha({
      precoPromocional: i.precoPromocional,
      cenario: ec?.promocional ?? null,
      pisoMargem: piso,
      precoNormal: precoNormalDe(i, a),
    })
    const vari = i.modelId ? porModelo.get(`${i.anuncioId}|${i.modelId}`) : null
    return {
      anuncioId: i.anuncioId,
      modelId: i.modelId ?? null,
      variacao: vari?.nome_variacao ?? null,
      titulo: a?.titulo ?? '(anúncio não encontrado)',
      idExterno: a?.id_externo ?? null,
      precoNormal: precoNormalDe(i, a),
      precoPromocional: i.precoPromocional,
      margem: ec?.promocional?.resultado.margemLiquida ?? null,
      lucro: ec?.promocional?.resultado.lucro ?? null,
      semEconomia: ec?.semEconomia ?? null,
      veredito,
    }
  })

  const resumo = resumirVeredito(avaliados.map(a => a.veredito))

  // MODO SIMULACAO: devolve o que aconteceria, sem chamar a Shopee.
  if (body.simular) {
    return NextResponse.json({ ok: true, simulacao: true, campanha: campanha.nome, resumo, itens: avaliados })
  }

  if (resumo.bloqueados > 0) {
    return NextResponse.json({
      ok: false, resumo, itens: avaliados,
      erro: `${resumo.bloqueados} item(ns) não podem ser enviados. Corrija antes de continuar.`,
    }, { status: 400 })
  }
  if (resumo.exigemConfirmacao > 0 && !body.confirmado) {
    return NextResponse.json({
      ok: false, precisaConfirmar: true, resumo, itens: avaliados,
      erro: `${resumo.exigemConfirmacao} item(ns) ficam abaixo do piso ou no prejuízo. Confirme para continuar.`,
    }, { status: 409 })
  }

  const semIdExterno = avaliados.filter(a => !a.idExterno)
  if (semIdExterno.length > 0) {
    return NextResponse.json({
      ok: false, erro: `${semIdExterno.length} anúncio(s) sem id no canal — não vieram de sincronização.`,
    }, { status: 400 })
  }

  let canal: ShopeeChannel = {
    id: row.id, empresaId: row.empresa_id, sellerId: row.seller_id,
    accessToken: row.access_token, refreshToken: row.refresh_token, tokenExpiraEm: row.token_expira_em,
  }
  canal = await refreshAccessTokenIfNeeded(sb, canal)

  // UM `item_id` POR ENTRADA, com todas as variacoes dentro.
  //
  // A primeira versao mandava uma entrada por modelo, entao um anuncio com
  // tres variacoes virava tres entradas com o MESMO `item_id` — que e o
  // formato que a leitura ja mostrou nao ser o dela: la o item aparece uma vez
  // com `model_list` dentro. Mandar repetido pediria para a Shopee decidir
  // qual vale.
  const porItemExterno = new Map<number, ItemParaCampanha>()
  itens.forEach((i, idx) => {
    const a = avaliados[idx]
    const itemId = Number(a.idExterno)
    let entrada = porItemExterno.get(itemId)
    if (!entrada) {
      entrada = { itemId }
      if (i.limitePorCompra != null) entrada.limitePorCompra = i.limitePorCompra
      porItemExterno.set(itemId, entrada)
    }
    if (i.modelId) {
      entrada.modelos = entrada.modelos ?? []
      entrada.modelos.push({
        modelId: Number(i.modelId),
        precoPromocional: i.precoPromocional,
        estoquePromocao: i.estoquePromocao,
      })
    } else {
      entrada.precoPromocional = i.precoPromocional
      if (i.estoquePromocao != null) entrada.estoquePromocao = i.estoquePromocao
    }
  })
  const paraShopee: ItemParaCampanha[] = [...porItemExterno.values()]

  const r = acao === 'atualizar'
    ? await atualizarItens({ sb, canal }, discountId, paraShopee)
    : await adicionarItens({ sb, canal }, discountId, paraShopee)

  await sb.from('marketplace_sync_log').insert({
    canal_id: canalId,
    tipo: acao === 'atualizar' ? 'campanha_atualizar_itens' : 'campanha_adicionar_itens',
    status: r.ok ? 'ok' : 'erro',
    mensagem: r.ok
      ? `${itens.length} item(ns) em "${campanha.nome}"`
      : `${r.erro}: ${r.mensagem}`,
    detalhes: { discountId, itens: avaliados.map(a => ({ titulo: a.titulo, preco: a.precoPromocional, margem: a.margem })), recusados: r.recusados },
  })

  return NextResponse.json({
    ok: r.ok,
    acao,
    campanha: campanha.nome,
    // O ERRO CRU DA SHOPEE VAI INTEIRO. Se a recusa vier pelo status da
    // campanha — a duvida que a sonda nao respondeu —, quem le precisa da
    // mensagem dela, nao de uma frase nossa por cima.
    erro: r.erro || undefined,
    mensagem: r.mensagem || undefined,
    recusados: r.recusados,
    itens: avaliados,
  }, { status: r.ok ? 200 : 502 })
}
