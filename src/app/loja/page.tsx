import Link from 'next/link'
import { lojaObrigatoria } from '@/lib/commerce/loja'
import { banners, blocosHome, categorias, marcasEmDestaque } from '@/lib/commerce/catalogo'
import CardProduto from '@/components/loja/CardProduto'
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

  const hero = faixas[0] ?? null
  const comImagem = arvore.filter(c => c.imagemUrl).slice(0, 8)
  const paraMostrar = comImagem.length >= 4 ? comImagem : arvore.slice(0, 8)

  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────
          Banner deliberadamente contido. Hero de tela cheia empurra o
          catálogo para baixo da dobra, e num celular isso significa que a
          primeira coisa que o cliente vê não é produto. */}
      {hero ? (
        <section className="loja-container pt-4">
          <Link
            href={hero.linkUrl || '#'}
            className="block overflow-hidden rounded-[var(--raio)]"
            aria-label={hero.titulo ?? 'Destaque'}
          >
            <picture>
              {hero.imagemMobileUrl && <source media="(max-width: 639px)" srcSet={hero.imagemMobileUrl} />}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={hero.imagemUrl ?? hero.imagemMobileUrl ?? ''}
                alt={hero.titulo ?? ''}
                className="h-auto w-full object-cover"
                fetchPriority="high"
              />
            </picture>
          </Link>
        </section>
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
      {blocos.map((b, i) => (
        <section key={b.id} className="loja-container pt-12">
          <TituloSecao
            titulo={b.titulo}
            subtitulo={b.subtitulo}
            href={b.tipo === 'ofertas' ? '/buscar?promocao=1' : '/buscar'}
          />
          <div className="loja-trilho">
            {b.produtos.map((p, j) => (
              <CardProduto
                key={p.lojaProdutoId}
                p={p}
                permiteSemEstoque={loja.permitirVendaSemEstoque}
                politica={loja.politicaPreco}
                // Só os primeiros do primeiro bloco escapam do lazy loading.
                prioridade={i === 0 && j < 4}
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
