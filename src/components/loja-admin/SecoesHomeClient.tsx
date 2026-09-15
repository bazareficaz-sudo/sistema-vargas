'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { botao } from '@/components/ui/botao'

// Seções comuns da home ("Ofertas", "Novidades", "Chuveiros"...), mas
// escolhidas pelo operador em vez de só as automáticas — o pedido foi
// exatamente "criar seções... configurar os produtos que irão aparecer ali,
// sendo TAG, MARCA, CATEGORIA ou SUBCATEGORIA".
//
// Diferente do "Destaque por tag" (BlocosHomeClient, visual de banner no
// carrossel do topo): isto é o grid pequeno de sempre — mesmo card,
// CardProduto, que Ofertas e Novidades já usam. Os dois tipos moram na
// mesma tabela (`loja_blocos_home`), diferenciados pelo `tipo`
// ('secao_filtro' aqui, 'destaque_tag' lá).

type Criterio = 'tag' | 'marca' | 'categoria' | 'subcategoria'

type Bloco = {
  id: string
  tipo: string
  titulo: string
  subtitulo: string | null
  limite: number
  ordem: number
  ativo: boolean
  config: { criterio?: Criterio; valor?: string }
}

const ROTULO_CRITERIO: Record<Criterio, string> = {
  tag: 'Tag', marca: 'Marca', categoria: 'Categoria', subcategoria: 'Subcategoria',
}

export default function SecoesHomeClient({
  lojaId, blocos, tagsDisponiveis, marcasDisponiveis, categoriasDisponiveis, subcategoriasDisponiveis,
}: {
  lojaId: string
  blocos: Bloco[]
  tagsDisponiveis: string[]
  marcasDisponiveis: string[]
  categoriasDisponiveis: string[]
  subcategoriasDisponiveis: string[]
}) {
  const router = useRouter()
  const secoes = blocos.filter(b => b.tipo === 'secao_filtro')
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)

  const valoresPorCriterio: Record<Criterio, string[]> = {
    tag: tagsDisponiveis, marca: marcasDisponiveis,
    categoria: categoriasDisponiveis, subcategoria: subcategoriasDisponiveis,
  }
  const temAlgumValor = Object.values(valoresPorCriterio).some(l => l.length > 0)

  async function excluir(id: string) {
    if (!confirm('Excluir esta seção?')) return
    const r = await fetch(`/api/loja-admin/blocos/${id}?lojaId=${lojaId}`, { method: 'DELETE' })
    if (r.ok) router.refresh()
    else alert((await r.json().catch(() => null))?.erro ?? 'Não foi possível excluir')
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 p-4">
        <div>
          <h2 className="font-semibold text-gray-900">Seções da home</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Uma seção comum, no grid de produtos de sempre. Dá o nome ("Chuveiros", "Categoria
            Destaques"...) e escolhe quem entra: por tag, marca, categoria ou subcategoria — sem
            escolher produto por produto.
          </p>
        </div>
        {!criando && temAlgumValor && (
          <button onClick={() => setCriando(true)} className={botao('primario', 'sm')}>+ Nova seção</button>
        )}
      </div>

      <div className="divide-y divide-gray-100">
        {!temAlgumValor && (
          <p className="p-4 text-sm text-gray-500">
            Nenhuma tag, marca ou categoria cadastrada ainda no catálogo desta empresa.
          </p>
        )}

        {criando && (
          <div className="p-4">
            <SecaoForm
              lojaId={lojaId}
              valoresPorCriterio={valoresPorCriterio}
              inicial={{ titulo: '', subtitulo: '', limite: 8, ordem: 0, ativo: true, criterio: 'marca', valor: marcasDisponiveis[0] ?? tagsDisponiveis[0] ?? categoriasDisponiveis[0] ?? subcategoriasDisponiveis[0] ?? '' }}
              aoSalvar={() => { setCriando(false); router.refresh() }}
              aoCancelar={() => setCriando(false)}
            />
          </div>
        )}

        {secoes.length === 0 && !criando && temAlgumValor && (
          <p className="p-4 text-sm text-gray-500">Nenhuma seção criada ainda — a home mostra Ofertas e Novidades automaticamente.</p>
        )}

        {secoes.map(b => (
          <div key={b.id} className="p-4">
            {editandoId === b.id ? (
              <SecaoForm
                lojaId={lojaId}
                id={b.id}
                valoresPorCriterio={valoresPorCriterio}
                inicial={{
                  titulo: b.titulo, subtitulo: b.subtitulo ?? '', limite: b.limite, ordem: b.ordem, ativo: b.ativo,
                  criterio: b.config?.criterio ?? 'marca', valor: b.config?.valor ?? '',
                }}
                aoSalvar={() => { setEditandoId(null); router.refresh() }}
                aoCancelar={() => setEditandoId(null)}
              />
            ) : (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900">{b.titulo}</p>
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {b.config?.criterio ? ROTULO_CRITERIO[b.config.criterio] : '?'}: {b.config?.valor}
                    </span>
                    {!b.ativo && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Desativada</span>}
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

function SecaoForm({ lojaId, id, valoresPorCriterio, inicial, aoSalvar, aoCancelar }: {
  lojaId: string
  id?: string
  valoresPorCriterio: Record<Criterio, string[]>
  inicial: { titulo: string; subtitulo: string; limite: number; ordem: number; ativo: boolean; criterio: Criterio; valor: string }
  aoSalvar: () => void
  aoCancelar: () => void
}) {
  const [form, setForm] = useState(inicial)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm(f => ({ ...f, [k]: v }))
  const opcoesAtual = valoresPorCriterio[form.criterio]

  function trocarCriterio(c: Criterio) {
    const opcoes = valoresPorCriterio[c]
    setForm(f => ({ ...f, criterio: c, valor: opcoes[0] ?? '' }))
  }

  async function salvar() {
    setSalvando(true)
    setErro(null)
    try {
      const corpo = {
        lojaId, tipo: 'secao_filtro',
        titulo: form.titulo, subtitulo: form.subtitulo,
        limite: form.limite, ordem: form.ordem, ativo: form.ativo,
        criterio: form.criterio, valor: form.valor,
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
    <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">Critério</label>
          <select value={form.criterio} onChange={e => trocarCriterio(e.target.value as Criterio)}
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-2 text-sm">
            {(Object.keys(ROTULO_CRITERIO) as Criterio[]).map(c => (
              <option key={c} value={c} disabled={valoresPorCriterio[c].length === 0}>
                {ROTULO_CRITERIO[c]}{valoresPorCriterio[c].length === 0 ? ' (nenhuma cadastrada)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Valor</label>
          <select value={form.valor} onChange={e => set('valor', e.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-2 text-sm">
            {opcoesAtual.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
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
          <label className="block text-sm font-medium text-gray-700">Nome da seção</label>
          <input value={form.titulo} onChange={e => set('titulo', e.target.value)} maxLength={120}
            placeholder="Ex.: Chuveiros"
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
          Ativa
        </label>
      </div>

      {erro && <p className="text-sm text-red-700">{erro}</p>}

      <div className="flex gap-2">
        <button onClick={salvar} disabled={salvando || !form.titulo.trim() || !form.valor} className={botao('primario')}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button onClick={aoCancelar} disabled={salvando} className={botao('secundario')}>Cancelar</button>
      </div>
    </div>
  )
}
