import GtinShopeeClient from '@/components/gtin/GtinShopeeClient'

export const dynamic = 'force-dynamic'

// GTIN DOS ANÚNCIOS DA SHOPEE: a varredura roda pela tela (leva alguns
// segundos), e cada correção é confirmada pela pessoa.
export default function GtinShopeePage() {
  return <GtinShopeeClient />
}
