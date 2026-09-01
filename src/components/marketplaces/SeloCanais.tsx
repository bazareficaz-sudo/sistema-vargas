'use client'

import { linkCompartilharWhatsApp } from '@/lib/commerce/urlProduto'

// Onde o produto está anunciado, em um selo por canal com a quantidade.
//
// Não usa a logo oficial de cada marketplace de propósito: distribuir a
// marca de terceiros exige licença de uso, e um arquivo de imagem por
// plataforma pesaria em cada linha de uma lista de 14 mil produtos. A cor
// de cada marca é o suficiente para reconhecer de relance — amarelo é
// Mercado Livre, laranja é Shopee.

export type ContagemCanais = Record<string, {
  total: number
  ativos: number
  /**
   * Só a Loja Online usa. Ela não tem "quantidade de anúncios" — um produto
   * está publicado ou não —, então o estado substitui a contagem.
   */
  estado?: 'publicado' | 'pausado' | 'rascunho'
  /**
   * Endereço público do produto na vitrine. Só a Loja Online preenche, e só
   * quando a página EXISTE de verdade.
   *
   * Quem monta é o servidor (`dashboard/produtos/page.tsx`), que tem o
   * subdomínio da loja e o slug do produto. Montar aqui exigiria o domínio
   * raiz no cliente e repetiria a regra de domínio próprio × subdomínio em
   * mais um lugar.
   *
   * Vem ausente para pausado e rascunho: a view da vitrine só contém
   * `publicado`, então esses endereços dariam 404. Um link que leva a lugar
   * nenhum é pior que nenhum link — ele parece que funciona.
   */
  url?: string
}>

const CANAL: Record<string, { sigla: string; nome: string; cls: string }> = {
  mercadolivre: { sigla: 'ML', nome: 'Mercado Livre', cls: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  shopee:       { sigla: 'SP', nome: 'Shopee',        cls: 'bg-orange-100 text-orange-700 border-orange-300' },
  amazon:       { sigla: 'AZ', nome: 'Amazon',        cls: 'bg-slate-200 text-slate-700 border-slate-300' },
  magalu:       { sigla: 'MG', nome: 'Magalu',        cls: 'bg-blue-100 text-blue-700 border-blue-300' },
  outro:        { sigla: '••', nome: 'Outro canal',   cls: 'bg-gray-100 text-gray-600 border-gray-300' },
  // A Loja Online é canal próprio, e por isso ganha cor própria — índigo, a
  // mesma do grupo "Loja Online" no menu. Não disputa com o amarelo do ML
  // nem com o laranja da Shopee.
  loja:         { sigla: 'LO', nome: 'Loja Online',   cls: 'bg-indigo-100 text-indigo-700 border-indigo-300' },
}

const ESTADO_LOJA: Record<string, string> = {
  publicado: 'publicado e visível na vitrine',
  pausado:   'pausado — some da vitrine, o cadastro fica',
  rascunho:  'rascunho — ainda não foi para a vitrine',
}

/**
 * Botão de mandar o link no WhatsApp.
 *
 * NÃO usa a logo do WhatsApp, pela mesma razão que os selos não usam a logo
 * de cada marketplace: distribuir marca de terceiros exige licença. O verde e
 * o balão de conversa bastam para reconhecer.
 */
function BotaoWhatsApp({ url }: { url: string }) {
  const link = linkCompartilharWhatsApp(url)
  if (!link) return null
  return (
    <a href={link} target="_blank" rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title="Enviar o link deste produto no WhatsApp — você escolhe o contato"
      className="inline-flex items-center justify-center w-5 h-5 rounded border border-green-300
        bg-green-100 text-green-700 hover:brightness-95 hover:ring-1 hover:ring-green-400 cursor-pointer">
      <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor" aria-hidden="true">
        <path d="M12 3C7 3 3 6.6 3 11c0 2.2 1 4.2 2.7 5.6L5 21l4.6-1.5c.8.2 1.6.3 2.4.3 5 0 9-3.6 9-8s-4-8-9-8z" />
      </svg>
    </a>
  )
}

export default function SeloCanais({ contagem, onAbrir }: {
  contagem: ContagemCanais | undefined
  /** Abre a lista de anúncios do produto. Sem isso, o selo é só informativo. */
  onAbrir?: () => void
}) {
  const canais = Object.entries(contagem ?? {}).filter(([, c]) => c.total > 0)
  if (canais.length === 0) return null

  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {canais.map(([plataforma, c]) => {
        const info = CANAL[plataforma] ?? CANAL.outro
        // Anúncio pausado conta no total mas não nos ativos — mostrar os
        // dois evita a leitura errada de "está vendendo em 3 lugares"
        // quando dois estão parados.
        const pausados = c.total - c.ativos
        const ehLoja = plataforma === 'loja'
        const titulo = ehLoja
          // A loja não tem contagem: um produto está publicado ou não.
          // Mostrar "1" ali seria um número sem significado.
          ? `${info.nome}: ${ESTADO_LOJA[c.estado ?? ''] ?? 'publicado'}`
            + (c.url ? '. Clique para abrir na vitrine.' : '')
          : `${info.nome}: ${c.total} anúncio(s)`
            + (pausados > 0 ? ` — ${c.ativos} ativo(s), ${pausados} pausado(s)/rascunho` : '')
            + (onAbrir ? '. Clique para ver e pausar.' : '')

        const classe = `relative inline-flex items-center justify-center w-6 h-5 rounded border text-[10px] font-bold leading-none
          ${info.cls} ${pausados === c.total ? 'opacity-50' : ''}`

        // A LOJA ABRE A VITRINE; os marketplaces abrem a lista de anúncios.
        //
        // São ações diferentes e por isso elementos diferentes: a vitrine é
        // uma página pública noutro domínio, então é uma âncora de verdade —
        // abre em nova aba, aceita clique do meio, "copiar endereço" e
        // aparece na barra de status antes do clique. Um `onClick` num
        // <span> não faz nada disso.
        if (ehLoja && c.url) {
          // Os dois juntos: o selo abre a vitrine, o botão manda o endereço.
          // Ficam lado a lado porque respondem à mesma pergunta ("e este
          // produto na loja?") por caminhos diferentes.
          return (
            <span key={plataforma} className="inline-flex items-center gap-0.5">
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                // A linha do produto abre a edição no clique. Sem parar aqui, o
                // clique no selo abriria a vitrine E a edição ao mesmo tempo.
                onClick={(e) => e.stopPropagation()}
                title={titulo}
                className={`${classe} cursor-pointer hover:brightness-95 hover:ring-1 hover:ring-indigo-400`}>
                {info.sigla}
              </a>
              <BotaoWhatsApp url={c.url} />
            </span>
          )
        }

        return (
          <span key={plataforma}
            onClick={!ehLoja && onAbrir ? (e) => { e.stopPropagation(); onAbrir() } : undefined}
            title={titulo}
            className={`${classe} ${!ehLoja && onAbrir ? 'cursor-pointer hover:brightness-95' : ''}`}>
            {info.sigla}
            {/* Contagem só faz sentido onde existe mais de um anúncio. */}
            {!ehLoja && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-[3px] rounded-full
                bg-gray-800 text-white text-[9px] font-bold flex items-center justify-center">
                {c.total}
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}
