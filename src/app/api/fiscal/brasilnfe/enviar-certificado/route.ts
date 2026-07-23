import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { alterarCertificado } from '@/lib/fiscal/brasilnfe/empresa'

// Envia o certificado A1 (.pfx/.p12, em base64) pra Brasil NFe via API —
// necessário porque o cliente não tem acesso ao painel da Brasil NFe:
// tudo (cadastro, token, certificado) precisa passar pela nossa plataforma.
export async function POST(req: Request) {
  const { empresaId, base64Certificado, senha } = await req.json()
  if (!empresaId || !base64Certificado || !senha) {
    return NextResponse.json({ ok: false, erro: 'empresaId, base64Certificado e senha são obrigatórios' }, { status: 400 })
  }

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: config } = await sb.from('sistema_config_fiscal').select('brasilnfe_user_token').maybeSingle()
  if (!config?.brasilnfe_user_token) {
    return NextResponse.json({ ok: false, erro: 'UserToken da Brasil NFe não configurado (saas-admin → Fiscal).' }, { status: 400 })
  }

  const { data: nfeConfig } = await sb.from('nfe_config').select('provider, credenciais').eq('empresa_id', empresaId).maybeSingle()
  if (nfeConfig?.provider !== 'brasilnfe') {
    return NextResponse.json({ ok: false, erro: 'Esta empresa não está configurada com o provedor Brasil NFe.' }, { status: 400 })
  }
  const empresaToken = nfeConfig?.credenciais?.token_producao
  if (!empresaToken) {
    return NextResponse.json({ ok: false, erro: 'Empresa ainda não tem token da Brasil NFe — cadastre a empresa primeiro.' }, { status: 400 })
  }

  const resultado = await alterarCertificado(config.brasilnfe_user_token, empresaToken, base64Certificado, senha)
  if (!resultado.ok) return NextResponse.json({ ok: false, erro: resultado.erro }, { status: 400 })

  const { error: erroUpdate } = await sb.from('empresa_config_fiscal').upsert({
    empresa_id: empresaId,
    certificado_ref: 'Enviado via API (Brasil NFe)',
    certificado_validade: resultado.dtExpiracao ? resultado.dtExpiracao.slice(0, 10) : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'empresa_id' })
  if (erroUpdate) {
    return NextResponse.json({ ok: false, erro: `Certificado enviado, mas falhou ao salvar a validade: ${erroUpdate.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, expirado: resultado.expirado, dtExpiracao: resultado.dtExpiracao })
}
