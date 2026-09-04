import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

// O HISTÓRICO DA FILA PARA UM PRODUTO — no banco, não nas linhas carregadas.
//
// A tela da fila traz as 200 últimas linhas da empresa. Parecia bastante até
// 04/09/2026, quando o gestor procurou um anúncio que não subia: uma rodada
// só devolveu 149 linhas `sem_anuncio`, e as 200 cobriam pouco mais de uma
// rodada. Buscar dentro do que já veio responderia "não achei" sobre um
// produto que a fila avaliou — a pior resposta possível, porque é a mesma
// que ela daria se ele nunca tivesse entrado na fila.
//
// Aqui a pergunta vai inteira ao banco: todo o histórico daquele produto, em
// qualquer canal, na ordem em que aconteceu.

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ ok: true, linhas: [], produtos: [] })

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  // Dois passos de propósito: filtrar por coluna de tabela embutida é onde o
  // PostgREST silenciosamente devolve menos do que se pediu. Achar os
  // produtos primeiro é uma consulta que se entende lendo.
  const { data: produtos } = await sb
    .from('produtos')
    .select('id, nome, sku')
    .eq('empresa_id', guarda.empresaId)
    .or(`nome.ilike.%${q}%,sku.ilike.%${q}%`)
    .limit(25)

  const ids = (produtos ?? []).map((p: { id: string }) => p.id)
  if (ids.length === 0) return NextResponse.json({ ok: true, linhas: [], produtos: [] })

  const { data: linhas, error } = await sb
    .from('marketplace_fila_simulacao')
    .select('id, rodada_em, acao, estoque_sistema, estoque_canal, estoque_enviaria, preco_canal, preco_enviaria, detalhe, produtos(nome, sku), marketplace_canais(nome, plataforma)')
    .eq('empresa_id', guarda.empresaId)
    .in('produto_id', ids)
    .order('rodada_em', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  // A fila de PENDENTES do mesmo produto: distingue "avaliado e recusado" de
  // "esperando a próxima rodada", que na tela pareciam a mesma coisa.
  const { data: pendentes } = await sb
    .from('marketplace_fila')
    .select('produto_id, sujo_em, motivo, prioridade, tentativas')
    .eq('empresa_id', guarda.empresaId)
    .in('produto_id', ids)
    .is('enviado_em', null)

  return NextResponse.json({
    ok: true,
    linhas: linhas ?? [],
    produtos: produtos ?? [],
    pendentes: pendentes ?? [],
  })
}
