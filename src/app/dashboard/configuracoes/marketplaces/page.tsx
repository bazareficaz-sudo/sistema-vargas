import SondaMlClient from '@/components/marketplaces/SondaMlClient'

export const dynamic = 'force-dynamic'

// DIAGNOSTICO DE MARKETPLACES.
//
// Criada em 02/09/2026 para dar casa a sonda do Mercado Livre. A rota
// `/api/precificacao/sondar-ml` existia desde 31/08 e a terceira rodada nunca
// aconteceu — mesmo motivo da tabela NCM ter ficado tres dias vazia: nao
// havia botao em tela nenhuma.
export default function ConfiguracoesMarketplacesPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-900">Marketplaces — diagnóstico</h1>
      <p className="mb-5 mt-1 text-sm text-gray-500">
        Mede o que a API de cada marketplace realmente responde, em vez de supor pela documentação.
      </p>

      <h2 className="mb-3 text-sm font-semibold text-gray-800">Sonda de campanhas do Mercado Livre</h2>
      <SondaMlClient />
    </div>
  )
}
