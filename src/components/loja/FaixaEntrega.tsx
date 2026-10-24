'use client'

import { textoDaOpcao } from '@/lib/commerce/frete/politica'
import { useEntrega } from './EntregaContexto'

// Faixa fina no topo: "Entregar em: Bairro X · frete R$ 8,00 · Trocar".
// Some quando o gestor desliga em Frete → Experiência do cliente.

export default function FaixaEntrega() {
  const { config, selecao, politica, abrir } = useEntrega()
  if (!config.ativo || !config.faixaTopo) return null

  const onde = selecao ? [selecao.bairro, selecao.cidade].filter(Boolean).join(', ') || selecao.cep : null
  const resumo =
    politica?.status === 'opcoes' ? textoDaOpcao(politica.opcoes[0])
    : politica ? politica.motivo
    : null

  return (
    <div className="border-b border-[var(--borda)] bg-[var(--fundo-suave)] text-[0.8125rem] text-[var(--tinta-media)]">
      <div className="loja-container flex min-h-9 flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
        {onde ? (
          <>
            <span>
              Entregar em <strong className="font-semibold text-[var(--tinta-forte)]">{onde}</strong>
            </span>
            {resumo && <span className="hidden sm:inline">· {resumo}</span>}
            <button onClick={abrir} className="compacto font-semibold underline underline-offset-2" style={{ color: 'var(--loja-primaria)' }}>
              Trocar
            </button>
          </>
        ) : (
          <button onClick={abrir} className="compacto font-medium text-[var(--tinta-forte)] hover:underline">
            📍 Informe seu bairro e veja o frete e o prazo de entrega
          </button>
        )}
      </div>
    </div>
  )
}
