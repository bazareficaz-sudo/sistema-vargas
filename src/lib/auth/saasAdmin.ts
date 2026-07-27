// Guarda de servidor pra rotas do painel da plataforma (/api/saas-admin/*,
// /api/suporte/*) — mesma checagem já usada em src/app/saas-admin/layout.tsx
// (system_admins.ativo = true), extraída pra reaproveitar fora de páginas.

export type ResultadoSystemAdmin =
  | { ok: true; adminId: string; nivel: string }
  | { ok: false; status: 401 | 403; erro: string }

export async function exigirSystemAdmin(supabase: any): Promise<ResultadoSystemAdmin> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, erro: 'Não autenticado' }

  const { data: admin } = await supabase
    .from('system_admins')
    .select('nivel')
    .eq('id', user.id)
    .eq('ativo', true)
    .single()

  if (!admin) return { ok: false, status: 403, erro: 'Acesso restrito à administração da plataforma' }

  return { ok: true, adminId: user.id, nivel: admin.nivel }
}
