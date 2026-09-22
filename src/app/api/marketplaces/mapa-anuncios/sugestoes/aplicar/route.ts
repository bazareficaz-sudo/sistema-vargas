import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'

// `metodo` é opcional e serve à honestidade do histórico: um produto escolhido
// à mão pelo operador não deve ficar gravado como se tivesse vindo de um
// casamento automático de SKU. Sem ele, mantém o valor antigo.
type ItemAplicar = {
  tipo: 'anuncio' | 'variacao'
  id: string
  produtoId: string
  metodo?: string
}

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
  // Cache de regra padrão por canal — os itens de um lote quase sempre são do
  // mesmo canal (a tela só passa anuncioIds do canal aberto), então isso evita
  // reconsultar marketplace_canais uma vez por item.
  const regraPadraoPorCanal = new Map<string, string | null>()
  async function regraPadraoDoCanal(canalId: string): Promise<string | null> {
    if (regraPadraoPorCanal.has(canalId)) return regraPadraoPorCanal.get(canalId)!
    const { data } = await sb.from('marketplace_canais').select('regra_padrao_id').eq('id', canalId).maybeSingle()
    const regraId = data?.regra_padrao_id ?? null
    regraPadraoPorCanal.set(canalId, regraId)
    return regraId
  }

  for (const item of itens) {
    const tabela = item.tipo === 'anuncio' ? 'marketplace_anuncios' : 'marketplace_anuncio_variacoes'

    const { data: linha }: { data: any } = await sb.from(tabela)
      .select(item.tipo === 'anuncio' ? 'id, empresa_id, canal_id, sku_canal, produto_id, regra_id' : 'id, empresa_id, anuncio_id, sku_variacao, produto_id')
      .eq('id', item.id).eq('empresa_id', guarda.empresaId).single()

    if (!linha) { erros.push({ id: item.id, erro: 'Não encontrado' }); continue }
    if (linha.produto_id) { jaMapeadosPorOutraSessao.push(item.id); continue }

    const { data: produto } = await sb.from('produtos').select('id, nome, sku')
      .eq('id', item.produtoId).eq('empresa_id', guarda.empresaId).single()
    if (!produto) { erros.push({ id: item.id, erro: 'Produto não encontrado' }); continue }

    // Variação não tem coluna de regra — só anúncio recebe a padrão do canal,
    // e só quando ainda não tem regra própria (nunca sobrescreve escolha manual).
    const dadosUpdate: any = { produto_id: produto.id }
    if (item.tipo === 'anuncio' && !linha.regra_id) {
      const regraPadrao = await regraPadraoDoCanal(linha.canal_id)
      if (regraPadrao) dadosUpdate.regra_id = regraPadrao
    }

    const { error: errUpd } = await sb.from(tabela).update(dadosUpdate).eq('id', item.id)
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
        metodo: item.metodo ?? 'automatico_sku_revisado', operador, updated_at: new Date().toISOString(),
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
