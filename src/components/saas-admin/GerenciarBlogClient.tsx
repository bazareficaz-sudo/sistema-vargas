'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface Post {
  id: string
  titulo: string
  slug: string
  resumo: string
  conteudo: string
  capa_url: string | null
  categoria: string
  publicado: boolean
  destaque: boolean
  autor: string
  publicado_em: string | null
  created_at: string
}

interface Props {
  posts: Post[]
}

const CATEGORIAS: Record<string, { label: string; cor: string }> = {
  novidade: { label: 'Novidade', cor: 'bg-blue-900/50 text-blue-300' },
  atualizacao: { label: 'Atualização', cor: 'bg-emerald-900/50 text-emerald-300' },
  manutencao: { label: 'Manutenção', cor: 'bg-amber-900/50 text-amber-300' },
  dica: { label: 'Dica', cor: 'bg-violet-900/50 text-violet-300' },
}

function slugify(s: string) {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

type ModalMode = 'edit' | 'new'

export default function GerenciarBlogClient({ posts }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [modal, setModal] = useState<{ mode: ModalMode; post?: Post } | null>(null)
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')
  const [filtro, setFiltro] = useState<'todos' | 'publicados' | 'rascunhos'>('todos')

  const emptyPost = (): Partial<Post> => ({
    titulo: '', slug: '', resumo: '', conteudo: '', capa_url: '',
    categoria: 'novidade', publicado: false, destaque: false, autor: 'Equipe Vargas',
  })

  const [form, setForm] = useState<Partial<Post>>(emptyPost())
  const [slugEditado, setSlugEditado] = useState(false)

  function abrirNovo() { setForm(emptyPost()); setSlugEditado(false); setErro(''); setModal({ mode: 'new' }) }
  function abrirEditar(p: Post) { setForm({ ...p }); setSlugEditado(true); setErro(''); setModal({ mode: 'edit', post: p }) }

  function onTituloChange(v: string) {
    setForm(f => ({ ...f, titulo: v, slug: slugEditado ? f.slug : slugify(v) }))
  }

  async function salvar() {
    if (!form.titulo?.trim()) { setErro('Título é obrigatório'); return }
    if (!form.slug?.trim()) { setErro('Slug é obrigatório'); return }
    setSaving(true); setErro('')
    try {
      const jaEstavaPublicado = modal?.post?.publicado ?? false
      const postData = {
        titulo: form.titulo.trim(),
        slug: slugify(form.slug),
        resumo: form.resumo ?? '',
        conteudo: form.conteudo ?? '',
        capa_url: form.capa_url || null,
        categoria: form.categoria ?? 'novidade',
        publicado: form.publicado ?? false,
        destaque: form.destaque ?? false,
        autor: form.autor || 'Equipe Vargas',
        updated_at: new Date().toISOString(),
        ...((form.publicado && !jaEstavaPublicado) ? { publicado_em: new Date().toISOString() } : {}),
      }

      if (modal?.mode === 'new') {
        const { error } = await supabase.from('blog_posts').insert(postData)
        if (error) throw error
      } else if (modal?.post?.id) {
        const { error } = await supabase.from('blog_posts').update(postData).eq('id', modal.post.id)
        if (error) throw error
      }

      setModal(null)
      router.refresh()
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar post')
    } finally {
      setSaving(false)
    }
  }

  async function togglePublicado(p: Post) {
    await supabase.from('blog_posts').update({
      publicado: !p.publicado,
      publicado_em: !p.publicado ? new Date().toISOString() : p.publicado_em,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id)
    router.refresh()
  }

  async function excluir(p: Post) {
    if (!confirm(`Excluir o post "${p.titulo}"? Esta ação não pode ser desfeita.`)) return
    await supabase.from('blog_posts').delete().eq('id', p.id)
    router.refresh()
  }

  const postsFiltrados = posts.filter(p => {
    if (filtro === 'publicados') return p.publicado
    if (filtro === 'rascunhos') return !p.publicado
    return true
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Blog</h1>
          <p className="text-slate-400 text-sm">Novidades e atualizações comunicadas aos clientes · {posts.length} post(s)</p>
        </div>
        <button onClick={abrirNovo}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold">
          + Novo post
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-2">
        {([['todos', 'Todos'], ['publicados', 'Publicados'], ['rascunhos', 'Rascunhos']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFiltro(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${filtro === k ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Lista de posts */}
      <div className="space-y-2">
        {postsFiltrados.length === 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-500 text-sm">
            Nenhum post encontrado.
          </div>
        )}
        {postsFiltrados.map(p => {
          const cat = CATEGORIAS[p.categoria] ?? CATEGORIAS.novidade
          return (
            <div key={p.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-white text-sm truncate">{p.titulo}</h3>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${cat.cor}`}>{cat.label}</span>
                  {p.destaque && <span className="text-[10px] bg-yellow-900/50 text-yellow-300 px-1.5 py-0.5 rounded-md">★ Destaque</span>}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${p.publicado ? 'bg-emerald-900/50 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                    {p.publicado ? 'Publicado' : 'Rascunho'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 truncate">/blog/{p.slug} · {p.resumo || 'Sem resumo'}</p>
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                <button onClick={() => abrirEditar(p)}
                  className="text-xs px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg">
                  ✏ Editar
                </button>
                <button onClick={() => togglePublicado(p)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg ${p.publicado ? 'bg-amber-900/50 text-amber-400 hover:bg-amber-900' : 'bg-emerald-900/50 text-emerald-400 hover:bg-emerald-900'}`}>
                  {p.publicado ? 'Despublicar' : 'Publicar'}
                </button>
                <button onClick={() => excluir(p)}
                  className="text-xs px-2.5 py-1.5 bg-red-900/50 text-red-400 hover:bg-red-900 rounded-lg">
                  🗑
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/70 py-8">
          <div className="bg-slate-900 rounded-2xl border border-slate-700 w-[720px] max-w-full mx-4">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h2 className="font-bold text-white">{modal.mode === 'new' ? 'Novo post' : `Editar: ${modal.post?.titulo}`}</h2>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              <div>
                <label className="text-xs text-slate-400">Título</label>
                <input value={form.titulo ?? ''} onChange={e => onTituloChange(e.target.value)}
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500" />
              </div>

              <div>
                <label className="text-xs text-slate-400">Slug (URL: /blog/{form.slug || '...'})</label>
                <input value={form.slug ?? ''} onChange={e => { setSlugEditado(true); setForm(f => ({ ...f, slug: e.target.value })) }}
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400">Categoria</label>
                  <select value={form.categoria ?? 'novidade'} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                    className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500">
                    {Object.entries(CATEGORIAS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Autor</label>
                  <input value={form.autor ?? ''} onChange={e => setForm(f => ({ ...f, autor: e.target.value }))}
                    className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400">URL da imagem de capa (opcional)</label>
                <input value={form.capa_url ?? ''} onChange={e => setForm(f => ({ ...f, capa_url: e.target.value }))}
                  placeholder="https://..."
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500" />
              </div>

              <div>
                <label className="text-xs text-slate-400">Resumo (aparece na listagem)</label>
                <textarea value={form.resumo ?? ''} onChange={e => setForm(f => ({ ...f, resumo: e.target.value }))}
                  rows={2}
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500" />
              </div>

              <div>
                <label className="text-xs text-slate-400">Conteúdo (HTML simples: use &lt;p&gt;, &lt;strong&gt;, &lt;ul&gt;, &lt;a&gt;)</label>
                <textarea value={form.conteudo ?? ''} onChange={e => setForm(f => ({ ...f, conteudo: e.target.value }))}
                  rows={10}
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={Boolean(form.publicado)}
                    onChange={e => setForm(f => ({ ...f, publicado: e.target.checked }))}
                    className="accent-blue-500" />
                  Publicado (visível para os clientes)
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={Boolean(form.destaque)}
                    onChange={e => setForm(f => ({ ...f, destaque: e.target.checked }))}
                    className="accent-blue-500" />
                  Destaque
                </label>
              </div>

              {erro && <p className="text-red-400 text-sm">{erro}</p>}
            </div>

            <div className="px-6 py-4 border-t border-slate-800 flex justify-end gap-3">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancelar</button>
              <button onClick={salvar} disabled={saving}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                {saving ? 'Salvando...' : 'Salvar post'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
