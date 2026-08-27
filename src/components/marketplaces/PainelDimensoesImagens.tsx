'use client'

import { useState } from 'react'
import { requisitoDe } from '@/lib/imagens/requisitos'
import { useDimensoes, type Medida } from '@/lib/imagens/useDimensoes'

// Mostra o tamanho de cada imagem do anúncio e avisa quando está abaixo do
// exigido pelo marketplace — antes de publicar, não depois de o anúncio não
// ativar.
//
// A medição roda no navegador e é instantânea. O ajuste vai pro servidor,
// porque processar imagem de outro domínio no navegador esbarra na proteção
// de canvas.

type ImagemAnuncio = { id: string; url: string; principal?: boolean }

export default function PainelDimensoesImagens({ imagens, plataforma, produtoId, onImagemAjustada, medidas: medidasFora, esquecer: esquecerFora }: {
  imagens: ImagemAnuncio[]
  plataforma: string
  produtoId: string | null
  onImagemAjustada: (imagemId: string, novaUrl: string) => void
  /** Medidas já lidas por quem chama — quando a mesma tela também mostra o
   *  tamanho na miniatura, medir de novo aqui seria trabalho repetido e uma
   *  segunda fonte para o mesmo número. Ausente, o painel mede sozinho, que
   *  é o caso dos modais de criação. */
  medidas?: Record<string, Medida>
  esquecer?: (id: string) => void
}) {
  const [ajustando, setAjustando] = useState<string | null>(null)
  const [aviso, setAviso] = useState('')
  const req = requisitoDe(plataforma)

  // Hook chamado sempre (regra dos hooks), mas ignorado quando quem chama já
  // trouxe as medidas prontas.
  const proprio = useDimensoes(medidasFora ? [] : imagens, plataforma)
  const medidas = medidasFora ?? proprio.medidas
  const esquecer = esquecerFora ?? proprio.esquecer

  async function ajustar(img: ImagemAnuncio) {
    if (!produtoId) { setAviso('Escolha o produto antes de ajustar a imagem.'); return }
    setAjustando(img.id); setAviso('')
    try {
      const d = await fetch('/api/produtos/imagens/ajustar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: img.url, produtoId, plataforma, imagemId: img.id }),
      }).then(r => r.json())
      if (!d.ok) { setAviso(d.erro ?? 'Não foi possível ajustar'); return }
      esquecer(img.id)
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

  // Ajusta todas as pequenas numa tacada.
  //
  // Uma a uma é aceitável com duas fotos e cansativo com nove — e nove é o
  // teto da Shopee, ou seja, o caso comum. Sequencial de propósito: o ajuste
  // baixa, redimensiona e sobe cada arquivo, e disparar tudo junto é o jeito
  // mais rápido de tomar limite de banda no meio do caminho.
  async function ajustarTodas(alvos: ImagemAnuncio[]) {
    if (!produtoId) { setAviso('Escolha o produto antes de ajustar as imagens.'); return }
    setAviso('')
    let feitas = 0
    const falhas: string[] = []
    for (const img of alvos) {
      setAjustando(img.id)
      try {
        const d = await fetch('/api/produtos/imagens/ajustar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: img.url, produtoId, plataforma, imagemId: img.id }),
        }).then(r => r.json())
        if (!d.ok) { falhas.push(d.erro ?? 'recusada'); continue }
        esquecer(img.id)
        onImagemAjustada(img.id, d.url)
        feitas++
      } catch (e: any) {
        falhas.push(e?.message ?? 'erro de rede')
      }
    }
    setAjustando(null)
    setAviso(
      `${feitas} de ${alvos.length} imagem(ns) ajustada(s) para ${req.alvoAjuste}px.`
      + (falhas.length ? ` Falhas: ${falhas.join('; ')}.` : '')
      // O mesmo alerta do ajuste individual, e pelo mesmo motivo: ampliar
      // resolve a exigência de tamanho, não a falta de nitidez do original.
      + (feitas > 0 ? ' Imagens menores que o alvo foram ampliadas — o tamanho passa a atender, mas a nitidez é a da foto original.' : ''))
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

      {comProblema.length > 1 && (
        <div className="flex items-center justify-between gap-2 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5">
          <p className="text-[11px] text-blue-900">
            {comProblema.length} imagens abaixo de {req.recomendado}×{req.recomendado} ou fora do quadrado.
          </p>
          <button type="button" onClick={() => ajustarTodas(comProblema)} disabled={ajustando !== null}
            className="text-[11px] px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 flex-shrink-0">
            {ajustando !== null ? 'ajustando…' : `ajustar todas p/ ${req.alvoAjuste}px`}
          </button>
        </div>
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
