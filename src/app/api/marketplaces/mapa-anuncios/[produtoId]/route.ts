import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, temPermissao } from '@/lib/auth/permissoes'
import { calcularKit } from '@/lib/produtos/kit'

// Acha anúncios de um produto (kit ou não) — direto por produto_id, e via
// marketplace_anuncio_variacoes.produto_id (anúncios Shopee com variação
// mapeiam produto no nível da variação, não do anúncio). Deduplica.
async function buscarAnunciosDoProduto(sb: any, empresaId: string, produtoId: string) {
  const [diretos, variacoes] = await Promise.all([
    sb.from('marketplace_anuncios').select('*').eq('empresa_id', empresaId).eq('produto_id', produtoId),
    sb.from('marketplace_anuncio_variacoes').select('anuncio_id').eq('empresa_id', empresaId).eq('produto_id', produtoId),
  ])
  const anunciosMap = new Map<string, any>()
  for (const a of diretos.data ?? []) anunciosMap.set(a.id, a)
  const idsFaltando = [...new Set<string>((variacoes.data ?? []).map((v: any) => v.anuncio_id))].filter(id => !anunciosMap.has(id))
  if (idsFaltando.length > 0) {
    const { data: extras } = await sb.from('marketplace_anuncios').select('*').in('id', idsFaltando)
    for (const a of extras ?? []) anunciosMap.set(a.id, a)
  }
  return [...anunciosMap.values()]
}

function margemPct(precoVenda: number | null, precoCusto: number | null): number | null {
  if (!precoVenda || precoVenda <= 0 || precoCusto == null) return null
  return ((precoVenda - precoCusto) / precoVenda) * 100
}

function statusPorCanal(canaisAtivos: any[], anuncios: any[], preferencias: any[]) {
  return canaisAtivos.map(canal => {
    const anunciosCanal = anuncios.filter(a => a.canal_id === canal.id && a.status !== 'encerrado')
    const pref = preferencias.find(p => p.canal_id === canal.id)
    if (anunciosCanal.length > 0) {
      return { canalId: canal.id, canalNome: canal.nome, plataforma: canal.plataforma, status: 'anunciado' as const }
    }
    if (pref?.nao_anunciar) {
      return { canalId: canal.id, canalNome: canal.nome, plataforma: canal.plataforma, status: 'ignorado' as const, observacao: pref.observacao ?? null }
    }
    return {
      canalId: canal.id, canalNome: canal.nome, plataforma: canal.plataforma, status: 'sem_anuncio' as const,
      observacao: pref?.observacao ?? null,
      motivo: `Produto cadastrado, mas sem anúncio no ${canal.nome}`,
    }
  })
}

