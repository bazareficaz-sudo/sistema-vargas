import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { lojaAtual } from '@/lib/commerce/loja'

// robots.txt — um arquivo, dois destinos.
//
// ATENÇÃO à convenção do Next: `robots.ts` só é reconhecido na RAIZ de `app/`.
// Diferente de `sitemap.ts`, ele NÃO funciona aninhado — uma versão em
// `app/loja/robots.ts` simplesmente não gera rota nenhuma (conferido no
// build: `sitemap.xml` apareceu, `robots.txt` não). Por isso este arquivo
// mora aqui e decide pelo host.
//
// Como ele resolve a loja por `lojaAtual()`, que lê o `host` direto, não
// depende do proxy — e por isso `/robots.txt` continua fora do `matcher`.

export const dynamic = 'force-dynamic'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers()
  const host = h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https')

  const loja = await lojaAtual()

  // ── Domínio do ERP ────────────────────────────────────────
  // Antes desta fase o sistema não tinha robots.txt nenhum, então tudo era
  // rastreável. As telas internas já exigem login, mas não há motivo para
  // convidar robô a bater nelas.
  if (!loja) {
    return {
      rules: [{
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard', '/pdv', '/api', '/saas-admin', '/suporte'],
      }],
    }
  }

  // ── Loja em montagem ──────────────────────────────────────
  // Segunda camada da mesma decisão que o `generateMetadata` toma com
  // `noindex` — e a que vale para o robô que lê robots.txt antes de baixar
  // qualquer página.
  if (!loja.indexavel || loja.emManutencao) {
    return { rules: [{ userAgent: '*', disallow: '/' }] }
  }

  return {
    rules: [{
      userAgent: '*',
      allow: '/',
      // Busca e carrinho não geram conteúdo indexável: a busca cria URL
      // infinita e conteúdo duplicado, que é o jeito mais rápido de piorar o
      // SEO do site inteiro.
      disallow: ['/carrinho', '/buscar'],
    }],
    sitemap: `${proto}://${host}/sitemap.xml`,
  }
}
