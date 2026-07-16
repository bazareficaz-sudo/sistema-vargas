import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buscarAnuncioPorUrl } from '@/lib/mercadolivre/item'

export async function POST(req: Request) {
  const { url } = await req.json()
  if (!url) return NextResponse.json({ ok: false, erro: 'URL ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  try {
    const dados = await buscarAnuncioPorUrl(url)
    return NextResponse.json({ ok: true, dados })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'Erro ao importar anúncio' }, { status: 400 })
  }
}
