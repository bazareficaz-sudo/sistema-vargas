'use client'

import { useEffect } from 'react'
import { useEntrega } from './EntregaContexto'
import { real } from './ds'

// No carrinho: "Faltam R$ X para o frete grátis" com barra de progresso, e o
// gatilho que abre a janela de bairro quando o gestor escolheu "no carrinho".
//
// O limite é o do lugar escolhido, quando há; sem lugar, a promessa geral da
// loja (o menor limite entre as regras). Subtotal vem do servidor, já
// conferido — não do navegador.

export default function IncentivoFrete({ subtotal }: { subtotal: number }) {
  const { config, selecao, politica, pedirLocal } = useEntrega()

  useEffect(() => { pedirLocal('carrinho') }, [pedirLocal])

  if (!config.ativo || !config.incentivoGratis) return null

  const limite =
    selecao && politica?.status === 'opcoes' ? politica.opcoes[0].gratisAcima
    : selecao && politica ? null
    : config.gratisAcima
  if (limite == null || limite <= 0) return null

  const falta = Math.max(limite - subtotal, 0)
  const pct = Math.min(100, Math.round((subtotal / limite) * 100))

  return (
    <div className="mt-3 rounded-[10px] bg-[var(--fundo-suave)] p-3 text-sm" aria-live="polite">
      {falta > 0 ? (
        <p className="text-[var(--tinta-media)]">
          Faltam <strong className="text-[var(--tinta-forte)]">{real(falta)}</strong> para o <strong className="text-[var(--tinta-forte)]">frete grátis</strong>
          {selecao?.bairro ? ` em ${selecao.bairro}` : ''}.
        </p>
      ) : (
        <p className="font-semibold" style={{ color: 'var(--sucesso)' }}>
          Você ganhou frete grátis{selecao?.bairro ? ` em ${selecao.bairro}` : ''}!
        </p>
      )}
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--borda)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'var(--loja-primaria)' }} />
      </div>
    </div>
  )
}
