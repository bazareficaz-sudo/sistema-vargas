import { NextResponse } from 'next/server'
import { guardaGetulio, lerConfig } from '@/lib/getulio/acesso'
import { VIGIAS, type Destinatario } from '@/lib/getulio/tipos'

export async function GET() {
  const { sb, guarda } = await guardaGetulio()
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })
  return NextResponse.json({ ok: true, config: await lerConfig(sb, guarda.empresaId) })
}

export async function POST(req: Request) {
  const { sb, guarda } = await guardaGetulio()
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({}))
  const horario = String(body.horario_resumo ?? '07:30')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(horario)) {
    return NextResponse.json({ ok: false, erro: 'Horário inválido — use HH:MM' }, { status: 400 })
  }
  const destinatarios: Destinatario[] = (Array.isArray(body.destinatarios) ? body.destinatarios : [])
    .map((d: any) => ({ nome: String(d?.nome ?? '').trim().slice(0, 40), numero: String(d?.numero ?? '').replace(/\D/g, '') }))
    .filter((d: Destinatario) => d.numero.length >= 10)
    .slice(0, 5)
  if (body.ativo && destinatarios.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Cadastre ao menos um número de WhatsApp para ligar o Getúlio' }, { status: 400 })
  }
  const idsValidos = new Set<string>(VIGIAS.map(v => v.id))
  const desligados = (Array.isArray(body.vigias_desligados) ? body.vigias_desligados : [])
    .map(String).filter((v: string) => idsValidos.has(v))

  const { error } = await sb.from('getulio_config').upsert({
    empresa_id: guarda.empresaId,
    ativo: !!body.ativo,
    horario_resumo: horario,
    destinatarios,
    vigias_desligados: desligados,
    responder_whatsapp: !!body.responder_whatsapp,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'empresa_id' })
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, config: await lerConfig(sb, guarda.empresaId) })
}
