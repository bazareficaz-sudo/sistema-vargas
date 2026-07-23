import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cadastrarEmpresa } from '@/lib/fiscal/brasilnfe/empresa'

// Cadastra a empresa na Brasil NFe (POST /services/empresa/AdicionarEmpresa)
// usando o UserToken de plataforma (sistema_config_fiscal) e grava o token
// devolvido em nfe_config.credenciais — chamado automaticamente ao criar
// uma empresa nova com provider 'brasilnfe' (NovaEmpresaWizard.tsx) ou
// manualmente pelo admin (saas-admin/fiscal) pra empresas já existentes.
export async function POST(req: Request) {
  const { empresaId } = await req.json()
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'empresaId ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: config } = await sb.from('sistema_config_fiscal').select('brasilnfe_user_token').maybeSingle()
  if (!config?.brasilnfe_user_token) {
    return NextResponse.json({ ok: false, erro: 'UserToken da Brasil NFe não configurado (saas-admin → Fiscal).' }, { status: 400 })
  }

  const { data: empresa } = await sb.from('empresas')
    .select('cnpj, razao_social, nome_fantasia, nome, inscricao_estadual, inscricao_municipal, regime_tributario, cnae, site, cep, logradouro, numero, complemento, bairro, ibge, cidade, uf, telefone, email')
    .eq('id', empresaId).single()
  if (!empresa) return NextResponse.json({ ok: false, erro: 'Empresa não encontrada' }, { status: 404 })
  if (!empresa.cnpj) return NextResponse.json({ ok: false, erro: 'CNPJ da empresa não preenchido — obrigatório pra cadastrar na Brasil NFe.' }, { status: 400 })

  const resultado = await cadastrarEmpresa(config.brasilnfe_user_token, {
    cnpj: empresa.cnpj,
    razaoSocial: empresa.razao_social || empresa.nome_fantasia || empresa.nome,
    nomeFantasia: empresa.nome_fantasia || empresa.nome,
    inscricaoEstadual: empresa.inscricao_estadual,
    inscricaoMunicipal: empresa.inscricao_municipal,
    regimeTributario: empresa.regime_tributario ?? 'simples_nacional',
    cnae: empresa.cnae,
    site: empresa.site,
    endereco: {
      cep: empresa.cep, logradouro: empresa.logradouro, numero: empresa.numero,
      complemento: empresa.complemento, bairro: empresa.bairro,
      codMunicipio: empresa.ibge, municipio: empresa.cidade, uf: empresa.uf,
    },
    telefone: empresa.telefone,
    email: empresa.email,
  })

  if (!resultado.ok) return NextResponse.json({ ok: false, erro: resultado.erro }, { status: 400 })

  const { error: erroUpdate } = await sb.from('nfe_config').upsert({
    empresa_id: empresaId,
    provider: 'brasilnfe',
    credenciais: { token_producao: resultado.token, token_homologacao: resultado.token },
    focusnfe_token: resultado.token,
    ativo: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'empresa_id' })
  if (erroUpdate) return NextResponse.json({ ok: false, erro: `Empresa cadastrada na Brasil NFe, mas falhou ao salvar o token: ${erroUpdate.message}` }, { status: 500 })

  return NextResponse.json({ ok: true, token: resultado.token })
}
