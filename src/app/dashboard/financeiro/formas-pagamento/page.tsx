import FormasPagamentoClient from '@/components/financeiro/FormasPagamentoClient'

export const dynamic = 'force-dynamic'

export default function FormasPagamentoPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900">Formas de Pagamento</h1>
      <p className="text-slate-500 text-sm mt-1 mb-6">
        O que o balcão aceita, quanto cada forma custa, para onde o dinheiro vai e em
        quantos dias ele cai. Alterar a taxa aqui atualiza o cálculo de margem nos
        terminais no próximo sincronismo.
      </p>
      <FormasPagamentoClient />
    </div>
  )
}
