import Link from 'next/link'

export default function ConfirmacaoAssinaturaPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-8 max-w-md w-full text-center">
        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <span className="text-4xl">⏳</span>
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">Confirmando seu pagamento</h1>
        <p className="text-slate-500 text-sm mb-6">
          Estamos aguardando a confirmação do Mercado Pago — isso pode levar alguns segundos.
          Assim que confirmado, seu acesso é liberado automaticamente.
        </p>
        <Link href="/dashboard" className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors">
          Ir para o sistema →
        </Link>
      </div>
    </div>
  )
}
