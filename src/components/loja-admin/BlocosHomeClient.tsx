'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { botao } from '@/components/ui/botao'

// Gestão dos blocos "Destaque por tag" — o banner dinâmico pedido: em vez de
// arte estática, mostra ao vivo os produtos que têm uma TAG (a mesma que a
// tela Dashboard → Produtos já usa para marcar produtos manualmente), com
// imagem, nome e preço vindos do catálogo. Muda o preço do produto, o banner
// muda sozinho — nada para reeditar.
//
// Escopo desta tela DE PROPÓSITO limitado a `destaque_tag`: os outros tipos
// de `loja_blocos_home` (ofertas, novidades, seleção manual...) já têm
// comportamento automático sem cadastro nenhum, e a rota
// `/api/loja-admin/blocos` já aceita qualquer tipo válido — é gestão
// completa de blocos que ficou de fora, não a tabela.

type Bloco = {
  id: string
  tipo: string
  titulo: string
  subtitulo: string | null
  limite: number
  ordem: number
  ativo: boolean
  config: { tag?: string }
}

export default function BlocosHomeClient({ lojaId, blocos, tagsDisponiveis }: {
  lojaId: string
  blocos: Bloco[]
  tagsDisponiveis: string[]
}) {
  const router = useRouter()
  const destaques = blocos.filter(b => b.tipo === 'destaque_tag')
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)

  async function excluir(id: string) {
    if (!confirm('Excluir este destaque?')) return
    const r = await fetch(`/api/loja-admin/blocos/${id}?lojaId=${lojaId}`, { method: 'DELETE' })
    if (r.ok) router.refresh()
    else alert((await r.json().catch(() => null))?.erro ?? 'Não foi possível excluir')
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 p-4">
        <div>
          <h2 className="font-semibold text-gray-900">Destaque por tag</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Um banner com visual de banner, mas o conteúdo é ao vivo do catálogo: escolha uma tag
            e os produtos marcados com ela aparecem na home com imagem, nome e preço atuais —
            nunca desatualizado, porque não é uma arte, é o próprio produto.
          </p>
        </div>
        {!criando && tagsDisponiveis.length > 0 && (
          <button onClick={() => setCriando(true)} className={botao('primario', 'sm')}>+ Novo destaque</button>
        )}
      </div>

      <div className="divide-y divide-gray-100">
        {tagsDisponiveis.length === 0 && (
          <p className="p-4 text-sm text-gray-500">
            Nenhuma tag cadastrada ainda. Marque produtos com uma tag em{' '}
            <strong>Dashboard → Produtos</strong> (seleção em massa → Gerenciar tags) e ela aparece aqui.
          </p>
        )}

        {criando && (
          <div className="p-4">
            <BlocoForm
              lojaId={lojaId}
              tagsDisponiveis={tagsDisponiveis}
              inicial={{ titulo: '', subtitulo: '', limite: 3, ordem: 0, ativo: true, tag: tagsDisponiveis[0] ?? '' }}
              aoSalvar={() => { setCriando(false); router.refresh() }}
              aoCancelar={() => setCriando(false)}
            />
          </div>
        )}

        {destaques.length === 0 && !criando && tagsDisponiveis.length > 0 && (
          <p className="p-4 text-sm text-gray-500">Nenhum destaque por tag cadastrado ainda.</p>
        )}

        {destaques.map(b => (
          <div key={b.id} className="p-4">
            {editandoId === b.id ? (
              <BlocoForm
                lojaId={lojaId}
                id={b.id}
                tagsDisponiveis={tagsDisponiveis}
                inicial={{
                  titulo: b.titulo, subtitulo: b.subtitulo ?? '', limite: b.limite,
                  ordem: b.ordem, ativo: b.ativo, tag: b.config?.tag ?? tagsDisponiveis[0] ?? '',
                }}
                aoSalvar={() => { setEditandoId(null); router.refresh() }}
                aoCancelar={() => setEditandoId(null)}
              />
            ) : (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900">{b.titulo}</p>
                    <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
                      #{b.config?.tag}
                    </span>
                    {!b.ativo && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Desativado</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">até {b.limite} produto(s) · ordem {b.ordem}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => setEditandoId(b.id)} className={botao('secundario', 'sm')}>Editar</button>
                  <button onClick={() => excluir(b.id)} className={botao('perigo', 'sm')}>Excluir</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function BlocoForm({ lojaId, id, tagsDisponiveis, inicial, aoSalvar, aoCancelar }: {
  lojaId: string
  id?: string
  tagsDisponiveis: string[]
  inicial: { titulo: string; subtitulo: string; limite: number; ordem: number; ativo: boolean; tag: string }
  aoSalvar: () => void
  aoCancelar: () => void
}) {
  const [form, setForm] = useState(inicial)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm(f => ({ ...f, [k]: v }))

  async function salvar() {
    setSalvando(true)
    setErro(null)
    try {
      const corpo = {
        lojaId, tipo: 'destaque_tag',
        titulo: form.titulo, subtitulo: form.subtitulo,
        limite: form.limite, ordem: form.ordem, ativo: form.ativo,
        tag: form.tag,
      }
      const r = await fetch(id ? `/api/loja-admin/blocos/${id}` : '/api/loja-admin/blocos', {
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
    <div className="space-y-3 rounded-lg border border-teal-200 bg-teal-50/40 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700">Tag</label>
          <select value={form.tag} onChange={e => set('tag', e.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-2 text-sm">
            {tagsDisponiveis.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Todo produto publicado com esta tag e com saldo entra, até o limite abaixo.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Quantos produtos (2 a 24)</label>
          <input type="number" min={2} max={24} value={form.limite}
            onChange={e => set('limite', Number(e.target.value))}
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700">Título na home</label>
          <input value={form.titulo} onChange={e => set('titulo', e.target.value)} maxLength={120}
            placeholder="Ex.: Ofertas da semana"
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Subtítulo (opcional)</label>
          <input value={form.subtitulo} onChange={e => set('subtitulo', e.target.value)} maxLength={200}
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
        <button onClick={salvar} disabled={salvando || !form.titulo.trim() || !form.tag} className={botao('primario')}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button onClick={aoCancelar} disabled={salvando} className={botao('secundario')}>Cancelar</button>
      </div>
    </div>
  )
}
