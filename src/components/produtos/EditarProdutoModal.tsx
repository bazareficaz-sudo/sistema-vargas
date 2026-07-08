'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

const TIPOS = [
  { value: 'simples',   label: 'Simples',   desc: 'Produto unitário padrão' },
  { value: 'kit',       label: 'Kit',        desc: 'Composto de outros produtos' },
  { value: 'generico',  label: 'Genérico',   desc: 'Produto sem SKU/EAN definido' },
  { value: 'insumo',    label: 'Insumo',     desc: 'Matéria-prima / uso interno' },
  { value: 'brinde',    label: 'Brinde',     desc: 'Não vendido, distribuído' },
]

type Produto = {
  id: string; nome: string; sku: string | null; ean: string | null
  preco_venda: number; preco_custo: number; unidade: string
  categoria: string | null; marca: string | null
  estoque: number; estoque_minimo: number
  ativo: boolean; disponivel_pdv: boolean; permite_fracao: boolean
  ncm: string | null; tipo: string
  markup?: number | null
  preco_promocional?: number | null
  promocao_inicio?: string | null
  promocao_fim?: string | null
  promocao_ativa?: boolean
}

type KitItem = { id?: string; produto_id: string; nome: string; unidade: string; quantidade: number }

type Props = { produto: Produto | null; onClose: () => void; onSaved: () => void; empresaId: string }

