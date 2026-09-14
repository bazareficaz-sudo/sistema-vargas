import Link from 'next/link'
import { ImagemProduto, Preco, SeloDisponibilidade, classesBotao, estiloPrimario } from './ds'
import type { PoliticaPreco, ProdutoCard } from '@/lib/commerce/tipos'

// "Banner dinâmico" de produto: visual de banner (imagem grande, uma frase,
// preço em destaque), mas o conteúdo é o PRÓPRIO catálogo — nome, imagem e
// preço vêm de `loja_vitrine_produtos`, os mesmos que a listagem usa. Nunca
// fica desatualizado: mudou o preço ou a promoção do produto, o banner muda
// sozinho no próximo carregamento, sem ninguém reeditar uma imagem.
//
// É o que diferencia isto de `loja_banners`: lá a imagem é uma arte estática
// que alguém sobe; aqui a "arte" é montada a partir de dado real. Por isso
// mora no bloco (`loja_blocos_home`, tipo `destaque_tag`), não na tabela de
// banners — quem decide quem aparece é a TAG do produto, não um upload.
//
// Um produto por banner, de propósito: description e preço legíveis lado a
// lado com a imagem é o que faz PARECER banner. Colocar dois produtos na
// mesma faixa vira card de novo — para isso já existe o bloco comum.

export default function BannerDestaqueProduto({ p, permiteSemEstoque, politica }: {
  p: ProdutoCard
  permiteSemEstoque: boolean
  politica?: PoliticaPreco
}) {
  return (
    <Link
      href={`/produto/${p.slug}`}
      className="group flex flex-col overflow-hidden rounded-[var(--raio)] border border-[var(--borda)] bg-white transition-shadow hover:shadow-[var(--sombra-alta)] sm:flex-row"
    >
      <ImagemProduto
        url={p.imagemUrl}
        alt={p.nome}
        className="aspect-[4/3] w-full sm:aspect-square sm:w-2/5"
      />

      <div className="flex flex-1 flex-col justify-center gap-2 p-5 sm:p-8">
        {p.marca && (
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--tinta-fraca)]">
            {p.marca}
          </span>
        )}

        <h3 className="text-xl font-extrabold leading-tight text-[var(--tinta-forte)] sm:text-2xl">
          {p.nome}
        </h3>

        {p.descricaoCurta && (
          <p className="loja-linhas-2 max-w-md text-sm text-[var(--tinta-media)]">
            {p.descricaoCurta}
          </p>
        )}

        <div className="mt-2">
          <Preco valor={p.preco} de={p.precoDe} pix={p.precoPix} politica={politica} tamanho="pagina" />
          <div className="mt-2">
            <SeloDisponibilidade disponivel={p.estoquePublicavel} permiteSemEstoque={permiteSemEstoque} />
          </div>
        </div>

        <span
          className={classesBotao('primario', 'mt-3 w-fit')}
          style={estiloPrimario}
        >
          Ver produto
        </span>
      </div>
    </Link>
  )
}
