'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { botao } from '@/components/ui/botao'

// Gestão de `loja_banners` (posição "hero", a única que a vitrine lê hoje —
// ver src/lib/commerce/catalogo.ts). Só o PRIMEIRO banner ativo e dentro da
// vigência aparece na loja; os outros existem para agendar a troca com
// antecedência (cadastrar a campanha de amanhã hoje, com `inicio_em` de
// amanhã, sem apagar a de hoje).

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
}

const vazio: Omit<Banner, 'id'> = {
  titulo: '', subtitulo: '', imagem_url: null, imagem_mobile_url: null,
  link_url: '', cta_texto: '', ordem: 0, ativo: true, inicio_em: null, fim_em: null,
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

export default function BannersClient({ lojaId, banners }: { lojaId: string; banners: Banner[] }) {
  const router = useRouter()
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)

  const noAr = [...banners]
    .filter(b => b.ativo)
    .sort((a, b) => a.ordem - b.ordem)
    .find(b => {
      const agora = Date.now()
      const comecou = !b.inicio_em || new Date(b.inicio_em).getTime() <= agora
      const naoAcabou = !b.fim_em || new Date(b.fim_em).getTime() >= agora
      return comecou && naoAcabou
    })

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
          <h2 className="font-semibold text-gray-900">Banner de abertura</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Só o primeiro <strong>No ar</strong> (ativo, dentro da vigência, menor ordem) aparece na loja.
            Cadastre vários para agendar trocas sem apagar o atual.
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
              inicial={vazio}
              aoSalvar={() => { setCriando(false); router.refresh() }}
              aoCancelar={() => setCriando(false)}
            />
          </div>
        )}

        {banners.length === 0 && !criando && (
          <p className="p-4 text-sm text-gray-500">Nenhum banner cadastrado — a home mostra a abertura automática.</p>
        )}

        {banners.map(b => {
          const s = situacao(b)
          const ehEsteNoAr = noAr?.id === b.id
          return (
            <div key={b.id} className="p-4">
              {editandoId === b.id ? (
                <BannerForm
                  lojaId={lojaId}
                  id={b.id}
                  inicial={b}
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
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${s.cor}`}>
                        {ehEsteNoAr && s.texto === 'No ar' ? 'No ar agora' : s.texto}
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

function BannerForm({ lojaId, id, inicial, aoSalvar, aoCancelar }: {
  lojaId: string
  id?: string
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
        <button onClick={salvar} disabled={salvando || !form.imagem_url} className={botao('primario')}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button onClick={aoCancelar} disabled={salvando} className={botao('secundario')}>Cancelar</button>
        {!form.imagem_url && <span className="self-center text-xs text-gray-500">Envie uma imagem para salvar</span>}
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
