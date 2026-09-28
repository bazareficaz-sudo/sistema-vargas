import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { calcularTaxaAcertoEntrada } from '@/lib/entradas/taxaAcerto'

export const dynamic = 'force-dynamic'

// Taxa de acerto de compra pra uma entrada por XML — quanto já vendeu do
// que essa NF-e trouxe. Só entradas FINALIZADAS incrementaram estoque de
// verdade; as demais nem chegam a ter uma resposta (não é erro, a entrada
// só ainda não aconteceu de fato).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: entrada } = await sb.from('nfe_entradas')
    .select('id, status, data_finalizacao')
    .eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!entrada) return NextResponse.json({ ok: false, erro: 'Entrada não encontrada' }, { status: 404 })

  if (entrada.status !== 'finalizada' || !entrada.data_finalizacao) {
    return NextResponse.json({ ok: true, finalizada: false, itens: [] })
  }

  const { data: itensNfe } = await sb.from('nfe_itens')
    .select('produto_id, descricao_sistema, descricao_xml, qtd_conferida, quantidade_entrada, quantidade_xml')
    .eq('entrada_id', id)
    .not('produto_id', 'is', null)

  // Mesma cascata usada em finalizar(): conferido físico > conversão > nota.
  const itensParaCalculo = (itensNfe ?? []).map((i: any) => ({
    produtoId: i.produto_id as string,
    quantidade: Number(i.qtd_conferida || i.quantidade_entrada || i.quantidade_xml) || 0,
  }))

  const resultado = await calcularTaxaAcertoEntrada(sb, guarda.empresaId, itensParaCalculo, entrada.data_finalizacao)
  const resultadoPorProduto = new Map(resultado.map(r => [r.produtoId, r]))

  const itens = (itensNfe ?? []).map((i: any) => ({
    produtoId: i.produto_id,
    nome: i.descricao_sistema || i.descricao_xml,
    ...resultadoPorProduto.get(i.produto_id),
  }))

  return NextResponse.json({ ok: true, finalizada: true, itens })
}
