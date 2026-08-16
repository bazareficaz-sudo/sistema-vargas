import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listarCategorias } from '@/lib/nuvemshop/listing'
import { COLUNAS_CANAL, montarCanal } from '@/lib/nuvemshop/canal'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// Categorias da loja, para o select da tela de criar anúncio.
//
// Diferente de Shopee e Mercado Livre, aqui a lista vem inteira de uma vez:
// são as categorias que o próprio lojista criou (dezenas, não milhares), e
// não uma árvore da plataforma que precisa ser navegada nível a nível.
export async function POST(req: Request) {
  const { canalId } = await req.json()
  if (!canalId) return NextResponse.json({ ok: false, erro: 'canalId ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: canalRow } = await sb
    .from('marketplace_canais')
    .select(COLUNAS_CANAL)
    .eq('id', canalId).eq('empresa_id', empresaId).eq('plataforma', 'nuvemshop')
    .maybeSingle()

  if (!canalRow) return NextResponse.json({ ok: false, erro: 'Canal Nuvemshop não encontrado' }, { status: 404 })
  if (!canalRow.access_token) {
    return NextResponse.json({ ok: false, erro: 'Canal não conectado — refaça a autorização em Configurar.' }, { status: 400 })
  }

  try {
    const categorias = await listarCategorias(montarCanal(canalRow))
    return NextResponse.json({ ok: true, categorias })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'Erro ao buscar categorias da loja' }, { status: 400 })
  }
}
