'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CONFIG_SESSAO_PADRAO, type ConfigSessao } from '@/lib/auth/configSessao'

// Desloga automaticamente do site (não mexe no PDV Electron, que tem
// sessão própria) em dois casos:
//   1. X min sem nenhuma interação (mouse, teclado, toque, scroll).
//   2. O dia vira enquanto a sessão continua aberta — aba esquecida ligada
//      durante a madrugada, ou navegador reaberto no dia seguinte com o
//      cookie de sessão ainda válido.
//
// Os dois são configuráveis por empresa (ligar/desligar e, no caso 1, o
// tempo) em Gestão → Sessão e Segurança. A regra chega por prop, lida pelo
// layout do dashboard a cada navegação — sem linha configurada, vale o
// padrão de sempre (30 min + virada do dia).
//
// "Última atividade" e "dia do login" ficam em localStorage, não em estado
// do componente — localStorage é compartilhado entre abas do mesmo
// navegador, então uma aba ociosa não desloga sozinha enquanto o usuário
// está ativo em outra aba. Quando UMA aba desloga, grava um sinal que as
// outras escutam (evento `storage`, que dispara nas OUTRAS abas — nunca na
// que escreveu) pra saírem juntas, em vez de cada uma só descobrir depois
// que uma chamada começou a falhar com 401.
//
// Não confia num `setTimeout` único de X minutos corridos: navegador pausa
// ou atrasa timers de aba em segundo plano. Em vez disso confere a cada 20s
// comparando `Date.now()` contra o timestamp salvo — funciona mesmo que a
// aba tenha ficado suspensa e "acordado" bem depois do previsto.

const CHAVE_ATIVIDADE = 'vg_sessao_ultima_atividade'
const CHAVE_DIA = 'vg_sessao_dia_login'
const CHAVE_LOGOUT = 'vg_sessao_logout_sinal'

const INTERVALO_VERIFICACAO_MS = 20 * 1000
const THROTTLE_GRAVACAO_MS = 5 * 1000

function hojeLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function SessaoVigia({ config = CONFIG_SESSAO_PADRAO }: { config?: ConfigSessao }) {
  const router = useRouter()
  const ultimaGravacaoRef = useRef(0)
  const deslogandoRef = useRef(false)
  // Em ref, e não nas dependências do efeito: o gestor salvar uma regra nova
  // não deve reiniciar os ouvintes nem zerar a contagem de inatividade — a
  // próxima verificação periódica já usa o valor atualizado.
  const configRef = useRef(config)
  useEffect(() => { configRef.current = config }, [config])

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
      const sufixo = motivo === 'inatividade' ? `&min=${configRef.current.inatividadeMin}` : ''
      router.push(`/login?erro=${motivo}${sufixo}`)
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
      const { inatividadeAtiva, inatividadeMin, viradaDiaAtiva } = configRef.current
      if (viradaDiaAtiva) {
        if (localStorage.getItem(CHAVE_DIA) !== hojeLocal()) { deslogar('virada_dia'); return }
      } else {
        // Regra desligada: mantém a marca sempre no dia de hoje. Senão, se o
        // gestor religasse a regra, a marca velha derrubaria na hora quem
        // está trabalhando normalmente desde ontem.
        localStorage.setItem(CHAVE_DIA, hojeLocal())
      }
      if (!inatividadeAtiva) return
      const ultima = Number(localStorage.getItem(CHAVE_ATIVIDADE) ?? Date.now())
      if (Date.now() - ultima >= inatividadeMin * 60 * 1000) deslogar('inatividade')
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
