import { NextResponse } from 'next/server'
import { contextoAdmin, invalidarVitrine, lojaDaSessao, type ContextoAdmin } from '@/lib/commerce/admin'
import { normalizarCor, normalizarRotulo, ROTULO_MAX } from '@/lib/commerce/variacoes'

// Editar, tirar produtos de, ou desfazer uma família de variações.
// `loja_id` entra em todo filtro de escrita: id de família de outra loja,
// adivinhado ou vindo de outra aba, não é editável por quem não é dono dela.

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SEM_FAMILIA = { familia_id: null, opcao_rotulo: null, opcao_cor: null, opcao_ordem: 0 }

/** Solta todos os produtos e apaga a família. */
async function desfazer(ctx: ContextoAdmin, lojaId: string, familiaId: string) {
  await ctx.sb.from('loja_produtos').update(SEM_FAMILIA).eq('loja_id', lojaId).eq('familia_id', familiaId)
  await ctx.sb.from('loja_familias').delete().eq('id', familiaId).eq('loja_id', lojaId)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ erro: 'Família inválida' }, { status: 400 })

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

  const { data: fam } = await ctx.sb
    .from('loja_familias').select('id').eq('id', id).eq('loja_id', lojaId).maybeSingle()
  if (!fam) return NextResponse.json({ erro: 'Família não encontrada' }, { status: 404 })

  // ── Nome e tipo ────────────────────────────────────────────
  const dadosFamilia: Record<string, string> = {}
  if (corpo?.nome !== undefined) {
    const nome = typeof corpo.nome === 'string' ? corpo.nome.trim().replace(/\s+/g, ' ') : ''
    if (!nome || nome.length > 120) return NextResponse.json({ erro: 'Dê um nome para a família (até 120 caracteres)' }, { status: 400 })
    dadosFamilia.nome = nome
  }
  if (corpo?.tipoOpcao !== undefined) {
    const tipo = typeof corpo.tipoOpcao === 'string' ? corpo.tipoOpcao.trim().replace(/\s+/g, ' ') : ''
    if (!tipo || tipo.length > 30) return NextResponse.json({ erro: 'Informe o tipo da opção (Cor, Medida...)' }, { status: 400 })
    dadosFamilia.tipo_opcao = tipo
  }

  // ── Itens a editar ─────────────────────────────────────────
  const edicoes: { id: string; rotulo: string; cor: string | null; ordem: number }[] = []
  for (const bruto of Array.isArray(corpo?.itens) ? (corpo!.itens as unknown[]).slice(0, 200) : []) {
    const i = bruto as Record<string, unknown>
    const rotulo = normalizarRotulo(i?.rotulo)
    const cor = normalizarCor(i?.cor)
    const ordem = Number(i?.ordem)
    if (typeof i?.lojaProdutoId !== 'string' || !UUID.test(i.lojaProdutoId)) {
      return NextResponse.json({ erro: 'Produto inválido na lista' }, { status: 400 })
    }
    if (!rotulo) {
      return NextResponse.json({ erro: `Informe o nome da opção (até ${ROTULO_MAX} caracteres) de cada produto` }, { status: 400 })
    }
    if (cor === undefined) return NextResponse.json({ erro: 'Cor inválida. Use o formato #RRGGBB' }, { status: 400 })
    if (!Number.isInteger(ordem) || ordem < 0 || ordem > 10000) {
      return NextResponse.json({ erro: 'Ordem inválida' }, { status: 400 })
    }
    edicoes.push({ id: i.lojaProdutoId, rotulo, cor, ordem })
  }

  const remover = Array.isArray(corpo?.remover)
    ? (corpo!.remover as unknown[]).filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, 200)
    : []

  // Os nomes de opção têm de continuar únicos: um UPDATE por vez pode bater no
  // índice único no meio de uma troca, então a conferência é feita aqui, no
  // conjunto final, antes de gravar qualquer coisa.
  if (edicoes.length > 0) {
    const { data: atuais } = await ctx.sb
      .from('loja_produtos').select('id, opcao_rotulo').eq('loja_id', lojaId).eq('familia_id', id)
    const finais = new Map<string, string>(((atuais ?? []) as any[]).map(a => [a.id as string, String(a.opcao_rotulo ?? '')]))
    for (const r of remover) finais.delete(r)
    for (const e of edicoes) if (finais.has(e.id)) finais.set(e.id, e.rotulo)
    const nomes = [...finais.values()].map(n => n.toLowerCase())
    if (new Set(nomes).size !== nomes.length) {
      return NextResponse.json({ erro: 'Duas opções estão com o mesmo nome' }, { status: 400 })
    }
  }

  if (Object.keys(dadosFamilia).length > 0) {
    const { error } = await ctx.sb.from('loja_familias').update(dadosFamilia).eq('id', id).eq('loja_id', lojaId)
    if (error) {
      console.error('[loja-admin] familias/editar falhou', { erro: error.message })
      return NextResponse.json({ erro: 'Não foi possível salvar' }, { status: 500 })
    }
  }

  if (remover.length > 0) {
    await ctx.sb.from('loja_produtos').update(SEM_FAMILIA)
      .eq('loja_id', lojaId).eq('familia_id', id).in('id', remover)
  }

  for (const e of edicoes) {
    if (remover.includes(e.id)) continue
    const { error } = await ctx.sb
      .from('loja_produtos')
      .update({ opcao_rotulo: e.rotulo, opcao_cor: e.cor, opcao_ordem: e.ordem })
      .eq('id', e.id).eq('loja_id', lojaId).eq('familia_id', id)
    if (error) {
      console.error('[loja-admin] familias/editar-item falhou', { erro: error.message })
      return NextResponse.json({
        erro: error.code === '23505' ? 'Duas opções estão com o mesmo nome' : 'Não foi possível salvar',
      }, { status: error.code === '23505' ? 409 : 500 })
    }
  }

  // Família de um produto só não é família: sobra nada para escolher.
  const { count } = await ctx.sb
    .from('loja_produtos').select('id', { count: 'exact', head: true })
    .eq('loja_id', lojaId).eq('familia_id', id)
  const desfeita = (count ?? 0) < 2
  if (desfeita) await desfazer(ctx, lojaId, id)

  invalidarVitrine(lojaId)
  return NextResponse.json({ ok: true, desfeita })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ erro: 'Família inválida' }, { status: 400 })

  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const lojaId = new URL(req.url).searchParams.get('lojaId') ?? ''
  if (!UUID.test(lojaId)) return NextResponse.json({ erro: 'Loja inválida' }, { status: 400 })
  if (!(await lojaDaSessao(ctx, lojaId))) return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })

  await desfazer(ctx, lojaId, id)
  invalidarVitrine(lojaId)
  return NextResponse.json({ ok: true })
}
