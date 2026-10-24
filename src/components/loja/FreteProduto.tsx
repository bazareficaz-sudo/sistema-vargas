'use client'

import { useEffect, useState } from 'react'
import type { ResultadoFrete } from '@/lib/commerce/frete/calculo'
import { textoDaOpcao, type PoliticaDestino } from '@/lib/commerce/frete/politica'
import { useEntrega, type Selecao } from './EntregaContexto'
import { real } from './ds'

// Bloco "Entrega" da página do produto.
//
// Sem bairro escolhido: um botão que abre a janela. Com bairro: o frete REAL
// deste produto para aquele lugar (a conta do servidor, a mesma do checkout) e
// a promessa de frete grátis, se a loja tiver.

type Dados = {
  chave: string
  cotacao: ResultadoFrete | null
  politica: PoliticaDestino | null
  erro: string | null
}

export default function FreteProduto({ produtoId }: { produtoId: string }) {
  const { config, selecao, abrir } = useEntrega()
  const [dados, setDados] = useState<Dados | null>(null)

  const chave = selecao ? `${produtoId}|${selecao.bairro}|${selecao.cidade}|${selecao.cep}` : null

  useEffect(() => {
    if (!config.ativo || !config.mostrarNoProduto || !selecao || !chave) return
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const r = await fetch('/api/loja/entrega', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...selecao, produto: { produtoId, quantidade: 1 } }),
        })
        const d = await r.json().catch(() => ({})) as {
          ativo?: boolean; cotacao?: ResultadoFrete | null; politica?: PoliticaDestino; erro?: string
        }
        if (!r.ok || !d.ativo) {
          setDados({ chave, cotacao: null, politica: null, erro: d.erro ?? 'Não foi possível calcular agora.' })
          return
        }
        setDados({ chave, cotacao: d.cotacao ?? null, politica: d.politica ?? null, erro: null })
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setDados({ chave, cotacao: null, politica: null, erro: 'Sem conexão. Tente de novo.' })
        }
      }
    })()
    return () => ctrl.abort()
  }, [config.ativo, config.mostrarNoProduto, selecao, chave, produtoId])

  if (!config.ativo || !config.mostrarNoProduto) return null

  const atual = dados && dados.chave === chave ? dados : null

  return (
    <section aria-label="Entrega" className="rounded-[var(--raio)] border border-[var(--borda)] p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold text-[var(--tinta-forte)]">Entrega</h2>
        {selecao && (
          <button onClick={abrir} className="compacto text-xs font-semibold underline underline-offset-2" style={{ color: 'var(--loja-primaria)' }}>
            Trocar endereço
          </button>
        )}
      </div>

      {!selecao ? (
        <>
          <p className="mt-1 text-[var(--tinta-media)]">Veja o frete e o prazo para o seu bairro.</p>
          <button
            onClick={abrir}
            className="mt-3 h-10 rounded-[10px] border border-[var(--borda)] bg-white px-4 text-sm font-semibold text-[var(--tinta-forte)] hover:border-[var(--loja-primaria)]"
          >
            Calcular frete e prazo
          </button>
          {config.incentivoGratis && config.gratisAcima != null && (
            <p className="mt-2 text-xs text-[var(--tinta-media)]">
              Frete grátis em compras acima de {real(config.gratisAcima)}.
            </p>
          )}
        </>
      ) : !atual ? (
        <p className="mt-1 text-[var(--tinta-media)]" aria-live="polite">Calculando…</p>
      ) : (
        <div className="mt-1" aria-live="polite">
          {atual.erro && <p className="text-[var(--alerta)]">{atual.erro}</p>}
          <Resultado selecao={selecao} dados={atual} incentivo={config.incentivoGratis} />
        </div>
      )}
    </section>
  )
}

function Resultado({ selecao, dados, incentivo }: { selecao: Selecao; dados: Dados; incentivo: boolean }) {
  const onde = [selecao.bairro, selecao.cidade].filter(Boolean).join(', ')
  const c = dados.cotacao
  const p = dados.politica

  if (c?.status === 'opcoes') {
    const gratisAcima = p?.status === 'opcoes' ? p.opcoes[0].gratisAcima : null
    return (
      <>
        <p className="text-xs text-[var(--tinta-media)]">Para {onde}</p>
        <ul className="mt-1 space-y-1">
          {c.opcoes.map(o => (
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
        {incentivo && gratisAcima != null && c.opcoes[0].valor > 0 && (
          <p className="mt-2 text-xs text-[var(--tinta-media)]">
            Frete grátis em compras acima de {real(gratisAcima)}.
          </p>
        )}
      </>
    )
  }

  // Um item sozinho abaixo do pedido mínimo não "não entrega": o cliente vai
  // somar outros itens. Mostra a política do bairro em vez de um bloqueio.
  if (c?.status === 'indisponivel' && !c.itensSomenteRetirada && p?.status === 'opcoes') {
    return (
      <>
        <p className="text-xs text-[var(--tinta-media)]">Para {onde}</p>
        <p className="mt-1 text-[var(--tinta-media)]">{textoDaOpcao(p.opcoes[0])}</p>
      </>
    )
  }

  if (c) {
    return <p className="text-[var(--tinta-media)]">{c.motivo}</p>
  }

  // Produto sem cotação própria (não achado): cai para a política do lugar.
  if (p?.status === 'opcoes') {
    return <p className="text-[var(--tinta-media)]">{textoDaOpcao(p.opcoes[0])}</p>
  }
  if (p) return <p className="text-[var(--tinta-media)]">{p.motivo}</p>
  return null
}
