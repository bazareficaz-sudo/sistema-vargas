'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { Categoria } from '@/lib/commerce/tipos'

// Menu de categorias do cabeçalho.
//
// Desktop: faixa de categorias; as que têm subcategorias abrem um painel ao
// passar o mouse, ao focar pelo teclado ou ao tocar na setinha. "Todas as
// categorias" abre o catálogo inteiro — 54 categorias hoje, das quais só 9
// cabem na faixa.
//
// Hover SOZINHO nunca basta: o projeto já perdeu uma rodada com um menu que só
// abria em `onMouseEnter` e não existia em tablet. Por isso cada item com
// painel tem uma setinha-botão (`aria-expanded`) que abre por clique, toque ou
// Enter, e o link da categoria continua navegando normalmente.
//
// O painel fica DENTRO do mesmo elemento do item, com um respiro de padding em
// vez de margem: com margem haveria um vão de 8px onde o mouse "sai" do item e
// o menu fecha antes de ele chegar ao painel.

const VISIVEIS = 9
/** Abaixo de `xl` a faixa só comporta 6; o resto fica no "Todas as categorias". */
const ATE_LG = 6
const TODAS = '__todas'
const ATRASO_ABRIR = 90
const ATRASO_FECHAR = 180

const linkItem =
  'block px-4 py-1.5 text-[0.8125rem] text-[var(--tinta-media)] hover:bg-[var(--fundo-suave)] hover:text-[var(--tinta-forte)]'

// O endereço de uma subcategoria inclui as categorias acima dela
// (`/c/pai/filho`): a rota resolve o caminho descendo a árvore a partir da
// raiz, e `/c/filho` sozinho dá 404. Por isso todo link daqui carrega `caminho`.
const hrefDe = (caminho: string[]) => `/c/${caminho.join('/')}`

function ListaFilhos({ filhos, caminho, aoNavegar, nivel = 0 }: {
  filhos: Categoria[]; caminho: string[]; aoNavegar: () => void; nivel?: number
}) {
  return (
    <>
      {filhos.map(f => (
        <li key={f.id}>
          <Link
            href={hrefDe([...caminho, f.slug])}
            onClick={aoNavegar}
            className={linkItem}
            style={nivel > 0 ? { paddingLeft: `${1 + nivel}rem` } : undefined}
          >
            {f.nome}
          </Link>
          {/* A árvore aceita mais níveis, mas o painel mostra até o terceiro:
              além disso vira rolagem sem ganho de navegação. */}
          {f.filhos.length > 0 && nivel < 1 && (
            <ul>
              <ListaFilhos
                filhos={f.filhos} caminho={[...caminho, f.slug]}
                aoNavegar={aoNavegar} nivel={nivel + 1}
              />
            </ul>
          )}
        </li>
      ))}
    </>
  )
}

