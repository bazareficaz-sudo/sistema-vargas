'use client'

import { useRef, useState } from 'react'

type Ponto = { data: string; saldo: number }

const W = 720, H = 220, PAD_L = 40, PAD_R = 12, PAD_T = 12, PAD_B = 28
const PLOT_W = W - PAD_L - PAD_R, PLOT_H = H - PAD_T - PAD_B

export default function GraficoEvolucaoEstoque({ pontos }: { pontos: Ponto[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  if (pontos.length < 2) {
    return <p className="text-xs text-gray-400 py-8 text-center">Sem movimentações suficientes no período pra desenhar o gráfico.</p>
  }

  const valores = pontos.map(p => p.saldo)
  const min = Math.min(...valores, 0)
  const max = Math.max(...valores, min + 1)
  const escalaY = (v: number) => PAD_T + PLOT_H - ((v - min) / (max - min)) * PLOT_H
  const escalaX = (i: number) => PAD_L + (i / (pontos.length - 1)) * PLOT_W

  const path = pontos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${escalaX(i).toFixed(1)} ${escalaY(p.saldo).toFixed(1)}`).join(' ')

  function aoMover(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const xRelativo = ((e.clientX - rect.left) / rect.width) * W
    const posicao = (xRelativo - PAD_L) / PLOT_W
    const idx = Math.round(posicao * (pontos.length - 1))
    setHoverIdx(Math.max(0, Math.min(pontos.length - 1, idx)))
  }

  const hover = hoverIdx != null ? pontos[hoverIdx] : null

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto cursor-crosshair"
        onMouseMove={aoMover} onMouseLeave={() => setHoverIdx(null)}>
        {[0, 0.5, 1].map(f => (
          <line key={f} x1={PAD_L} x2={W - PAD_R} y1={PAD_T + PLOT_H * f} y2={PAD_T + PLOT_H * f} stroke="#f3f4f6" strokeWidth={1} />
        ))}
        <text x={2} y={escalaY(max) + 4} fontSize="10" fill="#9ca3af">{Math.round(max)}</text>
        <text x={2} y={escalaY(min) + 4} fontSize="10" fill="#9ca3af">{Math.round(min)}</text>

        <path d={path} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {hoverIdx != null && (
          <>
            <line x1={escalaX(hoverIdx)} x2={escalaX(hoverIdx)} y1={PAD_T} y2={PAD_T + PLOT_H} stroke="#d1d5db" strokeWidth={1} />
            <circle cx={escalaX(hoverIdx)} cy={escalaY(pontos[hoverIdx].saldo)} r={4} fill="#2563eb" stroke="#fff" strokeWidth={2} />
          </>
        )}

        <text x={PAD_L} y={H - 8} fontSize="10" fill="#9ca3af">{pontos[0].data}</text>
        <text x={W - PAD_R} y={H - 8} textAnchor="end" fontSize="10" fill="#9ca3af">{pontos[pontos.length - 1].data}</text>
      </svg>
      {hover && (
        <div className="absolute top-1 right-1 bg-white border border-gray-200 rounded-lg shadow-sm px-2.5 py-1.5 text-xs pointer-events-none">
          <p className="text-gray-500">{hover.data}</p>
          <p className="font-semibold text-gray-900">Saldo: {hover.saldo.toLocaleString('pt-BR')}</p>
        </div>
      )}
    </div>
  )
}
