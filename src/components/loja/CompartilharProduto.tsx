'use client'

import { useState } from 'react'

// Compartilhar o produto — pedido explicitamente para WhatsApp e Instagram.
//
// Não existe endereço público de "compartilhar no Instagram" como existe
// para WhatsApp (`wa.me`): o Instagram não abre um link com texto pronto, só
// aceita compartilhar de dentro do próprio app. Por isso o botão principal
// usa a Web Share API do navegador (`navigator.share`) — no celular ela abre
// o menu nativo do sistema, com Instagram, WhatsApp e qualquer outro app
// instalado, exatamente como compartilhar uma foto da galeria. É o único
// caminho que realmente chega ao Instagram a partir do navegador.
//
// WhatsApp ganha um atalho À PARTE porque é o canal desta loja — a maioria
// do tráfego vem de lá (ver CONTINUIDADE.md) — e nem todo navegador tem
// `navigator.share` (é raro em desktop).
export default function CompartilharProduto({ nome }: { nome: string }) {
  const [aviso, setAviso] = useState<string | null>(null)

  function urlAtual() {
    return typeof window !== 'undefined' ? window.location.href : ''
  }

  async function compartilhar() {
    const url = urlAtual()
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: nome, text: `Olha isso: ${nome}`, url })
      } catch {
        // Usuário cancelou o menu do sistema — não é erro, não precisa avisar nada.
      }
      return
    }
    // Sem Web Share (comum em desktop): copia o link, e o aviso diz o que
    // fazer com ele — sem isso, "copiado" sozinho não diz pra onde colar.
    try {
      await navigator.clipboard.writeText(url)
      setAviso('Link copiado — cole no Instagram ou onde quiser.')
      setTimeout(() => setAviso(null), 3500)
    } catch {
      // Navegador sem permissão de área de transferência: o link ainda serve
      // pra alguma coisa se disser o que é, em vez de aparecer sozinho.
      setAviso(`Copie o link: ${url}`)
    }
  }

  function abrirWhatsapp() {
    const url = urlAtual()
    window.open(`https://wa.me/?text=${encodeURIComponent(`${nome}\n${url}`)}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        onClick={compartilhar}
        className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[var(--borda)] bg-white px-3 font-medium text-[var(--tinta-forte)] hover:bg-[var(--fundo-suave)]"
      >
        <span aria-hidden>↗</span> Compartilhar
      </button>
      <button
        type="button"
        onClick={abrirWhatsapp}
        className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[var(--borda)] bg-white px-3 font-medium text-[var(--tinta-forte)] hover:bg-[var(--fundo-suave)]"
      >
        WhatsApp
      </button>
      {aviso && <span className="text-xs text-[var(--sucesso)]">{aviso}</span>}
    </div>
  )
}
