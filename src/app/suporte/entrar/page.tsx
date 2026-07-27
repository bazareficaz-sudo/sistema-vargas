'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function SuporteEntrarPage() {
  return (
    <Suspense fallback={null}>
      <SuporteEntrar />
    </Suspense>
  )
}

function SuporteEntrar() {
  const searchParams = useSearchParams()
  const [erro, setErro] = useState('')

  useEffect(() => {
    const tokenHash = searchParams.get('token_hash')
    if (!tokenHash) { setErro('Link de acesso inválido.'); return }

    const supabase = createClient()
    supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' }).then(({ error }) => {
      if (error) { setErro('Não foi possível entrar: ' + error.message); return }
      window.location.href = '/dashboard'
    })
  }, [searchParams])

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="text-center">
        {erro ? (
          <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3 max-w-sm">{erro}</p>
        ) : (
          <p className="text-gray-400 text-sm">Entrando em modo suporte...</p>
        )}
      </div>
    </div>
  )
}
