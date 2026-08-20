'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ClienteFormDrawer from './ClienteFormDrawer'

// Botão isolado para a lista de clientes, que é componente de servidor —
// só a gaveta precisa rodar no navegador.

export default function NovoClienteBotao({ empresaId }: { empresaId: string }) {
  const [aberto, setAberto] = useState(false)
  const router = useRouter()

  return (
    <>
      <button onClick={() => setAberto(true)}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
        + Novo cliente
      </button>
      <ClienteFormDrawer
        empresaId={empresaId}
        aberto={aberto}
        onFechar={() => setAberto(false)}
        onSalvo={id => router.push(`/dashboard/clientes/${id}`)}
      />
    </>
  )
}