export async function GET(req: Request, { params }: { params: Promise<{ produtoId: string }> }) {
  const { produtoId } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })
  const podeVerCustos = temPermissao(guarda.role, 'ver_custos_margens')

  const { data: produto } = await sb.from('produtos').select('*').eq('id', produtoId).eq('empresa_id', guarda.empresaId).single()
  if (!produto) return NextResponse.json({ ok: false, erro: 'Produto não encontrado' }, { status: 404 })

  const [canaisRes, estoqueRes, depositosRes, kitItensRes] = await Promise.all([
    sb.from('marketplace_canais').select('id, nome, plataforma, ativo').eq('empresa_id', guarda.empresaId),
    sb.from('produto_estoque').select('deposito_id, quantidade').eq('empresa_id', guarda.empresaId).eq('produto_id', produtoId),
    sb.from('depositos').select('id, nome').eq('empresa_id', guarda.empresaId),
    sb.from('kit_itens').select('kit_id, quantidade').eq('produto_id', produtoId),
  ])

  const canaisAtivos = (canaisRes.data ?? []).filter((c: any) => c.ativo)
  const depositoNomePorId = new Map((depositosRes.data ?? []).map((d: any) => [d.id, d.nome]))
  const estoquePorDeposito = (estoqueRes.data ?? []).map((e: any) => ({
    depositoId: e.deposito_id, depositoNome: depositoNomePorId.get(e.deposito_id) ?? '—', quantidade: Number(e.quantidade) || 0,
  }))

  // Kits que usam este produto como componente
  const kitIds = [...new Set((kitItensRes.data ?? []).map((k: any) => k.kit_id))]
  const { data: kitsInfo } = kitIds.length > 0
    ? await sb.from('produtos').select('id, nome, sku, preco_venda').in('id', kitIds).eq('empresa_id', guarda.empresaId)
    : { data: [] as any[] }
  const quantidadePorKit = new Map((kitItensRes.data ?? []).map((k: any) => [k.kit_id, Number(k.quantidade) || 0]))

  const { data: preferencias } = await sb.from('produto_canal_preferencias')
    .select('produto_id, canal_id, nao_anunciar, observacao')
    .in('produto_id', [produtoId, ...kitIds])

  const preferenciasDe = (id: string) => (preferencias ?? []).filter((p: any) => p.produto_id === id)

  const anunciosProduto = await buscarAnunciosDoProduto(sb, guarda.empresaId, produtoId)
  const canalPorId = new Map(canaisRes.data?.map((c: any) => [c.id, c]))
  const anunciosProdutoMontados = anunciosProduto.map(a => montarAnuncio(a, canalPorId, produto.preco_custo, podeVerCustos))

  const kits = await Promise.all((kitsInfo ?? []).map(async (kit: any) => {
    const [resultadoKit, anunciosKit] = await Promise.all([
      calcularKit(sb, kit.id),
      buscarAnunciosDoProduto(sb, guarda.empresaId, kit.id),
    ])
    const anunciosKitMontados = anunciosKit.map(a => montarAnuncio(a, canalPorId, resultadoKit?.custo ?? null, podeVerCustos))
    const canaisKit = statusPorCanal(canaisAtivos, anunciosKit, preferenciasDe(kit.id))
    return {
      kitId: kit.id, nome: kit.nome, sku: kit.sku,
      quantidadeComponente: quantidadePorKit.get(kit.id) ?? 1,
      estoquePossivel: resultadoKit?.estoque ?? null,
      custo: podeVerCustos ? (resultadoKit?.custo ?? null) : undefined,
      precoVenda: kit.preco_venda,
      margem: podeVerCustos ? margemPct(kit.preco_venda, resultadoKit?.custo ?? null) : undefined,
      anunciado: anunciosKitMontados.some(a => a.status !== 'encerrado'),
      anuncios: anunciosKitMontados,
      canais: canaisKit,
    }
  }))

  const canaisProduto = statusPorCanal(canaisAtivos, anunciosProduto, preferenciasDe(produtoId))

  // Empresas do mesmo grupo/tenant — só se o usuário tiver a permissão.
  // Casamento é por SKU/EAN (cada empresa tem seu próprio catálogo de
  // produtos, produto_id não é compartilhado entre empresas).
  let empresasGrupo: any[] | null = null
  if (temPermissao(guarda.role, 'ver_dados_grupo') && guarda.tenantId) {
    const { data: irmas } = await sb.from('empresas').select('id, nome, nome_fantasia')
      .eq('tenant_id', guarda.tenantId).neq('id', guarda.empresaId)
    empresasGrupo = await Promise.all((irmas ?? []).map(async (empresa: any) => {
      let produtoIrmao: any = null
      if (produto.sku) {
        const { data } = await sb.from('produtos').select('id').eq('empresa_id', empresa.id).eq('sku', produto.sku).maybeSingle()
        produtoIrmao = data
      }
      if (!produtoIrmao && produto.ean) {
        const { data } = await sb.from('produtos').select('id').eq('empresa_id', empresa.id).eq('ean', produto.ean).maybeSingle()
        produtoIrmao = data
      }
      if (!produtoIrmao) {
        return { empresaId: empresa.id, empresaNome: empresa.nome_fantasia ?? empresa.nome, produtoEncontrado: false, canais: [] }
      }
      const [canaisIrmaRes, anunciosIrma] = await Promise.all([
        sb.from('marketplace_canais').select('id, nome, plataforma, ativo').eq('empresa_id', empresa.id),
        buscarAnunciosDoProduto(sb, empresa.id, produtoIrmao.id),
      ])
      const canalPorIdIrma = new Map(canaisIrmaRes.data?.map((c: any) => [c.id, c]))
      const canaisAtivosIrma = (canaisIrmaRes.data ?? []).filter((c: any) => c.ativo)
      return {
        empresaId: empresa.id, empresaNome: empresa.nome_fantasia ?? empresa.nome, produtoEncontrado: true,
        canais: statusPorCanal(canaisAtivosIrma, anunciosIrma, []),
      }
    }))
  }

  // Checklist de dados mínimos pra anunciar (seção 11 do pedido original)
  const dadosMinimos = {
    titulo: !!produto.nome,
    imagem: !!produto.foto_url,
    preco: Number(produto.preco_venda) > 0,
    categoria: !!produto.categoria,
    peso: produto.peso_kg != null,
    medidas: produto.altura_cm != null && produto.largura_cm != null && produto.comprimento_cm != null,
    estoque: Number(produto.estoque) > 0,
  }

  const totalAnuncios = anunciosProdutoMontados.length + kits.reduce((s, k) => s + k.anuncios.length, 0)
  const canaisComAnuncio = new Set([
    ...canaisProduto.filter(c => c.status === 'anunciado').map(c => c.canalId),
    ...kits.flatMap(k => k.canais.filter(c => c.status === 'anunciado').map(c => c.canalId)),
  ]).size
  const canaisSemAnuncioTotal = canaisProduto.filter(c => c.status === 'sem_anuncio').length
    + kits.reduce((s, k) => s + k.canais.filter(c => c.status === 'sem_anuncio').length, 0)
  const margemProduto = margemPct(produto.preco_venda, produto.preco_custo)
  const alertaMargemRuim = (podeVerCustos && margemProduto !== null && margemProduto < 10)
    || kits.some(k => podeVerCustos && k.margem != null && (k.margem as number) < 10)

  return NextResponse.json({
    ok: true,
    produto: {
      id: produto.id, nome: produto.nome, sku: produto.sku, ean: produto.ean, tipo: produto.tipo,
      marca: produto.marca, categoria: produto.categoria, fotoUrl: produto.foto_url,
      ativo: produto.ativo, estoque: produto.estoque,
      precoVenda: produto.preco_venda,
      precoCusto: podeVerCustos ? produto.preco_custo : undefined,
      margem: podeVerCustos ? margemProduto : undefined,
      dadosMinimos,
    },
    estoquePorDeposito,
    anuncios: anunciosProdutoMontados,
    canais: canaisProduto,
    kits,
    empresasGrupo,
    resumo: {
      totalAnuncios, canaisComAnuncio, totalKits: kits.length,
      kitsAnunciados: kits.filter(k => k.anunciado).length,
      kitsNaoAnunciados: kits.filter(k => !k.anunciado).length,
      canaisSemAnuncio: canaisSemAnuncioTotal,
      alertaMargemRuim,
    },
  })
}

function montarAnuncio(a: any, canalPorId: Map<string, any>, custoReferencia: number | null, podeVerCustos: boolean) {
  const canal = canalPorId.get(a.canal_id)
  return {
    id: a.id, canalId: a.canal_id, canalNome: canal?.nome ?? '—', plataforma: canal?.plataforma ?? '—',
    titulo: a.titulo, idExterno: a.id_externo, urlAnuncio: a.url_anuncio, skuCanal: a.sku_canal,
    status: a.status, precoVenda: a.preco_venda, estoqueExterno: a.estoque_externo,
    temVariacao: a.tem_variacao, sincronizadoEm: a.sincronizado_em ?? a.ultima_atualizacao_externa,
    margem: podeVerCustos ? margemPct(a.preco_venda, custoReferencia) : undefined,
  }
}
