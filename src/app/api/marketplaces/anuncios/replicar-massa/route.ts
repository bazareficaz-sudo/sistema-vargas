import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { criarAnuncio as criarAnuncioShopee, getLogisticsChannels } from '@/lib/shopee/listing'
import { criarAnuncio as criarAnuncioML, getAtributos, getTiposAnuncio } from '@/lib/mercadolivre/listing'
import type { ShopeeChannel } from '@/lib/shopee/types'
import type { MLChannel } from '@/lib/mercadolivre/types'

// Replica vários anúncios já trabalhados pra outra conta (canal) do MESMO
// marketplace, de uma vez.
//
// Só mesma plataforma de propósito: entre Shopee e Mercado Livre a categoria
// e os atributos teriam que ser adivinhados item a item, e adivinhar em massa
// e sem revisão é justamente o que produz catálogo ruim. Cruzar plataformas
// continua sendo pelo fluxo individual, onde o operador confere.

export const maxDuration = 300

// Cada item é uma criação de anúncio de verdade (upload de imagens + chamada
// da API), então o lote é limitado pra caber na janela da função. O que passar
// disso volta como "não processado" — explícito, nunca truncado em silêncio.
const MAX_POR_LOTE = 15

type Resultado = { anuncioId: string; titulo: string; ok: boolean; itemId?: string; erro?: string }

