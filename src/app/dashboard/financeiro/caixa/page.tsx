import CaixaClient from '@/components/financeiro/CaixaClient'

export const dynamic = 'force-dynamic'

export default function CaixaPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900">Caixa</h1>
      <p className="text-slate-500 text-sm mt-1 mb-6">
        O saldo de cada caixa é a soma dos movimentos, nunca um número guardado — não
        existe saldo que possa divergir do extrato. Clique num caixa para ver o dele.
      </p>
      <CaixaClient />
    </div>
  )
}
