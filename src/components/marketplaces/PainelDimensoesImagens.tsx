'use client'

import { useEffect, useState } from 'react'
import { avaliarDimensoes, lerDimensoes, requisitoDe, type Avaliacao } from '@/lib/imagens/requisitos'

// Mostra o tamanho de cada imagem do anúncio e avisa quando está abaixo do
// exigido pelo marketplace — antes de publicar, não depois de o anúncio não
// ativar.
//
// A medição roda no navegador e é instantânea. O ajuste vai pro servidor,
// porque processar imagem de outro domínio no navegador esbarra na proteção
// de canvas.

type ImagemAnuncio = { id: string; url: string; principal?: boolean }

type Medida = { largura: number; altura: number; avaliacao: Avaliacao } | { erro: true }

export default function PainelDimensoesImagens({ imagens, plataforma, produtoId, onImagemAjustada }: {
  imagens: ImagemAnuncio[]
  plataforma: string
  produtoId: string | null
  onImagemAjustada: (imagemId: string, novaUrl: string) => void
}) {
  const [medidas, setMedidas] = useState<Record<string, Medida>>({})
  const [ajustando, setAjustando] = useState<string | null>(null)
  const [aviso, setAviso] = useState('')
  const req = requisitoDe(plataforma)

  useEffect(() => {
    let ativo = true
    ;(async () => {
      for (const img of imagens) {
        // Reaproveita a medida quando a URL não mudou.
        if (medidas[img.id] && !('erro' in medidas[img.id])) continue
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
  }, [imagens.map(i => `${i.id}:${i.url}`).join('|'), plataforma])

  async function ajustar(img: ImagemAnuncio) {
    if (!produtoId) { setAviso('Escolha o produto antes de ajustar a imagem.'); return }
    setAjustando(img.id); setAviso('')
    try {
      const d = await fetch('/api/produtos/imagens/ajustar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: img.url, produtoId, plataforma, imagemId: img.id }),
      }).then(r => r.json())
      if (!d.ok) { setAviso(d.erro ?? 'Não foi possível ajustar'); return }
      setMedidas(m => { const n = { ...m }; delete n[img.id]; return n })
      onImagemAjustada(img.id, d.url)
      if (d.ampliou) {
        setAviso(`Ajustada de ${d.antes.largura}×${d.antes.altura} para ${d.depois.largura}×${d.depois.altura}. Como a original era menor, a imagem foi ampliada — isso atende a exigência de tamanho, mas não cria nitidez que a foto não tinha.`)
      }
    } catch (e: any) {
      setAviso(e.message ?? 'Erro ao ajustar')
    } finally {
      setAjustando(null)
    }
  }

  if (imagens.length === 0) return null

  const comProblema = imagens.filter(i => {
    const m = medidas[i.id]
    return m && !('erro' in m) && m.avaliacao.nivel !== 'ok'
  })
  const comErro = imagens.filter(i => {
    const m = medidas[i.id]
    return m && !('erro' in m) && m.avaliacao.nivel === 'erro'
  })

  return (
    <div className="mt-2 space-y-1.5">
      {comErro.length > 0 && (
        <p className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
          {comErro.length === 1 ? '1 imagem está' : `${comErro.length} imagens estão`} abaixo de {req.minimo}×{req.minimo} —
          {req.efeitoAbaixoDoMinimo ?? ` a ${req.plataforma} pode não ativar o anúncio.`}
        </p>
      )}

      {comProblema.length > 0 && (
        <div className="space-y-1">
          {imagens.map(img => {
            const m = medidas[img.id]
            if (!m) return null
            if ('erro' in m) {
              return (
                <p key={img.id} className="text-[11px] text-gray-400">
                  Não foi possível ler o tamanho desta imagem (o endereço pode estar fora do ar).
                </p>
              )
            }
            if (m.avaliacao.nivel === 'ok') return null
            const cor = m.avaliacao.nivel === 'erro' ? 'text-red-700' : 'text-amber-700'
            return (
              <div key={img.id} className="flex items-start gap-2">
                <img src={img.url} alt="" className="w-8 h-8 rounded object-cover border border-gray-200 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className={`text-[11px] ${cor}`}>
                    <strong>{m.largura}×{m.altura}</strong> — {m.avaliacao.mensagem}
                  </p>
                </div>
                <button type="button" onClick={() => ajustar(img)} disabled={ajustando === img.id}
                  className="text-[11px] px-2 py-0.5 border border-blue-300 text-blue-700 rounded hover:bg-blue-50 disabled:opacity-50 flex-shrink-0">
                  {ajustando === img.id ? 'ajustando...' : `ajustar p/ ${req.alvoAjuste}px`}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {comProblema.length === 0 && Object.keys(medidas).length > 0 && (
        <p className="text-[11px] text-green-700">
          ✓ Todas as imagens estão dentro do recomendado pela {req.plataforma} ({req.recomendado}×{req.recomendado}).
        </p>
      )}

      {aviso && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">{aviso}</p>
      )}
    </div>
  )
}
