import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { guardaGetulio, lerConfig } from '@/lib/getulio/acesso'
import { montarResumo } from '@/lib/getulio/resumo'

// Prévia: o resumo que sairia agora, sem enviar e sem marcar nada como avisado.
export const maxDuration = 60

export async function POST() {
  const { sb, guarda } = await guardaGetulio()
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })
  const cfg = await lerConfig(sb, guarda.empresaId)
  const nome = cfg.destinatarios?.[0]?.nome ?? ''
  const r = await montarResumo(createAdminClient(), guarda.empresaId, nome, new Date(), { semanal: cfg.resumo_semanal !== false })
  return NextResponse.json({ ok: true, texto: r.texto, geradoPor: r.geradoPor, itens: r.itens.length, restantes: r.restantes })
}
