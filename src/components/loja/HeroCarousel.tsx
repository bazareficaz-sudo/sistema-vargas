'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ImagemProduto, classesBotao, real } from './ds'
import { PRECO_UNICO, exibicaoPreco, rotuloAVista, textoAVista, textoParcelamento } from '@/lib/commerce/precos'
import type { PoliticaPreco, ProdutoCard } from '@/lib/commerce/tipos'

// Carrossel do topo: divide o mesmo espaço entre o banner estático (imagem
// que alguém sobe, `loja_banners`) e o destaque por tag (produto real do
// catálogo, com preço ao vivo) — os dois são "slide" do mesmo carrossel, não
// uma seção e depois outra. Foi um ajuste pedido depois de a primeira versão
// pôr o destaque por tag como bloco separado mais abaixo na página: o pedido
// era ocupar o espaço do banner principal, não abrir uma seção nova.
//
// Só entra a mecânica de carrossel (setas, bolinhas, autoplay) quando há MAIS
// de um slide — com um só, continua sendo o banner contido de sempre. Isso
// não é economia de código: é a mesma regra do resto da vitrine, de não
// mostrar controle de navegação para navegar entre uma coisa só.

export type SlideBanner = {
  tipo: 'banner'
  id: string
  imagemUrl: string
  imagemMobileUrl: string | null
  linkUrl: string | null
  titulo: string | null
}

export type SlideProduto = {
  tipo: 'produto'
  id: string
  produto: ProdutoCard
  /** Título do bloco de destaque (ex.: "Ofertas da semana") — a manchete do slide. */
  titulo: string
  /** Subtítulo do bloco. Serve de legenda quando o produto não tem descrição própria. */
  subtitulo: string | null
  cor: 'primaria' | 'destaque'
}

export type Slide = SlideBanner | SlideProduto

