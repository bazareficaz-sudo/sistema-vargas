'use client'

import { useEffect, useState } from 'react'
import { real } from './ds'
import type { ResultadoFrete } from '@/lib/commerce/frete/calculo'

// Consulta de frete por CEP, dentro do carrinho.
//
// É uma ESTIMATIVA: o valor que vale é o do checkout, que o servidor recalcula
// ao fechar o pedido. Mesmo assim usa a mesma rota do checkout — duas contas
// diferentes nesta tela e naquela seriam duas chances de o cliente ver um
// número aqui e outro lá.
//
// A cotação guarda a chave (CEP + itens) para a qual foi feita e só aparece
// enquanto ela bate com o carrinho atual. Mudou a quantidade, a cotação antiga
// some e uma nova é pedida sozinha: mostrar frete de um carrinho que já não
// existe é pior que não mostrar.

type Cotacao = {
  chave: string
  resultado: ResultadoFrete | null
  local: string | null
  erro: string | null
}

const soDigitos = (v: string) => v.replace(/\D/g, '')
const mascara = (v: string) => {
  const d = soDigitos(v).slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

export default function CotacaoFreteCarrinho({ itens, subtotal }: {
  itens: { produtoId: string; quantidade: number }[]
  subtotal: number
}) {
  const [campo, setCampo] = useState('')
  const [cepPedido, setCepPedido] = useState<string | null>(null)
  const [cotacao, setCotacao] = useState<Cotacao | null>(null)

  // String, e não o array: o pai cria um array novo a cada render, e como
  // dependência do efeito isso cancelaria a consulta em andamento à toa.
  const assinatura = itens.map(i => `${i.produtoId}:${i.quantidade}`).join(',')
  const chave = cepPedido ? `${cepPedido}|${assinatura}` : null
  const atual = chave && cotacao?.chave === chave ? cotacao : null
  const carregando = !!chave && !atual

  useEffect(() => {
    if (!chave || !cepPedido || cotacao?.chave === chave || !assinatura) return

    const ctrl = new AbortController()
    ;(async () => {
      try {
        const r = await fetch('/api/loja/frete', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cep: cepPedido,
            itens: assinatura.split(',').map(p => {
              const [produtoId, q] = p.split(':')
              return { produtoId, quantidade: Number(q) }
            }),
          }),
        })
        const d = await r.json().catch(() => ({}))

        if (!r.ok || !d.ativo) {
          setCotacao({
            chave, resultado: null, local: null,
            erro: d.erro ?? 'Não foi possível calcular a entrega agora.',
          })
          return
        }
        const e = d.endereco as { bairro: string; cidade: string; uf: string }
        setCotacao({
          chave, resultado: d.resultado as ResultadoFrete, erro: null,
          local: [e.bairro, [e.cidade, e.uf].filter(Boolean).join('/')].filter(Boolean).join(' · '),
        })
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setCotacao({ chave, resultado: null, local: null, erro: 'Sem conexão. Tente de novo.' })
        }
      }
    })()

    return () => ctrl.abort()
  }, [chave, cepPedido, assinatura, cotacao?.chave])

  function calcular(e: React.FormEvent) {
    e.preventDefault()
    const d = soDigitos(campo)
    if (d.length === 8) setCepPedido(d)
  }

  const r = atual?.resultado ?? null
  const maisBarata = r?.status === 'opcoes' ? r.opcoes[0].valor : null

  return (
    <div className="mt-4 border-t border-[var(--borda)] pt-4">
      <form onSubmit={calcular}>
        <label htmlFor="cep-frete" className="block text-sm font-semibold text-[var(--tinta-forte)]">
          Calcular entrega
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="cep-frete" inputMode="numeric" autoComplete="postal-code"
            placeholder="Seu CEP" value={campo}
            onChange={e => setCampo(mascara(e.target.value))}
            className="h-10 min-w-0 flex-1 rounded-[10px] border border-[var(--borda)] px-3 text-sm outline-none focus:border-[var(--loja-primaria)]"
          />
          <button
            type="submit" disabled={soDigitos(campo).length !== 8 || carregando}
            className="h-10 shrink-0 rounded-[10px] border border-[var(--borda)] bg-white px-4 text-sm font-semibold text-[var(--tinta-forte)] disabled:opacity-40"
          >
            Calcular
          </button>
        </div>
      </form>

      <div className="mt-3 text-sm" aria-live="polite">
        {carregando && <p className="text-[var(--tinta-media)]">Calculando…</p>}

        {atual?.erro && <p className="text-[var(--alerta)]">{atual.erro}</p>}

        {atual && r?.status === 'opcoes' && (
          <>
            {atual.local && <p className="text-xs text-[var(--tinta-media)]">{atual.local}</p>}
            <ul className="mt-1 space-y-1">
              {r.opcoes.map(o => (
                <li key={o.servico} className="flex justify-between gap-3">
                  <span>
                    {o.servico}
                    {o.prazo && <span className="block text-xs text-[var(--tinta-media)]">{o.prazo}</span>}
                  </span>
                  <span className="shrink-0 font-semibold">
                    {o.valor > 0 ? real(o.valor) : <span style={{ color: 'var(--sucesso)' }}>Grátis</span>}
                  </span>
                </li>
              ))}
            </ul>
            {maisBarata != null && (
              <div className="mt-3 flex justify-between border-t border-[var(--borda)] pt-3">
                <span className="font-semibold">
                  Total com entrega{r.opcoes.length > 1 ? ' (a partir de)' : ''}
                </span>
                <span className="font-bold">{real(subtotal + maisBarata)}</span>
              </div>
            )}
          </>
        )}

        {atual && r?.status === 'combinar' && (
          <p className="text-[var(--tinta-media)]">
            {r.motivo} A loja combina o valor com você pelo WhatsApp.
          </p>
        )}

        {atual && r?.status === 'indisponivel' && (
          <div>
            <p className="font-medium text-[var(--alerta)]">{r.motivo}</p>
            {r.itensSomenteRetirada && (
              <ul className="mt-1 list-disc pl-4 text-xs text-[var(--tinta-media)]">
                {r.itensSomenteRetirada.map(n => <li key={n}>{n}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
