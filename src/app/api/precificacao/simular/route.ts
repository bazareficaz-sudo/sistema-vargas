import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { buscarConfigDoCanal } from '@/lib/precificacao/config'
import { resolverFaixasML } from '@/lib/precificacao/mlComissao'
import { calcular, saudeDaMargem } from '@/lib/precificacao/motor'
import { calcularKit } from '@/lib/produtos/kit'
import { refreshAccessTokenIfNeeded } from '@/lib/mercadolivre/client'
import type { Objetivo } from '@/lib/precificacao/tipos'

// Simulação e comparação entre canais.
//
// A mesma rota serve às duas telas: passando um canal, é simulação; passando
// vários, é o comparador lado a lado. Assim não existem duas contas
// diferentes pro mesmo número.

export const maxDuration = 60

export async function POST(req: Request) {
  const body = await req.json()
  const { produtoId, custoManual, objetivo, canaisIds, categoriaML } = body as {
    produtoId?: string
    custoManual?: number
    objetivo: Objetivo
    canaisIds?: string[]
    categoriaML?: string
  }

  if (!objetivo?.tipo) return NextResponse.json({ ok: false, erro: 'Objetivo não informado' }, { status: 400 })

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  // Custo: do produto (ou do kit, somando componentes) ou digitado à mão.
  let custo = Number(custoManual ?? 0)
  let pesoKg: number | null = null
  let produto: any = null

  if (produtoId) {
    const { data: p } = await sb.from('produtos')
      .select('id, nome, sku, tipo, preco_custo, preco_venda, peso_kg')
      .eq('id', produtoId).eq('empresa_id', guarda.empresaId).maybeSingle()
    if (!p) return NextResponse.json({ ok: false, erro: 'Produto não encontrado' }, { status: 404 })
    produto = p
    pesoKg = p.peso_kg != null ? Number(p.peso_kg) : null

    if (p.tipo === 'kit') {
      const kit = await calcularKit(sb, p.id)
      custo = Number(kit?.custo ?? 0)
    } else {
      custo = Number(p.preco_custo ?? 0)
    }
    if (!(custo > 0)) {
      return NextResponse.json({
        ok: false,
        erro: `O produto "${p.nome}" não tem custo cadastrado — sem custo não há como calcular margem.`,
      }, { status: 400 })
    }
  }

  if (!(custo > 0)) return NextResponse.json({ ok: false, erro: 'Informe o custo do produto' }, { status: 400 })

  let query = sb.from('marketplace_canais')
    .select('id, nome, plataforma, access_token, refresh_token, token_expira_em, empresa_id, seller_id')
    .eq('empresa_id', guarda.empresaId)
  if (canaisIds?.length) query = query.in('id', canaisIds)
  const { data: canais } = await query.order('nome')

  if (!canais?.length) return NextResponse.json({ ok: false, erro: 'Nenhum canal encontrado' }, { status: 404 })

  const resultados = []
  for (const canal of canais) {
    const { cfg, origem } = await buscarConfigDoCanal(sb, guarda.empresaId, canal)
    const avisosExtras: string[] = []
    let cfgFinal = cfg

    // Comissão do Mercado Livre buscada na API (com cache). Precisa da
    // categoria: sem ela, cai nas faixas configuradas e diz por quê.
    if (cfg.comissaoModo === 'api_ml' && canal.plataforma === 'mercadolivre') {
      if (!categoriaML) {
        avisosExtras.push('Sem a categoria do Mercado Livre, a comissão usada é a da tabela configurada — não a alíquota real da categoria.')
        cfgFinal = { ...cfg, comissaoModo: 'faixas' }
      } else {
        try {
          const atualizado = await refreshAccessTokenIfNeeded(sb, {
            id: canal.id, empresaId: canal.empresa_id, sellerId: canal.seller_id,
            accessToken: canal.access_token, refreshToken: canal.refresh_token, tokenExpiraEm: canal.token_expira_em,
          })
          const r = await resolverFaixasML(sb, { id: canal.id, accessToken: atualizado.accessToken }, categoriaML)
          cfgFinal = { ...cfg, comissaoModo: 'faixas', comissaoFaixas: r.faixas }
          if (r.origem === 'cache') avisosExtras.push('Comissão vinda do cache (atualizada a cada 12 horas).')
        } catch (e: any) {
          avisosExtras.push(`Não deu para consultar a comissão real no Mercado Livre (${e?.message ?? 'erro'}). Usando a tabela configurada.`)
          cfgFinal = { ...cfg, comissaoModo: 'faixas' }
        }
      }
    }

    const r = calcular({ cfg: cfgFinal, custoProduto: custo, objetivo, pesoKg })
    if (origem === 'preset') {
      avisosExtras.push('Este canal ainda não tem taxas configuradas — os valores são um ponto de partida, confira antes de decidir.')
    }

    resultados.push({
      canal: { id: canal.id, nome: canal.nome, plataforma: canal.plataforma },
      origemConfig: origem,
      resultado: { ...r, avisos: [...r.avisos, ...avisosExtras] },
      saude: saudeDaMargem(r.margemLiquida, cfg.faixasSaude),
    })
  }

  return NextResponse.json({
    ok: true,
    produto: produto ? { id: produto.id, nome: produto.nome, sku: produto.sku, precoVenda: produto.preco_venda } : null,
    custo,
    resultados,
  })
}
