'use client'

import { useEffect, useRef, useState } from 'react'

// Indicador global de "sistema ocupado" — cobre tanto navegação entre
// páginas (o Next.js busca o payload da rota via fetch) quanto qualquer
// chamada ao Supabase (o client deles também usa fetch por baixo), então
// não precisa instrumentar tela por tela: um patch em window.fetch já
// enxerga as duas coisas de uma vez.
//
// Barra fina fixa no topo da viewport (padrão GitHub/YouTube/Vercel) —
// posição previsível, sem depender de onde o mouse está.

const MOSTRAR_APOS_MS = 150   // evita "piscar" em requisições muito rápidas
const ESCONDER_APOS_MS = 150  // evita "piscar" entre requisições em sequência

let fetchJaInterceptado = false

export default function GlobalLoadingIndicator() {
  const [visivel, setVisivel] = useState(false)
  const emVooRef = useRef(0)
  const timerMostrarRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timerEsconderRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
          if (emVooRef.current > 0) despacharEstado(true)
        }, MOSTRAR_APOS_MS)
      }
    }

    function marcarFim() {
      emVooRef.current = Math.max(0, emVooRef.current - 1)
      if (emVooRef.current === 0) {
        if (timerMostrarRef.current) { clearTimeout(timerMostrarRef.current); timerMostrarRef.current = null }
        timerEsconderRef.current = setTimeout(() => {
          timerEsconderRef.current = null
          if (emVooRef.current === 0) despacharEstado(false)
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
    <div aria-hidden className="fixed top-0 left-0 right-0 z-[9999] h-[3px] overflow-hidden pointer-events-none">
      <div className="app-loading-bar" />
    </div>
  )
}
