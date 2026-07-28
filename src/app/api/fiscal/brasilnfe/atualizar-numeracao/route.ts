import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { atualizarNumeracao } from '@/lib/fiscal/brasilnfe/empresa'

// Alinha o contador de NF-e/NFC-e na Brasil NFe com o que a empresa já
// vinha usando num emissor anterior (mesmo raciocínio de enviar-certificado:
// o cliente não tem acesso ao painel da Brasil NFe, então tudo passa por
// aqui). `numero` deve ser o PRÓXIMO número a emitir, não o último já usado.
export async function POST(req: Request) {
  const { empresaId, modeloDocumento, serie, numero, ambiente } = await req.json()
  if (!empresaId || !modeloDocumento || !serie || !numero || !ambiente) {
    return NextResponse.json({ ok: false, erro: 'empresaId, modeloDocumento, serie, numero e ambiente são obrigatórios' }, { status: 400 })
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
  const empresaToken = nfeConfig?.credenciais?.token_producao || nfeConfig?.credenciais?.token_homologacao
  if (!empresaToken) {
    return NextResponse.json({ ok: false, erro: 'Empresa ainda não tem token da Brasil NFe — cadastre a empresa primeiro.' }, { status: 400 })
  }

  const resultado = await atualizarNumeracao(config.brasilnfe_user_token, empresaToken, {
    ambiente: ambiente === 'homologacao' ? 'homologacao' : 'producao',
    modeloDocumento: Number(modeloDocumento),
    serie: String(serie),
    numero: Number(numero),
  })
  if (!resultado.ok) return NextResponse.json({ ok: false, erro: resultado.erro }, { status: 400 })

  // Espelha localmente pra manter o formulário em sincronia com o que
  // ficou configurado de verdade do lado da Brasil NFe.
  const campoSerie = Number(modeloDocumento) === 65 ? 'serie_nfce' : 'serie_nfe'
  const campoNumero = Number(modeloDocumento) === 65 ? 'proximo_nfce' : 'proximo_nfe'
  await sb.from('empresa_config_fiscal').update({
    [campoSerie]: Number(serie),
    [campoNumero]: Number(numero),
    updated_at: new Date().toISOString(),
  }).eq('empresa_id', empresaId)

  return NextResponse.json({ ok: true })
}
