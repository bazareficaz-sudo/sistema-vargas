import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { classificarUrlML } from '@/lib/mercadolivre/item'
import { lerAnuncioPorUrl, type CanalParaLeitura } from '@/lib/mercadolivre/lerPorUrl'

// CAPTURAR UM RASCUNHO COLANDO O LINK.
//
// A captura existia só pela extensão do Chrome, que lê a PÁGINA. Isso cobre
// o caso de quem está navegando, e deixa de fora quem recebeu um link no
// WhatsApp, está no celular, ou não tem a extensão instalada na máquina em
// que está.
//
// Aqui a leitura é pela API do Mercado Livre com o token da própria empresa —
// não é scraping. A contrapartida está no que se consegue: a API devolve
// título, descrição, preço, imagens, categoria, marca, atributos e condição;
// NÃO devolve o que só existe na página renderizada, como preço riscado
// ("de R$ 91,00"), quantidade vendida e o vendedor do momento numa página de
// catálogo. O rascunho criado por link nasce com esses campos vazios, e a
// tela precisa deixar isso visível em vez de fingir que a captura foi igual.
//
// O RESULTADO É O MESMO TIPO DE RASCUNHO. Mesma tabela, mesma deduplicação
// por `origem_id_externo`, mesmo registro em `anuncio_rascunho_historico`.
// Só a coluna `origem` distingue — e ela existe justamente para que a
// diferença de completude possa ser explicada depois.

export const maxDuration = 30