export default function HeroCarousel({ slides, politica, permiteSemEstoque }: {
  slides: Slide[]
  politica?: PoliticaPreco
  permiteSemEstoque: boolean
}) {
  const [indice, setIndice] = useState(0)
  const [arrastoX, setArrastoX] = useState<number | null>(null)

  const multiplo = slides.length > 1

  // Sem pausa no hover, e sem sincronizar por `scrollLeft`: a primeira
  // versão usava `overflow-x-auto` + `scrollIntoView` + `onScroll` para
  // saber em qual slide estava, e testado ao vivo isso travava — o
  // navegador às vezes restaura a posição de rolagem sozinho ao recarregar,
  // o `onScroll` lia isso e brigava com o estado do React, e o carrossel
  // ficava preso num slide ou pulava vários de uma vez. Também pausava com
  // `onMouseEnter`/`onMouseLeave`, e clicar numa bolinha deixa o cursor em
  // cima do carrossel sem o `mouseleave` disparar — autoplay parado pra
  // sempre naquele carregamento.
  //
  // Agora É SÓ ESTADO: `indice` manda, um `translateX` obedece. Sem
  // segunda fonte de verdade, não tem como as duas discordarem. O gesto de
  // arrastar (celular) veio de volta como `onTouchStart/Move/End` medindo
  // a distância, não como rolagem nativa.
  useEffect(() => {
    if (!multiplo) return
    const id = setInterval(() => setIndice(i => (i + 1) % slides.length), 6000)
    return () => clearInterval(id)
  }, [multiplo, slides.length])

  if (slides.length === 0) return null

  const irPara = (i: number) => setIndice(((i % slides.length) + slides.length) % slides.length)

  return (
    <section className="loja-container pt-4">
      <div
        className="relative touch-pan-y overflow-hidden rounded-[var(--raio)]"
        onTouchStart={e => setArrastoX(e.touches[0].clientX)}
        onTouchMove={e => {
          if (arrastoX == null) return
          const delta = e.touches[0].clientX - arrastoX
          // Limiar de 50px: sem ele, um toque para clicar no card já dispara
          // "arrasto" e troca de slide sozinho.
          if (Math.abs(delta) > 50) {
            irPara(indice + (delta < 0 ? 1 : -1))
            setArrastoX(null)
          }
        }}
        onTouchEnd={() => setArrastoX(null)}
      >
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${indice * 100}%)` }}
        >
          {slides.map(s => (
            <div key={s.id} className="w-full shrink-0">
              {s.tipo === 'banner' ? <SlideBannerView s={s} /> : (
                <SlideProdutoView s={s} politica={politica} permiteSemEstoque={permiteSemEstoque} />
              )}
            </div>
          ))}
        </div>

        {/* Fundo escuro atrás das bolinhas: sem ele, bolinha branca some em
            cima de banner claro — já aconteceu num teste real. */}
        {multiplo && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center">
            <div className="flex items-center gap-2 rounded-full bg-black/25 px-2.5 py-1.5 backdrop-blur-sm">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  aria-label={`Ir para o destaque ${i + 1}`}
                  onClick={() => setIndice(i)}
                  className={`h-2 rounded-full transition-all ${
                    i === indice ? 'w-6 bg-white' : 'w-2 bg-white/50 hover:bg-white/80'
                  }`}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function SlideBannerView({ s }: { s: SlideBanner }) {
  return (
    <Link href={s.linkUrl || '#'} className="block" aria-label={s.titulo ?? 'Destaque'}>
      <picture>
        {s.imagemMobileUrl && <source media="(max-width: 639px)" srcSet={s.imagemMobileUrl} />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={s.imagemUrl}
          alt={s.titulo ?? ''}
          className="h-auto w-full object-cover"
          fetchPriority="high"
        />
      </picture>
    </Link>
  )
}

// As duas cores da própria loja, nunca uma paleta inventada — é o que faz o
// slide de produto parecer parte da campanha e não um anúncio de terceiro.
const FUNDO_COR = {
  primaria: 'color-mix(in srgb, var(--loja-primaria) 88%, black)',
  destaque: 'color-mix(in srgb, var(--loja-destaque) 88%, black)',
}

function SlideProdutoView({ s, politica, permiteSemEstoque }: {
  s: SlideProduto
  politica?: PoliticaPreco
  permiteSemEstoque: boolean
}) {
  const p = s.produto
  const pol = politica ?? PRECO_UNICO
  const e = exibicaoPreco({ preco: p.preco, precoDe: p.precoDe, precoPix: p.precoPix }, pol)
  const descricao = p.descricaoCurta || s.subtitulo
  const semSaldo = p.estoquePublicavel <= 0 && !permiteSemEstoque

  return (
    <Link
      href={`/produto/${p.slug}`}
      className="flex min-h-[280px] flex-col items-center gap-6 px-6 py-8 sm:min-h-[340px] sm:flex-row sm:px-10 md:min-h-[400px]"
      style={{ background: FUNDO_COR[s.cor] }}
    >
      <div className="h-40 w-40 shrink-0 overflow-hidden rounded-2xl bg-white shadow-lg sm:h-56 sm:w-56 md:h-64 md:w-64">
        <ImagemProduto url={p.imagemUrl} alt={p.nome} className="h-full w-full" prioridade />
      </div>

      <div className="max-w-md text-center text-white sm:text-left">
        <p className="text-xs font-bold uppercase tracking-widest text-white/70">{s.titulo}</p>
        <h2 className="mt-1 text-2xl font-extrabold leading-tight sm:text-3xl">{p.nome}</h2>
        {descricao && <p className="loja-linhas-2 mt-2 text-sm text-white/80 sm:text-base">{descricao}</p>}

        <div className="mt-4">
          {e.de != null && (
            <div className="text-sm text-white/60 line-through">{real(e.de)}</div>
          )}
          <div className="text-4xl font-extrabold tracking-tight sm:text-5xl">
            {real(e.destaque)}
            {e.aVistaEmDestaque && (
              <span className="ml-2 align-middle text-base font-semibold text-white/80">
                {textoAVista(pol)}
              </span>
            )}
          </div>
          {e.parcelamento && (
            <p className="mt-1 text-sm text-white/80">{textoParcelamento(e.parcelamento)}</p>
          )}
          {!e.aVistaEmDestaque && e.aVista != null && (
            <p className="mt-1 text-sm font-medium text-white/90">
              {real(e.aVista)} {rotuloAVista(pol)}
            </p>
          )}
        </div>

        {semSaldo ? (
          <span className="mt-4 inline-block rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold">
            Em breve, sem estoque agora
          </span>
        ) : (
          <span className={`${classesBotao('secundario')} mt-4 bg-white text-[var(--tinta-forte)] hover:bg-white/90`}>
            Ver produto
          </span>
        )}
      </div>
    </Link>
  )
}
