import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

// Histórico das alterações de preço feitas pelo recálculo.

export async function GET(req: Request) {
  const url = new URL(req.url)
  const pagina = Math.max(0, Number(url.searchParams.get('pagina') ?? 0))
  const tamanho = Math.min(100, Number(url.searchParams.get('tamanho') ?? 50))

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data, count } = await sb.from('precificacao_historico')
    .select('*, marketplace_anuncios(titulo), marketplace_canais(nome)', { count: 'exact' })
    .eq('empresa_id', guarda.empresaId)
    .order('created_at', { ascending: false })
    .range(pagina * tamanho, pagina * tamanho + tamanho - 1)

  return NextResponse.json({ ok: true, itens: data ?? [], total: count ?? 0, pagina, tamanho })
}