/** Só http(s), e só o que parece um link de anúncio. */
function urlSegura(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString().slice(0, 2000)
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const { url: urlBruta, canalId } = await req.json() as { url?: string; canalId?: string | null }
  const url = urlSegura(urlBruta)
  if (!url) {
    return NextResponse.json({ ok: false, erro: 'Cole o endereço completo do anúncio, começando com https://' }, { status: 400 })
  }

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  // TRES RESPOSTAS DIFERENTES, e a diferenca importa porque cada uma pede
  // uma acao diferente de quem colou o link.
  //
  // A primeira versao dizia "o ML negou a leitura, reconecte a conta" para um
  // link de catalogo — conselho errado para um problema que nao era de
  // autorizacao. A pessoa iria reconectar e continuaria sem funcionar.
  const alvo = classificarUrlML(url)

  if (alvo.tipo === 'catalogo') {
    return NextResponse.json({
      ok: false,
      tipoLink: 'catalogo',
      erro: 'Este link e da pagina de CATALOGO do Mercado Livre (/p/ ou /up/), que nao pertence a um '
        + 'vendedor — nela varios vendedores disputam a caixa de compra, e o ganhador muda. '
        + 'Abra o anuncio do vendedor especifico e cole aquele endereco: na pagina do catalogo, o '
        + 'caminho e clicar no nome do vendedor ou em "outras opcoes de compra".',
    }, { status: 400 })
  }

  if (alvo.tipo === 'nenhum') {
    return NextResponse.json({
      ok: false,
      tipoLink: 'nenhum',
      erro: 'Nao encontrei o codigo do anuncio no caminho deste link. Por enquanto a importacao por '
        + 'link funciona so para o Mercado Livre — para outros marketplaces, use a extensao do Chrome.',
    }, { status: 400 })
  }

  const idExterno = alvo.itemId

  // JÁ CAPTURADO? Devolve o existente em vez de criar duplicado — mesma regra
  // da extensão. Sem isto, colar o mesmo link duas vezes criaria dois
  // rascunhos do mesmo anúncio, e o mapeamento teria que ser feito duas vezes.
  const { data: existente } = await sb.from('anuncio_rascunhos')
    .select('id, titulo, status, capturado_em, origem')
    .eq('empresa_id', empresaId)
    .eq('origem_marketplace', 'mercadolivre')
    .eq('origem_id_externo', idExterno)
    .maybeSingle()

  if (existente) {
    return NextResponse.json({
      ok: true,
      duplicado: true,
      rascunhoId: existente.id,
      titulo: existente.titulo,
      mensagem: `Este anúncio já tinha sido capturado em ${new Date(existente.capturado_em).toLocaleDateString('pt-BR')}`
        + `${existente.origem === 'extensao' ? ' pela extensão' : ''}. Abri o rascunho que já existe.`,
    })
  }

  const { data: canais } = await sb.from('marketplace_canais')
    .select('id, empresa_id, seller_id, access_token, refresh_token, token_expira_em')
    .eq('empresa_id', empresaId).eq('plataforma', 'mercadolivre')
    .not('access_token', 'is', null)

  const leitura = await lerAnuncioPorUrl(sb, (canais ?? []) as CanalParaLeitura[], url, canalId)
  if (!leitura.ok) {
    return NextResponse.json({ ok: false, erro: leitura.erro }, { status: 400 })
  }

  const d = leitura.dados
  const imagens = [...new Set(d.imagens)].slice(0, 30)

  // O MESMO FORMATO de `dados_origem` que a extensão grava, com os campos que
  // a API não fornece explicitamente em `null` — e não ausentes. Ausente e
  // nulo se parecem no JSON e significam coisas diferentes para quem for ler
  // depois: "não veio nesta origem" contra "esqueceram de mapear".
  const dadosOrigem = {
    titulo: d.titulo,
    descricao: d.descricao,
    preco: d.preco,
    // Só a página renderizada tem estes. A API não os expõe.
    precoDe: null,
    precoPromocional: null,
    tipoPagina: 'anuncio',
    idAnuncioVencedor: null,
    vendedor: null,
    quantidadeVendida: null,
    categoriaAparente: d.categoriaNomeExterna,
    marca: d.marcaSugerida,
    condicao: d.condicao,
    // A API nomeia `name`/`valueName`; a extensão grava `nome`/`valor`. A
    // tradução acontece aqui para as duas origens produzirem o MESMO formato —
    // quem lê `dados_origem` depois não deveria precisar saber de onde veio.
    atributos: d.atributos.map(a => ({ nome: a.name, valor: a.valueName })).slice(0, 80),
    imagens,
    capturadoEm: new Date().toISOString(),
    dispositivo: 'importação por link',
    // O que a API deu além do que a extensão consegue — a categoria oficial,
    // com id. Vale guardar: é o que o fluxo de publicação vai querer.
    categoriaId: d.categoriaId,
    categoriaCaminho: d.categoriaCaminho,
  }

  const { data: criado, error } = await sb.from('anuncio_rascunhos').insert({
    empresa_id: empresaId,
    origem: 'link',
    origem_marketplace: 'mercadolivre',
    origem_id_externo: idExterno,
    origem_url: url,
    origem_vendedor: null,
    dados_origem: dadosOrigem,
    dados_editados: {},
    titulo: d.titulo,
    preco_origem: d.preco,
    imagem_principal: imagens[0] ?? null,
    qtd_imagens: imagens.length,
    tem_variacao: d.temVariacoes,
    status: 'capturado',
    capturado_por: user.id,
  }).select('id').single()

  if (error || !criado) {
    return NextResponse.json({ ok: false, erro: `Falha ao gravar o rascunho: ${error?.message ?? 'sem id de volta'}` }, { status: 500 })
  }

  await sb.from('anuncio_rascunho_historico').insert({
    rascunho_id: criado.id,
    empresa_id: empresaId,
    user_id: user.id,
    acao: 'capturado',
    dados_depois: { url, marketplace: 'mercadolivre', titulo: d.titulo, qtdImagens: imagens.length },
    observacao: 'Importado por link, lido pela API do Mercado Livre',
  })

  return NextResponse.json({
    ok: true,
    duplicado: false,
    rascunhoId: criado.id,
    titulo: d.titulo,
    qtdImagens: imagens.length,
    temVariacao: d.temVariacoes,
    // O que esta origem NÃO trouxe. A tela mostra para o operador saber que
    // precisa conferir, em vez de descobrir na hora de publicar.
    naoDisponivelPorLink: ['preço riscado', 'quantidade vendida', 'vendedor'],
  })
}
