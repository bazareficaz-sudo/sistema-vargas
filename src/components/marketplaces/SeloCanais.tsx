'use client'

// Onde o produto está anunciado, em um selo por canal com a quantidade.
//
// Não usa a logo oficial de cada marketplace de propósito: distribuir a
// marca de terceiros exige licença de uso, e um arquivo de imagem por
// plataforma pesaria em cada linha de uma lista de 14 mil produtos. A cor
// de cada marca é o suficiente para reconhecer de relance — amarelo é
// Mercado Livre, laranja é Shopee.

export type ContagemCanais = Record<string, { total: number; ativos: number }>

const CANAL: Record<string, { sigla: string; nome: string; cls: string }> = {
  mercadolivre: { sigla: 'ML', nome: 'Mercado Livre', cls: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  shopee:       { sigla: 'SP', nome: 'Shopee',        cls: 'bg-orange-100 text-orange-700 border-orange-300' },
  amazon:       { sigla: 'AZ', nome: 'Amazon',        cls: 'bg-slate-200 text-slate-700 border-slate-300' },
  magalu:       { sigla: 'MG', nome: 'Magalu',        cls: 'bg-blue-100 text-blue-700 border-blue-300' },
  outro:        { sigla: '••', nome: 'Outro canal',   cls: 'bg-gray-100 text-gray-600 border-gray-300' },
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
        const titulo = `${info.nome}: ${c.total} anúncio(s)`
          + (pausados > 0 ? ` — ${c.ativos} ativo(s), ${pausados} pausado(s)/rascunho` : '')
          + (onAbrir ? '. Clique para ver e pausar.' : '')
        return (
          <span key={plataforma}
            onClick={onAbrir ? (e) => { e.stopPropagation(); onAbrir() } : undefined}
            title={titulo}
            className={`relative inline-flex items-center justify-center w-6 h-5 rounded border text-[10px] font-bold leading-none
              ${info.cls} ${pausados === c.total ? 'opacity-50' : ''} ${onAbrir ? 'cursor-pointer hover:brightness-95' : ''}`}>
            {info.sigla}
            <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-[3px] rounded-full
              bg-gray-800 text-white text-[9px] font-bold flex items-center justify-center">
              {c.total}
            </span>
          </span>
        )
      })}
    </span>
  )
}
