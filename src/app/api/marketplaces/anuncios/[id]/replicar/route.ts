import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Devolve o conteúdo de um anúncio já trabalhado, pra servir de base ao criar
// o mesmo produto em outra conta (canal). Só leitura — quem publica continua
// sendo o fluxo normal de criação, com o operador revisando antes.
//
// O que dá pra reaproveitar depende do par origem→destino:
//  - mesma plataforma: título, descrição, imagens e a CATEGORIA (o id é o
//    mesmo nas duas contas, porque a árvore é da plataforma, não da conta).
//  - Mercado Livre → Mercado Livre: também os atributos, que o sync guarda
//    completos em dados_brutos.
//  - Shopee: o sync NÃO traz atributos (o get_item_base_info não devolve
//    attribute_list nesta conta), então lá os atributos seguem sendo
//    preenchidos pela IA na tela de criação — sinalizado na resposta.
//  - plataformas diferentes: categoria e atributos não se aproveitam (as
//    taxonomias não conversam); vai só o texto e as imagens.

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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: anuncio } = await sb
    .from('marketplace_anuncios')
    .select('id, empresa_id, canal_id, produto_id, titulo, descricao, preco_venda, imagens, categoria_externa, marca_externa, dados_brutos, tem_variacao')
    .eq('id', id).eq('empresa_id', empresaId).maybeSingle()

  if (!anuncio) return NextResponse.json({ ok: false, erro: 'Anúncio não encontrado' }, { status: 404 })

  const { data: canal } = await sb
    .from('marketplace_canais').select('id, nome, plataforma').eq('id', anuncio.canal_id).maybeSingle()

  const plataforma = canal?.plataforma ?? null
  const brutos: any = anuncio.dados_brutos ?? {}

  return NextResponse.json({
    ok: true,
    origem: {
      anuncioId: anuncio.id,
      canalId: canal?.id ?? null,
      canalNome: canal?.nome ?? '—',
      plataforma,
      produtoId: anuncio.produto_id,
      titulo: anuncio.titulo ?? '',
      descricao: anuncio.descricao ?? '',
      imagens: Array.isArray(anuncio.imagens) ? anuncio.imagens.filter((u: unknown) => typeof u === 'string') : [],
      preco: anuncio.preco_venda ?? null,
      categoriaExterna: anuncio.categoria_externa ?? null,
      marcaExterna: anuncio.marca_externa ?? null,
      temVariacao: !!anuncio.tem_variacao,
      atributos: plataforma === 'mercadolivre' ? atributosDoMercadoLivre(brutos) : [],
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
