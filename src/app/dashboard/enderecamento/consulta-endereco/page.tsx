import ConsultaEnderecoClient from '@/components/enderecamento/ConsultaEnderecoClient'

export const dynamic = 'force-dynamic'

export default async function ConsultaEnderecoPage({ searchParams }: { searchParams: Promise<{ codigo?: string }> }) {
  const { codigo } = await searchParams
  return <ConsultaEnderecoClient codigoInicial={codigo ?? ''} />
}
