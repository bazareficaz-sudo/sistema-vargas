import ConciliacaoClient from '@/components/financeiro/ConciliacaoClient'

export const dynamic = 'force-dynamic'

export default function ConciliacaoPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900">Conciliação da Adquirente</h1>
      <p className="text-slate-500 text-sm mt-1 mb-6">
        O caixa sabe o que passou na maquininha e quanto deveria custar. Aqui entra o outro
        lado: o que o Mercado Pago pagou de verdade, em que dia, e quanto cobrou.
      </p>
      <ConciliacaoClient />
    </div>
  )
}
