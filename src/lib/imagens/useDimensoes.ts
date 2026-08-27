'use client'

import { useEffect, useState } from 'react'
import { avaliarDimensoes, lerDimensoes, type Avaliacao } from './requisitos'

// Mede as imagens uma vez e serve as duas telas que precisam do resultado: o
// selo em cada miniatura da grade e o painel de avisos embaixo dela.
//
// Estava dentro do painel, e o selo na miniatura só existiria medindo tudo de
// novo — nove downloads a mais por abertura, e a chance de os dois lugares
// discordarem sobre a mesma foto enquanto uma medição termina antes da outra.

export type Medida =
  | { largura: number; altura: number; avaliacao: Avaliacao }
  | { erro: true }

export type ImagemMedivel = { id: string; url: string }

export function useDimensoes(imagens: ImagemMedivel[], plataforma: string) {
  const [medidas, setMedidas] = useState<Record<string, Medida>>({})

  // A chave inclui a URL: trocar a foto de uma posição precisa remedir, e
  // comparar só o id manteria o número da imagem antiga na tela.
  const chave = imagens.map(i => `${i.id}:${i.url}`).join('|')

  useEffect(() => {
    let ativo = true
    ;(async () => {
      for (const img of imagens) {
        const jaMedida = medidas[img.id]
        if (jaMedida && !('erro' in jaMedida)) continue
        const d = await lerDimensoes(img.url)
        if (!ativo) return
        setMedidas(m => ({
          ...m,
          [img.id]: d
            ? { largura: d.largura, altura: d.altura, avaliacao: avaliarDimensoes(d.largura, d.altura, plataforma) }
            : { erro: true },
        }))
      }
    })()
    return () => { ativo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, plataforma])

  /** Esquece a medida de uma imagem — usar depois de ajustar, para remedir. */
  function esquecer(id: string) {
    setMedidas(m => { const n = { ...m }; delete n[id]; return n })
  }

  return { medidas, esquecer }
}

/** Cores do selo por nível, num lugar só para grade e painel não divergirem. */
export const CORES_NIVEL: Record<Avaliacao['nivel'], string> = {
  ok: 'bg-emerald-600/85 text-white',
  aviso: 'bg-amber-500/90 text-white',
  erro: 'bg-red-600/90 text-white',
}
