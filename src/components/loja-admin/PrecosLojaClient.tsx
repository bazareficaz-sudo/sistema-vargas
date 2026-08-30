'use client'

import FormularioLoja, { type Secao } from './FormularioLoja'
import {
  brl, exibicaoPreco, motivoSemParcelamento, rotuloAVista, textoAVista, textoParcelamento,
} from '@/lib/commerce/precos'
import type { PoliticaPreco } from '@/lib/commerce/tipos'

// A aba Preços.
//
// O que justifica esta tela ter código próprio, em vez de ser mais uma
// chamada seca de FormularioLoja como Aparência e Domínio: a política de
// preços muda o que o cliente lê em 533 páginas no instante do Salvar. Uma
// vírgula errada em "desconto do Pix" não quebra nada — publica um preço
// menor do que a loja pratica, em todo o catálogo, e ninguém percebe pelo
// log.
//
// Por isso a prévia fica ACIMA dos campos, e é calculada com o formulário
// como está, ainda não salvo. E é calculada pelas MESMAS funções da vitrine
// (`exibicaoPreco`, `textoParcelamento`) — uma prévia que faz a conta por
// conta própria é uma prévia que um dia mente.

/** Um produto de verdade do catálogo, para a prévia não usar preço inventado. */
export type AmostraPreco = {
  produtoId: string
  nome: string
  preco: number
  precoDe: number | null
  /** `loja_produtos.preco_pix`, a exceção digitada produto a produto. */
  precoPixManual: number | null
}

const SECOES: Secao[] = [
  {
    titulo: 'Como a vitrine mostra o preço',
    descricao:
      'Um preço só é o que a loja faz hoje. Dois preços mostram o normal com parcelamento '
      + 'e o à vista logo abaixo — e, quando o produto está em promoção, invertem: o à vista sobe para o destaque.',
    campos: [
      { nome: 'preco_exibicao', rotulo: 'Exibição', tipo: 'select',
        opcoes: [
          { valor: 'preco_unico', rotulo: 'Um preço' },
          { valor: 'dois_precos', rotulo: 'Dois preços (normal + à vista)' },
        ],
        ajuda: 'Trocar aqui muda o catálogo inteiro de uma vez. Confira a prévia acima antes de salvar.' },
    ],
  },
  {
    titulo: 'Preço à vista',
    descricao: 'O campo "Preço no Pix" de um produto continua ganhando desta regra, como exceção.',
    campos: [
      { nome: 'avista_origem', rotulo: 'De onde vem o preço à vista', tipo: 'select',
        opcoes: [
          { valor: 'percentual', rotulo: 'Um desconto em % sobre todo o catálogo' },
          { valor: 'promocao', rotulo: 'O preço promocional do produto' },
        ],
        ajuda: 'Com "promocional", só os produtos em promoção vigente têm dois preços — o promocional à vista e o de tabela parcelado. Os demais ficam com um preço só, e o riscado deixa de existir.' },
      { nome: 'pix_desconto_pct', rotulo: 'Desconto à vista', tipo: 'numero', sufixo: '%',
        ajuda: 'Só vale na opção do percentual. Incide sobre o preço praticado — que já é o promocional quando há promoção. 0 desliga o segundo preço.' },
      { nome: 'pix_rotulo', rotulo: 'Como chamar', max: 40, placeholder: 'no Pix',
        ajuda: 'Aparece como "R$ 89,00 no Pix". Se a loja dá o mesmo desconto em dinheiro, escreva "no Pix ou dinheiro".' },
    ],
  },
  {
    titulo: 'Parcelamento',
    descricao: 'Só informação de vitrine: a loja ainda não cobra pelo site (o checkout é a Fase 3). Escreva aqui o que o balcão realmente pratica.',
    campos: [
      { nome: 'parcelas_max', rotulo: 'Parcelar em até', tipo: 'numero', sufixo: 'x',
        ajuda: 'Vazio não fala de parcelamento. Mínimo 2, máximo 24.' },
      { nome: 'parcelas_sem_juros', rotulo: 'Sem juros até', tipo: 'numero', sufixo: 'x',
        ajuda: 'Acima disso só é oferecido se houver juros configurados abaixo. Digite 0 para nenhuma.' },
      { nome: 'parcelas_juros_mes', rotulo: 'Juros ao mês', tipo: 'numero', sufixo: '%',
        ajuda: 'Tabela Price, a conta do cartão. 0 significa que a loja não parcela com juros.' },
      { nome: 'parcela_minima', rotulo: 'Parcela mínima', tipo: 'numero', prefixo: 'R$',
        ajuda: 'A vitrine reduz o número de vezes até a parcela alcançar este valor — é o que evita "10x de R$ 0,49".' },
    ],
  },
]

/** Lê a política do formulário em edição, com os mesmos padrões do banco. */
function politicaDoForm(f: Record<string, unknown>): PoliticaPreco {
  const num = (v: unknown, padrao = 0) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : padrao
  }
  return {
    exibicao: f.preco_exibicao === 'dois_precos' ? 'dois_precos' : 'preco_unico',
    avistaOrigem: f.avista_origem === 'promocao' ? 'promocao' : 'percentual',
    pixDescontoPct: num(f.pix_desconto_pct),
    pixRotulo: typeof f.pix_rotulo === 'string' && f.pix_rotulo.trim() ? f.pix_rotulo : 'no Pix',
    parcelasMax: f.parcelas_max == null || f.parcelas_max === '' ? null : num(f.parcelas_max),
    parcelasSemJuros: num(f.parcelas_sem_juros),
    jurosMes: num(f.parcelas_juros_mes),
    parcelaMinima: num(f.parcela_minima),
  }
}

