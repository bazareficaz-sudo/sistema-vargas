'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useCarrinho } from './CarrinhoContexto'
import { classesBotao, estiloPrimario } from './ds'
import type { ProdutoDetalhe } from '@/lib/commerce/tipos'

// Escolher quantidade e comprar. É a única parte interativa da página do
// produto — o resto é HTML servido pronto, para carregar rápido no celular.
//
// O botão precisa de "grande clareza visual" (requisito do projeto), e isso
// aqui significa: largura total no celular, cor da marca, rótulo que diz o
// que acontece. Não significa botão gigante — altura exagerada só empurra o
// resto da página para baixo.

export default function ComprarProduto({ produto, permiteSemEstoque }: {
  produto: ProdutoDetalhe
  permiteSemEstoque: boolean
}) {
  const router = useRouter()
  const { adicionar } = useCarrinho()
  const [qtd, setQtd] = useState(1)
  const [feito, setFeito] = useState(false)

  const disponivel = produto.disponivelAgora
  const semSaldo = disponivel <= 0 && !permiteSemEstoque

  // Teto: o do produto ou o da loja, o que for menor. Sem saldo mas com venda
  // permitida (encomenda), o teto é só o limite comercial.
  const teto = Math.max(
    1,
    Math.min(
      produto.limiteMaximoPorCompra ?? Infinity,
      permiteSemEstoque && disponivel <= 0 ? Infinity : Math.max(disponivel, 1),
    ),
  )

  function aoAdicionar(irParaCarrinho: boolean) {
    adicionar({
      produtoId: produto.produtoId,
      slug: produto.slug,
      nome: produto.nome,
      imagemUrl: produto.imagemUrl,
      precoVisto: produto.preco,
    }, qtd)

    if (irParaCarrinho) { router.push('/carrinho'); return }
    setFeito(true)
    setTimeout(() => setFeito(false), 2200)
  }

  if (semSaldo) {
    return (
      <div className="rounded-[var(--raio)] border border-[var(--borda)] bg-[var(--fundo-suave)] p-4">
        <p className="font-semibold text-[var(--tinta-forte)]">Produto indisponível no momento</p>
        <p className="mt-1 text-sm text-[var(--tinta-media)]">
          Este item faz parte do nosso catálogo, mas está sem estoque agora.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label htmlFor="qtd" className="text-sm font-medium text-[var(--tinta-media)]">Quantidade</label>
        <div className="flex items-center rounded-[10px] border border-[var(--borda)]">
          <button
            type="button"
            onClick={() => setQtd(q => Math.max(1, q - 1))}
            disabled={qtd <= 1}
            aria-label="Diminuir quantidade"
            className="flex h-11 w-11 items-center justify-center text-lg text-[var(--tinta-media)] disabled:opacity-30"
          >
            −
          </button>
          <input
            id="qtd"
            type="number"
            inputMode="numeric"
            min={1}
            max={Number.isFinite(teto) ? teto : undefined}
            value={qtd}
            onChange={e => {
              const v = Math.floor(Number(e.target.value) || 1)
              setQtd(Math.min(Math.max(v, 1), teto))
            }}
            className="h-11 w-14 border-x border-[var(--borda)] text-center text-[0.9375rem] font-semibold outline-none"
          />
          <button
            type="button"
            onClick={() => setQtd(q => Math.min(teto, q + 1))}
            disabled={qtd >= teto}
            aria-label="Aumentar quantidade"
            className="flex h-11 w-11 items-center justify-center text-lg text-[var(--tinta-media)] disabled:opacity-30"
          >
            +
          </button>
        </div>
        {produto.unidade && (
          <span className="text-sm text-[var(--tinta-fraca)]">{produto.unidade}</span>
        )}
      </div>

      {qtd >= teto && Number.isFinite(teto) && disponivel > 0 && (
        <p className="text-[0.8125rem] text-[var(--alerta)]">
          {produto.limiteMaximoPorCompra === teto
            ? `Máximo de ${teto} por compra.`
            : `Temos ${teto} em estoque.`}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => aoAdicionar(true)}
          className={classesBotao('primario', 'w-full sm:flex-1')}
          style={estiloPrimario}
        >
          Comprar agora
        </button>
        <button
          type="button"
          onClick={() => aoAdicionar(false)}
          className={classesBotao('secundario', 'w-full sm:flex-1')}
        >
          {feito ? '✓ Adicionado' : 'Adicionar ao carrinho'}
        </button>
      </div>

      {/* aria-live: quem usa leitor de tela precisa ouvir a confirmação, que
          visualmente é só o texto do botão mudando. */}
      <p aria-live="polite" className="sr-only">
        {feito ? `${qtd} unidade(s) de ${produto.nome} adicionadas ao carrinho.` : ''}
      </p>
    </div>
  )
}
