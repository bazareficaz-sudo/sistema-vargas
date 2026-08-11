'use client'

import { useEffect } from 'react'

// Visualizador de imagem em tela cheia.
//
// A miniatura da aba Imagens é cortada (object-cover) para caber na grade;
// não dá para conferir se a foto está boa olhando um recorte. Aqui a imagem
// aparece inteira (object-contain), com o título e navegação entre as fotos
// do produto.

export type ImagemVisualizavel = { id: string; url: string; titulo?: string | null }

export default function VisualizadorImagem({
  imagens, indice, onFechar, onNavegar,
}: {
  imagens: ImagemVisualizavel[]
  indice: number
  onFechar: () => void
  onNavegar: (novoIndice: number) => void
}) {
  const img = imagens[indice]

  // Teclado: Esc fecha, setas navegam. Numa tela cheia de imagem, o mouse
  // costuma estar longe dos botões.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') onFechar()
      if (e.key === 'ArrowRight' && indice < imagens.length - 1) onNavegar(indice + 1)
      if (e.key === 'ArrowLeft' && indice > 0) onNavegar(indice - 1)
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [indice, imagens.length, onFechar, onNavegar])

  if (!img) return null

  return (
    // z-index acima do modal de produto (z-50), senão abriria atrás dele.
    <div className="fixed inset-0 z-[60] bg-black/90 flex flex-col" onClick={onFechar}>
      <div className="flex items-center justify-between px-4 py-3 text-white shrink-0">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {img.titulo?.trim() || `Imagem ${indice + 1}`}
          </p>
          <p className="text-xs text-white/50">{indice + 1} de {imagens.length}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a href={img.url} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="px-3 h-8 inline-flex items-center text-xs rounded-lg border border-white/25 text-white/80 hover:bg-white/10">
            Abrir original
          </a>
          <button onClick={onFechar} aria-label="Fechar"
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-white/25 text-white/80 hover:bg-white/10 text-lg leading-none">
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 pb-4 min-h-0">
        {indice > 0 && (
          <button onClick={e => { e.stopPropagation(); onNavegar(indice - 1) }} aria-label="Anterior"
            className="absolute left-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-xl">
            ‹
          </button>
        )}
        {/* object-contain e não cover: o ponto de abrir em tela cheia é ver a
            imagem inteira, não um recorte maior. */}
        <img src={img.url} alt={img.titulo ?? 'Imagem do produto'}
          onClick={e => e.stopPropagation()}
          className="max-h-full max-w-full object-contain rounded-lg" />
        {indice < imagens.length - 1 && (
          <button onClick={e => { e.stopPropagation(); onNavegar(indice + 1) }} aria-label="Próxima"
            className="absolute right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-xl">
            ›
          </button>
        )}
      </div>
    </div>
  )
}
