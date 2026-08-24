import Link from 'next/link'
import CardProduto from './CardProduto'
import { EstadoVazio, classesBotao, estiloPrimario } from './ds'
import type { Loja, Ordenacao, ResultadoBusca } from '@/lib/commerce/tipos'

// Listagem compartilhada por /buscar e /c/[...caminho].
//
// Uma implementação só, de propósito. Listar uma categoria é buscar sem
// termo — e duas cópias divergem: neste projeto o filtro de entrada de
// mercadoria já teve duas versões que se afastaram, e virou módulo
// compartilhado depois de o defeito aparecer em uma delas só.

const ORDENS: { valor: Ordenacao; rotulo: string }[] = [
  { valor: 'relevancia', rotulo: 'Relevância' },
  { valor: 'menor_preco', rotulo: 'Menor preço' },
  { valor: 'maior_preco', rotulo: 'Maior preço' },
  { valor: 'novidades', rotulo: 'Novidades' },
  { valor: 'nome', rotulo: 'Nome' },
]

function comParametro(base: string, params: Record<string, string | undefined>, mudanca: Record<string, string | null>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v)
  for (const [k, v] of Object.entries(mudanca)) {
    if (v === null) p.delete(k)
    else p.set(k, v)
  }
  const q = p.toString()
  return q ? `${base}?${q}` : base
}

export default function Listagem({
  loja, resultado, base, params, titulo, subtitulo, vazioTitulo, vazioDescricao,
}: {
  loja: Loja
  resultado: ResultadoBusca
  /** Caminho sem query — `/buscar` ou `/c/hidraulica`. */
  base: string
  params: Record<string, string | undefined>
  titulo: string
  subtitulo?: string
  vazioTitulo: string
  vazioDescricao?: string
}) {
  const { produtos, total, pagina, paginas } = resultado
  const ordemAtual = (params.ordem as Ordenacao) ?? 'relevancia'
  const soDisponivel = params.disponivel === '1'
  const soPromocao = params.promocao === '1'

  if (produtos.length === 0) {
    return (
      <div className="loja-container py-6">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">{titulo}</h1>
        <EstadoVazio
          titulo={vazioTitulo}
          descricao={vazioDescricao}
          acao={
            <Link href="/" className={classesBotao('primario')} style={estiloPrimario}>
              Voltar para a loja
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="loja-container py-6">
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">{titulo}</h1>
        <p className="mt-1 text-sm text-[var(--tinta-media)]">
          {subtitulo ? `${subtitulo} · ` : ''}
          {total} {total === 1 ? 'produto' : 'produtos'}
        </p>
      </div>

      {/* Filtros. Faixa rolável no celular em vez de painel lateral: painel
          lateral em tela pequena vira modal, e modal antes de ver o produto
          é atrito. */}
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        <Link
          href={comParametro(base, params, { disponivel: soDisponivel ? null : '1', pagina: null })}
          className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-[0.8125rem] font-medium ${
            soDisponivel
              ? 'border-transparent text-white'
              : 'border-[var(--borda)] bg-white text-[var(--tinta-media)]'
          }`}
          style={soDisponivel ? estiloPrimario : undefined}
        >
          Disponível
        </Link>
        <Link
          href={comParametro(base, params, { promocao: soPromocao ? null : '1', pagina: null })}
          className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-[0.8125rem] font-medium ${
            soPromocao
              ? 'border-transparent text-white'
              : 'border-[var(--borda)] bg-white text-[var(--tinta-media)]'
          }`}
          style={soPromocao ? estiloPrimario : undefined}
        >
          Em oferta
        </Link>

        <div className="ml-auto flex shrink-0 gap-2">
          {ORDENS.map(o => (
            <Link
              key={o.valor}
              href={comParametro(base, params, { ordem: o.valor, pagina: null })}
              className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-[0.8125rem] font-medium ${
                ordemAtual === o.valor
                  ? 'border-[var(--tinta-forte)] bg-white text-[var(--tinta-forte)]'
                  : 'border-[var(--borda)] bg-white text-[var(--tinta-media)]'
              }`}
            >
              {o.rotulo}
            </Link>
          ))}
        </div>
      </div>

      <div className="loja-grade">
        {produtos.map((p, i) => (
          <CardProduto
            key={p.lojaProdutoId}
            p={p}
            permiteSemEstoque={loja.permitirVendaSemEstoque}
            prioridade={i < 4}
          />
        ))}
      </div>

      {/* Paginação por link de verdade — não botão "carregar mais".
          Link é indexável, compartilhável e funciona com o botão voltar. */}
      {paginas > 1 && (
        <nav aria-label="Paginação" className="mt-8 flex items-center justify-center gap-2">
          {pagina > 1 && (
            <Link
              href={comParametro(base, params, { pagina: String(pagina - 1) })}
              className={classesBotao('secundario')}
              rel="prev"
            >
              Anterior
            </Link>
          )}
          <span className="px-3 text-sm text-[var(--tinta-media)]">
            {pagina} de {paginas}
          </span>
          {pagina < paginas && (
            <Link
              href={comParametro(base, params, { pagina: String(pagina + 1) })}
              className={classesBotao('secundario')}
              rel="next"
            >
              Próxima
            </Link>
          )}
        </nav>
      )}
    </div>
  )
}
