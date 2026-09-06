import ConfigPdvClient from '@/components/pdv/ConfigPdvClient'

export const dynamic = 'force-dynamic'

export default function ConfigPdvPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-900">Configurações do PDV</h1>
      <p className="text-sm text-gray-500 mt-1 mb-5">
        Como a loja trabalha no balcão. Vale para todos os caixas desta empresa.
      </p>
      <ConfigPdvClient />
    </div>
  )
}
