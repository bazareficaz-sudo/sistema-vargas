import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { mlGet, refreshAccessTokenIfNeeded } from '@/lib/mercadolivre/client'
import type { MLChannel } from '@/lib/mercadolivre/types'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// Devolve o conteúdo de um anúncio já trabalhado, pra servir de base ao criar
// o mesmo produto em outra conta (canal). Só leitura — quem publica continua
// sendo o fluxo normal de criação, com o operador revisando antes.
//
// O que dá pra reaproveitar depende do par origem→destino:
//  - mesma plataforma: título, descrição, imagens e a CATEGORIA (o id é o
//    mesmo nas duas contas, porque a árvore é da plataforma, não da conta).
//  - mesma plataforma: também os atributos, a condição (novo/usado) e os
//    canais de envio — o sync guarda tudo em dados_brutos, nas duas.
//  - plataformas diferentes: categoria e atributos não se aproveitam (as
//    taxonomias não conversam); vai só o texto e as imagens.
//
// O comentário aqui dizia que a Shopee não trazia atributos. Está errado:
// `dados_brutos.attribute_list` existe nos anúncios sincronizados. Enquanto
// isso valeu, duplicar um anúncio da Shopee jogava fora os atributos e
// obrigava a IA a adivinhá-los de novo.

function atributosDoMercadoLivre(dadosBrutos: any): { id: string; valor: string }[] {
  const lista = dadosBrutos?.attributes
  if (!Array.isArray(lista)) return []
  const atributos: { id: string; valor: string }[] = []
  for (const a of lista) {
    const id = a?.id
    const valor = a?.value_name
    // Atributos de catálogo/somente-leitura do ML não podem ser reenviados na
    // criação — e alguns vêm sem value_name (só struct), inúteis aqui.
    if (typeof id !== 'string' || typeof valor !== 'string' || !valor.trim()) continue
    atributos.push({ id, valor: valor.trim() })
  }
  return atributos
}

// A Shopee devolve cada atributo como uma lista de valores escolhidos.
// value_id 0 é texto livre (o nome digitado vai em original_value_name);
// qualquer outro é opção da lista da categoria — e como o id de atributo e
// de valor pertencem à categoria, não à loja, valem igual num anúncio novo
// da mesma categoria.
function atributosDaShopee(dadosBrutos: any): { attributeId: number; valueIds: number[]; texto?: string; unidade?: string }[] {
  const lista = dadosBrutos?.attribute_list
  if (!Array.isArray(lista)) return []
  const saida: { attributeId: number; valueIds: number[]; texto?: string; unidade?: string }[] = []
  for (const a of lista) {
    const attributeId = Number(a?.attribute_id)
    if (!attributeId) continue
    const valores = Array.isArray(a?.attribute_value_list) ? a.attribute_value_list : []
    const valueIds: number[] = []
    let texto: string | undefined
    let unidade: string | undefined
    for (const v of valores) {
      const id = Number(v?.value_id ?? 0)
      if (id > 0) { valueIds.push(id); continue }
      const nome = v?.original_value_name
      if (typeof nome === 'string' && nome.trim()) {
        texto = nome.trim()
        if (typeof v?.value_unit === 'string' && v.value_unit.trim()) unidade = v.value_unit.trim()
      }
    }
    if (valueIds.length === 0 && !texto) continue
    saida.push({ attributeId, valueIds, texto, unidade })
  }
  return saida
}

// Canais de envio ligados no anúncio de origem. Fazem parte do "resto igual"
// numa duplicação: publicar sem eles deixaria o anúncio novo sem frete.
function logisticaDaShopee(dadosBrutos: any): number[] {
  const lista = dadosBrutos?.logistic_info
  if (!Array.isArray(lista)) return []
  return lista.filter((l: any) => l?.enabled).map((l: any) => Number(l.logistic_id)).filter(Boolean)
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: anuncio } = await sb
    .from('marketplace_anuncios')
    .select('id, empresa_id, canal_id, produto_id, titulo, descricao, preco_venda, imagens, categoria_externa, marca_externa, dados_brutos, tem_variacao, id_externo')
    .eq('id', id).eq('empresa_id', empresaId).maybeSingle()

  if (!anuncio) return NextResponse.json({ ok: false, erro: 'Anúncio não encontrado' }, { status: 404 })

  const { data: canal } = await sb
    .from('marketplace_canais')
    .select('id, nome, plataforma, empresa_id, seller_id, access_token, refresh_token, token_expira_em')
    .eq('id', anuncio.canal_id).maybeSingle()

  const plataforma = canal?.plataforma ?? null
  const brutos: any = anuncio.dados_brutos ?? {}

  // Descrição do Mercado Livre: buscada AQUI, na hora, porque o sync de
  // catálogo não a traz — no ML ela é um endpoint separado, e puxá-la para
  // 7.693 anúncios a cada rodada dobraria as chamadas. O resultado disso era
  // que replicar e duplicar um anúncio do ML sempre vinham com a descrição
  // vazia: o campo estava nulo em 100% deles.
  //
  // Uma chamada por replicação é barato, e o texto é gravado de volta — da
  // segunda vez em diante já está no banco.
  let descricao = anuncio.descricao ?? ''
  let descricaoBuscadaAgora = false
  if (!descricao.trim() && plataforma === 'mercadolivre' && canal?.access_token) {
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
      // Anúncio sem descrição, ou o ML recusou a leitura dela. Segue sem — o
      // resto do conteúdo continua valendo para a replicação.
    }
  }

  return NextResponse.json({
    ok: true,
    origem: {
      anuncioId: anuncio.id,
      canalId: canal?.id ?? null,
      canalNome: canal?.nome ?? '—',
      plataforma,
      produtoId: anuncio.produto_id,
      titulo: anuncio.titulo ?? '',
      descricao,
      // A tela avisa quando o texto veio do marketplace agora, em vez de já
      // estar no banco — é a diferença entre "sem descrição" e "buscada".
      descricaoBuscadaAgora,
      imagens: Array.isArray(anuncio.imagens) ? anuncio.imagens.filter((u: unknown) => typeof u === 'string') : [],
      preco: anuncio.preco_venda ?? null,
      categoriaExterna: anuncio.categoria_externa ?? null,
      marcaExterna: anuncio.marca_externa ?? null,
      temVariacao: !!anuncio.tem_variacao,
      atributos: plataforma === 'mercadolivre' ? atributosDoMercadoLivre(brutos) : [],
      atributosShopee: plataforma === 'shopee' ? atributosDaShopee(brutos) : [],
      logisticaHabilitada: plataforma === 'shopee' ? logisticaDaShopee(brutos) : [],
      // 'NEW' | 'USED' na Shopee; no ML vem 'new'/'used' em minúsculas.
      condicao: typeof brutos?.condition === 'string' ? brutos.condition.toUpperCase() : null,
      // Peso/dimensões: a Shopee guarda em gramas-kg no próprio item; o
      // cadastro do produto costuma ter os mesmos valores, mas se o operador
      // ajustou só no anúncio, é esse número que vale.
      pesoKg: typeof brutos?.weight === 'string' ? Number(brutos.weight) : (typeof brutos?.weight === 'number' ? brutos.weight : null),
      comprimentoCm: brutos?.dimension?.package_length ?? null,
      larguraCm: brutos?.dimension?.package_width ?? null,
      alturaCm: brutos?.dimension?.package_height ?? null,
    },
  })
}
