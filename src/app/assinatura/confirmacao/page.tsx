'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

// Assim que o cliente volta do checkout do Mercado Pago, chama a
// reconciliação (ver /api/mercadopago/confirmar-assinatura) pra linkar o
// pagamento com a assinatura — o webhook sozinho não dá conta disso na
// primeira autorização (payer_email vem vazio nesse fluxo). Tenta algumas
// vezes porque o Mercado Pago pode levar alguns segundos pra refletir o
// status "authorized".
export default function ConfirmacaoAssinaturaPage() {
  const [status, setStatus] = useState<'checando' | 'active' | 'pending'>('checando')

  useEffect(() => {
    let cancelado = false
    let tentativas = 0

    async function checar() {
      tentativas++
      try {
        const res = await fetch('/api/mercadopago/confirmar-assinatura', { method: 'POST' })
        const data = await res.json()
        if (cancelado) return
        if (data.ok && data.status === 'active') {
          setStatus('active')
          return
        }
      } catch {
        // silencioso — tenta de novo
      }
      if (!cancelado && tentativas < 6) {
        setTimeout(checar, 3000)
      } else if (!cancelado) {
        setStatus('pending')
      }
    }
    checar()
    return () => { cancelado = true }
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-8 max-w-md w-full text-center">
        {status === 'active' ? (
          <>
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5">
              <span className="text-4xl">✓</span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-2">Pagamento confirmado!</h1>
            <p className="text-slate-500 text-sm mb-6">Seu acesso já está liberado.</p>
          </>
        ) : (
          <>
            <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-5">
              <span className="text-4xl">⏳</span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-2">Confirmando seu pagamento</h1>
            <p className="text-slate-500 text-sm mb-6">
              {status === 'checando'
                ? 'Estamos confirmando com o Mercado Pago — isso leva só alguns segundos.'
                : 'Ainda não recebemos a confirmação do Mercado Pago. Assim que confirmado, seu acesso é liberado automaticamente — você pode continuar navegando, o sistema avisa quando estiver pronto.'}
            </p>
          </>
        )}
        <Link href="/dashboard" className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors">
          Ir para o sistema →
        </Link>
      </div>
    </div>
  )
}
