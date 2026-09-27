'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Desloga automaticamente do site (não mexe no PDV Electron, que tem
// sessão própria) em dois casos:
//   1. 30 min sem nenhuma interação (mouse, teclado, toque, scroll).
//   2. O dia vira enquanto a sessão continua aberta — aba esquecida ligada
//      durante a madrugada, ou navegador reaberto no dia seguinte com o
//      cookie de sessão ainda válido.
//
// "Última atividade" e "dia do login" ficam em localStorage, não em estado
// do componente — localStorage é compartilhado entre abas do mesmo
// navegador, então uma aba ociosa não desloga sozinha enquanto o usuário
// está ativo em outra aba. Quando UMA aba desloga, grava um sinal que as
// outras escutam (evento `storage`, que dispara nas OUTRAS abas — nunca na
// que escreveu) pra saírem juntas, em vez de cada uma só descobrir depois
// que uma chamada começou a falhar com 401.
//
// Não confia num `setTimeout` único de 30 minutos corridos: navegador pausa
// ou atrasa timers de aba em segundo plano. Em vez disso confere a cada 20s
// comparando `Date.now()` contra o timestamp salvo — funciona mesmo que a
// aba tenha ficado suspensa e "acordado" bem depois do previsto.

const CHAVE_ATIVIDADE = 'vg_sessao_ultima_atividade'
const CHAVE_DIA = 'vg_sessao_dia_login'
const CHAVE_LOGOUT = 'vg_sessao_logout_sinal'

const LIMITE_INATIVIDADE_MS = 30 * 60 * 1000
const INTERVALO_VERIFICACAO_MS = 20 * 1000
const THROTTLE_GRAVACAO_MS = 5 * 1000

function hojeLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function SessaoVigia() {
  const router = useRouter()
  const ultimaGravacaoRef = useRef(0)
  const deslogandoRef = useRef(false)

  useEffect(() => {
    // Primeira aba a abrir o dashboard hoje marca o dia. Se já existir uma
    // data guardada e for diferente de hoje, é porque essa marca sobrou de
    // ontem (ou antes) e o cookie de sessão ainda está válido — exatamente
    // o caso "virou o dia" que deve forçar novo login.
    if (!localStorage.getItem(CHAVE_DIA)) localStorage.setItem(CHAVE_DIA, hojeLocal())
    localStorage.setItem(CHAVE_ATIVIDADE, String(Date.now()))

    async function deslogar(motivo: 'inatividade' | 'virada_dia') {
      if (deslogandoRef.current) return
      deslogandoRef.current = true
      localStorage.removeItem(CHAVE_DIA)
      localStorage.removeItem(CHAVE_ATIVIDADE)
      // Sinal pras outras abas — o valor em si não importa, só o disparo
      // do evento `storage` nelas.
      localStorage.setItem(CHAVE_LOGOUT, String(Date.now()))
      const sb = createClient()
      await sb.auth.signOut()
      router.push(`/login?erro=${motivo}`)
      router.refresh()
    }

    function registrarAtividade() {
      const agora = Date.now()
      if (agora - ultimaGravacaoRef.current < THROTTLE_GRAVACAO_MS) return
      ultimaGravacaoRef.current = agora
      localStorage.setItem(CHAVE_ATIVIDADE, String(agora))
    }

    function verificar() {
      if (deslogandoRef.current) return
      if (localStorage.getItem(CHAVE_DIA) !== hojeLocal()) { deslogar('virada_dia'); return }
      const ultima = Number(localStorage.getItem(CHAVE_ATIVIDADE) ?? Date.now())
      if (Date.now() - ultima >= LIMITE_INATIVIDADE_MS) deslogar('inatividade')
    }

    function aoMudarStorage(e: StorageEvent) {
      // Outra aba deslogou (por inatividade ou virada de dia) — segue
      // junto na hora, sem esperar a própria verificação periódica.
      if (e.key === CHAVE_LOGOUT && e.newValue && !deslogandoRef.current) {
        deslogandoRef.current = true
        router.push('/login?erro=outra_aba')
        router.refresh()
      }
    }

    const eventosAtividade = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const
    eventosAtividade.forEach(ev => window.addEventListener(ev, registrarAtividade, { passive: true }))
    window.addEventListener('storage', aoMudarStorage)
    const intervalo = setInterval(verificar, INTERVALO_VERIFICACAO_MS)

    return () => {
      eventosAtividade.forEach(ev => window.removeEventListener(ev, registrarAtividade))
      window.removeEventListener('storage', aoMudarStorage)
      clearInterval(intervalo)
    }
  }, [router])

  return null
}
