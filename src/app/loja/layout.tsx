import type { Metadata } from 'next'
import { Suspense } from 'react'
import { lojaObrigatoria } from '@/lib/commerce/loja'
import { categorias } from '@/lib/commerce/catalogo'
import { CarrinhoProvider } from '@/components/loja/CarrinhoContexto'
import Cabecalho from '@/components/loja/Cabecalho'
import Rodape from '@/components/loja/Rodape'
import './loja.css'

// Casca da vitrine.
//
// Ela vive DENTRO do layout raiz do ERP (é o mesmo app), então o globals.css
// administrativo continua carregado. É por isso que todo o tema da loja está
// escopado em `.loja`: sem isso, a vitrine herdaria o fundo slate e a
// tipografia de painel — exatamente a percepção que este projeto quer evitar.

export async function generateMetadata(): Promise<Metadata> {
  const loja = await lojaObrigatoria()
  const titulo = loja.seoTitle || loja.nome

  return {
    title: { default: titulo, template: `%s · ${loja.nome}` },
    description: loja.metaDescription || loja.descricao || undefined,
    // Enquanto a loja não for marcada como indexável no painel, ela pede
    // noindex. Google indexando vitrine em montagem é o tipo de erro que
    // leva semanas para desfazer.
    robots: loja.indexavel ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      type: 'website',
      siteName: loja.nome,
      title: titulo,
      description: loja.metaDescription || loja.descricao || undefined,
      images: loja.ogImageUrl ? [loja.ogImageUrl] : undefined,
      locale: 'pt_BR',
    },
    icons: loja.faviconUrl ? { icon: loja.faviconUrl } : undefined,
  }
}

export default async function LayoutLoja({ children }: { children: React.ReactNode }) {
  const loja = await lojaObrigatoria()
  const arvore = await categorias(loja.id)

  // Loja fechada para manutenção: página única, sem cabeçalho nem catálogo.
  // Continua devolvendo 200 (e não 503) porque isto é estado de montagem, e
  // não falha — mas com noindex, que já vem do generateMetadata.
  if (loja.emManutencao) {
    return (
      <div
        className="loja flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center"
        style={{ ['--loja-primaria' as string]: loja.corPrimaria }}
      >
        <h1 className="text-2xl font-bold">{loja.nome}</h1>
        <p className="max-w-md text-[var(--tinta-media)]">
          Nossa loja online está em preparação e volta em breve.
        </p>
        {loja.whatsapp && (
          <a
            href={`https://wa.me/55${loja.whatsapp.replace(/\D/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 rounded-[10px] px-5 py-3 font-semibold text-white"
            style={{ background: 'var(--loja-primaria)' }}
          >
            Falar no WhatsApp
          </a>
        )}
      </div>
    )
  }

  return (
    <div
      className="loja flex min-h-screen flex-col"
      // As duas cores da marca entram como variáveis CSS. É a personalização
      // controlada: o lojista escolhe a cor, não o layout.
      style={{
        ['--loja-primaria' as string]: loja.corPrimaria,
        ['--loja-destaque' as string]: loja.corDestaque,
      }}
    >
      <CarrinhoProvider lojaId={loja.id}>
        {/* useSearchParams no cabeçalho exige fronteira de Suspense. */}
        <Suspense fallback={<div className="h-[124px] border-b border-[var(--borda)] lg:h-[104px]" />}>
          <Cabecalho
            loja={{ id: loja.id, nome: loja.nome, logoUrl: loja.logoUrl, whatsapp: loja.whatsapp }}
            categorias={arvore}
          />
        </Suspense>

        <main className="flex-1">{children}</main>
      </CarrinhoProvider>

      <Rodape loja={loja} categorias={arvore} />
    </div>
  )
}
