import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirSystemAdmin } from '@/lib/auth/saasAdmin'
import { createAdminClient } from '@/lib/supabase/admin'
import { cifrarSegredo } from '@/lib/ia/segredos'

const modelos = new Set(['claude-haiku-4-5-20251001', 'claude-sonnet-5', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'])
const provedores = new Set(['herdar', 'automatico', 'anthropic', 'openai', 'desativado'])

export async function POST(request: Request) {
  const supabase = await createClient()
  const acesso = await exigirSystemAdmin(supabase)
  if (!acesso.ok) return NextResponse.json({ ok: false, erro: acesso.erro }, { status: acesso.status })
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (body?.escopo === 'provedor') {
    const provedor = body.provedor === 'anthropic' || body.provedor === 'openai' ? body.provedor : null
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
    if (!provedor || apiKey.length < 20 || apiKey.length > 500) {
      return NextResponse.json({ ok: false, erro: 'Informe uma chave de API válida.' }, { status: 400 })
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ ok: false, erro: 'O cofre ainda não está habilitado neste ambiente (SUPABASE_SERVICE_ROLE_KEY ausente).' }, { status: 503 })
    }
    const { error } = await createAdminClient().from('ia_provedor_segredos').upsert({
      provedor,
      segredo_cifrado: cifrarSegredo(apiKey),
      atualizado_por: acesso.adminId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'provedor' })
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  const escopo = body?.escopo === 'global' ? 'global' : 'empresa'
  if (escopo === 'global') {
    const provedorGlobal = typeof body?.provedor === 'string' ? body.provedor : ''
    const modeloGlobal = typeof body?.modelo === 'string' && body.modelo ? body.modelo : null
    const reqGlobal = Number(body?.limiteRequisicoes), tokensGlobal = Number(body?.limiteTokens)
    const maxGlobal = Number(body?.maxTokensResposta), timeout = Number(body?.timeoutSegundos)
    if (!provedores.has(provedorGlobal) || provedorGlobal === 'herdar' || (modeloGlobal && !modelos.has(modeloGlobal))) return NextResponse.json({ ok: false, erro: 'Política global inválida.' }, { status: 400 })
    if (![reqGlobal, tokensGlobal, maxGlobal, timeout].every(Number.isInteger) || reqGlobal < -1 || tokensGlobal < -1 || maxGlobal < 100 || maxGlobal > 8000 || timeout < 5 || timeout > 90) return NextResponse.json({ ok: false, erro: 'Limites globais inválidos.' }, { status: 400 })
    const { error } = await supabase.from('ia_saas_config').update({ provedor_padrao: provedorGlobal, modelo_padrao: modeloGlobal, limite_requisicoes_padrao: reqGlobal, limite_tokens_padrao: tokensGlobal, max_tokens_resposta: maxGlobal, timeout_segundos: timeout, fallback_automatico: body?.fallbackAutomatico !== false, atualizado_por: acesso.adminId, updated_at: new Date().toISOString() }).eq('id', true)
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  const empresaId = typeof body?.empresaId === 'string' ? body.empresaId : ''
  const provedor = typeof body?.provedor === 'string' ? body.provedor : ''
  const modelo = typeof body?.modelo === 'string' && body.modelo ? body.modelo : null
  const req = Number(body?.limiteRequisicoesMes)
  const tokens = Number(body?.limiteTokensMes)
  const max = Number(body?.maxTokensResposta)
  if (!/^[0-9a-f-]{36}$/i.test(empresaId) || !provedores.has(provedor)) return NextResponse.json({ ok: false, erro: 'Configuração inválida.' }, { status: 400 })
  if (modelo && !modelos.has(modelo)) return NextResponse.json({ ok: false, erro: 'Modelo não permitido.' }, { status: 400 })
  if ((!Number.isInteger(req) || req < -1) || (!Number.isInteger(tokens) || tokens < -1) || (!Number.isInteger(max) || max < 100 || max > 8000)) return NextResponse.json({ ok: false, erro: 'Limites inválidos.' }, { status: 400 })

  const { error } = await supabase.from('ia_empresa_config').upsert({
    empresa_id: empresaId, habilitado: provedor !== 'desativado', provedor, modelo,
    limite_requisicoes_mes: req, limite_tokens_mes: tokens, max_tokens_resposta: max,
    fallback_automatico: body?.fallbackAutomatico !== false, funcionalidades: ['dashboard'],
    atualizado_por: acesso.adminId, updated_at: new Date().toISOString(),
  }, { onConflict: 'empresa_id' })
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
