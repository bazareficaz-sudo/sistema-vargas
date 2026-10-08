import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { guardaGetulio, lerConfig } from '@/lib/getulio/acesso'
import { varrer } from '@/lib/getulio/varredura'

// "Olhar agora": a mesma varredura do cron, a pedido. As consultas de giro e
// vendas só rodam com a chave de serviço — por isso o cliente admin, depois
// da checagem de permissão e sempre com a empresa da sessão.
export const maxDuration = 120

export async function POST() {
  const { sb, guarda } = await guardaGetulio()
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })
  const cfg = await lerConfig(sb, guarda.empresaId)
  const resultado = await varrer(createAdminClient(), guarda.empresaId, cfg.vigias_desligados ?? [])
  return NextResponse.json({ ok: true, ...resultado })
}