export function MenuDesktop({ categorias }: { categorias: Categoria[] }) {
  const [aberto, setAberto] = useState<string | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const limpar = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
  }
  const agendar = (id: string | null, ms: number) => {
    limpar()
    timer.current = setTimeout(() => setAberto(id), ms)
  }
  const fechar = () => { limpar(); setAberto(null) }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (!navRef.current?.contains(e.target as Node)) { limpar(); setAberto(null) }
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Devolve o foco ao botão que abriu: sem isso o foco some junto com o painel.
      navRef.current?.querySelector<HTMLElement>(`[data-gatilho="${aberto}"]`)?.focus()
      limpar(); setAberto(null)
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', tecla)
    }
  }, [aberto])

  const saiuDoGrupo = (id: string) => (e: React.FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setAberto(v => (v === id ? null : v))
    }
  }

  const visiveis = categorias.slice(0, VISIVEIS)

  return (
    <nav ref={navRef} aria-label="Categorias" className="relative hidden gap-5 pb-2.5 lg:flex">
      {visiveis.map((c, i) => {
        const temFilhos = c.filhos.length > 0
        const estaAberto = aberto === c.id
        return (
          <div
            key={c.id}
            className={`relative items-center ${i >= ATE_LG ? 'hidden xl:flex' : 'flex'}`}
            onMouseEnter={() => agendar(temFilhos ? c.id : null, ATRASO_ABRIR)}
            onMouseLeave={() => agendar(null, ATRASO_FECHAR)}
            onBlur={saiuDoGrupo(c.id)}
          >
            <Link
              href={`/c/${c.slug}`}
              onClick={fechar}
              className="whitespace-nowrap text-[0.8125rem] font-medium text-[var(--tinta-media)] hover:text-[var(--tinta-forte)]"
            >
              {c.nome}
            </Link>

            {temFilhos && (
              <button
                type="button"
                data-gatilho={c.id}
                aria-expanded={estaAberto}
                aria-label={`Subcategorias de ${c.nome}`}
                onClick={() => { limpar(); setAberto(estaAberto ? null : c.id) }}
                className="compacto ml-0.5 flex h-6 w-5 items-center justify-center text-[0.625rem] text-[var(--tinta-fraca)] hover:text-[var(--tinta-forte)]"
              >
                <span aria-hidden className={estaAberto ? 'rotate-180' : ''}>▾</span>
              </button>
            )}

            {temFilhos && estaAberto && (
              <div className={`absolute top-full z-50 pt-2 ${i >= ATE_LG ? 'right-0' : 'left-0'}`}>
                <ul className="min-w-[14rem] rounded-[var(--raio)] border border-[var(--borda)] bg-white py-2 shadow-[var(--sombra-alta)]">
                  <li>
                    <Link
                      href={`/c/${c.slug}`}
                      onClick={fechar}
                      className={`${linkItem} font-semibold !text-[var(--tinta-forte)]`}
                    >
                      Ver tudo em {c.nome}
                    </Link>
                  </li>
                  <li role="separator" className="my-1 border-t border-[var(--borda)]" />
                  <ListaFilhos filhos={c.filhos} caminho={[c.slug]} aoNavegar={fechar} />
                </ul>
              </div>
            )}
          </div>
        )
      })}

      {categorias.length > VISIVEIS && (
        <div
          className="flex items-center"
          onMouseEnter={() => agendar(TODAS, ATRASO_ABRIR)}
          onMouseLeave={() => agendar(null, ATRASO_FECHAR)}
          onBlur={saiuDoGrupo(TODAS)}
        >
          <button
            type="button"
            data-gatilho={TODAS}
            aria-expanded={aberto === TODAS}
            onClick={() => { limpar(); setAberto(aberto === TODAS ? null : TODAS) }}
            className="compacto whitespace-nowrap text-[0.8125rem] font-semibold"
            style={{ color: 'var(--loja-primaria)' }}
          >
            Todas as categorias <span aria-hidden className="text-[0.625rem]">▾</span>
          </button>

          {aberto === TODAS && (
            <div className="absolute inset-x-0 top-full z-50 pt-2">
              <div className="max-h-[70vh] overflow-y-auto rounded-[var(--raio)] border border-[var(--borda)] bg-white p-5 shadow-[var(--sombra-alta)]">
                <div className="columns-3 gap-8 xl:columns-4">
                  {categorias.map(c => (
                    <div key={c.id} className="mb-4 break-inside-avoid">
                      <Link
                        href={`/c/${c.slug}`}
                        onClick={fechar}
                        className="text-[0.8125rem] font-semibold text-[var(--tinta-forte)] hover:underline"
                      >
                        {c.nome}
                      </Link>
                      {c.filhos.length > 0 && (
                        <ul className="mt-1">
                          {c.filhos.map(f => (
                            <li key={f.id}>
                              <Link
                                href={hrefDe([c.slug, f.slug])}
                                onClick={fechar}
                                className="block py-0.5 text-[0.8125rem] text-[var(--tinta-media)] hover:text-[var(--tinta-forte)]"
                              >
                                {f.nome}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-2 border-t border-[var(--borda)] pt-3">
                  <Link href="/c" onClick={fechar} className="text-[0.8125rem] font-semibold" style={{ color: 'var(--loja-primaria)' }}>
                    Ver página de categorias
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </nav>
  )
}

// ─── Celular ─────────────────────────────────────────────────────────────────

export function MenuMobile({ categorias, aoNavegar }: {
  categorias: Categoria[]; aoNavegar: () => void
}) {
  const [expandido, setExpandido] = useState<string | null>(null)

  return (
    <nav aria-label="Categorias" className="loja-container max-h-[65vh] overflow-y-auto py-2">
      {categorias.map(c => {
        const temFilhos = c.filhos.length > 0
        const estaExpandido = expandido === c.id
        return (
          <div key={c.id} className="border-b border-[var(--borda)] last:border-0">
            <div className="flex items-center">
              <Link
                href={`/c/${c.slug}`}
                onClick={aoNavegar}
                className="block flex-1 py-3 text-[0.9375rem] text-[var(--tinta-forte)]"
              >
                {c.nome}
              </Link>
              {temFilhos && (
                <button
                  type="button"
                  aria-expanded={estaExpandido}
                  aria-label={`Subcategorias de ${c.nome}`}
                  onClick={() => setExpandido(estaExpandido ? null : c.id)}
                  className="compacto flex h-11 w-11 shrink-0 items-center justify-center text-xl text-[var(--tinta-media)]"
                >
                  <span aria-hidden>{estaExpandido ? '−' : '+'}</span>
                </button>
              )}
            </div>
            {temFilhos && estaExpandido && (
              <ul className="pb-2 pl-4">
                {c.filhos.map(f => (
                  <li key={f.id}>
                    <Link
                      href={hrefDe([c.slug, f.slug])}
                      onClick={aoNavegar}
                      className="block py-2.5 text-[0.875rem] text-[var(--tinta-media)]"
                    >
                      {f.nome}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </nav>
  )
}
