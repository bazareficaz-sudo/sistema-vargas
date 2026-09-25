import { createAdminClient } from '@/lib/supabase/admin'
import { erroJson, registrarUso, validarTokenMarketing } from '@/lib/integracoes/marketing/token'

export const dynamic = 'force-dynamic'

// GET /api/integracoes/marketing/v1/empresa — identifica a empresa do token,
// para o Marketing confirmar a conexão. Só nome e cidade.
export async function GET(req: Request) {
  const auth = await validarTokenMarketing(req)
  if (!auth.ok) return erroJson(auth.code, auth.erro, auth.status)
  const { data, error } = await createAdminClient().from('empresas')
    .select('id, nome_fantasia, nome, cidade, estado, uf').eq('id', auth.ctx.empresaId).single()
  if (error) return erroJson('internal', 'Falha ao ler a empresa.', 500, true)
  await registrarUso(auth.ctx.tokenId)
  return Response.json({ source_business_id: data.id, name: data.nome_fantasia || data.nome, city: data.cidade, state: data.uf || data.estado })
}
