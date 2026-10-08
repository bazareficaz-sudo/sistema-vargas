import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { diaISO } from '@/lib/datas'
import { varrer } from '@/lib/getulio/varredura'
import { enviarAlertas, enviarResumo } from '@/lib/getulio/resumo'
import { minutosDoDiaSP, minutosDoHorario } from '@/lib/getulio/regras'
import type { ConfigGetulio } from '@/lib/getulio/tipos'

// Roda a cada 15 minutos (vercel.json). Para cada empresa com o Getúlio
// ligado:
//   • varre a cada hora — os sinais na Central ficam frescos;
//   • depois de varrer, manda o ALERTA IMEDIATO do urgente que acabou de
//     aparecer (ver selecionarAlertas — horário, limite diário, só novidade);
//   • no horário do resumo, varre de novo e envia o resumo do dia, uma vez
//     (na segunda, com a semana que passou).
//
// Resumo atrasado mais de 4h (Getúlio ligado à noite, cron fora do ar) não
// sai: chegaria fora de hora. Fica para o dia seguinte.
export const maxDuration = 300

const JANELA_RESUMO_MIN = 240
const INTERVALO_VARREDURA_MS = 55 * 60_000

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, erro: 'Não autorizado' }, { status: 401 })
  }

  const sb = createAdminClient()
  const { data: configs } = await sb.from('getulio_config').select('*').eq('ativo', true)
  const agora = new Date()
  const minutos = minutosDoDiaSP(agora)
  const hoje = diaISO(agora)

  const resultados: Record<string, unknown>[] = []
  for (const cfg of (configs ?? []) as ConfigGetulio[]) {
    const atraso = minutos - minutosDoHorario(cfg.horario_resumo)
    const horaDoResumo = atraso >= 0 && atraso <= JANELA_RESUMO_MIN && cfg.ultimo_resumo_dia !== hoje
    const varreduraVencida = !cfg.ultima_varredura
      || agora.getTime() - new Date(cfg.ultima_varredura).getTime() >= INTERVALO_VARREDURA_MS
    const r: Record<string, unknown> = { empresa: cfg.empresa_id }
    try {
      if (varreduraVencida || horaDoResumo) r.varredura = await varrer(sb, cfg.empresa_id, cfg.vigias_desligados ?? [], agora)
      if (horaDoResumo) {
        const envio = await enviarResumo(sb, cfg.empresa_id, cfg.destinatarios ?? [], 'resumo_diario', agora, { semanal: cfg.resumo_semanal !== false })
        r.resumo = { ok: envio.ok, enviados: envio.enviados, falhas: envio.falhas }
      } else if (cfg.alertas_imediatos !== false && r.varredura) {
        // Na hora do resumo o urgente já vai nele; fora dela, alerta.
        r.alertas = await enviarAlertas(sb, cfg.empresa_id, cfg.destinatarios ?? [], agora)
      }
    } catch (e: any) {
      r.erro = e?.message ?? String(e)
    }
    resultados.push(r)
  }
  return NextResponse.json({ ok: true, empresas: resultados.length, resultados })
}