export async function POST(req: Request) {
  const { anuncioIds, canalDestinoId } = await req.json() as { anuncioIds: string[]; canalDestinoId: string }
  if (!Array.isArray(anuncioIds) || anuncioIds.length === 0 || !canalDestinoId) {
    return NextResponse.json({ ok: false, erro: 'anuncioIds/canalDestinoId ausente' }, { status: 400 })
  }

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: destino } = await sb.from('marketplace_canais')
    .select('id, nome, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em')
    .eq('id', canalDestinoId).eq('empresa_id', empresaId).maybeSingle()
  if (!destino) return NextResponse.json({ ok: false, erro: 'Canal de destino não encontrado' }, { status: 404 })
  if (!destino.access_token) return NextResponse.json({ ok: false, erro: 'Canal de destino não conectado — refaça a autenticação em Configurar.' }, { status: 400 })

  const idsDoLote = anuncioIds.slice(0, MAX_POR_LOTE)
  const naoProcessados = anuncioIds.slice(MAX_POR_LOTE)

  const { data: origens } = await sb.from('marketplace_anuncios')
    .select('id, produto_id, titulo, descricao, categoria_externa, dados_brutos, canal_id, tem_variacao')
    .eq('empresa_id', empresaId).in('id', idsDoLote)

  const { data: canaisOrigem } = await sb.from('marketplace_canais')
    .select('id, plataforma').eq('empresa_id', empresaId)
  const plataformaPorCanal = new Map((canaisOrigem ?? []).map(c => [c.id, c.plataforma]))

  // Anúncios que o canal de destino já tem, pra não criar duplicado.
  const { data: jaNoDestino } = await sb.from('marketplace_anuncios')
    .select('produto_id').eq('canal_id', canalDestinoId).not('produto_id', 'is', null)
  const produtosJaNoDestino = new Set((jaNoDestino ?? []).map(a => a.produto_id))

  const resultados: Resultado[] = []

  // Dados que valem pro lote inteiro, buscados uma vez só.
  let logisticaShopee: number[] = []
  let tipoAnuncioML = ''
  if (destino.plataforma === 'shopee') {
    const canal: ShopeeChannel = {
      id: destino.id, empresaId: destino.empresa_id, sellerId: destino.seller_id,
      accessToken: destino.access_token, refreshToken: destino.refresh_token, tokenExpiraEm: destino.token_expira_em,
    }
    try {
      const canais = await getLogisticsChannels({ sb, canal })
      logisticaShopee = canais.filter(c => c.enabled).map(c => c.logistic_id)
    } catch { /* sem logística resolvida, a criação falha item a item com a mensagem da Shopee */ }
  } else if (destino.plataforma === 'mercadolivre') {
    const canal: MLChannel = {
      id: destino.id, empresaId: destino.empresa_id, sellerId: destino.seller_id,
      accessToken: destino.access_token, refreshToken: destino.refresh_token, tokenExpiraEm: destino.token_expira_em,
    }
    try {
      const tipos = await getTiposAnuncio({ sb, canal })
      tipoAnuncioML = tipos[0]?.id ?? ''
    } catch { /* idem */ }
  }

  for (const origem of origens ?? []) {
    const rotulo = origem.titulo ?? '(sem título)'
    const falhar = (erro: string) => resultados.push({ anuncioId: origem.id, titulo: rotulo, ok: false, erro })

    const plataformaOrigem = plataformaPorCanal.get(origem.canal_id)
    if (plataformaOrigem !== destino.plataforma) { falhar('Plataforma diferente do destino — replique pelo fluxo individual.'); continue }
    if (!origem.produto_id) { falhar('Anúncio sem produto vinculado — mapeie antes de replicar.'); continue }
    if (origem.tem_variacao) { falhar('Anúncio com variações — ainda não é replicado em massa.'); continue }
    if (produtosJaNoDestino.has(origem.produto_id)) { falhar('O produto já tem anúncio nesse canal.'); continue }
    if (!origem.categoria_externa) { falhar('Anúncio de origem sem categoria registrada.'); continue }

    const { data: produto } = await sb.from('produtos')
      .select('id, preco_venda, estoque, peso_kg, comprimento_cm, largura_cm, altura_cm')
      .eq('id', origem.produto_id).eq('empresa_id', empresaId).maybeSingle()
    if (!produto) { falhar('Produto não encontrado.'); continue }

    const { data: imgs } = await sb.from('produto_imagens')
      .select('url, principal').eq('produto_id', origem.produto_id).order('ordem', { ascending: true })
    const fotoUrls = (imgs ?? []).sort((a: any, b: any) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0)).map((i: any) => i.url)
    if (fotoUrls.length === 0) { falhar('Produto sem imagem cadastrada.'); continue }

    const preco = Number(produto.preco_venda ?? 0)
    if (!(preco > 0)) { falhar('Produto sem preço de venda.'); continue }
    const estoque = Number(produto.estoque ?? 0)
    const brutos: any = origem.dados_brutos ?? {}

    try {
      if (destino.plataforma === 'shopee') {
        // Peso é obrigatório na Shopee: usa o do cadastro e, se faltar, o que
        // estava no próprio anúncio de origem.
        const peso = Number(produto.peso_kg ?? brutos?.weight ?? 0)
        if (!(peso > 0)) { falhar('Produto sem peso cadastrado (a Shopee exige).'); continue }

        const canal: ShopeeChannel = {
          id: destino.id, empresaId: destino.empresa_id, sellerId: destino.seller_id,
          accessToken: destino.access_token, refreshToken: destino.refresh_token, tokenExpiraEm: destino.token_expira_em,
        }
        const r = await criarAnuncioShopee(sb, canal, {
          produtoId: origem.produto_id, empresaId,
          categoryId: Number(origem.categoria_externa),
          titulo: origem.titulo ?? '', descricao: origem.descricao ?? '',
          preco, estoque, pesoKg: peso,
          comprimentoCm: produto.comprimento_cm ?? brutos?.dimension?.package_length ?? undefined,
          larguraCm: produto.largura_cm ?? brutos?.dimension?.package_width ?? undefined,
          alturaCm: produto.altura_cm ?? brutos?.dimension?.package_height ?? undefined,
          // Atributos não vêm do anúncio de origem: a sincronização da Shopee
          // não devolve attribute_list. Categoria que exige atributo
          // obrigatório vai falhar aqui, com a mensagem da própria Shopee —
          // esses ficam pro fluxo individual, onde a IA preenche.
          atributos: [],
          logisticaHabilitada: logisticaShopee,
          fotoUrls,
        })
        if (r.ok) resultados.push({ anuncioId: origem.id, titulo: rotulo, ok: true, itemId: r.itemId })
        else falhar(r.erro)
      } else {
        const canal: MLChannel = {
          id: destino.id, empresaId: destino.empresa_id, sellerId: destino.seller_id,
          accessToken: destino.access_token, refreshToken: destino.refresh_token, tokenExpiraEm: destino.token_expira_em,
        }
        if (!tipoAnuncioML) { falhar('Não foi possível descobrir o tipo de anúncio da conta de destino.'); continue }

        // Peso e medidas são obrigatórios no ML desde a mudança da API. Usa o
        // cadastro e, se faltar, o que veio no próprio anúncio de origem.
        const dimensoes = {
          pesoKg: Number(produto.peso_kg ?? brutos?.weight ?? 0),
          comprimentoCm: Number(produto.comprimento_cm ?? brutos?.dimension?.package_length ?? 0),
          larguraCm: Number(produto.largura_cm ?? brutos?.dimension?.package_width ?? 0),
          alturaCm: Number(produto.altura_cm ?? brutos?.dimension?.package_height ?? 0),
        }
        const semDimensao = Object.entries({
          peso: dimensoes.pesoKg, comprimento: dimensoes.comprimentoCm,
          largura: dimensoes.larguraCm, altura: dimensoes.alturaCm,
        }).filter(([, v]) => !(v > 0)).map(([k]) => k)
        if (semDimensao.length > 0) { falhar(`Produto sem ${semDimensao.join('/')} cadastrado (o Mercado Livre exige).`); continue }

        // Atributos: só os que existem na categoria de destino e, em lista
        // fechada, só quando o valor bate com uma das opções. Mandar
        // atributo de outra categoria faz o ML recusar o anúncio inteiro.
        let atributos: { id: string; valueName: string }[] = []
        try {
          const defs = await getAtributos({ sb, canal }, String(origem.categoria_externa))
          const porId = new Map(defs.map(d => [d.id, d]))
          for (const a of (brutos?.attributes ?? [])) {
            const def = porId.get(a?.id)
            const valor = a?.value_name
            if (!def || typeof valor !== 'string' || !valor.trim()) continue
            if (Array.isArray(def.valores) && def.valores.length > 0) {
              const match = def.valores.find((v: any) => String(v.name).toLowerCase() === valor.toLowerCase())
              if (match) atributos.push({ id: def.id, valueName: match.name })
            } else {
              atributos.push({ id: def.id, valueName: valor.trim() })
            }
          }
        } catch { atributos = [] }

        const r = await criarAnuncioML(sb, canal, {
          produtoId: origem.produto_id, empresaId,
          categoryId: String(origem.categoria_externa),
          titulo: (origem.titulo ?? '').slice(0, 60), descricao: origem.descricao ?? '',
          preco, estoque, condicao: 'new',
          listingTypeId: tipoAnuncioML,
          atributos, fotoUrls, dimensoes,
        })
        if (r.ok) resultados.push({ anuncioId: origem.id, titulo: rotulo, ok: true, itemId: r.itemId })
        else falhar(r.erro)
      }
    } catch (e: any) {
      falhar(e?.message ?? 'Erro inesperado ao criar o anúncio')
    }
  }

  const criados = resultados.filter(r => r.ok).length
  await sb.from('marketplace_sync_log').insert({
    canal_id: canalDestinoId,
    tipo: 'replicar_massa',
    status: criados === resultados.length ? 'ok' : 'erro',
    mensagem: `Replicação em massa: ${criados} de ${resultados.length} criado(s)${naoProcessados.length ? ` — ${naoProcessados.length} não processado(s) por limite de lote` : ''}`,
    detalhes: { resultados, naoProcessados },
  })

  return NextResponse.json({ ok: true, resultados, naoProcessados: naoProcessados.length, limiteLote: MAX_POR_LOTE })
}
