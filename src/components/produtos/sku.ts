import { createClient } from '@/lib/supabase/client'

// Próximo SKU sequencial: maior SKU puramente numérico já cadastrado + 1.
// SKUs não-numéricos (ou vazios) são ignorados no cálculo.
export async function gerarProximoSku(sb: ReturnType<typeof createClient>, empresaId: string): Promise<string> {
  const { data } = await sb
    .from('produtos')
    .select('sku')
    .eq('empresa_id', empresaId)
    .not('sku', 'is', null)
    .limit(50000)

  let maior = 0
  for (const row of data ?? []) {
    const valor = row.sku as string | null
    if (valor && /^\d+$/.test(valor)) {
      const n = parseInt(valor, 10)
      if (n > maior) maior = n
    }
  }
  return String(maior + 1)
}