export default function EditarProdutoModal({ produto, onClose, onSaved, empresaId }: Props) {
  const [form, setForm] = useState<Produto | null>(null)
  const [aba, setAba] = useState<'geral' | 'preco' | 'kit' | 'promocao' | 'fiscal'>('geral')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [categorias, setCategorias] = useState<{ id: string; nome: string }[]>([])
  const [marcas, setMarcas] = useState<{ id: string; nome: string }[]>([])
  const [kitItens, setKitItens] = useState<KitItem[]>([])
  const [buscaKit, setBuscaKit] = useState('')
  const [resultadosKit, setResultadosKit] = useState<Produto[]>([])
  const [promocaoInfinita, setPromocaoInfinita] = useState(false)
  const buscarRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (produto) {
      setForm({ ...produto })
      setAba('geral')
      setPromocaoInfinita(!produto.promocao_fim)
      if (produto.tipo === 'kit') carregarKitItens(produto.id)
    }
  }, [produto])

  useEffect(() => {
    const sb = createClient()
    Promise.all([
      sb.from('categorias').select('id, nome').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      sb.from('marcas').select('id, nome').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
    ]).then(([cats, mks]) => {
      setCategorias(cats.data ?? [])
      setMarcas(mks.data ?? [])
    })
  }, [empresaId])

  async function carregarKitItens(kitId: string) {
    const sb = createClient()
    const { data } = await sb
      .from('kit_itens')
      .select('id, produto_id, quantidade, produtos(nome, unidade)')
      .eq('kit_id', kitId)
    setKitItens((data ?? []).map((d: any) => ({
      id: d.id,
      produto_id: d.produto_id,
      nome: d.produtos?.nome ?? '',
      unidade: d.produtos?.unidade ?? 'UN',
      quantidade: d.quantidade,
    })))
  }

  function campo<K extends keyof Produto>(field: K, value: Produto[K]) {
    setForm(prev => prev ? { ...prev, [field]: value } : prev)
  }

  // Markup → calcula preço de venda automaticamente
  function aplicarMarkup(markup: number) {
    if (!form) return
    const custo = form.preco_custo ?? 0
    const venda = custo > 0 ? parseFloat((custo * (1 + markup / 100)).toFixed(2)) : form.preco_venda
    setForm(prev => prev ? { ...prev, markup, preco_venda: venda } : prev)
  }

  // Busca de produtos para kit
  useEffect(() => {
    if (!buscaKit || buscaKit.length < 2) { setResultadosKit([]); return }
    clearTimeout(buscarRef.current)
    buscarRef.current = setTimeout(async () => {
      const sb = createClient()
      const { data } = await sb.from('produtos')
        .select('id, nome, unidade, preco_venda')
        .eq('empresa_id', empresaId)
        .neq('id', form?.id ?? '')
        .neq('tipo', 'kit')
        .ilike('nome', `%${buscaKit}%`)
        .limit(8)
      setResultadosKit((data ?? []) as any)
    }, 300)
  }, [buscaKit, empresaId, form?.id])

  async function adicionarKitItem(prod: Produto) {
    if (kitItens.find(k => k.produto_id === prod.id)) return
    const novoItem: KitItem = { produto_id: prod.id, nome: prod.nome, unidade: prod.unidade, quantidade: 1 }
    setKitItens(prev => [...prev, novoItem])
    setBuscaKit(''); setResultadosKit([])
    if (form?.id) {
      const sb = createClient()
      const { data, error } = await sb.from('kit_itens')
        .insert({ kit_id: form.id, produto_id: prod.id, quantidade: 1 })
        .select().single()
      if (error) {
        setErro('Erro ao salvar item do kit: ' + error.message)
      } else if (data) {
        setKitItens(prev => prev.map(k => k.produto_id === prod.id ? { ...k, id: data.id } : k))
      }
    }
  }

  async function atualizarQtdKit(produtoId: string, quantidade: number) {
    setKitItens(prev => prev.map(k => k.produto_id === produtoId ? { ...k, quantidade } : k))
    if (form?.id) {
      const sb = createClient()
      const { error } = await sb.from('kit_itens').update({ quantidade }).eq('kit_id', form.id).eq('produto_id', produtoId)
      if (error) setErro('Erro ao atualizar quantidade: ' + error.message)
    }
  }

  async function removerKitItem(produtoId: string) {
    setKitItens(prev => prev.filter(k => k.produto_id !== produtoId))
    if (form?.id) {
      const sb = createClient()
      await sb.from('kit_itens').delete().eq('kit_id', form.id).eq('produto_id', produtoId)
    }
  }

  async function salvar() {
    if (!form) return
    setSalvando(true); setErro('')
    const sb = createClient()
    const isKit = form.tipo === 'kit'
    const { error } = await sb.from('produtos').update({
      nome: form.nome,
      tipo: form.tipo,
      sku: form.sku || null,
      ean: form.ean || null,
      preco_venda: form.preco_venda,
      ...(isKit ? {} : { preco_custo: form.preco_custo, markup: form.markup ?? null }),
      preco_promocional: form.preco_promocional ?? null,
      promocao_inicio: form.promocao_inicio ?? null,
      promocao_fim: promocaoInfinita ? null : (form.promocao_fim ?? null),
      promocao_ativa: form.promocao_ativa ?? false,
      unidade: form.unidade,
      categoria: form.categoria || null,
      marca: form.marca || null,
      ...(isKit ? {} : { estoque: form.estoque, estoque_minimo: form.estoque_minimo }),
      ativo: form.ativo,
      disponivel_pdv: form.disponivel_pdv,
      permite_fracao: form.permite_fracao,
      ncm: form.ncm || null,
      updated_at: new Date().toISOString(),
    }).eq('id', form.id)
    if (error) { setSalvando(false); setErro(error.message); return }

    // Garante que a composição do kit está salva (sync completo)
    if (form.tipo === 'kit' && kitItens.length > 0) {
      await sb.from('kit_itens').delete().eq('kit_id', form.id)
      const { error: kitError } = await sb.from('kit_itens').insert(
        kitItens.map(k => ({ kit_id: form.id, produto_id: k.produto_id, quantidade: k.quantidade }))
      )
      if (kitError) { setSalvando(false); setErro('Produto salvo, mas erro na composição: ' + kitError.message); return }
    }

    setSalvando(false)
    onSaved(); onClose()
  }

  if (!produto || !form) return null

  const abaAtiva = 'border-b-2 border-blue-600 text-blue-600 font-medium'
  const abaInativa = 'border-b-2 border-transparent text-gray-500 hover:text-gray-700'

  const markupCalculado = form.preco_custo > 0 && form.preco_venda > 0
    ? (((form.preco_venda - form.preco_custo) / form.preco_custo) * 100)
    : 0

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-[600px] bg-white h-full overflow-y-auto shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-gray-900 font-semibold text-base">Editar produto</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                form.tipo === 'kit'      ? 'bg-purple-100 text-purple-700' :
                form.tipo === 'insumo'   ? 'bg-orange-100 text-orange-700' :
                form.tipo === 'brinde'   ? 'bg-pink-100 text-pink-700' :
                form.tipo === 'generico' ? 'bg-gray-100 text-gray-600' :
                'bg-blue-100 text-blue-700'
              }`}>{TIPOS.find(t => t.value === form.tipo)?.label ?? form.tipo}</span>
            </div>
            <p className="text-gray-400 text-xs mt-0.5 truncate max-w-sm">{produto.nome}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {/* Abas */}
        <div className="flex border-b border-gray-200 px-6">
          {[
            { key: 'geral',    label: 'Geral' },
            { key: 'preco',    label: 'Preço & Markup' },
            { key: 'promocao', label: 'Promoção' },
            ...(form.tipo === 'kit' ? [{ key: 'kit', label: 'Composição' }] : []),
            { key: 'fiscal',   label: 'Fiscal' },
          ].map(a => (
            <button key={a.key} onClick={() => setAba(a.key as typeof aba)}
              className={`py-3 px-1 mr-5 text-sm transition-colors ${aba === a.key ? abaAtiva : abaInativa}`}>
              {a.label}
            </button>
          ))}
        </div>

        <div className="flex-1 px-6 py-5">

          {/* ── ABA GERAL ── */}
          {aba === 'geral' && (
            <div className="space-y-4">
              {/* Tipo */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Tipo de produto</label>
                <div className="grid grid-cols-5 gap-2">
                  {TIPOS.map(t => (
                    <button key={t.value} onClick={() => campo('tipo', t.value)}
                      title={t.desc}
                      className={`py-2 px-1 text-xs border rounded-lg text-center transition-colors font-medium ${
                        form.tipo === t.value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Status toggles */}
              <div className="flex gap-5 py-1">
                {[
                  { field: 'ativo' as const,          label: 'Ativo' },
                  { field: 'disponivel_pdv' as const,  label: 'Disponível no PDV' },
                  { field: 'permite_fracao' as const,  label: 'Permite fração' },
                ].map(({ field, label }) => (
                  <label key={field} className="flex items-center gap-2 cursor-pointer select-none">
                    <div onClick={() => campo(field, !form[field])}
                      className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${form[field] ? 'bg-green-500' : 'bg-gray-300'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form[field] ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                    <span className="text-sm text-gray-700">{label}</span>
                  </label>
                ))}
              </div>

              {/* Nome */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Descrição *</label>
                <input value={form.nome} onChange={e => campo('nome', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
              </div>

              {/* SKU + EAN */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Código (SKU)</label>
                  <input value={form.sku ?? ''} onChange={e => campo('sku', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">GTIN/EAN</label>
                  <input value={form.ean ?? ''} onChange={e => campo('ean', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
              </div>

              {/* Unidade */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Unidade</label>
                  <select value={form.unidade} onChange={e => campo('unidade', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500">
                    {['UN','KG','LT','MT','CX','PC','PR','DZ','CT','M2','M3','GR','ML','CM'].map(u => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Categoria + Marca */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Categoria</label>
                  <select value={form.categoria ?? ''} onChange={e => campo('categoria', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500">
                    <option value="">— Sem categoria —</option>
                    {categorias.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Marca</label>
                  <select value={form.marca ?? ''} onChange={e => campo('marca', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500">
                    <option value="">— Sem marca —</option>
                    {marcas.map(m => <option key={m.id} value={m.nome}>{m.nome}</option>)}
                  </select>
                </div>
              </div>

              {/* Estoque */}
              {form.tipo === 'kit' && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                  <span className="mt-0.5">⚠️</span>
                  <span>O estoque de kits é calculado automaticamente com base nos componentes. Edite o estoque de cada componente individualmente.</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Estoque atual</label>
                  <input type="number" value={form.estoque}
                    disabled={form.tipo === 'kit'}
                    onChange={e => campo('estoque', parseFloat(e.target.value) || 0)}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none ${form.tipo === 'kit' ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed' : 'border-gray-300 text-gray-900 focus:border-blue-500'}`} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Estoque mínimo</label>
                  <input type="number" value={form.estoque_minimo}
                    disabled={form.tipo === 'kit'}
                    onChange={e => campo('estoque_minimo', parseFloat(e.target.value) || 0)}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none ${form.tipo === 'kit' ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed' : 'border-gray-300 text-gray-900 focus:border-blue-500'}`} />
                </div>
              </div>
            </div>
          )}

          {/* ── ABA PREÇO & MARKUP ── */}
          {aba === 'preco' && (
            <div className="space-y-5">
              {/* Custo */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Custo (R$)
                  {form.tipo === 'kit' && <span className="ml-1 text-amber-500 text-[10px]">(soma dos componentes)</span>}
                </label>
                <input type="number" step="0.01" value={form.preco_custo}
                  disabled={form.tipo === 'kit'}
                  onChange={e => {
                    const custo = parseFloat(e.target.value) || 0
                    const mk = form.markup ?? 0
                    const venda = mk > 0 ? parseFloat((custo * (1 + mk / 100)).toFixed(2)) : form.preco_venda
                    setForm(prev => prev ? { ...prev, preco_custo: custo, preco_venda: venda } : prev)
                  }}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none ${form.tipo === 'kit' ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed' : 'border-gray-300 text-gray-900 focus:border-blue-500'}`} />
              </div>

              {/* Markup */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <label className="block text-xs font-medium text-blue-700 mb-3">Markup (%)</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number" step="0.01"
                    value={form.markup ?? markupCalculado.toFixed(2)}
                    onChange={e => aplicarMarkup(parseFloat(e.target.value) || 0)}
                    className="w-32 border border-blue-300 rounded-lg px-3 py-2 text-sm text-gray-900 font-mono focus:outline-none focus:border-blue-500 bg-white"
                  />
                  <span className="text-blue-600 text-sm font-medium">%</span>
                  <div className="flex gap-2 ml-2">
                    {[20, 30, 50, 100].map(mk => (
                      <button key={mk} onClick={() => aplicarMarkup(mk)}
                        className="px-3 py-1.5 text-xs border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors bg-white">
                        {mk}%
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-blue-500 mt-2">
                  Preço de venda calculado automaticamente: <strong>
                    {form.preco_custo > 0
                      ? (form.preco_custo * (1 + (form.markup ?? markupCalculado) / 100)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                      : '—'}
                  </strong>
                </p>
              </div>

              {/* Preço de venda */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Preço de venda (R$)
                  <span className="text-gray-400 font-normal ml-1">— ou defina manualmente</span>
                </label>
                <input type="number" step="0.01" value={form.preco_venda}
                  onChange={e => {
                    const venda = parseFloat(e.target.value) || 0
                    const custo = form.preco_custo ?? 0
                    const mk = custo > 0 ? ((venda - custo) / custo) * 100 : 0
                    setForm(prev => prev ? { ...prev, preco_venda: venda, markup: parseFloat(mk.toFixed(4)) } : prev)
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 font-mono text-base" />
                {form.preco_custo > 0 && form.preco_venda > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    Margem: <span className={`font-medium ${form.preco_venda > form.preco_custo ? 'text-green-600' : 'text-red-600'}`}>
                      {markupCalculado.toFixed(1)}%
                    </span>
                    {' '}· Lucro bruto: <span className="font-medium text-green-600">
                      {(form.preco_venda - form.preco_custo).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── ABA PROMOÇÃO ── */}
          {aba === 'promocao' && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div onClick={() => campo('promocao_ativa', !form.promocao_ativa)}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${form.promocao_ativa ? 'bg-orange-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.promocao_ativa ? 'translate-x-6' : 'translate-x-1'}`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Promoção ativa</p>
                  <p className="text-xs text-gray-500">O preço promocional será exibido no PDV quando ativo</p>
                </div>
              </div>

              {form.promocao_ativa && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Preço promocional (R$)</label>
                    <input type="number" step="0.01"
                      value={form.preco_promocional ?? ''}
                      onChange={e => campo('preco_promocional', parseFloat(e.target.value) || null)}
                      placeholder={`Normal: ${form.preco_venda.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}
                      className="w-full border border-orange-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-orange-500 font-mono text-base" />
                    {form.preco_promocional && form.preco_venda > 0 && (
                      <p className="text-xs text-orange-600 mt-1">
                        Desconto de {(((form.preco_venda - form.preco_promocional) / form.preco_venda) * 100).toFixed(1)}% sobre o preço normal
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Data de início</label>
                    <input type="datetime-local"
                      value={form.promocao_inicio ? form.promocao_inicio.slice(0, 16) : ''}
                      onChange={e => campo('promocao_inicio', e.target.value ? new Date(e.target.value).toISOString() : null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-600">Data de término</label>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input type="checkbox" checked={promocaoInfinita} onChange={e => setPromocaoInfinita(e.target.checked)}
                          className="w-3.5 h-3.5 accent-orange-500" />
                        <span className="text-xs text-gray-500">Sem prazo (infinito)</span>
                      </label>
                    </div>
                    <input type="datetime-local"
                      disabled={promocaoInfinita}
                      value={form.promocao_fim ? form.promocao_fim.slice(0, 16) : ''}
                      onChange={e => campo('promocao_fim', e.target.value ? new Date(e.target.value).toISOString() : null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400" />
                    {promocaoInfinita && (
                      <p className="text-xs text-orange-500 mt-1">A promoção ficará ativa até ser desativada manualmente.</p>
                    )}
                  </div>
                </>
              )}

              {!form.promocao_ativa && (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-4xl mb-2">🏷️</p>
                  <p className="text-sm">Ative a promoção para configurar o preço especial e o período.</p>
                </div>
              )}
            </div>
          )}

          {/* ── ABA KIT / COMPOSIÇÃO ── */}
          {aba === 'kit' && form.tipo === 'kit' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">Defina os produtos que compõem este kit. O preço do kit é definido manualmente na aba <strong>Preço</strong>.</p>

              {/* Busca produto para adicionar */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Adicionar produto ao kit</label>
                <input
                  value={buscaKit}
                  onChange={e => setBuscaKit(e.target.value)}
                  placeholder="Digite o nome do produto..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
                />
                {resultadosKit.length > 0 && (
                  <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden">
                    {resultadosKit.map(p => (
                      <button key={p.id} onClick={() => adicionarKitItem(p)}
                        className="w-full text-left px-3 py-2.5 hover:bg-blue-50 flex items-center justify-between border-b border-gray-100 last:border-0 transition-colors bg-white">
                        <div>
                          <p className="text-sm text-gray-900">{p.nome}</p>
                          <p className="text-xs text-gray-400">{p.unidade} · {(p.preco_venda ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                        </div>
                        <span className="text-blue-500 text-xs font-medium">+ Adicionar</span>
                      </button>
                    ))}
                  </div>
                )}
                {buscaKit.length >= 2 && resultadosKit.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1">Nenhum produto encontrado para "{buscaKit}".</p>
                )}
              </div>

              {/* Lista de itens do kit */}
              {kitItens.length > 0 ? (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-600">Produto</th>
                        <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-600">Qtd</th>
                        <th className="w-12 px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {kitItens.map(item => (
                        <tr key={item.produto_id} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-gray-900">{item.nome}
                            <span className="text-gray-400 text-xs ml-1">{item.unidade}</span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <input type="number" min="0.001" step="0.001"
                              value={item.quantidade}
                              onChange={e => atualizarQtdKit(item.produto_id, parseFloat(e.target.value) || 1)}
                              className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-blue-500"
                            />
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <button onClick={() => removerKitItem(item.produto_id)}
                              className="text-red-400 hover:text-red-600 transition-colors text-lg leading-none">×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
                  <p className="text-3xl mb-2">📦</p>
                  <p className="text-sm">Nenhum produto no kit ainda.<br />Busque produtos acima para adicionar.</p>
                </div>
              )}
            </div>
          )}

          {/* ── ABA FISCAL ── */}
          {aba === 'fiscal' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">NCM</label>
                  <input value={form.ncm ?? ''} onChange={e => campo('ncm', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <p className="text-xs text-gray-400">Demais configurações fiscais (CFOP, CST, ICMS) são gerenciadas diretamente no PDV.</p>
            </div>
          )}

          {erro && <p className="mt-4 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center">
          <div className="text-xs text-gray-400">
            {form.tipo === 'kit' && `${kitItens.length} produto(s) no kit`}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button onClick={salvar} disabled={salvando}
              className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors font-medium">
              {salvando ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
