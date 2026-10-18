import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { empresasDoUsuario } from '@/lib/auth/empresaAtiva'
import { emailConfigurado, listaDeEmails } from '@/lib/email/enviar'
import { enviarFechamento } from '@/lib/fiscal/enviarFechamento'
import { periodoDoMes } from '@/lib/fiscal/fechamento'

// Envio do fechamento ao contador por e-mail.
//   GET                      → configuração do automático e últimos envios
//   POST {acao:'enviar', mes} → monta o .zip do mês e envia agora
//   POST {acao:'config', envio_automatico, dia_envio, copia_para}

export const maxDuration = 60

async function estado(sb: Awaited<ReturnType<typeof createClient>>, empresaId: string) {
  const [{ data: cfg }, { data: envios }, { data: emp }] = await Promise.all([
    sb.from('fechamento_contador_config').select('envio_automatico, dia_envio, copia_para').eq('empresa_id', empresaId).maybeSingle(),
    sb.from('fechamento_contador_envios').select('id, mes, para, copia, origem, status, erro, notas, created_at')
      .eq('empresa_id', empresaId).order('created_at', { ascending: false }).limit(12),
    sb.from('empresas').select('contador, email_contador').eq('id', empresaId).maybeSingle(),
  ])
  return {
    config: cfg ?? { envio_automatico: false, dia_envio: 2, copia_para: null },
    envios: envios ?? [],
    emailConfigurado: emailConfigurado(),
    contador: emp?.contador ?? null,
    emailContador: emp?.email_contador ?? null,
  }
}

export async function GET() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'exportar_dados')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })
  return NextResponse.json({ ok: true, ...(await estado(sb, guarda.empresaId)) })
}

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'exportar_dados')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })
  const body = await req.json().catch(() => ({}))

  if (body.acao === 'enviar') {
    const mes = String(body.mes ?? '')
    if (!periodoDoMes(mes)) return NextResponse.json({ ok: false, erro: 'Mês inválido' }, { status: 400 })
    const { data: { user } } = await sb.auth.getUser()
    const permitidas = (await empresasDoUsuario(sb, guarda.userId)).map(e => e.id)
    const r = await enviarFechamento(createAdminClient(), guarda.empresaId, mes, {
      origem: 'manual', enviadoPor: guarda.userId, empresasPermitidas: permitidas,
      // Quem clicou recebe cópia: fica com o registro de que foi.
      copiaExtra: user?.email ?? null,
    })
    return NextResponse.json({ ...r, ...(await estado(sb, guarda.empresaId)) }, { status: r.ok ? 200 : 422 })
  }

  if (body.acao === 'config') {
    const dia = Math.min(28, Math.max(1, Math.round(Number(body.dia_envio) || 2)))
    const copiaTexto = String(body.copia_para ?? '').trim()
    const copia = listaDeEmails(copiaTexto)
    if (copiaTexto && copia.length === 0) return NextResponse.json({ ok: false, erro: 'O e-mail de cópia não parece válido.' }, { status: 400 })
    const { error } = await sb.from('fechamento_contador_config').upsert({
      empresa_id: guarda.empresaId, envio_automatico: !!body.envio_automatico, dia_envio: dia,
      copia_para: copia.join('; ') || null, updated_at: new Date().toISOString(),
    }, { onConflict: 'empresa_id' })
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, ...(await estado(sb, guarda.empresaId)) })
  }

  return NextResponse.json({ ok: false, erro: 'Ação desconhecida' }, { status: 400 })
}
