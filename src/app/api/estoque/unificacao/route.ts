import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'
import { buscarConfigUnificacao } from '@/lib/produtos/estoqueUnificado'

// Configuração do estoque unificado entre empresas do grupo.
//
// Roda no servidor de propósito: somar estoque de OUTRA empresa lendo direto
// do navegador esbarraria na RLS e devolveria zero em silêncio — ou seja, um
// número errado com cara de certo, que é o pior resultado possível aqui.

export async function GET() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const config = await buscarConfigUnificacao(sb, guarda.empresaId)

  // Candidatas: empresas do MESMO tenant, exceto a própria. Mesmo limite das
  // Parcerias — nunca atravessa clientes diferentes da plataforma.
  const { data: minha } = await sb.from('empresas').select('tenant_id').eq('id', guarda.empresaId).maybeSingle()
  const { data: irmas } = minha?.tenant_id
    ? await sb.from('empresas').select('id, nome_fantasia, razao_social')
        .eq('tenant_id', minha.tenant_id).neq('id', guarda.empresaId).order('nome_fantasia')
    : { data: [] as any[] }

  const ids = [guarda.empresaId, ...(irmas ?? []).map((e: any) => e.id)]
  const { data: depositos } = await sb.from('depositos')
    .select('id, empresa_id, nome').in('empresa_id', ids).eq('ativo', true).order('nome')

  return NextResponse.json({
    ok: true,
    config,
    empresaId: guarda.empresaId,
    candidatas: (irmas ?? []).map((e: any) => ({
      id: e.id, nome: e.nome_fantasia ?? e.razao_social ?? 'Empresa',
    })),
    depositos: depositos ?? [],
  })
}

export async function POST(req: Request) {
  const { ativo, depositoProprioId, participantes } = await req.json().catch(() => ({}))

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  // Só empresas do mesmo tenant entram. Validado no servidor, não só escondido
  // na tela — a lista da tela não é barreira de segurança.
  const { data: minha } = await sb.from('empresas').select('tenant_id').eq('id', guarda.empresaId).maybeSingle()
  const { data: irmas } = minha?.tenant_id
    ? await sb.from('empresas').select('id').eq('tenant_id', minha.tenant_id).neq('id', guarda.empresaId)
    : { data: [] as any[] }
  const permitidas = new Set((irmas ?? []).map((e: any) => e.id))

  const linhas = (Array.isArray(participantes) ? participantes : [])
    .filter((p: any) => p?.empresaId && permitidas.has(p.empresaId))
    .map((p: any) => ({
      empresa_id: guarda.empresaId,
      participante_id: p.empresaId,
      deposito_id: p.depositoId || null,
      criado_por: guarda.userId,
      updated_at: new Date().toISOString(),
    }))

  const recusadas = (Array.isArray(participantes) ? participantes : [])
    .filter((p: any) => p?.empresaId && !permitidas.has(p.empresaId)).length

  await sb.from('empresa_config_estoque').upsert({
    empresa_id: guarda.empresaId,
    estoque_unificado_ativo: !!ativo,
    estoque_unificado_deposito_id: depositoProprioId || null,
  }, { onConflict: 'empresa_id' })

  // Troca o conjunto inteiro: participante removido na tela tem que sumir da
  // soma, e não sobrar como linha órfã.
  await sb.from('estoque_unificado_participantes').delete().eq('empresa_id', guarda.empresaId)
  if (linhas.length > 0) {
    const { error } = await sb.from('estoque_unificado_participantes').insert(linhas)
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })
  }

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId, usuarioNome: null,
    acao: 'estoque_unificado_atualizado', tabela: 'estoque_unificado_participantes',
    valorNovo: JSON.stringify({ ativo: !!ativo, participantes: linhas.length }),
  } as any)

  return NextResponse.json({ ok: true, participantes: linhas.length, recusadas })
}
