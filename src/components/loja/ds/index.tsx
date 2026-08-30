import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  PRECO_UNICO, brl, exibicaoPreco, rotuloAVista, textoAVista, textoParcelamento,
} from '@/lib/commerce/precos'
import type { PoliticaPreco } from '@/lib/commerce/tipos'

// Design system da vitrine. Definido UMA vez, antes das páginas.
//
// O ERP tem `src/components/ui/botao.ts`, e o comentário de lá explica por
// quê: uma varredura achou 10 combinações diferentes de padding só para o
// botão azul primário. Aqui a lição já entra aplicada — nenhuma página da
// loja escreve classe de botão, de preço ou de card por conta própria.

// ─── Dinheiro ────────────────────────────────────────────────────────────────

// O formatador vive em `@/lib/commerce/precos`, junto das frases de
// parcelamento que também precisam dele. Aqui ele só ganha o nome curto que
// as páginas da vitrine já usam.
export const real = brl

// ─── Botão ───────────────────────────────────────────────────────────────────

type VarianteBotao = 'primario' | 'secundario' | 'sutil'

const BOTAO_BASE =
  'inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold ' +
  'whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

const BOTAO_VARIANTE: Record<VarianteBotao, string> = {
  // A cor da marca fica no botão de comprar, e quase só nele. É o que faz o
  // olho achar a ação principal sem precisar de tamanho exagerado.
  primario: 'text-white shadow-sm hover:brightness-110 active:brightness-95',
  secundario: 'bg-white border border-[var(--borda)] text-[var(--tinta-forte)] hover:bg-[var(--fundo-suave)]',
  sutil: 'bg-transparent text-[var(--tinta-media)] hover:text-[var(--tinta-forte)]',
}

export function classesBotao(variante: VarianteBotao = 'secundario', extra = '') {
  return [BOTAO_BASE, 'h-11 px-5 text-[0.9375rem]', BOTAO_VARIANTE[variante], extra]
    .filter(Boolean).join(' ')
}

/** Cor de marca aplicada por style, não por classe: ela vem do banco. */
export const estiloPrimario = { background: 'var(--loja-primaria)' }

// ─── Imagem de produto ───────────────────────────────────────────────────────

/**
 * Produto sem foto NÃO é caso de borda nesta loja.
 *
 * A decisão de 24/08 foi que o usuário publica o que quiser, com ou sem foto.
 * Medido: dos 508 publicados, 284 não têm imagem. Ou seja, mais da metade da
 * vitrine passa por aqui — cards com e sem foto convivem na MESMA grade.
 *
 * Por isso o vazio é desenhado, não improvisado: nada de ícone de imagem
 * quebrada, retângulo cinza ou espaço em branco. Um bloco tipográfico com a
 * inicial e o nome, na paleta da loja, que fica discreto ao lado de uma foto
 * de verdade em vez de parecer defeito.
 */
