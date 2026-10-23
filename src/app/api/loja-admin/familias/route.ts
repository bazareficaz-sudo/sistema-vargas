import { NextResponse } from 'next/server'
import { contextoAdmin, invalidarVitrine, lojaDaSessao } from '@/lib/commerce/admin'
import { normalizarCor, normalizarRotulo, ROTULO_MAX } from '@/lib/commerce/variacoes'

// Criar uma família de variações, ou acrescentar produtos a uma que já existe.
//
// Cada produto continua sendo ele mesmo — SKU, estoque e preço não mudam. A
// família só diz "estes produtos são opções uns dos outros" na vitrine.

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Item = { produtoId: string; rotulo: string; cor: string | null }

export async function POST(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const corpo = await req.json().catch(() => null) as Record<string, unknown> | null
  const lojaId = corpo?.lojaId
  if (typeof lojaId !== 'string' || !UUID.test(lojaId)) {
    return NextResponse.json({ erro: 'Loja inválida' }, { status: 400 })
  }
  if (!(await lojaDaSessao(ctx, lojaId))) {
    return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })
  }

  // ── Itens ──────────────────────────────────────────────────
  const itens: Item[] = []
  for (const bruto of Array.isArray(corpo?.itens) ? (corpo!.itens as unknown[]).slice(0, 200) : []) {
    const i = bruto as Record<string, unknown>
    const rotulo = normalizarRotulo(i?.rotulo)
    const cor = normalizarCor(i?.cor)
    if (typeof i?.produtoId !== 'string' || !UUID.test(i.produtoId)) {
      return NextResponse.json({ erro: 'Produto inválido na lista' }, { status: 400 })
    }
    if (!rotulo) {
      return NextResponse.json({ erro: `Informe o nome da opção (até ${ROTULO_MAX} caracteres) de cada produto` }, { status: 400 })
    }
    if (cor === undefined) {
      return NextResponse.json({ erro: 'Cor inválida. Use o formato #RRGGBB' }, { status: 400 })
    }
    itens.push({ produtoId: i.produtoId, rotulo, cor })
  }

  const vistos = new Set<string>()
  for (const i of itens) {
    const chave = i.rotulo.toLowerCase()
    if (vistos.has(chave)) {
      return NextResponse.json({ erro: `A opção "${i.rotulo}" está repetida` }, { status: 400 })
    }
    vistos.add(chave)
  }
  if (new Set(itens.map(i => i.produtoId)).size !== itens.length) {
    return NextResponse.json({ erro: 'Produto repetido na lista' }, { status: 400 })
  }

  // ── Família: existente ou nova ─────────────────────────────
  let familiaId = typeof corpo?.familiaId === 'string' ? corpo.familiaId : null
  let ordemBase = 0
  let criouAgora = false

  if (familiaId) {
    if (!UUID.test(familiaId)) return NextResponse.json({ erro: 'Família inválida' }, { status: 400 })
    if (itens.length < 1) return NextResponse.json({ erro: 'Nenhum produto informado' }, { status: 400 })

    const { data: fam } = await ctx.sb
      .from('loja_familias').select('id').eq('id', familiaId).eq('loja_id', lojaId).maybeSingle()
    if (!fam) return NextResponse.json({ erro: 'Família não encontrada' }, { status: 404 })

    const { data: existentes } = await ctx.sb
      .from('loja_produtos').select('opcao_rotulo, opcao_ordem')
      .eq('loja_id', lojaId).eq('familia_id', familiaId)
    const rotulosExistentes = new Set(((existentes ?? []) as any[]).map(e => String(e.opcao_rotulo ?? '').toLowerCase()))
    const repetida = itens.find(i => rotulosExistentes.has(i.rotulo.toLowerCase()))
    if (repetida) {
      return NextResponse.json({ erro: `Já existe a opção "${repetida.rotulo}" nesta família` }, { status: 409 })
    }
    ordemBase = Math.max(-1, ...((existentes ?? []) as any[]).map(e => Number(e.opcao_ordem ?? 0))) + 1
  } else {
    const nome = typeof corpo?.nome === 'string' ? corpo.nome.trim().replace(/\s+/g, ' ') : ''
    const tipo = typeof corpo?.tipoOpcao === 'string' ? corpo.tipoOpcao.trim().replace(/\s+/g, ' ') : ''
    if (!nome || nome.length > 120) return NextResponse.json({ erro: 'Dê um nome para a família (até 120 caracteres)' }, { status: 400 })
    if (!tipo || tipo.length > 30) return NextResponse.json({ erro: 'Informe o tipo da opção (Cor, Medida...)' }, { status: 400 })
    if (itens.length < 2) return NextResponse.json({ erro: 'Uma família precisa de pelo menos 2 produtos' }, { status: 400 })
  }

  // ── Produtos precisam existir na loja ──────────────────────
  // Produto que nunca foi publicado nem virou rascunho não tem linha em
  // `loja_produtos` ainda — e a família mora nessa linha.
  const { data: linhas } = await ctx.sb
    .from('loja_produtos').select('id, produto_id, familia_id')
    .eq('loja_id', lojaId).in('produto_id', itens.map(i => i.produtoId))
  const porProduto = new Map(((linhas ?? []) as any[]).map(l => [l.produto_id as string, l]))

  const semLinha = itens.filter(i => !porProduto.has(i.produtoId)).length
  if (semLinha > 0) {
    return NextResponse.json({
      erro: `${semLinha} ${semLinha === 1 ? 'produto ainda não está' : 'produtos ainda não estão'} na loja. Publique (ou salve como rascunho) antes de agrupar.`,
    }, { status: 400 })
  }
  const emOutra = itens.find(i => {
    const atual = porProduto.get(i.produtoId)?.familia_id
    return atual && atual !== familiaId
  })
  if (emOutra) {
    return NextResponse.json({ erro: 'Algum produto já faz parte de outra família. Tire-o de lá primeiro.' }, { status: 409 })
  }

  if (!familiaId) {
    const { data: criada, error } = await ctx.sb
      .from('loja_familias')
      .insert({
        empresa_id: ctx.empresaId, loja_id: lojaId,
        nome: (corpo!.nome as string).trim().replace(/\s+/g, ' '),
        tipo_opcao: (corpo!.tipoOpcao as string).trim().replace(/\s+/g, ' '),
      })
      .select('id').single()
    if (error || !criada) {
      console.error('[loja-admin] familias/criar falhou', { erro: error?.message })
      return NextResponse.json({ erro: 'Não foi possível salvar' }, { status: 500 })
    }
    familiaId = criada.id as string
    criouAgora = true
  }

  // Um UPDATE por produto: cada um tem rótulo e cor próprios, e são poucos.
  for (const [indice, item] of itens.entries()) {
    const { error } = await ctx.sb
      .from('loja_produtos')
      .update({
        familia_id: familiaId, opcao_rotulo: item.rotulo, opcao_cor: item.cor,
        opcao_ordem: ordemBase + indice,
      })
      .eq('id', porProduto.get(item.produtoId)!.id).eq('loja_id', lojaId)
    if (error) {
      console.error('[loja-admin] familias/atribuir falhou', { erro: error.message })
      if (criouAgora) {
        // Não deixa uma família pela metade (ou vazia) para trás.
        await ctx.sb.from('loja_produtos')
          .update({ familia_id: null, opcao_rotulo: null, opcao_cor: null, opcao_ordem: 0 })
          .eq('loja_id', lojaId).eq('familia_id', familiaId)
        await ctx.sb.from('loja_familias').delete().eq('id', familiaId).eq('loja_id', lojaId)
      }
      return NextResponse.json({
        erro: error.code === '23505' ? 'Já existe uma opção com esse nome nesta família' : 'Não foi possível salvar',
      }, { status: error.code === '23505' ? 409 : 500 })
    }
  }

  invalidarVitrine(lojaId)
  return NextResponse.json({ ok: true, id: familiaId })
}
