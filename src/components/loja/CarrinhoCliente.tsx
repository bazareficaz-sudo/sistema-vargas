'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useCarrinho } from './CarrinhoContexto'
import { EstadoVazio, ImagemProduto, classesBotao, estiloPrimario, real } from './ds'
import type { ItemCarrinhoConferido } from '@/lib/commerce/tipos'

// Carrinho.
//
// O que está na tela NUNCA é o que veio do localStorage: é o que o servidor
// confirmou. A cada mudança de quantidade a lista é reconferida — preço,
// saldo e existência do produto.
//
// Os avisos ("o preço mudou", "ajustamos a quantidade") são o ponto principal
// desta tela. Trocar o valor em silêncio é o que faz o cliente descobrir a
// diferença no fim do checkout — e desistir ali.

type Conferido = {
  itens: ItemCarrinhoConferido[]
  subtotal: number
  quantidadeTotal: number
  removidos: string[]
  temAviso: boolean
}

export default function CarrinhoCliente({
  permiteSemEstoque, entregaAtiva, retiradaAtiva, whatsapp, nomeLoja,
}: {
  permiteSemEstoque: boolean
  entregaAtiva: boolean
  retiradaAtiva: boolean
  whatsapp: string | null
  nomeLoja: string
}) {
  const { itens, carregado, alterar, remover } = useCarrinho()
  const [dados, setDados] = useState<Conferido | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const conferir = useCallback(async () => {
    if (itens.length === 0) { setDados(null); setCarregando(false); return }
    setCarregando(true)
    setErro(null)
    try {
      const r = await fetch('/api/loja/conferir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itens }),
      })
      if (!r.ok) throw new Error('falhou')
      setDados(await r.json())
    } catch {
      // Mostrar erro e manter o carrinho, em vez de esvaziar a tela: o
      // cliente não perde o que montou por causa de uma falha de rede.
      setErro('Não foi possível confirmar preços e disponibilidade agora.')
    } finally {
      setCarregando(false)
    }
  }, [itens])

  useEffect(() => { if (carregado) conferir() }, [carregado, conferir])

  if (!carregado || (carregando && !dados)) {
    return (
      <div className="loja-container py-10">
        <div className="space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="loja-esqueleto h-24 w-full" />)}
        </div>
      </div>
    )
  }

  if (itens.length === 0) {
    return (
      <div className="loja-container">
        <EstadoVazio
          titulo="Seu carrinho está vazio"
          descricao="Adicione produtos para continuar."
          acao={<Link href="/" className={classesBotao('primario')} style={estiloPrimario}>Ver produtos</Link>}
        />
      </div>
    )
  }

  const lista = dados?.itens ?? []
  const subtotal = dados?.subtotal ?? 0

  const textoWhatsApp = whatsapp
    ? `https://wa.me/55${whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(
        `Olá! Quero finalizar este pedido na ${nomeLoja}:\n\n` +
        lista.filter(i => !i.indisponivel)
          .map(i => `• ${i.quantidade}x ${i.produto.nome} — ${real(i.subtotal)}`).join('\n') +
        `\n\nTotal: ${real(subtotal)}`,
      )}`
    : null

  return (
    <div className="loja-container py-6">
      <h1 className="text-xl font-bold tracking-tight md:text-2xl">Carrinho</h1>

      {erro && (
        <p className="mt-4 rounded-[var(--raio)] border border-[var(--alerta)]/30 bg-[var(--alerta)]/5 p-3 text-sm text-[var(--alerta)]">
          {erro}
        </p>
      )}

      {dados && dados.removidos.length > 0 && (
        <p className="mt-4 rounded-[var(--raio)] border border-[var(--borda)] bg-[var(--fundo-suave)] p-3 text-sm text-[var(--tinta-media)]">
          {dados.removidos.length} {dados.removidos.length === 1 ? 'produto saiu' : 'produtos saíram'} do
          catálogo e {dados.removidos.length === 1 ? 'foi removido' : 'foram removidos'} do carrinho.
        </p>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px]">
        <ul className="divide-y divide-[var(--borda)]">
          {lista.map(item => (
            <li key={item.produto.produtoId} className="flex gap-3 py-4">
              <Link
                href={`/produto/${item.produto.slug}`}
                className="h-20 w-20 shrink-0 overflow-hidden rounded-[var(--raio-sm)] border border-[var(--borda)]"
              >
                <ImagemProduto url={item.produto.imagemUrl} alt={item.produto.nome} className="h-full w-full" />
              </Link>

              <div className="min-w-0 flex-1">
                <Link href={`/produto/${item.produto.slug}`} className="loja-linhas-2 text-[0.875rem] font-medium">
                  {item.produto.nome}
                </Link>

                <div className="mt-1 text-[0.9375rem] font-bold">{real(item.produto.preco)}</div>

                {/* Avisos — a razão de esta tela existir do jeito que existe. */}
                {item.precoMudou && item.precoAnterior != null && (
                  <p className="mt-1 text-[0.75rem] font-medium text-[var(--alerta)]">
                    O preço mudou de {real(item.precoAnterior)} para {real(item.produto.preco)}.
                  </p>
                )}
                {item.quantidadeAjustada && (
                  <p className="mt-1 text-[0.75rem] font-medium text-[var(--alerta)]">
                    Ajustamos para {item.quantidade} — é o que temos em estoque.
                  </p>
                )}
                {item.indisponivel && (
                  <p className="mt-1 text-[0.75rem] font-medium text-[var(--alerta)]">
                    Sem estoque no momento. Não entra no total.
                  </p>
                )}

                <div className="mt-2 flex items-center gap-3">
                  <div className="flex items-center rounded-[8px] border border-[var(--borda)]">
                    <button
                      type="button"
                      onClick={() => alterar(item.produto.produtoId, item.quantidade - 1)}
                      aria-label={`Diminuir ${item.produto.nome}`}
                      className="compacto flex h-9 w-9 items-center justify-center text-[var(--tinta-media)]"
                    >−</button>
                    <span className="w-9 text-center text-sm font-semibold">{item.quantidade}</span>
                    <button
                      type="button"
                      onClick={() => alterar(item.produto.produtoId, item.quantidade + 1)}
                      disabled={!permiteSemEstoque && item.quantidade >= item.disponivel}
                      aria-label={`Aumentar ${item.produto.nome}`}
                      className="compacto flex h-9 w-9 items-center justify-center text-[var(--tinta-media)] disabled:opacity-30"
                    >+</button>
                  </div>

                  <button
                    type="button"
                    onClick={() => remover(item.produto.produtoId)}
                    className="compacto text-[0.8125rem] font-medium text-[var(--tinta-fraca)] hover:text-[var(--tinta-forte)]"
                  >
                    Remover
                  </button>
                </div>
              </div>

              <div className="shrink-0 text-right text-[0.9375rem] font-bold">
                {real(item.subtotal)}
              </div>
            </li>
          ))}
        </ul>

        {/* Resumo. `sticky` só no desktop: no celular ele fica no fim da
            lista, que é onde o polegar chega depois de conferir os itens. */}
        <aside className="h-fit rounded-[var(--raio)] border border-[var(--borda)] bg-white p-5 lg:sticky lg:top-28">
          <div className="flex items-baseline justify-between">
            <span className="text-[var(--tinta-media)]">Subtotal</span>
            <span className="text-2xl font-bold tracking-tight">{real(subtotal)}</span>
          </div>
          <p className="mt-1 text-xs text-[var(--tinta-fraca)]">
            O frete é combinado pela loja — ele não entra neste total.
          </p>

          {/* O checkout existe (Fase 3), e é ele o caminho principal: o
              pedido nasce no ERP, com estoque reservado, em vez de virar uma
              conversa que alguém precisa transcrever depois.
              O WhatsApp fica como saída secundária — há quem prefira falar
              antes de comprar, e tirar isso não ganharia nada. */}
          <Link
            href="/checkout"
            className={classesBotao('primario', 'mt-4 w-full')}
            style={estiloPrimario}
          >
            Finalizar compra
          </Link>

          {textoWhatsApp && (
            <a
              href={textoWhatsApp}
              target="_blank"
              rel="noopener noreferrer"
              className={classesBotao('secundario', 'mt-2 w-full')}
            >
              Prefiro combinar pelo WhatsApp
            </a>
          )}

          <Link href="/" className={classesBotao('sutil', 'mt-2 w-full')}>
            Continuar comprando
          </Link>

          {(entregaAtiva || retiradaAtiva) && (
            <p className="mt-4 border-t border-[var(--borda)] pt-4 text-xs text-[var(--tinta-media)]">
              {[entregaAtiva && 'Entrega no endereço', retiradaAtiva && 'Retirada na loja']
                .filter(Boolean).join(' · ')}
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}
