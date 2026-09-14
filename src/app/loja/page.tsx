import Link from 'next/link'
import { lojaObrigatoria } from '@/lib/commerce/loja'
import { banners, blocosHome, categorias, marcasEmDestaque } from '@/lib/commerce/catalogo'
import CardProduto from '@/components/loja/CardProduto'
import HeroCarousel, { type Slide } from '@/components/loja/HeroCarousel'
import { TituloSecao, classesBotao, estiloPrimario } from '@/components/loja/ds'

// Home.
//
// A rota é DINÂMICA, e não ISR — não por escolha, mas porque a loja é
// resolvida pelo hostname, e ler `headers()` obriga a renderização sob
// demanda. O build confirma isso marcando `/loja` com ƒ.
//
// O cache que importa está uma camada abaixo: `banners`, `blocosHome`,
// `marcasEmDestaque` e `categorias` são memorizadas por loja em
// src/lib/commerce/catalogo.ts. Assim a montagem da home custa uma rodada de
// consultas a cada 5 minutos por loja, e não uma por visita — que é o que
// protege o mesmo Supabase que atende o PDV.
//
// A invalidação vem do painel (`invalidarVitrine`) e do cron de manutenção.

export default async function Home() {
  const loja = await lojaObrigatoria()

  const [arvore, faixas, blocos, marcas] = await Promise.all([
    categorias(loja.id),
    banners(loja.id),
    blocosHome(loja),
    marcasEmDestaque(loja.id, 12),
  ])

  const comImagem = arvore.filter(c => c.imagemUrl).slice(0, 8)
  const paraMostrar = comImagem.length >= 4 ? comImagem : arvore.slice(0, 8)

  // ── Carrossel do topo ─────────────────────────────────────────
  //
  // Um carrossel só, dois tipos de slide: o banner estático de sempre
  // (`loja_banners`) e o destaque por tag (`loja_blocos_home`, tipo
  // `destaque_tag`) — que por isso SAI da lista de blocos abaixo, senão
  // apareceria duas vezes. Antes só o primeiro banner ativo entrava; agora
  // TODOS os banners "no ar" e todos os produtos destacados dividem o mesmo
  // espaço, alternando — foi o ajuste pedido depois de a primeira versão pôr
  // o destaque como uma seção separada mais abaixo.
  const blocosDestaque = blocos.filter(b => b.tipo === 'destaque_tag')
  const blocosNormais = blocos.filter(b => b.tipo !== 'destaque_tag')

  const slides: Slide[] = [
    ...faixas.map((f): Slide => ({
      tipo: 'banner', id: f.id, imagemUrl: f.imagemUrl ?? f.imagemMobileUrl ?? '',
      imagemMobileUrl: f.imagemMobileUrl, linkUrl: f.linkUrl, titulo: f.titulo,
    })),
    ...blocosDestaque.flatMap((b, bi) => b.produtos.map((p): Slide => ({
      tipo: 'produto', id: p.lojaProdutoId, produto: p, titulo: b.titulo, subtitulo: b.subtitulo,
      // Alterna entre as duas cores da loja — cada BLOCO fica numa cor fixa
      // (todos os produtos do mesmo destaque com a mesma cor), e o próximo
      // bloco troca. Evita um carrossel piscando cor a cada slide.
      cor: bi % 2 === 0 ? 'primaria' : 'destaque',
    }))),
  ]

  return (
    <>
      {/* ── Topo: carrossel, ou abertura automática sem conteúdo nenhum ── */}
      {slides.length > 0 ? (
        <HeroCarousel slides={slides} politica={loja.politicaPreco} permiteSemEstoque={loja.permitirVendaSemEstoque} />
      ) : (
        <section className="loja-container pt-8">
          <div className="rounded-[var(--raio)] bg-[var(--fundo-suave)] px-6 py-10 md:px-10 md:py-14">
            <h1 className="max-w-2xl text-2xl font-extrabold tracking-tight text-[var(--tinta-forte)] md:text-4xl">
              {loja.nome}
            </h1>
            {loja.descricao && (
              <p className="mt-2 max-w-xl text-[var(--tinta-media)] md:text-lg">{loja.descricao}</p>
            )}
            <Link href="/buscar" className={classesBotao('primario', 'mt-5')} style={estiloPrimario}>
              Ver todos os produtos
            </Link>
          </div>
        </section>
      )}

      {/* ── Categorias ────────────────────────────────────── */}
      {paraMostrar.length > 0 && (
        <section className="loja-container pt-10">
          <TituloSecao titulo="Categorias" href="/c" />
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {paraMostrar.map(c => (
              <Link
                key={c.id}
                href={`/c/${c.slug}`}
                className="group flex flex-col items-center gap-2 rounded-[var(--raio)] border border-[var(--borda)] bg-white p-3 text-center transition-shadow hover:shadow-[var(--sombra)]"
              >
                <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-[var(--fundo-suave)]">
                  {c.imagemUrl
                    /* eslint-disable-next-line @next/next/no-img-element */
                    ? <img src={c.imagemUrl} alt="" className="h-full w-full object-cover" />
                    : <span aria-hidden className="text-base font-bold text-[var(--tinta-fraca)]">
                        {c.nome.trim()[0]?.toUpperCase()}
                      </span>}
                </div>
                <span className="loja-linhas-2 text-[0.6875rem] font-medium leading-tight text-[var(--tinta-forte)]">
                  {c.nome}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Blocos de produto ─────────────────────────────── */}
      {blocosNormais.map(b => (
        <section key={b.id} className="loja-container pt-12">
          <TituloSecao
            titulo={b.titulo}
            subtitulo={b.subtitulo}
            // Seção por critério não tem link de "ver tudo" hoje — não existe
            // busca por tag/categoria bruta do ERP, só por marca (que já usa
            // /buscar?marca=, mas o valor exato não chega até aqui).
            href={b.tipo === 'secao_filtro' ? undefined : b.tipo === 'ofertas' ? '/buscar?promocao=1' : '/buscar'}
          />

          <div className="loja-trilho">
            {b.produtos.map(p => (
              <CardProduto
                key={p.lojaProdutoId}
                p={p}
                permiteSemEstoque={loja.permitirVendaSemEstoque}
                politica={loja.politicaPreco}
                // Slides do carrossel já cobrem a prioridade do topo; aqui
                // nenhum card precisa escapar do lazy loading.
                prioridade={false}
              />
            ))}
          </div>
        </section>
      ))}

      {/* ── Marcas ────────────────────────────────────────── */}
      {marcas.length > 0 && (
        <section className="loja-container pt-12">
          <TituloSecao titulo="Marcas" />
          <div className="flex flex-wrap gap-2">
            {marcas.map(m => (
              <Link
                key={m}
                href={`/buscar?marca=${encodeURIComponent(m)}`}
                className="rounded-full border border-[var(--borda)] bg-white px-4 py-2 text-[0.8125rem] font-medium text-[var(--tinta-media)] hover:border-[var(--tinta-fraca)] hover:text-[var(--tinta-forte)]"
              >
                {m}
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
