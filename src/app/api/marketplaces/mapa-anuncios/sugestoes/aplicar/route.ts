import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'

type ItemAplicar = { tipo: 'anuncio' | 'variacao'; id: string; produtoId: string }

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json()
  const itens: ItemAplicar[] = Array.isArray(body?.itens) ? body.itens : []
  if (itens.length === 0) return NextResponse.json({ ok: false, erro: 'Nenhum item enviado' }, { status: 400 })

  const { data: profile } = await sb.from('profiles').select('nome').eq('id', guarda.userId).single()
  const operador = profile?.nome ?? 'Usuário'

  let aplicados = 0
  const jaMapeadosPorOutraSessao: string[] = []
  const erros: { id: string; erro: string }[] = []

  for (const item of itens) {
    const tabela = item.tipo === 'anuncio' ? 'marketplace_anuncios' : 'marketplace_anuncio_variacoes'

    const { data: linha }: { data: any } = await sb.from(tabela)
      .select(item.tipo === 'anuncio' ? 'id, empresa_id, canal_id, sku_canal, produto_id' : 'id, empresa_id, anuncio_id, sku_variacao, produto_id')
      .eq('id', item.id).eq('empresa_id', guarda.empresaId).single()

    if (!linha) { erros.push({ id: item.id, erro: 'Não encontrado' }); continue }
    if (linha.produto_id) { jaMapeadosPorOutraSessao.push(item.id); continue }

    const { data: produto } = await sb.from('produtos').select('id, nome, sku')
      .eq('id', item.produtoId).eq('empresa_id', guarda.empresaId).single()
    if (!produto) { erros.push({ id: item.id, erro: 'Produto não encontrado' }); continue }

    const { error: errUpd } = await sb.from(tabela).update({ produto_id: produto.id }).eq('id', item.id)
    if (errUpd) { erros.push({ id: item.id, erro: errUpd.message }); continue }

    let canalId: string | null = null
    let chave: string | null = null
    let anuncioId: string | null = null
    let variacaoId: string | null = null

    if (item.tipo === 'anuncio') {
      canalId = linha.canal_id
      chave = linha.sku_canal
      anuncioId = linha.id
    } else {
      chave = linha.sku_variacao
      anuncioId = linha.anuncio_id
      variacaoId = linha.id
      const { data: pai } = await sb.from('marketplace_anuncios').select('canal_id').eq('id', linha.anuncio_id).single()
      canalId = pai?.canal_id ?? null
    }

    if (canalId && chave) {
      await sb.from('marketplace_mapeamentos').upsert({
        empresa_id: guarda.empresaId, canal_id: canalId,
        nivel: item.tipo === 'anuncio' ? 'anuncio' : 'variacao', chave,
        anuncio_id: anuncioId, variacao_id: variacaoId, produto_id: produto.id,
        produto_nome_snapshot: produto.nome, produto_sku_snapshot: produto.sku,
        metodo: 'automatico_sku_revisado', operador, updated_at: new Date().toISOString(),
      }, { onConflict: 'empresa_id,canal_id,nivel,chave' })
    }

    aplicados++
  }

  if (aplicados > 0) {
    await registrarAuditoria(sb, {
      empresaId: guarda.empresaId, usuarioId: guarda.userId, usuarioNome: operador,
      acao: 'revisao_mapeamento_aplicada', tabela: 'marketplace_anuncios',
      valorNovo: { quantidade: aplicados },
    })
  }

  return NextResponse.json({ ok: true, aplicados, jaMapeadosPorOutraSessao, erros })
}
