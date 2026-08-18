import ConsultaProdutoEnderecoClient from '@/components/enderecamento/ConsultaProdutoEnderecoClient'

export const dynamic = 'force-dynamic'

export default async function ConsultaProdutoEnderecoPage({ searchParams }: { searchParams: Promise<{ busca?: string }> }) {
  const { busca } = await searchParams
  return <ConsultaProdutoEnderecoClient buscaInicial={busca ?? ''} />
}
