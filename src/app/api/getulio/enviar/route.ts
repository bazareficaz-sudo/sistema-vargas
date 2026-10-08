import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { guardaGetulio, lerConfig } from '@/lib/getulio/acesso'
import { enviarResumo } from '@/lib/getulio/resumo'

// "Enviar agora": o mesmo resumo do horário, a pedido de quem está na tela.
// Marca os sinais como avisados — o resumo das 7h30 não repete o que já foi.
export const maxDuration = 120

export async function POST() {
  const { sb, guarda } = await guardaGetulio()
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })
  const cfg = await lerConfig(sb, guarda.empresaId)
  const r = await enviarResumo(createAdminClient(), guarda.empresaId, cfg.destinatarios ?? [], 'envio_manual', new Date(), { semanal: cfg.resumo_semanal !== false })
  if (!r.ok) return NextResponse.json({ ok: false, erro: r.falhas.map(f => f.erro).join(' · ') || 'Falha ao enviar' }, { status: 400 })
  return NextResponse.json({ ok: true, enviados: r.enviados, falhas: r.falhas })
}
