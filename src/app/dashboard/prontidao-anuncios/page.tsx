import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import ProntidaoClient from '@/components/prontidao/ProntidaoClient'
import type { ProdutoProntidao } from '@/lib/anuncios/prontidao'

export const dynamic = 'force-dynamic'

export default async function ProntidaoAnunciosPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const profile = await perfilDaSessao(sb, user!.id)
  const empresaId = profile?.empresa_id ?? ''
  const { data, error } = await sb.rpc('prontidao_produtos', { p_empresa: empresaId })
  if (error) {
    return <div className="p-8 text-sm text-red-600">Não foi possível carregar os produtos: {error.message}</div>
  }
  const produtos: ProdutoProntidao[] = ((data ?? []) as any[]).map(p => ({
    ...p,
    estoque: Number(p.estoque ?? 0),
    preco_venda: p.preco_venda != null ? Number(p.preco_venda) : null,
    preco_custo: p.preco_custo != null ? Number(p.preco_custo) : null,
    peso_kg: p.peso_kg != null ? Number(p.peso_kg) : null,
    comprimento_cm: p.comprimento_cm != null ? Number(p.comprimento_cm) : null,
    largura_cm: p.largura_cm != null ? Number(p.largura_cm) : null,
    altura_cm: p.altura_cm != null ? Number(p.altura_cm) : null,
    fotos: Number(p.fotos ?? 0),
    plataformas: p.plataformas ?? [],
  }))
  return <ProntidaoClient produtosIniciais={produtos} />
}
