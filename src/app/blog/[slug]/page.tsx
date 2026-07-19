import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const CATEGORIAS: Record<string, { label: string; cor: string; icon: string }> = {
  novidade: { label: 'Novidade', cor: 'bg-blue-50 text-blue-700 border-blue-200', icon: '🚀' },
  atualizacao: { label: 'Atualização', cor: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: '⬆️' },
  manutencao: { label: 'Manutenção', cor: 'bg-amber-50 text-amber-700 border-amber-200', icon: '🛠️' },
  dica: { label: 'Dica', cor: 'bg-violet-50 text-violet-700 border-violet-200', icon: '💡' },
}

function formatarData(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

async function getPost(slug: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('slug', slug)
    .eq('publicado', true)
    .single()
  return data
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = await getPost(slug)
  if (!post) return { title: 'Post não encontrado — Blog Vargas ERP' }
  return {
    title: `${post.titulo} — Blog Vargas ERP`,
    description: post.resumo || undefined,
  }
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getPost(slug)
  if (!post) notFound()

  const cat = CATEGORIAS[post.categoria] ?? CATEGORIAS.novidade

  return (
    <article>
      <section className="pt-12 pb-8 px-6" style={{ background: 'linear-gradient(135deg,#f8faff 0%,#eef2ff 50%,#f0fdf4 100%)' }}>
        <div className="max-w-3xl mx-auto">
          <Link href="/blog" className="text-sm text-gray-500 hover:text-blue-600 transition-colors font-medium">← Todas as novidades</Link>
          <div className="flex items-center gap-2 mt-5 mb-4">
            <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full border ${cat.cor}`}>
              {cat.icon} {cat.label}
            </span>
            <span className="text-xs text-gray-400">{formatarData(post.publicado_em)}</span>
          </div>
          <h1 className="text-3xl lg:text-4xl font-black text-gray-900 leading-tight mb-4">{post.titulo}</h1>
          {post.resumo && <p className="text-gray-500 text-lg leading-relaxed">{post.resumo}</p>}
          <p className="text-sm text-gray-400 mt-4">Por {post.autor || 'Equipe Vargas'}</p>
        </div>
      </section>

      {post.capa_url && (
        <div className="max-w-3xl mx-auto px-6 -mt-2 mb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.capa_url} alt={post.titulo} className="w-full rounded-2xl border border-gray-100 shadow-sm" />
        </div>
      )}

      <div className="max-w-3xl mx-auto px-6 py-10">
        <div
          className="blog-content"
          dangerouslySetInnerHTML={{ __html: post.conteudo || '' }}
        />
      </div>

      <div className="max-w-3xl mx-auto px-6 pb-16">
        <div className="border-t border-gray-100 pt-8 flex items-center justify-between">
          <Link href="/blog" className="text-sm font-bold text-blue-600 hover:text-blue-700 transition-colors">← Voltar para o blog</Link>
          <Link href="/login" className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition-colors">
            Acessar o sistema
          </Link>
        </div>
      </div>
    </article>
  )
}
