import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'

// Unifica 2-5 produtos duplicados num só: repõe todas as referências
// (vendas, estoque, mapeamento de marketplace, kits, etc — ver
// supabase-unificar-produtos.sql) pro produto vencedor, via a função
// unificar_produtos(), e desativa os perdedores (nunca apaga a linha — o
// sistema nunca faz hard-delete de produto).
export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'excluir_cadastros')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { vencedorId, perdedorIds, campos, tags, imagens } = await req.json()

  if (!vencedorId || !Array.isArray(perdedorIds) || perdedorIds.length === 0) {
    return NextResponse.json({ ok: false, erro: 'vencedorId e perdedorIds são obrigatórios' }, { status: 400 })
  }
  const todosIds: string[] = [vencedorId, ...perdedorIds]
  if (todosIds.length < 2 || todosIds.length > 5) {
    return NextResponse.json({ ok: false, erro: 'Selecione entre 2 e 5 produtos para unificar' }, { status: 400 })
  }
  if (perdedorIds.includes(vencedorId)) {
    return NextResponse.json({ ok: false, erro: 'O produto vencedor não pode estar entre os perdedores' }, { status: 400 })
  }

  const { data: produtos, error: erroBusca } = await sb
    .from('produtos')
    .select('id, tipo, mesclado_em, empresa_id')
    .in('id', todosIds)
    .eq('empresa_id', guarda.empresaId)

  if (erroBusca) return NextResponse.json({ ok: false, erro: erroBusca.message }, { status: 500 })
  if (!produtos || produtos.length !== todosIds.length) {
    return NextResponse.json({ ok: false, erro: 'Um ou mais produtos não foram encontrados nesta empresa' }, { status: 404 })
  }
  if (produtos.some(p => p.tipo === 'kit')) {
    return NextResponse.json({ ok: false, erro: 'Produtos do tipo "kit" não podem ser unificados' }, { status: 400 })
  }
  if (produtos.some(p => p.mesclado_em)) {
    return NextResponse.json({ ok: false, erro: 'Um dos produtos selecionados já foi mesclado anteriormente e não pode ser selecionado de novo' }, { status: 400 })
  }

  // As imagens finais só podem vir das linhas de produto_imagens que já
  // existem nos produtos selecionados — nunca uma URL arbitrária vinda do
  // corpo da requisição.
  const { data: imagensExistentes } = await sb.from('produto_imagens').select('url').in('produto_id', todosIds)
  const urlsValidas = new Set((imagensExistentes ?? []).map(i => i.url))
  const imagensList = Array.isArray(imagens) ? imagens : []
  if (imagensList.some((img: any) => !urlsValidas.has(img?.url))) {
    return NextResponse.json({ ok: false, erro: 'Uma das imagens selecionadas não pertence aos produtos escolhidos' }, { status: 400 })
  }

  const { data: resultado, error: erroRpc } = await sb.rpc('unificar_produtos', {
    p_vencedor_id: vencedorId,
    p_perdedor_ids: perdedorIds,
    p_campos: { ...(campos ?? {}), tags: Array.isArray(tags) ? tags : [] },
    p_imagens: imagensList,
  })
  if (erroRpc) return NextResponse.json({ ok: false, erro: erroRpc.message }, { status: 400 })
  void resultado

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId,
    usuarioId: guarda.userId,
    acao: 'produtos_unificados',
    tabela: 'produtos',
    valorAnterior: { perdedorIds },
    valorNovo: { vencedorId, campos, tags },
  })

  return NextResponse.json({ ok: true })
}
