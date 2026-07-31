import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirPermissao, registrarAuditoria, permissoesDoPapel, type Papel, type PermissaoCodigo } from '@/lib/auth/permissoes'

// Lê e grava as exceções de permissão de um usuário.
//
// Só grava linha quando o valor DIFERE do padrão do papel — assim, trocar o
// papel da pessoa depois continua funcionando como esperado, e a tabela não
// vira uma cópia inteira da matriz para cada usuário.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_usuarios')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: alvo } = await sb.from('profiles').select('empresa_id, role, nome').eq('id', id).single()
  if (!alvo || alvo.empresa_id !== guarda.empresaId) {
    return NextResponse.json({ ok: false, erro: 'Usuário não encontrado' }, { status: 404 })
  }

  const { data: linhas } = await sb.from('usuario_permissoes')
    .select('codigo, permitido').eq('usuario_id', id)

  const excecoes: Record<string, boolean> = {}
  for (const l of linhas ?? []) excecoes[l.codigo] = l.permitido

  return NextResponse.json({
    ok: true,
    papel: alvo.role,
    padraoDoPapel: permissoesDoPapel(alvo.role as Papel),
    excecoes,
  })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { permissoes } = await req.json() as { permissoes: Record<string, boolean> }
  if (!permissoes || typeof permissoes !== 'object') {
    return NextResponse.json({ ok: false, erro: 'Lista de permissões ausente' }, { status: 400 })
  }

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_usuarios')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: alvo } = await sb.from('profiles').select('empresa_id, role').eq('id', id).single()
  if (!alvo || alvo.empresa_id !== guarda.empresaId) {
    return NextResponse.json({ ok: false, erro: 'Usuário não encontrado' }, { status: 404 })
  }

  // Trava contra se trancar fora: o admin não pode remover a própria
  // permissão de gerenciar usuários — ninguém mais poderia devolvê-la.
  if (id === guarda.userId && permissoes['gerenciar_usuarios'] === false) {
    return NextResponse.json({ ok: false, erro: 'Você não pode remover a sua própria permissão de gerenciar usuários.' }, { status: 400 })
  }

  const padrao = new Set(permissoesDoPapel(alvo.role as Papel))
  const admin = createAdminClient()

  const paraGravar: { empresa_id: string; usuario_id: string; codigo: string; permitido: boolean; atualizado_por: string; updated_at: string }[] = []
  const paraApagar: string[] = []

  for (const [codigo, permitido] of Object.entries(permissoes)) {
    const ehPadrao = padrao.has(codigo as PermissaoCodigo)
    if (permitido === ehPadrao) paraApagar.push(codigo)   // voltou ao padrão do papel
    else paraGravar.push({
      empresa_id: guarda.empresaId, usuario_id: id, codigo, permitido,
      atualizado_por: guarda.userId, updated_at: new Date().toISOString(),
    })
  }

  if (paraApagar.length > 0) {
    await admin.from('usuario_permissoes').delete().eq('usuario_id', id).in('codigo', paraApagar)
  }
  if (paraGravar.length > 0) {
    const { error } = await admin.from('usuario_permissoes').upsert(paraGravar, { onConflict: 'usuario_id,codigo' })
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })
  }

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: 'permissoes_alteradas', tabela: 'usuario_permissoes',
    valorNovo: { usuarioAlvo: id, excecoes: paraGravar.map(p => `${p.codigo}=${p.permitido}`) },
  })

  return NextResponse.json({ ok: true, excecoes: paraGravar.length })
}
