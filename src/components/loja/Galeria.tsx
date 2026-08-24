'use client'

import { useState } from 'react'
import { ImagemProduto } from './ds'

// Galeria do produto.
//
// Uma imagem só (ou nenhuma) é o caso COMUM neste catálogo, não a exceção:
// dos 508 produtos publicados, 284 não têm foto e a grande maioria dos que
// têm, tem uma. Por isso as miniaturas só aparecem quando há mais de uma —
// uma fileira de miniaturas com um item só é ruído que ocupa altura de tela.

export default function Galeria({ imagens, nome }: {
  imagens: { url: string; alt: string | null }[]
  nome: string
}) {
  const [i, setI] = useState(0)
  const atual = imagens[i] ?? null

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-[var(--raio)] border border-[var(--borda)] bg-white">
        <ImagemProduto
          url={atual?.url ?? null}
          alt={atual?.alt || nome}
          prioridade
          className="aspect-square w-full"
        />
      </div>

      {imagens.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {imagens.map((img, idx) => (
            <button
              key={img.url + idx}
              type="button"
              onClick={() => setI(idx)}
              aria-label={`Ver imagem ${idx + 1} de ${imagens.length}`}
              aria-current={idx === i}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-[var(--raio-sm)] border-2 bg-white ${
                idx === i ? 'border-[var(--loja-primaria)]' : 'border-[var(--borda)]'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="" className="h-full w-full object-contain" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
