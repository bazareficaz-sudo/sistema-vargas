'use client'

import { useEffect, useRef, useState } from 'react'

// Indicador global de "sistema ocupado" — cobre tanto navegação entre
// páginas (o Next.js busca o payload da rota via fetch) quanto qualquer
// chamada ao Supabase (o client deles também usa fetch por baixo), então
// não precisa instrumentar tela por tela: um patch em window.fetch já
// enxerga as duas coisas de uma vez.
//
// cursor:url() não anima (o CSS só aceita imagem estática ali), então o
// "ícone em movimento" de verdade é o badge flutuante com o "V" da marca
// (mesmo gradiente do menu lateral) girando ao lado do mouse — o cursor
// nativo de ocupado do sistema operacional entra junto, como reforço.

const MOSTRAR_APOS_MS = 150   // evita "piscar" em requisições muito rápidas
const ESCONDER_APOS_MS = 150  // evita "piscar" entre requisições em sequência

let fetchJaInterceptado = false

export default function GlobalLoadingIndicator() {
  const [visivel, setVisivel] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const emVooRef = useRef(0)
  const timerMostrarRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timerEsconderRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      setPos({ x: e.clientX, y: e.clientY })
    }
    window.addEventListener('mousemove', onMouseMove)
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [])

  useEffect(() => {
    if (fetchJaInterceptado) return
    fetchJaInterceptado = true

    const fetchOriginal = window.fetch

    function marcarInicio() {
      emVooRef.current += 1
      if (timerEsconderRef.current) { clearTimeout(timerEsconderRef.current); timerEsconderRef.current = null }
      if (emVooRef.current === 1 && !timerMostrarRef.current) {
        timerMostrarRef.current = setTimeout(() => {
          timerMostrarRef.current = null
          if (emVooRef.current > 0) {
            document.documentElement.classList.add('app-loading')
            despacharEstado(true)
          }
        }, MOSTRAR_APOS_MS)
      }
    }

    function marcarFim() {
      emVooRef.current = Math.max(0, emVooRef.current - 1)
      if (emVooRef.current === 0) {
        if (timerMostrarRef.current) { clearTimeout(timerMostrarRef.current); timerMostrarRef.current = null }
        timerEsconderRef.current = setTimeout(() => {
          timerEsconderRef.current = null
          if (emVooRef.current === 0) {
            document.documentElement.classList.remove('app-loading')
            despacharEstado(false)
          }
        }, ESCONDER_APOS_MS)
      }
    }

    function despacharEstado(v: boolean) {
      window.dispatchEvent(new CustomEvent('app-loading-change', { detail: v }))
    }

    window.fetch = async function patchedFetch(...args: Parameters<typeof fetch>) {
      marcarInicio()
      try {
        return await fetchOriginal(...args)
      } finally {
        marcarFim()
      }
    }

    return () => { window.fetch = fetchOriginal; fetchJaInterceptado = false }
  }, [])

  useEffect(() => {
    function onChange(e: Event) { setVisivel((e as CustomEvent<boolean>).detail) }
    window.addEventListener('app-loading-change', onChange)
    return () => window.removeEventListener('app-loading-change', onChange)
  }, [])

  if (!visivel) return null

  return (
    <div
      aria-hidden
      style={{ left: pos.x + 14, top: pos.y + 14 }}
      className="fixed z-[9999] pointer-events-none w-6 h-6 rounded-lg flex items-center justify-center shadow-lg app-loading-badge"
    >
      <span className="text-white font-bold text-[10px]">V</span>
    </div>
  )
}
