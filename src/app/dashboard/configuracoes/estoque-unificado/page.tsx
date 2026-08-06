import EstoqueUnificadoClient from '@/components/estoque/EstoqueUnificadoClient'

export const dynamic = 'force-dynamic'

export default function EstoqueUnificadoPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-900">Estoque unificado do grupo</h1>
      <p className="text-sm text-gray-500 mt-1 mb-5">
        Some o estoque de mais de uma empresa do grupo no número que vai para os anúncios.
      </p>
      <EstoqueUnificadoClient />
    </div>
  )
}
