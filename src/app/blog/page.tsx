import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Post {
  id: string
  titulo: string
  slug: string
  resumo: string
  capa_url: string | null
  categoria: string
  destaque: boolean
  autor: string
  publicado_em: string | null
}

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

function CategoriaBadge({ categoria }: { categoria: string }) {
  const cat = CATEGORIAS[categoria] ?? CATEGORIAS.novidade
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full border ${cat.cor}`}>
      {cat.icon} {cat.label}
    </span>
  )
}

function PostCover({ post }: { post: Post }) {
  const cat = CATEGORIAS[post.categoria] ?? CATEGORIAS.novidade
  if (post.capa_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={post.capa_url} alt={post.titulo} className="w-full h-full object-cover" />
  }
  return (
    <div className="w-full h-full flex items-center justify-center text-5xl" style={{ background: 'linear-gradient(135deg,#eef2ff,#f0fdf4)' }}>
      {cat.icon}
    </div>
  )
}

export default async function BlogPage() {
  const supabase = await createClient()

  const { data } = await supabase
    .from('blog_posts')
    .select('id, titulo, slug, resumo, capa_url, categoria, destaque, autor, publicado_em')
    .eq('publicado', true)
    .order('publicado_em', { ascending: false })

  const posts = (data ?? []) as Post[]
  const destaque = posts.find(p => p.destaque) ?? posts[0]
  const restantes = posts.filter(p => p.id !== destaque?.id)

  return (
    <div>
      {/* ── HERO ────────────────────────────────────────────────────────── */}
      <section className="pt-14 pb-12 px-6" style={{ background: 'linear-gradient(135deg,#f8faff 0%,#eef2ff 50%,#f0fdf4 100%)' }}>
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-sm font-bold text-blue-600 uppercase tracking-widest mb-3">Blog Vargas ERP</p>
          <h1 className="text-3xl lg:text-4xl font-black text-gray-900 mb-4">Novidades e atualizações do sistema</h1>
          <p className="text-gray-500 text-lg max-w-2xl mx-auto">
            Acompanhe lançamentos de recursos, melhorias, manutenções programadas e dicas para aproveitar melhor o Sistema Vargas.
          </p>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-6 py-14">
        {posts.length === 0 && (
          <div className="text-center py-20">
            <p className="text-gray-400">Nenhuma novidade publicada ainda. Volte em breve!</p>
          </div>
        )}

        {/* ── POST EM DESTAQUE ─────────────────────────────────────────── */}
        {destaque && (
          <Link href={`/blog/${destaque.slug}`} className="group block mb-12">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 bg-white rounded-3xl border border-gray-100 shadow-sm hover:shadow-lg transition-shadow overflow-hidden">
              <div className="h-56 md:h-full">
                <PostCover post={destaque} />
              </div>
              <div className="p-8 flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-3">
                  <CategoriaBadge categoria={destaque.categoria} />
                  <span className="text-xs text-gray-400">{formatarData(destaque.publicado_em)}</span>
                </div>
                <h2 className="text-2xl font-black text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">{destaque.titulo}</h2>
                <p className="text-gray-500 text-sm leading-relaxed line-clamp-3">{destaque.resumo}</p>
                <span className="mt-4 text-sm font-bold text-blue-600">Ler mais →</span>
              </div>
            </div>
          </Link>
        )}

        {/* ── DEMAIS POSTS ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {restantes.map(post => (
            <Link key={post.id} href={`/blog/${post.slug}`} className="group block">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden h-full flex flex-col">
                <div className="h-40">
                  <PostCover post={post} />
                </div>
                <div className="p-5 flex flex-col flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <CategoriaBadge categoria={post.categoria} />
                    <span className="text-xs text-gray-400">{formatarData(post.publicado_em)}</span>
                  </div>
                  <h3 className="font-bold text-gray-900 mb-1.5 group-hover:text-blue-600 transition-colors">{post.titulo}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed line-clamp-2 flex-1">{post.resumo}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
