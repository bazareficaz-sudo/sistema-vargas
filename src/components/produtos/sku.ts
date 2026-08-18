import { createClient } from '@/lib/supabase/client'

// Próximo SKU sequencial: maior SKU puramente numérico já cadastrado + 1.
// SKUs não-numéricos (ou vazios) são ignorados no cálculo.
//
// Resolve no banco (supabase-proximo-sku.sql). A versão anterior lia a
// tabela com .limit(50000) e calculava o máximo na aplicação — mas o
// PostgREST corta em 1000 linhas e `.limit()` do cliente não levanta esse
// teto. Numa empresa com 14 mil produtos, o máximo saía de 1000 linhas
// arbitrárias e vinha errado SEMPRE o mesmo número, criando produtos
// diferentes com o mesmo SKU (medido: 3 produtos com SKU 25618).
//
// O fallback paginado existe pro caso da função ainda não estar no banco
// — é lento (uma requisição a cada 1000 produtos), mas correto.
export async function gerarProximoSku(sb: ReturnType<typeof createClient>, empresaId: string): Promise<string> {
  const { data, error } = await sb.rpc('proximo_sku_numerico', { p_empresa_id: empresaId })
  if (!error && data) return String(data)

  let maior = 0
  for (let offset = 0; ; offset += 1000) {
    const { data: pagina } = await sb
      .from('produtos')
      .select('sku')
      .eq('empresa_id', empresaId)
      .not('sku', 'is', null)
      .order('id')
      .range(offset, offset + 999)
    if (!pagina || pagina.length === 0) break
    for (const row of pagina) {
      const valor = row.sku as string | null
      if (valor && /^\d+$/.test(valor)) {
        const n = parseInt(valor, 10)
        if (n > maior) maior = n
      }
    }
    if (pagina.length < 1000) break
  }
  return String(maior + 1)
}