export function ImagemProduto({ url, alt, prioridade = false, className = '' }: {
  url: string | null; alt: string; prioridade?: boolean; className?: string
}) {
  if (url) {
    return (
      <div className={`relative overflow-hidden bg-white ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt}
          loading={prioridade ? 'eager' : 'lazy'}
          decoding="async"
          className="h-full w-full object-contain"
        />
      </div>
    )
  }

  const inicial = (alt.trim()[0] ?? '?').toUpperCase()
  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-1.5 overflow-hidden px-3 text-center ${className}`}
      style={{ background: 'linear-gradient(160deg, var(--fundo-suave), #eef2f7)' }}
      // Decorativo: o nome do produto já está escrito logo abaixo, no card.
      // Repetir aqui faria o leitor de tela dizer tudo duas vezes.
      role="presentation"
    >
      <span
        className="flex h-11 w-11 items-center justify-center rounded-full text-lg font-bold text-white/95"
        style={{ background: 'var(--loja-primaria)', opacity: 0.85 }}
      >
        {inicial}
      </span>
      <span className="text-[0.6875rem] font-medium leading-tight text-[var(--tinta-fraca)]">
        Foto em breve
      </span>
    </div>
  )
}

// ─── Preço ───────────────────────────────────────────────────────────────────

/**
 * O bloco de preço da vitrine. Card e página do produto usam este, e só este.
 *
 * Sem `politica`, ou com ela em 'preco_unico', desenha exatamente o que a
 * Fase 1 desenhava — riscado, preço, Pix embaixo. É o que permite esta
 * mudança chegar a uma loja no ar sem alterar um pixel até alguém ligar a
 * política na aba Preços.
 *
 * Em 'dois_precos' a decisão de QUEM ganha o tamanho grande não está aqui:
 * está em `exibicaoPreco`, para o card e a página nunca discordarem sobre o
 * que destacar. Aqui só mora a tipografia.
 */
export function Preco({ valor, de, pix, politica, tamanho = 'card' }: {
  valor: number
  de?: number | null
  pix?: number | null
  politica?: PoliticaPreco
  tamanho?: 'card' | 'pagina'
}) {
  const grande = tamanho === 'pagina'
  const pol = politica ?? PRECO_UNICO
  const e = exibicaoPreco({ preco: valor, precoDe: de ?? null, precoPix: pix ?? null }, pol)

  const miudo = grande ? 'text-sm' : 'text-[0.6875rem]'
  const heroi = grande ? 'text-3xl' : 'text-[1.0625rem]'

  // O riscado fica ACIMA do preço quando ele é o destaque, e ABAIXO do à
  // vista quando o destaque é o Pix. Nos dois casos ele encosta no preço que
  // está sendo comparado — riscado longe do número que ele contradiz é o
  // tipo de detalhe que faz o cliente reler.
  const riscado = e.de != null && (
    <div className={`text-[var(--tinta-fraca)] line-through ${miudo}`}>{real(e.de)}</div>
  )

  return (
    <div>
      {!e.aVistaEmDestaque && riscado}

      <div
        className={`font-bold tracking-tight ${heroi} ${e.aVistaEmDestaque ? '' : 'text-[var(--tinta-forte)]'}`}
        style={e.aVistaEmDestaque ? { color: 'var(--sucesso)' } : undefined}
      >
        {real(e.destaque)}
        {e.aVistaEmDestaque && (
          <span className={`ml-1.5 font-semibold ${miudo}`}>{textoAVista(pol)}</span>
        )}
      </div>

      {e.aVistaEmDestaque ? (
        <>
          {riscado}
          {/* O preço normal, que é o que vale em qualquer outra forma de
              pagamento. Sem parcelamento configurado sai só o valor — e
              continua legível, porque o "De" logo acima dá o contexto. */}
          <div className={`text-[var(--tinta-media)] ${miudo}`}>
            <span className="font-semibold">{real(e.normal ?? valor)}</span>
            {e.parcelamento && <> {textoParcelamento(e.parcelamento)}</>}
          </div>
        </>
      ) : (
        <>
          {e.parcelamento && (
            <div className={`text-[var(--tinta-media)] ${miudo}`}>
              {textoParcelamento(e.parcelamento)}
            </div>
          )}
          {e.aVista != null && (
            <div className={`font-medium text-[var(--sucesso)] ${miudo} ${grande ? 'mt-1' : ''}`}>
              {real(e.aVista)} {rotuloAVista(pol)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Selo de disponibilidade ─────────────────────────────────────────────────

export function SeloDisponibilidade({ disponivel, permiteSemEstoque }: {
  disponivel: number; permiteSemEstoque: boolean
}) {
  if (disponivel > 0) {
    // "Últimas unidades" só com número pequeno DE VERDADE. Usar urgência
    // falsa é o tipo de coisa que o cliente descobre e não perdoa.
    if (disponivel <= 3) {
      // Concordância: com 1 em estoque, "Últimas 1 unidades" é o tipo de
      // detalhe que faz a loja parecer gerada por máquina.
      const n = Math.floor(disponivel)
      return <span className="text-[0.6875rem] font-semibold text-[var(--alerta)]">
        {n === 1 ? 'Última unidade' : `Últimas ${n} unidades`}
      </span>
    }
    return <span className="text-[0.6875rem] font-medium text-[var(--sucesso)]">Disponível</span>
  }
  if (permiteSemEstoque) {
    return <span className="text-[0.6875rem] font-medium text-[var(--tinta-media)]">Sob encomenda</span>
  }
  return <span className="text-[0.6875rem] font-medium text-[var(--tinta-fraca)]">Indisponível</span>
}

// ─── Estados ─────────────────────────────────────────────────────────────────

export function EstadoVazio({ titulo, descricao, acao }: {
  titulo: string; descricao?: string; acao?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h2 className="text-lg font-semibold text-[var(--tinta-forte)]">{titulo}</h2>
      {descricao && <p className="max-w-md text-sm text-[var(--tinta-media)]">{descricao}</p>}
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  )
}

export function EsqueletoCard() {
  return (
    <div className="overflow-hidden rounded-[var(--raio)] border border-[var(--borda)] bg-white">
      <div className="loja-esqueleto aspect-square w-full" />
      <div className="space-y-2 p-3">
        <div className="loja-esqueleto h-3 w-4/5" />
        <div className="loja-esqueleto h-3 w-2/5" />
        <div className="loja-esqueleto h-5 w-1/2" />
      </div>
    </div>
  )
}

export function EsqueletoGrade({ n = 10 }: { n?: number }) {
  return (
    <div className="loja-grade">
      {Array.from({ length: n }, (_, i) => <EsqueletoCard key={i} />)}
    </div>
  )
}

// ─── Título de seção ─────────────────────────────────────────────────────────

export function TituloSecao({ titulo, subtitulo, href }: {
  titulo: string; subtitulo?: string | null; href?: string
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-[var(--tinta-forte)] md:text-xl">{titulo}</h2>
        {subtitulo && <p className="mt-0.5 text-sm text-[var(--tinta-media)]">{subtitulo}</p>}
      </div>
      {href && (
        <Link href={href} className="shrink-0 text-sm font-semibold" style={{ color: 'var(--loja-primaria)' }}>
          Ver tudo
        </Link>
      )}
    </div>
  )
}