/**
 * O preço à vista, repetindo a regra do banco.
 *
 * É a única duplicação desta tela, e é consciente: a coluna `preco_pix` da
 * view sai calculada com o percentual JÁ SALVO, e a prévia precisa mostrar o
 * percentual que está sendo digitado. A regra copiada está em
 * supabase-loja-precos.sql, seção 2 — mudou lá, muda aqui.
 */
function aVistaPrevisto(a: AmostraPreco, pol: PoliticaPreco): number | null {
  if (a.precoPixManual != null && a.precoPixManual < a.preco) return a.precoPixManual
  // Em 'promocao' o à vista não sai daqui: sai da própria promoção, e quem
  // monta isso é `exibicaoPreco`. Devolver um número aqui criaria um segundo
  // preço à vista concorrendo com o primeiro.
  if (pol.avistaOrigem === 'percentual' && pol.pixDescontoPct > 0 && a.preco > 0) {
    return Math.round(a.preco * (1 - pol.pixDescontoPct / 100) * 100) / 100
  }
  return null
}

function LinhaPrevia({ a, pol }: { a: AmostraPreco; pol: PoliticaPreco }) {
  const e = exibicaoPreco(
    { preco: a.preco, precoDe: a.precoDe, precoPix: aVistaPrevisto(a, pol) },
    pol,
  )

  // Por que NÃO há parcelamento, quando não há. Silêncio aqui faria o
  // operador achar que o campo não pegou, e mexer no que já estava certo —
  // foi exatamente o que aconteceu com "6x, sem juros até 0".
  const semParcela = e.parcelamento ? null : motivoSemParcelamento(e.normal ?? a.preco, pol)

  return (
    <li className="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-gray-700">{a.nome}</p>
        {a.precoDe != null && (
          <span className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-amber-800">
            em promoção
          </span>
        )}
      </div>

      {/* A mesma hierarquia da vitrine, em tipografia do painel: o destaque
          grande, o resto miúdo. Não reaproveita o componente <Preco> porque
          ele desenha com as variáveis de cor da loja, que não existem aqui. */}
      <div className="sm:w-72 sm:shrink-0">
        {!e.aVistaEmDestaque && e.de != null && (
          <div className="text-xs text-gray-400 line-through">{brl(e.de)}</div>
        )}

        <div className={`text-lg font-bold ${e.aVistaEmDestaque ? 'text-emerald-700' : 'text-gray-900'}`}>
          {brl(e.destaque)}
          {e.aVistaEmDestaque && (
            <span className="ml-1.5 text-xs font-semibold">{textoAVista(pol)}</span>
          )}
        </div>

        {e.aVistaEmDestaque ? (
          <>
            {e.de != null && <div className="text-xs text-gray-400 line-through">{brl(e.de)}</div>}
            <div className="text-xs text-gray-600">
              <span className="font-semibold">{brl(e.normal ?? a.preco)}</span>
              {e.parcelamento && <> {textoParcelamento(e.parcelamento)}</>}
            </div>
          </>
        ) : (
          <>
            {e.parcelamento && (
              <div className="text-xs text-gray-600">{textoParcelamento(e.parcelamento)}</div>
            )}
            {e.aVista != null && (
              <div className="text-xs font-medium text-emerald-700">
                {brl(e.aVista)} {rotuloAVista(pol)}
              </div>
            )}
          </>
        )}

        {semParcela && (
          <p className="mt-0.5 text-[0.6875rem] text-amber-700">{semParcela}</p>
        )}
      </div>
    </li>
  )
}

export default function PrecosLojaClient({ lojaId, valores, amostra, migracaoPendente }: {
  lojaId: string
  valores: Record<string, unknown>
  amostra: AmostraPreco[]
  /** A migração ainda não rodou: os campos existem na tela, não no banco. */
  migracaoPendente?: boolean
}) {
  return (
    <FormularioLoja
      lojaId={lojaId}
      secoes={SECOES}
      valores={valores}
      previa={form => {
        const pol = politicaDoForm(form)
        return (
          <>
          {migracaoPendente && (
            // O aviso vem ANTES da prévia porque, sem as colunas, salvar
            // falha — e descobrir isso no erro do botão é descobrir tarde.
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
              <h2 className="font-semibold text-amber-900">Falta rodar a migração</h2>
              <p className="mt-1 text-sm text-amber-800">
                As colunas desta tela ainda não existem no banco. A prévia abaixo já
                funciona, mas <strong>salvar vai falhar</strong> até que{' '}
                <code className="rounded bg-amber-100 px-1">supabase-loja-precos.sql</code>{' '}
                seja executado no SQL Editor do Supabase.
              </p>
              <p className="mt-1 text-sm text-amber-800">
                A vitrine não é afetada: sem as colunas ela segue com um preço só,
                exatamente como hoje.
              </p>
            </div>
          )}

          <section className="rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900">Como vai ficar na vitrine</h2>
              <p className="mt-0.5 text-sm text-gray-500">
                Produtos de verdade do seu catálogo, com o que está digitado abaixo —
                inclusive o que ainda não foi salvo.
              </p>
            </div>

            {amostra.length === 0 ? (
              <p className="p-4 text-sm text-gray-600">
                Nenhum produto publicado com preço ainda. Publique em{' '}
                <strong>Loja Online → Produtos</strong> para ver a prévia.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {amostra.map(a => <LinhaPrevia key={a.produtoId} a={a} pol={pol} />)}
              </ul>
            )}

            {pol.exibicao !== 'dois_precos' && (
              <p className="border-t border-gray-100 px-4 py-3 text-xs text-gray-500">
                A exibição está em <strong>Um preço</strong>. O parcelamento configurado abaixo
                só aparece na vitrine depois de trocar para <strong>Dois preços</strong>.
              </p>
            )}
          </section>
          </>
        )
      }}
    />
  )
}
