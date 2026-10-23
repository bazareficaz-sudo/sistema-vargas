import DevolucoesClient from '@/components/financeiro/DevolucoesClient'

export const dynamic = 'force-dynamic'

export default function DevolucoesPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900">Devoluções a resolver</h1>
      <p className="text-slate-500 text-sm mt-1 mb-6">
        Quando a troca fecha a favor do cliente, a loja devolve a diferença — em dinheiro da
        gaveta ou como crédito na conta dele. O PDV não grava essa escolha, então ela é feita
        aqui, uma vez por devolução.
      </p>
      <DevolucoesClient />
    </div>
  )
}
