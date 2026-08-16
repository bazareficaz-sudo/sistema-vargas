import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Unificar categorias duplicadas.
//
// O catálogo tem a mesma categoria escrita de várias formas — MATERIAL
// HIDRÁULICO (1.788 produtos), MATERIAL HIDRAULICO (762), Material Hidráulico
// e uma com o acento quebrado. Arrumar isso à mão significaria reeditar
// milhares de produtos.
//
// Aqui é uma operação só: os produtos de todas as origens passam a apontar
// para o destino, e as origens são apagadas. Feito no servidor porque são
// vários passos que não podem ficar pela metade — produto apontando para
// categoria que já foi excluída é pior do que a duplicata.
//
// A regra é a mesma para qualquer lugar onde a origem aparecia: o produto
// termina com o PAR do destino (categoria + subcategoria). Se o destino é uma
// subcategoria, `categoria` vira o nome do pai. Assim "unificar" quer dizer
// sempre a mesma coisa, e não uma coisa quando a origem era raiz e outra
// quando era filha.

type Corpo = { origemIds?: string[]; destinoId?: string }

export async function POST(req: Request) {
  const { origemIds, destinoId } = await req.json() as Corpo

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })
  const perfil = await perfilDaSessao(sb, user.id)
  const empresaId = perfil?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  if (!Array.isArray(origemIds) || origemIds.length === 0 || !destinoId) {
    return NextResponse.json({ ok: false, erro: 'Escolha as categorias de origem e o destino.' }, { status: 400 })
  }
  if (origemIds.includes(destinoId)) {
    return NextResponse.json({ ok: false, erro: 'O destino não pode estar entre as categorias que serão unificadas.' }, { status: 400 })
  }

  const { data: todas } = await sb.from('categorias')
    .select('id, nome, pai_id').eq('empresa_id', empresaId)
  const porId = new Map((todas ?? []).map(c => [c.id, c]))

  const destino = porId.get(destinoId)
  if (!destino) return NextResponse.json({ ok: false, erro: 'Categoria de destino não encontrada.' }, { status: 404 })

  // O par que todo produto migrado passa a ter.
  const paiDoDestino = destino.pai_id ? porId.get(destino.pai_id) : null
  const parDestino = paiDoDestino
    ? { categoria: paiDoDestino.nome, subcategoria: destino.nome }
    : { categoria: destino.nome, subcategoria: null as string | null }

  const origens = origemIds.map(id => porId.get(id)).filter(Boolean) as { id: string; nome: string; pai_id: string | null }[]
  if (origens.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nenhuma categoria de origem encontrada.' }, { status: 404 })
  }

  // Origem com filhas deixaria as filhas órfãs. Recusa em vez de decidir
  // sozinho o que fazer com elas.
  const comFilhas = origens.filter(o => (todas ?? []).some(c => c.pai_id === o.id && !origemIds.includes(c.id)))
  if (comFilhas.length > 0) {
    return NextResponse.json({
      ok: false,
      erro: `${comFilhas.map(c => `"${c.nome}"`).join(', ')} tem subcategorias dentro. Mova ou inclua as subcategorias na unificação primeiro.`,
    }, { status: 400 })
  }

  let migrados = 0
  const detalhes: { nome: string; produtos: number }[] = []

  for (const origem of origens) {
    // Pega tudo que apontava para a origem, no primeiro OU no segundo nível.
    const { data: alvo } = await sb.from('produtos')
      .select('id').eq('empresa_id', empresaId)
      .or(`categoria.eq.${origem.nome},subcategoria.eq.${origem.nome}`)

    const ids = (alvo ?? []).map(p => p.id)
    if (ids.length > 0) {
      // Em lotes: uma lista de milhares de ids numa URL estoura o limite.
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await sb.from('produtos')
          .update({ categoria: parDestino.categoria, subcategoria: parDestino.subcategoria })
          .in('id', ids.slice(i, i + 200))
        if (error) {
          return NextResponse.json({
            ok: false,
            erro: `Falha ao migrar os produtos de "${origem.nome}": ${error.message}. Nenhuma categoria foi excluída.`,
          }, { status: 400 })
        }
      }
      migrados += ids.length
    }
    detalhes.push({ nome: origem.nome, produtos: ids.length })
  }

  // Só depois de migrar tudo. Se a exclusão falhar, o pior caso é uma
  // categoria vazia sobrando — não produto apontando para o vazio.
  const { error: erroDelete } = await sb.from('categorias')
    .delete().eq('empresa_id', empresaId).in('id', origens.map(o => o.id))

  if (erroDelete) {
    return NextResponse.json({
      ok: true, migrados, detalhes,
      aviso: `Os produtos foram migrados, mas as categorias de origem não puderam ser excluídas: ${erroDelete.message}`,
    })
  }

  return NextResponse.json({
    ok: true,
    migrados,
    excluidas: origens.length,
    destino: parDestino.subcategoria
      ? `${parDestino.categoria} → ${parDestino.subcategoria}`
      : parDestino.categoria,
    detalhes,
  })
}
