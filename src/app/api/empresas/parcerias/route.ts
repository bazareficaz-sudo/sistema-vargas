import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'

export async function GET() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })
  if (!guarda.tenantId) return NextResponse.json({ ok: true, parcerias: [] })

  const { data: parcerias } = await sb.from('empresa_parcerias')
    .select('id, empresa_id_a, empresa_id_b, status, created_at')
    .or(`empresa_id_a.eq.${guarda.empresaId},empresa_id_b.eq.${guarda.empresaId}`)
    .order('created_at', { ascending: false })

  const idsEmpresas = [...new Set((parcerias ?? []).flatMap(p => [p.empresa_id_a, p.empresa_id_b]))]
  const { data: empresas } = idsEmpresas.length > 0
    ? await sb.from('empresas').select('id, nome, nome_fantasia').in('id', idsEmpresas)
    : { data: [] as any[] }
  const nomePorId = new Map((empresas ?? []).map((e: any) => [e.id, e.nome_fantasia ?? e.nome]))

  const lista = (parcerias ?? []).map(p => {
    const parceiraId = p.empresa_id_a === guarda.empresaId ? p.empresa_id_b : p.empresa_id_a
    return {
      id: p.id, status: p.status, createdAt: p.created_at,
      empresaParceiraId: parceiraId, empresaParceiraNome: nomePorId.get(parceiraId) ?? '—',
    }
  })

  return NextResponse.json({ ok: true, parcerias: lista })
}

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })
  if (!guarda.tenantId) return NextResponse.json({ ok: false, erro: 'Empresa sem grupo (tenant) identificado' }, { status: 400 })

  const body = await req.json()
  const empresaParceiraId = String(body?.empresaParceiraId ?? '')
  if (!empresaParceiraId) return NextResponse.json({ ok: false, erro: 'empresaParceiraId ausente' }, { status: 400 })
  if (empresaParceiraId === guarda.empresaId) return NextResponse.json({ ok: false, erro: 'Não é possível criar parceria com a própria empresa' }, { status: 400 })

  // Nunca cruza tenant — a empresa parceira precisa pertencer ao mesmo
  // grupo/dono de quem está criando a parceria.
  const { data: parceira } = await sb.from('empresas').select('id, tenant_id').eq('id', empresaParceiraId).maybeSingle()
  if (!parceira || parceira.tenant_id !== guarda.tenantId) {
    return NextResponse.json({ ok: false, erro: 'Empresa parceira não encontrada no seu grupo' }, { status: 404 })
  }

  // Evita duplicidade nas duas ordens (A,B) e (B,A).
  const { data: existente } = await sb.from('empresa_parcerias')
    .select('id')
    .or(`and(empresa_id_a.eq.${guarda.empresaId},empresa_id_b.eq.${empresaParceiraId}),and(empresa_id_a.eq.${empresaParceiraId},empresa_id_b.eq.${guarda.empresaId})`)
    .maybeSingle()
  if (existente) return NextResponse.json({ ok: false, erro: 'Já existe uma parceria entre essas empresas' }, { status: 400 })

  const { data: nova, error } = await sb.from('empresa_parcerias').insert({
    tenant_id: guarda.tenantId, empresa_id_a: guarda.empresaId, empresa_id_b: empresaParceiraId,
    status: 'ativa', criado_por: guarda.userId,
  }).select('id').single()
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: 'parceria_criada', tabela: 'empresa_parcerias', valorNovo: { empresaParceiraId },
  })

  return NextResponse.json({ ok: true, id: nova.id })
}
