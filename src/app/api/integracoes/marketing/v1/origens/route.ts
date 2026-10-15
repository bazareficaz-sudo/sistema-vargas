import { createAdminClient } from '@/lib/supabase/admin'
import { erroJson, registrarUso, validarTokenMarketing } from '@/lib/integracoes/marketing/token'
import { FUSO_VENDAS, inicioDoDiaLocal } from '@/lib/integracoes/marketing/vendas'

export const dynamic = 'force-dynamic'

// GET /api/integracoes/marketing/v1/origens?desde=AAAA-MM-DD&ate=AAAA-MM-DD
//
// Origem do contato: por código de publicação do Vargas Marketing, quantas
// conversas começaram no período (dia em que o código chegou, fuso de São
// Paulo), quantas receberam orçamento e quantas compraram. Só números — nada
// de cliente, telefone ou mensagem. Somente leitura (marketing_origens).

const MAX_DIAS = 92
const DIA = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  const auth = await validarTokenMarketing(req)
  if (!auth.ok) return erroJson(auth.code, auth.erro, auth.status)
  const url = new URL(req.url)
  const desde = url.searchParams.get('desde') ?? '', ate = url.searchParams.get('ate') ?? ''
  if (!DIA.test(desde) || !DIA.test(ate) || desde > ate) return erroJson('invalid_range', 'Informe "desde" e "ate" no formato AAAA-MM-DD.', 400)
  const inicio = inicioDoDiaLocal(desde)
  const fim = new Date(new Date(inicioDoDiaLocal(ate)).getTime() + 86_400_000).toISOString()
  if (Number.isNaN(Date.parse(inicio)) || Number.isNaN(Date.parse(fim))) return erroJson('invalid_range', 'Datas inválidas.', 400)
  if (Date.parse(fim) - Date.parse(inicio) > MAX_DIAS * 86_400_000) return erroJson('range_too_large', `Intervalo máximo de ${MAX_DIAS} dias.`, 400)

  const { data, error } = await createAdminClient().rpc('marketing_origens', { p_empresa: auth.ctx.empresaId, p_inicio: inicio, p_fim: fim })
  if (error) return erroJson('internal', 'Falha ao ler a origem dos contatos.', 500, true)

  await registrarUso(auth.ctx.tokenId)
  return Response.json({
    origins: ((data ?? []) as { codigo: string; conversas: number; orcamentos: number; compras: number }[]).map(o => ({
      code: o.codigo, conversations: Number(o.conversas), quotes: Number(o.orcamentos), purchases: Number(o.compras),
    })),
    window: { from: desde, to: ate, timezone: FUSO_VENDAS },
    generated_at: new Date().toISOString(),
  })
}
