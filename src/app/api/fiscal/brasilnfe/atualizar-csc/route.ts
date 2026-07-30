import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { atualizarCscNfce } from '@/lib/fiscal/brasilnfe/empresa'

// Envia o CSC/idCSC da NFC-e (emitidos pela SEFAZ, por CNPJ e por ambiente)
// para o cadastro da empresa na Brasil NFe. Sem isso, toda NFC-e é rejeitada
// com "Codigo identificador do CSC no QR-Code nao cadastrado na SEFAZ".
// Mesmo padrão de enviar-certificado/atualizar-numeracao: o cliente não tem
// acesso ao painel da Brasil NFe, então tudo passa por aqui.
export async function POST(req: Request) {
  const { empresaId, ambiente } = await req.json()
  if (!empresaId || !ambiente) {
    return NextResponse.json({ ok: false, erro: 'empresaId e ambiente são obrigatórios' }, { status: 400 })
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

  // O CSC vem do que já está salvo em Empresas → Fiscal, pra não existirem
  // dois lugares com o mesmo dado divergindo.
  const { data: cf } = await sb.from('empresa_config_fiscal').select('csc_nfce, id_csc_nfce').eq('empresa_id', empresaId).maybeSingle()
  if (!cf?.csc_nfce || !cf?.id_csc_nfce) {
    return NextResponse.json({ ok: false, erro: 'Preencha o CSC e o ID do CSC na aba Fiscal desta empresa antes de enviar.' }, { status: 400 })
  }

  const resultado = await atualizarCscNfce(config.brasilnfe_user_token, empresaToken, {
    ambiente: ambiente === 'homologacao' ? 'homologacao' : 'producao',
    idCsc: String(cf.id_csc_nfce),
    csc: String(cf.csc_nfce),
  })
  if (!resultado.ok) return NextResponse.json({ ok: false, erro: resultado.erro }, { status: 400 })

  return NextResponse.json({ ok: true })
}
