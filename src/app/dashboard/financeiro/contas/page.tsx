import ContasClient from '@/components/financeiro/ContasClient'

export const dynamic = 'force-dynamic'

export default function ContasFinanceiroPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900">Bancos e Contas</h1>
      <p className="text-slate-500 text-sm mt-1 mb-6">
        Onde o dinheiro entra. Conta bancária é saldo disponível; adquirente é o que a
        maquininha ainda deve — separados de propósito, para o total não mentir sobre o
        que dá para gastar hoje.
      </p>
      <ContasClient />
    </div>
  )
}
