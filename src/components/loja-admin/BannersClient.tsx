'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { botao } from '@/components/ui/botao'

// Gestão de `loja_banners`, em dois modos que dividem a mesma tela e o mesmo
// formulário:
//
//   'hero'      → carrossel do topo da home. TODOS os banners ativos e dentro da
//                 vigência entram, dividindo espaço com os destaques por tag
//                 (ver BlocosHomeClient) — um só carrossel.
//   'categoria' → banner no topo da página de uma categoria. Cada banner é
//                 amarrado a UMA categoria; a subcategoria sem banner próprio
//                 herda o da categoria-mãe (ver `bannersParaCategoria`).
//
// `inicio_em`/`fim_em` servem para agendar nos dois: uma campanha de amanhã
// pode ser cadastrada hoje sem aparecer antes da hora.

type CategoriaLoja = { id: string; nome: string; pai_id: string | null }

type Banner = {
  id: string
  titulo: string | null
  subtitulo: string | null
  imagem_url: string | null
  imagem_mobile_url: string | null
  link_url: string | null
  cta_texto: string | null
  ordem: number
  ativo: boolean
  inicio_em: string | null
  fim_em: string | null
  loja_categoria_id?: string | null
}

const vazio: Omit<Banner, 'id'> = {
  titulo: '', subtitulo: '', imagem_url: null, imagem_mobile_url: null,
  link_url: '', cta_texto: '', ordem: 0, ativo: true, inicio_em: null, fim_em: null,
  loja_categoria_id: '',
}

/** "Material Elétrico › Lâmpadas" — a subcategoria sozinha ("Lâmpadas") não diz de onde é. */
function rotuloCategoria(c: CategoriaLoja, todas: CategoriaLoja[]): string {
  const pai = c.pai_id ? todas.find(x => x.id === c.pai_id) : null
  return pai ? `${pai.nome} › ${c.nome}` : c.nome
}

function paraDatetimeLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function situacao(b: Banner): { texto: string; cor: string } {
  if (!b.ativo) return { texto: 'Desativado', cor: 'bg-gray-100 text-gray-600' }
  const agora = Date.now()
  if (b.inicio_em && new Date(b.inicio_em).getTime() > agora) return { texto: 'Agendado', cor: 'bg-blue-100 text-blue-700' }
  if (b.fim_em && new Date(b.fim_em).getTime() < agora) return { texto: 'Expirado', cor: 'bg-gray-100 text-gray-500' }
  return { texto: 'No ar', cor: 'bg-green-100 text-green-700' }
}

