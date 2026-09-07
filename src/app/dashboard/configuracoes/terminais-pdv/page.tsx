import TerminaisPdvClient from '@/components/pdv/TerminaisPdvClient'

export const dynamic = 'force-dynamic'

export default function TerminaisPdvPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-900">Terminais de PDV</h1>
      <p className="text-sm text-gray-500 mt-1 mb-5">
        Quais caixas estão autorizados a operar nesta empresa, e com qual identidade.
      </p>
      <TerminaisPdvClient />
    </div>
  )
}
