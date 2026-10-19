import SaudeVendaConfig from '@/components/configuracoes/SaudeVendaConfig'
import { carregarSaudeVenda } from '@/lib/saude-venda-dados'

export const dynamic = 'force-dynamic'

// A régua de venda. As taxas moram em /dashboard/financeiro/taxas, no menu
// Financeiro — mesma linha de `saude_config`, outra metade da tela.
export default async function SaudeVendaPage() {
  const { empresaId, config, faixas, role } = await carregarSaudeVenda()

  return (
    <SaudeVendaConfig
      empresaId={empresaId}
      configInicial={config}
      faixasIniciais={faixas}
      role={role}
      abas={['faixas', 'taxas']}
      subtitulo="Faixas de lucratividade, descontos e autorizações. As taxas de pagamento ficam em Financeiro → Taxas e Custos de Venda."
    />
  )
}
