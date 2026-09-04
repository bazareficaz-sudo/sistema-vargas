import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

// OS ANÚNCIOS TRAVADOS: o espelho diz um número, a plataforma devolveu outro.
//
// `estoque_externo` é o que ACREDITAMOS ter mandado. `estoque_reservado` é o
// que a sincronização de catálogo leu da plataforma (shopee/sync.ts,
// mercadolivre/sync.ts, nuvemshop/sync.ts). Quando discordam, um envio
// anterior foi dado como aceito sem ter sido — e o anúncio fica preso: a
// fila compara o espelho com ele mesmo, conclui "já igual" e nunca reenvia.
//
// GET conta e lista. POST reenfileira os produtos correspondentes.
//
// A COMPARAÇÃO É FEITA AQUI, não no filtro da consulta, porque o PostgREST
// não compara duas COLUNAS entre si — ele lê o nome da segunda como texto.
// Foi exatamente esse erro que derrubou a rodada inteira da fila em agosto
// (ver supabase-fila-pendente-consertar.sql). Paginar e comparar em memória
// é mais longo e é o que funciona.

const TAMANHO_PAGINA = 1000

type Linha = {
  id: string
  produto_id: string | null
  titulo: string | null
  id_externo: string | null
  estoque_externo: number | null
  estoque_reservado: number | null
  canal_id: string
}

async function levantarTravados(sb: ReturnType<typeof createClient> extends Promise<infer T> ? T : never, empresaId: string) {
  const travados: Linha[] = []
  for (let offset = 0; offset < 50 * TAMANHO_PAGINA; offset += TAMANHO_PAGINA) {
    const { data, error } = await sb
      .from('marketplace_anuncios')
      .select('id, produto_id, titulo, id_externo, estoque_externo, estoque_reservado, canal_id')
      .eq('empresa_id', empresaId)
      .not('produto_id', 'is', null)
      .not('estoque_externo', 'is', null)
      .not('estoque_reservado', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + TAMANHO_PAGINA - 1)

    if (error) throw new Error(error.message)
    const pagina = (data ?? []) as Linha[]
    travados.push(...pagina.filter(a => Number(a.estoque_externo) !== Number(a.estoque_reservado)))
    if (pagina.length < TAMANHO_PAGINA) break
  }
  return travados
}

export async function GET() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  try {
    const travados = await levantarTravados(sb, guarda.empresaId)
    return NextResponse.json({
      ok: true,
      total: travados.length,
      produtos: new Set(travados.map(a => a.produto_id)).size,
      // Uma amostra para a tela mostrar, não a lista inteira.
      amostra: travados.slice(0, 20).map(a => ({
        titulo: a.titulo, idExterno: a.id_externo,
        espelho: a.estoque_externo, medido: a.estoque_reservado,
      })),
    })
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao levantar' }, { status: 500 })
  }
}

export async function POST() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  try {
    const travados = await levantarTravados(sb, guarda.empresaId)
    const produtoIds = [...new Set(travados.map(a => a.produto_id).filter(Boolean) as string[])]
    if (produtoIds.length === 0) return NextResponse.json({ ok: true, enfileirados: 0, anuncios: 0 })

    const agora = new Date().toISOString()
    const { error } = await sb.from('marketplace_fila').upsert(
      produtoIds.map(produto_id => ({
        empresa_id: guarda.empresaId,
        produto_id,
        sujo_em: agora,
        motivo: 'espelho divergente da leitura do canal',
        prioridade: 0,
        // Zera o envio anterior: "pendente" nesta fila é `enviado_em IS NULL`
        // (ver supabase-fila-pendente-consertar.sql), então reenfileirar sem
        // limpar aqui não faria o produto voltar a ser atendido.
        enviado_em: null,
        tentativas: 0,
      })),
      { onConflict: 'empresa_id,produto_id' },
    )
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, enfileirados: produtoIds.length, anuncios: travados.length })
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao reenfileirar' }, { status: 500 })
  }
}
