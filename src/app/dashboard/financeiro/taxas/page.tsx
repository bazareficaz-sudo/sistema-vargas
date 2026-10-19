import SaudeVendaConfig from '@/components/configuracoes/SaudeVendaConfig'
import { carregarSaudeVenda } from '@/lib/saude-venda-dados'

export const dynamic = 'force-dynamic'

// AS TAXAS, NO MENU ONDE SE PROCURA POR ELAS.
//
// A taxa da maquininha estava dentro de "Saúde da Venda", no menu Comercial.
// Quem precisa conferir quanto o cartão custa abre o Financeiro — e não
// achava, porque o nome da tela fala de venda, não de custo.
//
// É TELA PRÓPRIA, e não um atalho com `?aba=` para a outra, por causa do
// controle de acesso: `lib/auth/telas.ts` monta o catálogo de permissões a
// partir dos endereços do menu. Um endereço com query não casaria com nenhum
// pathname, e a tela ficaria impossível de bloquear em Usuários → Permissões.
// Como duas telas de verdade, cada uma se bloqueia por conta — dá para liberar
// a régua de desconto ao gerente de balcão e guardar as taxas no Financeiro.
export default async function TaxasFinanceiroPage() {
  const { empresaId, config, faixas, role } = await carregarSaudeVenda()

  return (
    <SaudeVendaConfig
      empresaId={empresaId}
      configInicial={config}
      faixasIniciais={faixas}
      role={role}
      abas={['taxas']}
      titulo="Taxas e Custos de Venda"
      subtitulo="Quanto cada forma de pagamento custa, e os custos que entram no cálculo da margem."
    />
  )
}
