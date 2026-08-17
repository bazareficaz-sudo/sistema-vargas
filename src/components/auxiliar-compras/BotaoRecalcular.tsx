'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Recalcular a lista sob demanda.
//
// O cálculo normal é noturno. Este botão é para quando alguém acabou de
// dar entrada numa nota ou corrigir o estoque e quer a lista atualizada
// sem esperar a madrugada. Demora — lê o catálogo e 180 dias de venda —
// então diz que está demorando em vez de parecer travado.

export default function BotaoRecalcular({ compacto = false }: { compacto?: boolean }) {
  const router = useRouter()
  const [rodando, setRodando] = useState(false)
  const [msg, setMsg] = useState('')

  async function recalcular() {
    setRodando(true); setMsg('')
    try {
      const d = await fetch('/api/reposicao/recalcular', { method: 'POST' }).then(r => r.json())
      if (!d.ok) { setMsg(d.erro ?? 'Falha ao recalcular'); return }
      setMsg(`${d.gravados} produto(s) analisados em ${(d.duracaoMs / 1000).toFixed(1)}s · ${d.semSinal} sem sinal de demanda`)
      router.refresh()
    } catch {
      setMsg('Falha de rede')
    } finally {
      setRodando(false)
    }
  }

  return (
    <div className={compacto ? 'inline-flex items-center gap-2' : 'inline-flex flex-col items-center gap-2'}>
      <button onClick={recalcular} disabled={rodando}
        className={`rounded-lg font-medium disabled:opacity-60 ${
          compacto
            ? 'px-3 py-1.5 text-xs border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            : 'px-4 py-2 text-sm bg-slate-800 text-white hover:bg-slate-700'
        }`}>
        {rodando ? 'Calculando…' : 'Recalcular agora'}
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </div>
  )
}