export default function BannersClient({ lojaId, banners, modo = 'hero', categorias = [] }: {
  lojaId: string
  banners: Banner[]
  modo?: 'hero' | 'categoria'
  categorias?: CategoriaLoja[]
}) {
  const router = useRouter()
  const ehCategoria = modo === 'categoria'
  // Ordenadas pelo rótulo completo, para a subcategoria ficar junto da mãe.
  const opcoesCategoria = categorias
    .map(c => ({ id: c.id, rotulo: rotuloCategoria(c, categorias) }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)

  async function excluir(id: string) {
    if (!confirm('Excluir este banner?')) return
    const r = await fetch(`/api/loja-admin/banners/${id}?lojaId=${lojaId}`, { method: 'DELETE' })
    if (r.ok) router.refresh()
    else alert((await r.json().catch(() => null))?.erro ?? 'Não foi possível excluir')
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 p-4">
        <div>
          <h2 className="font-semibold text-gray-900">
            {ehCategoria ? 'Banners de categoria' : 'Carrossel do topo — banners'}
          </h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {ehCategoria ? (
              <>
                Um banner no topo da página de uma categoria. Vale também para as subcategorias dela —
                a menos que a subcategoria tenha um banner próprio, que aí ganha o lugar do da mãe.
              </>
            ) : (
              <>
                Todo banner <strong>No ar</strong> (ativo, dentro da vigência) entra no carrossel do topo da
                loja, dividindo espaço com os destaques por tag. A ordem decide a sequência.
              </>
            )}
          </p>
        </div>
        {!criando && (
          <button onClick={() => setCriando(true)} className={botao('primario', 'sm')}>+ Novo banner</button>
        )}
      </div>

      <div className="divide-y divide-gray-100">
        {criando && (
          <div className="p-4">
            <BannerForm
              lojaId={lojaId}
              modo={modo}
              opcoesCategoria={opcoesCategoria}
              inicial={vazio}
              aoSalvar={() => { setCriando(false); router.refresh() }}
              aoCancelar={() => setCriando(false)}
            />
          </div>
        )}

        {banners.length === 0 && !criando && (
          <p className="p-4 text-sm text-gray-500">
            {ehCategoria
              ? 'Nenhum banner de categoria ainda — as páginas de categoria mostram só a listagem.'
              : 'Nenhum banner cadastrado — a home mostra a abertura automática.'}
          </p>
        )}

        {banners.map(b => {
          const s = situacao(b)
          return (
            <div key={b.id} className="p-4">
              {editandoId === b.id ? (
                <BannerForm
                  lojaId={lojaId}
                  id={b.id}
                  modo={modo}
                  opcoesCategoria={opcoesCategoria}
                  inicial={{ ...b, loja_categoria_id: b.loja_categoria_id ?? '' }}
                  aoSalvar={() => { setEditandoId(null); router.refresh() }}
                  aoCancelar={() => setEditandoId(null)}
                />
              ) : (
                <div className="flex items-center gap-3">
                  <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                    {b.imagem_url && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={b.imagem_url} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-gray-900">{b.titulo || '(sem título)'}</p>
                      {ehCategoria && (
                        <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                          {opcoesCategoria.find(o => o.id === b.loja_categoria_id)?.rotulo ?? 'categoria removida'}
                        </span>
                      )}
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${s.cor}`}>
                        {s.texto}
                      </span>
                    </div>
                    <p className="truncate text-xs text-gray-500">
                      ordem {b.ordem}
                      {b.inicio_em && ` · a partir de ${new Date(b.inicio_em).toLocaleString('pt-BR')}`}
                      {b.fim_em && ` · até ${new Date(b.fim_em).toLocaleString('pt-BR')}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => setEditandoId(b.id)} className={botao('secundario', 'sm')}>Editar</button>
                    <button onClick={() => excluir(b.id)} className={botao('perigo', 'sm')}>Excluir</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function BannerForm({ lojaId, id, modo, opcoesCategoria, inicial, aoSalvar, aoCancelar }: {
  lojaId: string
  id?: string
  modo: 'hero' | 'categoria'
  opcoesCategoria: { id: string; rotulo: string }[]
  inicial: Omit<Banner, 'id'>
  aoSalvar: () => void
  aoCancelar: () => void
}) {
  const [form, setForm] = useState(inicial)
  const [salvando, setSalvando] = useState(false)
  const [enviando, setEnviando] = useState<'desktop' | 'mobile' | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const set = (k: keyof typeof form, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  async function upload(arquivo: File, campo: 'imagem_url' | 'imagem_mobile_url', tipo: 'desktop' | 'mobile') {
    setEnviando(tipo)
    setErro(null)
    try {
      const sb = createClient()
      const ext = arquivo.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `banners/${lojaId}/${tipo}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await sb.storage.from('produto-imagens').upload(path, arquivo, { upsert: false })
      if (error) throw error
      const { data } = sb.storage.from('produto-imagens').getPublicUrl(path)
      set(campo, data.publicUrl)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha no envio da imagem')
    } finally {
      setEnviando(null)
    }
  }

  async function salvar() {
    setSalvando(true)
    setErro(null)
    try {
      const corpo = {
        lojaId,
        titulo: form.titulo, subtitulo: form.subtitulo,
        imagemUrl: form.imagem_url, imagemMobileUrl: form.imagem_mobile_url,
        linkUrl: form.link_url, ctaTexto: form.cta_texto,
        ordem: form.ordem, ativo: form.ativo,
        inicioEm: form.inicio_em, fimEm: form.fim_em,
        // `posicao` explícita só na criação: é a rota que decide pelo que
        // recebe, e categoria vazia NÃO pode cair em banner da home.
        ...(modo === 'categoria' ? { posicao: 'categoria', categoriaId: form.loja_categoria_id } : {}),
      }
      const r = await fetch(id ? `/api/loja-admin/banners/${id}` : '/api/loja-admin/banners', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      })
      const dados = await r.json()
      if (!r.ok) throw new Error(dados.erro ?? 'Não foi possível salvar')
      aoSalvar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
      {modo === 'categoria' && (
        <div>
          <label className="block text-sm font-medium text-gray-700">Categoria</label>
          <select
            value={form.loja_categoria_id ?? ''}
            onChange={e => set('loja_categoria_id', e.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-2 text-sm"
          >
            <option value="">Escolha a categoria…</option>
            {opcoesCategoria.map(o => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Escolher uma categoria-mãe cobre também as subcategorias dela.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <CampoImagem
          rotulo="Imagem (desktop)"
          ajuda="Larga e baixa — vira uma faixa no topo da página."
          url={form.imagem_url}
          enviando={enviando === 'desktop'}
          onArquivo={a => upload(a, 'imagem_url', 'desktop')}
        />
        <CampoImagem
          rotulo="Imagem (celular, opcional)"
          ajuda="Sem esta, o celular usa a mesma imagem do desktop — que costuma cortar mal."
          url={form.imagem_mobile_url}
          enviando={enviando === 'mobile'}
          onArquivo={a => upload(a, 'imagem_mobile_url', 'mobile')}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700">Título (alt da imagem)</label>
          <input value={form.titulo ?? ''} onChange={e => set('titulo', e.target.value)} maxLength={120}
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Link ao clicar</label>
          <input value={form.link_url ?? ''} onChange={e => set('link_url', e.target.value)} maxLength={500}
            placeholder="/c/ferramentas ou /produto/algum-slug"
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700">Começa em (opcional)</label>
          <input type="datetime-local" value={paraDatetimeLocal(form.inicio_em)}
            onChange={e => set('inicio_em', e.target.value ? new Date(e.target.value).toISOString() : null)}
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Termina em (opcional)</label>
          <input type="datetime-local" value={paraDatetimeLocal(form.fim_em)}
            onChange={e => set('fim_em', e.target.value ? new Date(e.target.value).toISOString() : null)}
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm" />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="w-28">
          <label className="block text-sm font-medium text-gray-700">Ordem</label>
          <input type="number" value={form.ordem} onChange={e => set('ordem', Number(e.target.value))}
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm" />
        </div>
        <label className="flex items-center gap-2 pt-5 text-sm text-gray-700">
          <input type="checkbox" checked={form.ativo} onChange={e => set('ativo', e.target.checked)} className="h-4 w-4" />
          Ativo
        </label>
      </div>

      {erro && <p className="text-sm text-red-700">{erro}</p>}

      <div className="flex gap-2">
        <button
          onClick={salvar}
          disabled={salvando || !form.imagem_url || (modo === 'categoria' && !form.loja_categoria_id)}
          className={botao('primario')}
        >
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button onClick={aoCancelar} disabled={salvando} className={botao('secundario')}>Cancelar</button>
        {!form.imagem_url && <span className="self-center text-xs text-gray-500">Envie uma imagem para salvar</span>}
        {form.imagem_url && modo === 'categoria' && !form.loja_categoria_id && (
          <span className="self-center text-xs text-gray-500">Escolha a categoria para salvar</span>
        )}
      </div>
    </div>
  )
}

function CampoImagem({ rotulo, ajuda, url, enviando, onArquivo }: {
  rotulo: string; ajuda: string; url: string | null; enviando: boolean; onArquivo: (a: File) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">{rotulo}</label>
      <div className="mt-1 flex items-center gap-3">
        <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-300 bg-white">
          {url
            /* eslint-disable-next-line @next/next/no-img-element */
            ? <img src={url} alt="" className="h-full w-full object-cover" />
            : <span className="text-xs text-gray-400">sem imagem</span>}
        </div>
        <label className={`${botao('secundario', 'sm')} cursor-pointer`}>
          {enviando ? 'Enviando…' : 'Escolher arquivo'}
          <input type="file" accept="image/*" className="hidden" disabled={enviando}
            onChange={e => { const a = e.target.files?.[0]; if (a) onArquivo(a) }} />
        </label>
      </div>
      <p className="mt-1 text-xs text-gray-500">{ajuda}</p>
    </div>
  )
}
