import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidateTag } from 'next/cache'

// Manutenção da Loja Online.
//
// Duas tarefas, nesta ordem:
//
//   1. Expirar reservas de estoque vencidas. A tabela nasce vazia na Fase 1 e
//      a escrita só entra na Fase 2, mas a rotina entra AGORA porque uma
//      reserva que não expira é pior que não ter reserva: some do estoque
//      para sempre e ninguém liga uma coisa à outra meses depois.
//
//   2. Recalcular o cache de disponibilidade das lojas ativas. É o que
//      mantém a listagem coerente sem calcular estoque ao vivo a cada busca.
//      A página do produto e o carrinho continuam usando o número ao vivo —
//      só a lista usa cache.
//
// Não existe gatilho em `produtos` de propósito: é a tabela mais quente do
// sistema, e pendurar trabalho ali para servir a vitrine seria cobrar do
// caixa o custo da loja. O preço dessa escolha é este cron.

export const maxDuration = 120

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, erro: 'Não autorizado' }, { status: 401 })
  }

  const sb = createAdminClient()
  const resultados: Record<string, unknown>[] = []

  const { data: expiradas, error: erroExpirar } = await sb.rpc('loja_expirar_reservas')
  if (erroExpirar) {
    // Nunca tratar erro de consulta como "nada a fazer". Este sistema já
    // perdeu dias com sincronização parada devolvendo 200 OK e zero itens.
    console.error('[cron/loja] expirar reservas falhou', erroExpirar.message)
    return NextResponse.json({ ok: false, erro: erroExpirar.message }, { status: 500 })
  }

  const { data: lojas, error: erroLojas } = await sb
    .from('loja_config').select('id, nome').eq('ativo', true)
  if (erroLojas) {
    console.error('[cron/loja] listar lojas falhou', erroLojas.message)
    return NextResponse.json({ ok: false, erro: erroLojas.message }, { status: 500 })
  }

  for (const loja of (lojas ?? []) as { id: string; nome: string }[]) {
    const { data, error } = await sb.rpc('loja_atualizar_estoque_cache', {
      p_loja_id: loja.id, p_produto_ids: null,
    })
    if (error) {
      // Uma loja com problema não pode impedir as outras de serem atendidas.
      console.error('[cron/loja] cache de estoque falhou', { lojaId: loja.id, erro: error.message })
      resultados.push({ loja: loja.nome, ok: false, erro: error.message })
      continue
    }
    resultados.push({ loja: loja.nome, ok: true, produtos: Number(data ?? 0) })
    revalidateTag(`loja:${loja.id}`, 'max')
  }

  return NextResponse.json({
    ok: true,
    reservasExpiradas: Number(expiradas ?? 0),
    lojas: resultados,
  })
}
