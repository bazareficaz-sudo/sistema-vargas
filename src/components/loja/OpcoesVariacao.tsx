import Link from 'next/link'
import type { VariacoesProduto } from '@/lib/commerce/tipos'

// Seletor de opções (cor, medida) da página do produto.
//
// Cada opção é um LINK para a página do produto daquela opção — não um estado
// de tela. Assim cada cor/medida tem URL própria (o Google indexa, o cliente
// compartilha no WhatsApp o link exato) e foto, preço e estoque vêm do cadastro
// de cada item, sem nenhuma lógica de "variação" no carrinho.

export default function OpcoesVariacao({ variacoes }: { variacoes: VariacoesProduto }) {
  const atual = variacoes.opcoes.find(o => o.atual)
  // Se alguma opção tem cor, o grupo todo vira bolinhas; as sem cor caem como
  // texto dentro do mesmo grupo. Misturar é raro, mas não deve esconder opção.
  return (
    <div>
      <p className="text-sm text-[var(--tinta-media)]">
        {variacoes.tipoOpcao}:{' '}
        <strong className="font-semibold text-[var(--tinta-forte)]">{atual?.rotulo}</strong>
      </p>

      <ul className="mt-2 flex flex-wrap gap-2" aria-label={`Escolha ${variacoes.tipoOpcao.toLowerCase()}`}>
        {variacoes.opcoes.map(o => {
          const marcada = o.atual
          const bolinha = !!o.cor
          return (
            <li key={o.slug}>
              <Link
                href={`/produto/${o.slug}`}
                scroll={false}
                prefetch={false}
                aria-current={marcada ? 'true' : undefined}
                aria-label={o.disponivel ? o.rotulo : `${o.rotulo} (indisponível)`}
                title={o.disponivel ? o.rotulo : `${o.rotulo} — indisponível`}
                className={[
                  'relative inline-flex items-center justify-center overflow-hidden border text-sm transition-shadow',
                  bolinha ? 'h-9 w-9 rounded-full' : 'min-h-9 min-w-9 rounded-[var(--raio)] px-3 py-1.5 font-medium',
                  marcada
                    ? 'border-[var(--loja-primaria)] ring-2 ring-[var(--loja-primaria)] ring-offset-1'
                    : 'border-[var(--borda)] hover:border-[var(--tinta-fraca)]',
                  !bolinha && marcada ? 'text-[var(--tinta-forte)]' : 'text-[var(--tinta-media)]',
                  !o.disponivel && !marcada ? 'opacity-60' : '',
                ].join(' ')}
                style={bolinha ? { backgroundColor: o.cor! } : undefined}
              >
                {!bolinha && (
                  <span className={o.disponivel ? '' : 'line-through'}>{o.rotulo}</span>
                )}
                {!o.disponivel && bolinha && (
                  // Risco diagonal sobre a bolinha: "existe, mas está sem estoque".
                  <span
                    aria-hidden
                    className="absolute inset-0"
                    style={{
                      background:
                        'linear-gradient(to top right, transparent calc(50% - 1px), rgba(0,0,0,.55) calc(50% - 1px), rgba(0,0,0,.55) calc(50% + 1px), transparent calc(50% + 1px))',
                    }}
                  />
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
