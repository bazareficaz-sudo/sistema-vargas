import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { revalidatePath, revalidateTag } from 'next/cache'

// Ponte entre o painel do ERP e a Loja Online.
//
// Diferente de src/lib/commerce/db.ts, aqui a sessão é de um usuário real e
// a RLS vale — as políticas `*_do_grupo` só devolvem as linhas da empresa
// ativa. É a mesma resolução de empresa que o resto do painel usa
// (`perfilDaSessao`), então trocar de empresa no seletor troca de loja
// sozinho, sem nenhum código a mais.

export type ContextoAdmin = {
  sb: any
  userId: string
  empresaId: string
  lojaId: string | null
}

/**
 * Contexto do painel. `lojaId` nulo significa que a empresa ativa ainda não
 * tem loja — a tela mostra o convite para criar, em vez de quebrar.
 */
export async function contextoAdmin(): Promise<ContextoAdmin | null> {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null

  const perfil = await perfilDaSessao(sb, user.id)
  const empresaId = perfil?.empresa_id ?? null
  if (!empresaId) return null

  const { data } = await sb.from('loja_config').select('id').eq('empresa_id', empresaId).maybeSingle()

  return { sb, userId: user.id, empresaId, lojaId: data?.id ?? null }
}

/**
 * Confere que a loja pertence à empresa ativa ANTES de qualquer escrita.
 *
 * A RLS já barraria, mas confiar só nela numa rota de escrita significa que
 * o erro aparece como "0 linhas afetadas" — que é indistinguível de sucesso.
 * Aqui a recusa é explícita.
 */
export async function lojaDaSessao(ctx: ContextoAdmin, lojaId: string): Promise<boolean> {
  const { data } = await ctx.sb
    .from('loja_config').select('id')
    .eq('id', lojaId).eq('empresa_id', ctx.empresaId).maybeSingle()
  return !!data
}

/**
 * Invalida o cache da vitrine depois de o painel salvar.
 *
 * Sem isto, o lojista muda a cor ou publica um produto e não vê diferença
 * por até 5 minutos — e conclui que o sistema não salvou.
 */
export function invalidarVitrine(lojaId: string): void {
  // Next 16: `revalidateTag(tag)` com um argumento só está DEPRECIADO. O
  // segundo parâmetro é o perfil, e 'max' dá semântica stale-while-revalidate
  // — o visitante que chegar no instante da invalidação recebe a versão
  // antiga na hora, em vez de esperar a nova ser gerada.
  revalidateTag('loja-config', 'max')
  revalidateTag(`loja:${lojaId}`, 'max')
  revalidateTag(`loja:${lojaId}:categorias`, 'max')
  // A home e as listagens são ISR por segmento; a tag não as alcança.
  revalidatePath('/loja', 'layout')
}
