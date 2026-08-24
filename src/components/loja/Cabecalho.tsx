'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useCarrinho } from './CarrinhoContexto'
import { real } from './ds'
import type { Categoria } from '@/lib/commerce/tipos'

// Cabeçalho da vitrine. Mobile first de verdade:
//
//   celular  → logo + carrinho na primeira linha, busca ocupando a SEGUNDA
//              linha inteira, categorias numa gaveta.
//   desktop  → tudo numa linha só.
//
// A busca ganha uma linha própria no celular porque é a função mais usada de
// uma loja com catálogo grande — espremê-la ao lado do logo, como quase todo
// tema faz, entrega um campo de 100px onde não cabe "tubo soldável 20mm".

type Sugestao = { slug: string; nome: string; imagem_url: string | null; preco: number }

export default function Cabecalho({ loja, categorias }: {
  loja: { id: string; nome: string; logoUrl: string | null; whatsapp: string | null }
  categorias: Categoria[]
}) {
  const router = useRouter()
  const params = useSearchParams()
  const { quantidadeTotal, carregado } = useCarrinho()

  const [termo, setTermo] = useState(params.get('q') ?? '')
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([])
  const [aberto, setAberto] = useState(false)
  const [menu, setMenu] = useState(false)
  const caixaRef = useRef<HTMLDivElement>(null)

  // Debounce de 300ms. Sem isso, "furadeira" dispara 9 consultas — uma por
  // tecla — e a última a chegar nem sempre é a da palavra completa.
  useEffect(() => {
    const t = termo.trim()
    if (t.length < 2) { setSugestoes([]); return }
    const controle = new AbortController()
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/loja/sugerir?q=${encodeURIComponent(t)}`, { signal: controle.signal })
        if (r.ok) setSugestoes(await r.json())
      } catch { /* requisição cancelada pela tecla seguinte */ }
    }, 300)
    return () => { clearTimeout(id); controle.abort() }
  }, [termo])

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])

  function buscar(e: React.FormEvent) {
    e.preventDefault()
    const t = termo.trim()
    if (!t) return
    setAberto(false)
    router.push(`/buscar?q=${encodeURIComponent(t)}`)
  }

  const campoBusca = (
    <div ref={caixaRef} className="relative w-full">
      <form onSubmit={buscar} role="search">
        <label htmlFor="busca-loja" className="sr-only">Buscar produtos</label>
        <input
          id="busca-loja"
          type="search"
          value={termo}
          onChange={e => { setTermo(e.target.value); setAberto(true) }}
          onFocus={() => setAberto(true)}
          placeholder="Buscar por nome, marca ou código"
          className="w-full rounded-[10px] border border-[var(--borda)] bg-[var(--fundo-suave)] px-4 py-2.5 text-[0.9375rem] outline-none placeholder:text-[var(--tinta-fraca)] focus:bg-white"
          autoComplete="off"
        />
      </form>

      {aberto && sugestoes.length > 0 && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-[var(--raio)] border border-[var(--borda)] bg-white shadow-[var(--sombra-alta)]">
          {sugestoes.map(s => (
            <Link
              key={s.slug}
              href={`/produto/${s.slug}`}
              onClick={() => setAberto(false)}
              className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--fundo-suave)]"
            >
              <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-[var(--fundo-suave)]">
                {s.imagem_url && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={s.imagem_url} alt="" className="h-full w-full object-contain" />
                )}
              </div>
              <span className="loja-linhas-2 min-w-0 flex-1 text-[0.8125rem]">{s.nome}</span>
              <span className="shrink-0 text-[0.8125rem] font-semibold">{real(Number(s.preco))}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--borda)] bg-white/95 backdrop-blur">
      <div className="loja-container">
        <div className="flex items-center gap-3 py-3">
          {/* Botão de menu: sempre visível, nunca dependente de hover. O
              projeto já perdeu uma rodada com um menu que só abria no
              onMouseEnter e não funcionava em celular nenhum. */}
          <button
            type="button"
            onClick={() => setMenu(v => !v)}
            aria-expanded={menu}
            aria-label="Abrir categorias"
            className="compacto -ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--tinta-forte)] hover:bg-[var(--fundo-suave)] lg:hidden"
          >
            <span aria-hidden className="text-xl leading-none">{menu ? '×' : '☰'}</span>
          </button>

          <Link href="/" className="flex shrink-0 items-center gap-2">
            {loja.logoUrl
              /* eslint-disable-next-line @next/next/no-img-element */
              ? <img src={loja.logoUrl} alt={loja.nome} className="h-8 w-auto max-w-[150px] object-contain" />
              : <span className="text-lg font-extrabold tracking-tight text-[var(--tinta-forte)]">{loja.nome}</span>}
          </Link>

          <div className="ml-auto hidden min-w-0 flex-1 px-4 lg:block lg:max-w-xl">{campoBusca}</div>

          <Link
            href="/carrinho"
            className="relative ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--fundo-suave)] lg:ml-0"
            aria-label={`Carrinho${carregado && quantidadeTotal > 0 ? ` com ${quantidadeTotal} itens` : ''}`}
          >
            <span aria-hidden className="text-xl leading-none">🛒</span>
            {/* Só depois de carregado: renderizar o número no servidor daria
                divergência de hidratação, porque o servidor não vê o
                localStorage. */}
            {carregado && quantidadeTotal > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[0.625rem] font-bold text-white"
                style={{ background: 'var(--loja-primaria)' }}
              >
                {quantidadeTotal > 99 ? '99+' : quantidadeTotal}
              </span>
            )}
          </Link>
        </div>

        {/* Busca em linha própria no celular. */}
        <div className="pb-3 lg:hidden">{campoBusca}</div>

        {/* Categorias no desktop: uma faixa, com rolagem se não couber. */}
        <nav aria-label="Categorias" className="hidden gap-5 overflow-x-auto pb-2.5 lg:flex">
          {categorias.slice(0, 9).map(c => (
            <Link
              key={c.id}
              href={`/c/${c.slug}`}
              className="whitespace-nowrap text-[0.8125rem] font-medium text-[var(--tinta-media)] hover:text-[var(--tinta-forte)]"
            >
              {c.nome}
            </Link>
          ))}
          {categorias.length > 9 && (
            <Link href="/c" className="whitespace-nowrap text-[0.8125rem] font-semibold" style={{ color: 'var(--loja-primaria)' }}>
              Todas
            </Link>
          )}
        </nav>
      </div>

      {/* Gaveta do celular */}
      {menu && (
        <div className="border-t border-[var(--borda)] bg-white lg:hidden">
          <nav aria-label="Categorias" className="loja-container max-h-[65vh] overflow-y-auto py-2">
            {categorias.map(c => (
              <Link
                key={c.id}
                href={`/c/${c.slug}`}
                onClick={() => setMenu(false)}
                className="block border-b border-[var(--borda)] py-3 text-[0.9375rem] text-[var(--tinta-forte)] last:border-0"
              >
                {c.nome}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  )
}
