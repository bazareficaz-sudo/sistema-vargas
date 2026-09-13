import CaixaTesourariaClient from '@/components/caixa/CaixaTesourariaClient'

export const dynamic = 'force-dynamic'

export default function CaixaPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-900">Caixa da Empresa</h1>
      <p className="text-sm text-gray-500 mt-1 mb-5">
        Tesouraria: aporte, retirada de sócio, depósito no banco e ajuste de contagem.
        Sem caixa de PDV ainda — sangria e fechamento de balcão vêm nas próximas fases.
      </p>
      <CaixaTesourariaClient />
    </div>
  )
}
