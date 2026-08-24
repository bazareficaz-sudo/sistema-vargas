import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { lojaAtual } from '@/lib/commerce/loja'
import { db } from '@/lib/commerce/db'

// Sitemap por loja.
//
// Cada loja tem o seu, servido no próprio domínio — é o que o Google espera,
// e o que impede o sitemap de uma loja listar URL de outra.
//
// Loja não indexável devolve sitemap VAZIO em vez de 404: o arquivo continua
// existindo (e não gera erro no Search Console), mas não convida ninguém a
// entrar numa vitrine em montagem.

export const revalidate = 3600

const LIMITE = 5000

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const loja = await lojaAtual()
  if (!loja || !loja.indexavel || loja.emManutencao) return []

  const h = await headers()
  const host = h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https')
  const base = `${proto}://${host}`

  const [{ data: produtos }, { data: categorias }] = await Promise.all([
    db().from('loja_produtos')
      .select('slug, updated_at')
      .eq('loja_id', loja.id).eq('status', 'publicado')
      .order('updated_at', { ascending: false }).limit(LIMITE),
    db().from('loja_categorias')
      .select('slug, updated_at').eq('loja_id', loja.id).eq('ativo', true),
  ])

  return [
    { url: base, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    ...((categorias ?? []) as any[]).map(c => ({
      url: `${base}/c/${c.slug}`,
      lastModified: c.updated_at ? new Date(c.updated_at) : undefined,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...((produtos ?? []) as any[]).map(p => ({
      url: `${base}/produto/${p.slug}`,
      lastModified: p.updated_at ? new Date(p.updated_at) : undefined,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
  ]
}
