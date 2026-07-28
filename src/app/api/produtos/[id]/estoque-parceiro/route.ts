import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

// Consulta (só leitura) o estoque de um produto vinculado numa empresa
// parceira — nunca escreve nada aqui, e nunca mistura produto_estoque entre
// empresas (cada uma mantém as suas próprias linhas, como sempre).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: produtoId } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'ver_dados_grupo')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: produto } = await sb.from('produtos').select('id, empresa_id').eq('id', produtoId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!produto) return NextResponse.json({ ok: false, erro: 'Produto não encontrado' }, { status: 404 })

  const [vinculosA, vinculosB] = await Promise.all([
    sb.from('produto_vinculos').select('produto_id_b').eq('produto_id_a', produtoId),
    sb.from('produto_vinculos').select('produto_id_a').eq('produto_id_b', produtoId),
  ])
  const produtoIdsParceiros = [
    ...(vinculosA.data ?? []).map((v: any) => v.produto_id_b),
    ...(vinculosB.data ?? []).map((v: any) => v.produto_id_a),
  ]
  if (produtoIdsParceiros.length === 0) return NextResponse.json({ ok: true, empresas: [] })

  const { data: produtosParceiros } = await sb.from('produtos').select('id, empresa_id, nome, sku').in('id', produtoIdsParceiros)
  const empresaIds = [...new Set((produtosParceiros ?? []).map((p: any) => p.empresa_id))]
  const [{ data: empresas }, { data: estoques }, { data: depositos }] = await Promise.all([
    sb.from('empresas').select('id, nome, nome_fantasia').in('id', empresaIds),
    sb.from('produto_estoque').select('empresa_id, deposito_id, produto_id, quantidade').in('produto_id', produtoIdsParceiros),
    sb.from('depositos').select('id, nome').in('empresa_id', empresaIds),
  ])
  const nomeEmpresaPorId = new Map((empresas ?? []).map((e: any) => [e.id, e.nome_fantasia ?? e.nome]))
  const nomeDepositoPorId = new Map((depositos ?? []).map((d: any) => [d.id, d.nome]))

  const resultado = (produtosParceiros ?? []).map((p: any) => ({
    empresaId: p.empresa_id,
    empresaNome: nomeEmpresaPorId.get(p.empresa_id) ?? '—',
    produtoId: p.id, produtoNome: p.nome, produtoSku: p.sku,
    estoquePorDeposito: (estoques ?? [])
      .filter((e: any) => e.produto_id === p.id)
      .map((e: any) => ({ depositoNome: nomeDepositoPorId.get(e.deposito_id) ?? '—', quantidade: Number(e.quantidade) || 0 })),
  }))

  return NextResponse.json({ ok: true, empresas: resultado })
}
