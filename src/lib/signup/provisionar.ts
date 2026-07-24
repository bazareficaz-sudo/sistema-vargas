import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export type PendingSignup = {
  nome: string
  telefone: string
  cnpj: string
  razaoSocial: string
  nomeFantasia: string
  endereco: {
    cep: string; logradouro: string; numero: string
    bairro: string; municipio: string; uf: string
  }
  planoCodigo: string
}

// Cria empresa + depósito principal + profile (admin) + subscription (trial)
// a partir dos dados de cadastro deixados em user_metadata.pending_signup no
// momento do signUp. Idempotente: se o usuário já tem profile, não faz nada.
export async function provisionarEmpresaEUsuario(
  admin: Admin, userId: string, metadata: Record<string, any> | undefined
): Promise<{ ok: true; empresaId?: string; jaExistia?: boolean } | { ok: false; error: string }> {
  const { data: profileExistente } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle()
  if (profileExistente) return { ok: true, jaExistia: true }

  const pending = metadata?.pending_signup as PendingSignup | undefined
  if (!pending) return { ok: false, error: 'Nenhum cadastro pendente encontrado para este usuário.' }

  const cnpjLimpo = (pending.cnpj || '').replace(/\D/g, '')
  if (cnpjLimpo) {
    const { data: empresaExistente } = await admin.from('empresas').select('id').eq('cnpj', cnpjLimpo).maybeSingle()
    if (empresaExistente) return { ok: false, error: 'Este CNPJ já está cadastrado. Fale com a gente para recuperar o acesso.' }
  }

  const { data: planoEscolhido } = await admin.from('plans')
    .select('id, dias_trial, exige_pagamento_inicial').eq('codigo', pending.planoCodigo).eq('publico', true).eq('ativo', true).maybeSingle()
  const plano = planoEscolhido ?? (
    await admin.from('plans').select('id, dias_trial, exige_pagamento_inicial').eq('publico', true).eq('ativo', true).order('ordem').limit(1).maybeSingle()
  ).data
  if (!plano) return { ok: false, error: 'Nenhum plano disponível no momento. Fale com a gente.' }

  const endereco = pending.endereco ?? {} as PendingSignup['endereco']
  const { data: empresa, error: erroEmpresa } = await admin.from('empresas').insert({
    nome: pending.nomeFantasia || pending.razaoSocial || pending.nome,
    razao_social: pending.razaoSocial || null,
    nome_fantasia: pending.nomeFantasia || null,
    cnpj: cnpjLimpo || null,
    cep: endereco.cep || null,
    logradouro: endereco.logradouro || null,
    numero: endereco.numero || null,
    bairro: endereco.bairro || null,
    cidade: endereco.municipio || null,
    uf: endereco.uf || null,
    status: 'em_implantacao',
  }).select('id').single()
  if (erroEmpresa || !empresa) return { ok: false, error: 'Erro ao criar empresa: ' + (erroEmpresa?.message ?? 'desconhecido') }

  await admin.from('depositos').insert({
    empresa_id: empresa.id, nome: 'Depósito Principal', principal: true, ativo: true,
  })

  const { error: erroProfile } = await admin.from('profiles').insert({
    id: userId, empresa_id: empresa.id, role: 'admin', nome: pending.nome,
  })
  if (erroProfile) return { ok: false, error: 'Erro ao criar perfil: ' + erroProfile.message }

  // Planos que exigem pagamento inicial (ex.: dependem de um provedor
  // externo pago por CNPJ, como a Brasil NFe) não ganham trial — a
  // assinatura fica 'pending' até o pagamento ser confirmado via webhook
  // do Mercado Pago (ver src/app/api/webhooks/mercadopago/route.ts).
  const hoje = new Date()
  const subscriptionData: Record<string, any> = { empresa_id: empresa.id, plan_id: plano.id }
  if (plano.exige_pagamento_inicial) {
    subscriptionData.status = 'pending'
  } else {
    const trialFim = new Date(hoje)
    trialFim.setDate(trialFim.getDate() + (plano.dias_trial ?? 14))
    subscriptionData.status = 'trial'
    subscriptionData.trial_inicio = hoje.toISOString().slice(0, 10)
    subscriptionData.trial_fim = trialFim.toISOString().slice(0, 10)
  }

  const { error: erroSub } = await admin.from('subscriptions').insert(subscriptionData)
  if (erroSub) return { ok: false, error: 'Erro ao criar assinatura: ' + erroSub.message }

  return { ok: true, empresaId: empresa.id }
}
