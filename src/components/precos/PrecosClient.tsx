'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Produto = {
  id: string
  nome: string
  sku: string | null
  categoria: string | null
  marca: string | null
  preco_custo: number
  preco_venda: number
  markup: number | null
  preco_promocional: number | null
  promocao_ativa: boolean
  promocao_inicio: string | null
  promocao_fim: string | null
  ativo: boolean
  unidade: string
}

type Categoria = { id: string; nome: string }

type Props = {
  produtos: Produto[]
  total: number
  pagina: number
  totalPaginas: number
  q: string
  abaAtiva: string
  categoriaFiltro: string
  categorias: Categoria[]
  empresaId: string
}

const ABAS = [
  { key: 'precos', label: 'Preços' },
  { key: 'promocoes', label: 'Promoções' },
]

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function calcMarkup(custo: number, venda: number) {
  if (!custo || !venda) return 0
  return ((venda / custo) - 1) * 100
}

export default function PrecosClient({
  produtos: inicial, total, pagina, totalPaginas, q: qInicial,
  abaAtiva: abaInicial, categoriaFiltro, categorias, empresaId
}: Props) {
  const router = useRouter()
  const [produtos, setProdutos] = useState(inicial)
  const [aba, setAba] = useState(abaInicial)
  const [q, setQ] = useState(qInicial)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState('')

  // Painel de alteração em massa
  const [painelMassa, setPainelMassa] = useState<'markup' | 'reajuste' | null>(null)
  const [markupMassa, setMarkupMassa] = useState('')
  const [reajusteTipo, setReajusteTipo] = useState<'aumentar' | 'diminuir'>('aumentar')
  const [reajusteValor, setReajusteValor] = useState('')
  const [reajusteBase, setReajusteBase] = useState<'percentual' | 'fixo'>('percentual')

  // Painel de promoção em massa
  const [painelPromocao, setPainelPromocao] = useState(false)
  const [promoDesconto, setPromoDesconto] = useState('')
  const [promoTipo, setPromoTipo] = useState<'percentual' | 'fixo'>('percentual')
  const [promoInicio, setPromoInicio] = useState('')
  const [promoFim, setPromoFim] = useState('')
  const [promoInfinito, setPromoInfinito] = useState(false)

  useEffect(() => { setProdutos(inicial) }, [inicial])
  useEffect(() => { setAba(abaInicial) }, [abaInicial])
  useEffect(() => { setQ(qInicial) }, [qInicial])

  function navegar(params: Record<string, string>) {
    const sp = new URLSearchParams({ q, aba, pagina: String(pagina), ...params })
    router.push(`/dashboard/precos?${sp.toString()}`)
  }

  function toggleAll(checked: boolean) {
    setSelecionados(checked ? new Set(produtos.map(p => p.id)) : new Set())
  }

  function toggleOne(id: string) {
    setSelecionados(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function showMsg(text: string) {
    setMsg(text)
    setTimeout(() => setMsg(''), 3000)
  }

  // Edição inline: { id, campo }
  const [editando, setEditando] = useState<{ id: string; campo: 'custo' | 'markup' | 'venda' } | null>(null)
  const [editValor, setEditValor] = useState('')

  function iniciarEdicao(produto: Produto, campo: 'custo' | 'markup' | 'venda') {
    const val = campo === 'custo' ? produto.preco_custo
      : campo === 'markup' ? (produto.markup ?? calcMarkup(produto.preco_custo, produto.preco_venda))
      : produto.preco_venda
    setEditando({ id: produto.id, campo })
    setEditValor(val.toFixed(campo === 'markup' ? 2 : 2))
  }

  async function salvarEdicaoInline(produto: Produto) {
    if (!editando) return
    const val = parseFloat(editValor.replace(',', '.'))
    if (isNaN(val) || val < 0) { setEditando(null); return }

    let novoCusto = produto.preco_custo
    let novoMarkup = produto.markup ?? calcMarkup(produto.preco_custo, produto.preco_venda)
    let novoPreco = produto.preco_venda

    if (editando.campo === 'custo') {
      novoCusto = val
      novoPreco = novoMarkup > 0 ? parseFloat((novoCusto * (1 + novoMarkup / 100)).toFixed(2)) : novoPreco
    } else if (editando.campo === 'markup') {
      novoMarkup = val
      novoPreco = novoCusto > 0 ? parseFloat((novoCusto * (1 + val / 100)).toFixed(2)) : novoPreco
    } else {
      novoPreco = val
      novoMarkup = novoCusto > 0 ? calcMarkup(novoCusto, val) : novoMarkup
    }

    const sb = createClient()
    await sb.from('produtos').update({
      preco_custo: novoCusto,
      preco_venda: novoPreco,
      markup: novoMarkup,
      updated_at: new Date().toISOString()
    }).eq('id', produto.id)

    setProdutos(prev => prev.map(p => p.id === produto.id
      ? { ...p, preco_custo: novoCusto, preco_venda: novoPreco, markup: novoMarkup }
      : p))
    setEditando(null)
    showMsg('Preço atualizado.')
  }

  function CelulaEditavel({ produto, campo, valor, prefix = '' }: {
    produto: Produto
    campo: 'custo' | 'markup' | 'venda'
    valor: string
    prefix?: string
  }) {
    const ativo = editando?.id === produto.id && editando?.campo === campo
    if (ativo) {
      return (
        <div className="flex items-center justify-end gap-1">
          <input
            value={editValor}
            onChange={e => setEditValor(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') salvarEdicaoInline(produto)
              if (e.key === 'Escape') setEditando(null)
            }}
            className="w-24 border border-blue-400 rounded px-2 py-1 text-sm text-right focus:outline-none bg-white"
            autoFocus
            onBlur={() => salvarEdicaoInline(produto)}
          />
        </div>
      )
    }
    return (
      <button
        onClick={() => iniciarEdicao(produto, campo)}
        className="w-full text-right hover:text-blue-600 hover:underline transition-colors cursor-pointer"
        title={`Clique para editar ${campo}`}
      >
        {prefix}{valor}
      </button>
    )
  }

  // Alteração em massa por markup
  async function aplicarMarkupMassa() {
    const mk = parseFloat(markupMassa.replace(',', '.'))
    if (isNaN(mk) || selecionados.size === 0) return
    setSalvando(true)
    const sb = createClient()
    const updates = produtos
      .filter(p => selecionados.has(p.id) && p.preco_custo > 0)
      .map(p => ({
        id: p.id,
        preco_venda: parseFloat((p.preco_custo * (1 + mk / 100)).toFixed(2)),
        markup: mk,
      }))
    for (const u of updates) {
      await sb.from('produtos').update({ preco_venda: u.preco_venda, markup: u.markup, updated_at: new Date().toISOString() }).eq('id', u.id)
    }
    setProdutos(prev => prev.map(p => {
      const u = updates.find(x => x.id === p.id)
      return u ? { ...p, preco_venda: u.preco_venda, markup: u.markup } : p
    }))
    setSalvando(false)
    setPainelMassa(null)
    setMarkupMassa('')
    setSelecionados(new Set())
    showMsg(`Markup de ${mk}% aplicado em ${updates.length} produto(s).`)
  }

  // Reajuste percentual/fixo em massa
  async function aplicarReajusteMassa() {
    const val = parseFloat(reajusteValor.replace(',', '.'))
    if (isNaN(val) || selecionados.size === 0) return
    setSalvando(true)
    const sb = createClient()
    const updates = produtos
      .filter(p => selecionados.has(p.id))
      .map(p => {
        let novoPreco: number
        if (reajusteBase === 'percentual') {
          novoPreco = reajusteTipo === 'aumentar'
            ? p.preco_venda * (1 + val / 100)
            : p.preco_venda * (1 - val / 100)
        } else {
          novoPreco = reajusteTipo === 'aumentar'
            ? p.preco_venda + val
            : p.preco_venda - val
        }
        novoPreco = Math.max(0, parseFloat(novoPreco.toFixed(2)))
        return { id: p.id, preco_venda: novoPreco, markup: p.preco_custo > 0 ? calcMarkup(p.preco_custo, novoPreco) : p.markup }
      })
    for (const u of updates) {
      await sb.from('produtos').update({ preco_venda: u.preco_venda, markup: u.markup, updated_at: new Date().toISOString() }).eq('id', u.id)
    }
    setProdutos(prev => prev.map(p => {
      const u = updates.find(x => x.id === p.id)
      return u ? { ...p, preco_venda: u.preco_venda, markup: u.markup ?? p.markup } : p
    }))
    setSalvando(false)
    setPainelMassa(null)
    setReajusteValor('')
    setSelecionados(new Set())
    showMsg(`Reajuste aplicado em ${updates.length} produto(s).`)
  }

  // Aplicar promoção em massa
  async function aplicarPromocaoMassa() {
    const desc = parseFloat(promoDesconto.replace(',', '.'))
    if (isNaN(desc) || selecionados.size === 0) return
    setSalvando(true)
    const sb = createClient()
    const updates = produtos
      .filter(p => selecionados.has(p.id))
      .map(p => {
        const promoPreco = promoTipo === 'percentual'
          ? parseFloat((p.preco_venda * (1 - desc / 100)).toFixed(2))
          : parseFloat((p.preco_venda - desc).toFixed(2))
        return {
          id: p.id,
          preco_promocional: Math.max(0, promoPreco),
          promocao_ativa: true,
          promocao_inicio: promoInicio || null,
          promocao_fim: promoInfinito ? null : (promoFim || null),
        }
      })
    for (const u of updates) {
      await sb.from('produtos').update({ ...u, updated_at: new Date().toISOString() }).eq('id', u.id)
    }
    setProdutos(prev => prev.map(p => {
      const u = updates.find(x => x.id === p.id)
      return u ? { ...p, ...u } : p
    }))
    setSalvando(false)
    setPainelPromocao(false)
    setPromoDesconto('')
    setSelecionados(new Set())
    showMsg(`Promoção aplicada em ${updates.length} produto(s).`)
  }

  // Remover promoção em massa
  async function removerPromocaoMassa() {
    if (selecionados.size === 0) return
    if (!confirm(`Remover promoção de ${selecionados.size} produto(s)?`)) return
    setSalvando(true)
    const sb = createClient()
    await sb.from('produtos').update({
      promocao_ativa: false, preco_promocional: null,
      promocao_inicio: null, promocao_fim: null,
      updated_at: new Date().toISOString()
    }).in('id', [...selecionados])
    setProdutos(prev => prev.map(p => selecionados.has(p.id)
      ? { ...p, promocao_ativa: false, preco_promocional: null, promocao_inicio: null, promocao_fim: null }
      : p))
    setSalvando(false)
    setSelecionados(new Set())
    showMsg('Promoções removidas.')
  }

  // Toggle promoção individual
  async function togglePromocao(produto: Produto) {
    const sb = createClient()
    const novoEstado = !produto.promocao_ativa
    await sb.from('produtos').update({ promocao_ativa: novoEstado, updated_at: new Date().toISOString() }).eq('id', produto.id)
    setProdutos(prev => prev.map(p => p.id === produto.id ? { ...p, promocao_ativa: novoEstado } : p))
  }

  const produtosPromo = aba === 'promocoes'
    ? produtos.filter(p => p.preco_promocional !== null && p.preco_promocional > 0)
    : produtos

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>gestão</span><span>›</span>
        <span className="text-gray-600 font-medium">preços</span>
      </div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-gray-900 text-xl font-semibold">Gestão de Preços</h1>
        {msg && (
          <span className="text-sm text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg">{msg}</span>
        )}
      </div>

      {/* Abas */}
      <div className="flex items-end gap-6 border-b border-gray-200 mb-5">
        {ABAS.map(a => (
          <button key={a.key}
            onClick={() => { setAba(a.key); navegar({ aba: a.key, pagina: '1' }) }}
            className={`pb-3 text-sm border-b-2 transition-colors ${aba === a.key ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {a.label}
          </button>
        ))}
      </div>

      {/* Busca + filtro */}
      <div className="flex items-center gap-3 mb-4">
        <form onSubmit={e => { e.preventDefault(); navegar({ q, pagina: '1' }) }} className="flex gap-2 flex-1 max-w-lg">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="Buscar produto..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white" />
          </div>
          <button type="submit" className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 bg-white">Buscar</button>
        </form>
        <select value={categoriaFiltro}
          onChange={e => navegar({ categoria: e.target.value, pagina: '1' })}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-blue-500 bg-white">
          <option value="">Todas as categorias</option>
          {categorias.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
        </select>
        <span className="text-sm text-gray-500">{total.toLocaleString('pt-BR')} produtos</span>
      </div>

      {/* Barra de ações em massa */}
      {selecionados.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-blue-700">{selecionados.size} produto(s) selecionado(s)</span>
          <div className="h-4 w-px bg-blue-200" />
          {aba === 'precos' && <>
            <button onClick={() => { setPainelMassa('markup'); setPainelPromocao(false) }}
              className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${painelMassa === 'markup' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-100'}`}>
              Aplicar markup %
            </button>
            <button onClick={() => { setPainelMassa('reajuste'); setPainelPromocao(false) }}
              className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${painelMassa === 'reajuste' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-100'}`}>
              Reajustar preço
            </button>
            <button onClick={() => { setPainelPromocao(true); setPainelMassa(null) }}
              className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${painelPromocao ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-orange-600 border-orange-300 hover:bg-orange-50'}`}>
              Criar promoção
            </button>
          </>}
          {aba === 'promocoes' && <>
            <button onClick={() => { setPainelPromocao(true); setPainelMassa(null) }}
              className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${painelPromocao ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-orange-600 border-orange-300 hover:bg-orange-50'}`}>
              Editar promoção
            </button>
            <button onClick={removerPromocaoMassa}
              className="text-sm px-3 py-1.5 rounded-lg border bg-white text-red-600 border-red-300 hover:bg-red-50 transition-colors">
              Remover promoção
            </button>
          </>}
          <button onClick={() => { setSelecionados(new Set()); setPainelMassa(null); setPainelPromocao(false) }}
            className="ml-auto text-xs text-gray-500 hover:text-gray-700">
            Cancelar
          </button>
        </div>
      )}

      {/* Painel: Markup em massa */}
      {painelMassa === 'markup' && (
        <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 mb-4 flex items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Markup desejado (%)</label>
            <input value={markupMassa} onChange={e => setMarkupMassa(e.target.value)}
              placeholder="Ex: 30"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-36 focus:outline-none focus:border-blue-500" />
          </div>
          <div className="text-xs text-gray-500 pb-2">
            {markupMassa && !isNaN(parseFloat(markupMassa)) && (
              <span>Exemplo: custo R$10 → venda <strong>{fmt(10 * (1 + parseFloat(markupMassa) / 100))}</strong></span>
            )}
          </div>
          <button onClick={aplicarMarkupMassa} disabled={salvando || !markupMassa}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {salvando ? 'Aplicando...' : `Aplicar em ${selecionados.size} produto(s)`}
          </button>
          <button onClick={() => setPainelMassa(null)} className="text-sm text-gray-400 hover:text-gray-600">Cancelar</button>
        </div>
      )}

      {/* Painel: Reajuste em massa */}
      {painelMassa === 'reajuste' && (
        <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 mb-4 flex items-end gap-4 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
            <div className="flex gap-1">
              {(['aumentar', 'diminuir'] as const).map(t => (
                <button key={t} onClick={() => setReajusteTipo(t)}
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors ${reajusteTipo === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                  {t === 'aumentar' ? '▲ Aumentar' : '▼ Diminuir'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Valor</label>
            <div className="flex gap-1">
              {(['percentual', 'fixo'] as const).map(b => (
                <button key={b} onClick={() => setReajusteBase(b)}
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors ${reajusteBase === b ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                  {b === 'percentual' ? '%' : 'R$'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{reajusteBase === 'percentual' ? 'Percentual (%)' : 'Valor (R$)'}</label>
            <input value={reajusteValor} onChange={e => setReajusteValor(e.target.value)}
              placeholder={reajusteBase === 'percentual' ? 'Ex: 10' : 'Ex: 5,00'}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-32 focus:outline-none focus:border-blue-500" />
          </div>
          <button onClick={aplicarReajusteMassa} disabled={salvando || !reajusteValor}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {salvando ? 'Aplicando...' : `Reajustar ${selecionados.size} produto(s)`}
          </button>
          <button onClick={() => setPainelMassa(null)} className="text-sm text-gray-400 hover:text-gray-600">Cancelar</button>
        </div>
      )}

      {/* Painel: Promoção em massa */}
      {painelPromocao && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-5 py-4 mb-4 flex items-end gap-4 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Desconto</label>
            <div className="flex gap-1">
              {(['percentual', 'fixo'] as const).map(b => (
                <button key={b} onClick={() => setPromoTipo(b)}
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors ${promoTipo === b ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                  {b === 'percentual' ? '% desconto' : 'R$ desconto'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{promoTipo === 'percentual' ? 'Desconto (%)' : 'Valor (R$)'}</label>
            <input value={promoDesconto} onChange={e => setPromoDesconto(e.target.value)}
              placeholder={promoTipo === 'percentual' ? 'Ex: 15' : 'Ex: 5,00'}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-32 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Início</label>
            <input type="datetime-local" value={promoInicio} onChange={e => setPromoInicio(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Fim</label>
            <input type="datetime-local" value={promoFim} onChange={e => setPromoFim(e.target.value)}
              disabled={promoInfinito}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400" />
            <label className="flex items-center gap-1.5 mt-1 cursor-pointer">
              <input type="checkbox" checked={promoInfinito} onChange={e => setPromoInfinito(e.target.checked)} className="accent-orange-500" />
              <span className="text-xs text-gray-600">Sem prazo (infinito)</span>
            </label>
          </div>
          <button onClick={aplicarPromocaoMassa} disabled={salvando || !promoDesconto}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {salvando ? 'Aplicando...' : `Aplicar promoção em ${selecionados.size} produto(s)`}
          </button>
          <button onClick={() => setPainelPromocao(false)} className="text-sm text-gray-400 hover:text-gray-600">Cancelar</button>
        </div>
      )}

      {/* Tabela Preços */}
      {aba === 'precos' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-10 px-4 py-3">
                  <input type="checkbox"
                    checked={selecionados.size === produtos.length && produtos.length > 0}
                    onChange={e => toggleAll(e.target.checked)}
                    className="w-4 h-4 accent-blue-600" />
                </th>
                <th className="text-left px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Produto</th>
                <th className="text-left px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Categoria</th>
                <th className="text-right px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Custo</th>
                <th className="text-right px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Markup</th>
                <th className="text-right px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Preço venda</th>
                <th className="text-right px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Markup Promo</th>
                <th className="text-center px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Promoção</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {produtos.map(p => {
                const markup = p.markup ?? (p.preco_custo > 0 ? calcMarkup(p.preco_custo, p.preco_venda) : 0)
                const markupPromo = p.preco_promocional && p.preco_custo > 0 ? calcMarkup(p.preco_custo, p.preco_promocional) : 0
                return (
                  <tr key={p.id} className={`hover:bg-blue-50/30 transition-colors group ${selecionados.has(p.id) ? 'bg-blue-50/50' : ''}`}>
                    <td className="px-4 py-2.5">
                      <input type="checkbox" checked={selecionados.has(p.id)} onChange={() => toggleOne(p.id)}
                        className="w-4 h-4 accent-blue-600" />
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-gray-900 font-medium truncate max-w-xs">{p.nome}</p>
                      {p.sku && <p className="text-xs text-gray-400 font-mono">{p.sku}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-500">{p.categoria ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600 text-xs">
                      <CelulaEditavel produto={p} campo="custo"
                        valor={p.preco_custo > 0 ? fmt(p.preco_custo) : '—'} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {editando?.id === p.id && editando?.campo === 'markup' ? (
                        <CelulaEditavel produto={p} campo="markup" valor={`${markup.toFixed(1)}%`} />
                      ) : (
                        <button
                          onClick={() => iniciarEdicao(p, 'markup')}
                          className={`text-xs font-medium px-1.5 py-0.5 rounded cursor-pointer hover:ring-2 hover:ring-blue-300 transition-all ${markup >= 30 ? 'bg-green-50 text-green-700' : markup > 0 ? 'bg-yellow-50 text-yellow-700' : 'bg-gray-100 text-gray-400'}`}
                          title="Clique para editar markup">
                          {markup > 0 ? `${markup.toFixed(1)}%` : '—'}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-gray-900">
                      <CelulaEditavel produto={p} campo="venda"
                        valor={p.preco_venda > 0 ? fmt(p.preco_venda) : '—'} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-xs font-medium ${markupPromo >= 30 ? 'text-green-600' : markupPromo > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>
                        {markupPromo > 0 ? `${markupPromo.toFixed(1)}%` : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {p.preco_promocional ? (
                        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
                          {fmt(p.preco_promocional)}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {produtos.length === 0 && (
                <tr><td colSpan={8} className="py-12 text-center text-gray-400">Nenhum produto encontrado.</td></tr>
              )}
            </tbody>
          </table>
          {totalPaginas > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
              <p className="text-xs text-gray-500">
                Mostrando {((pagina - 1) * 100) + 1}–{Math.min(pagina * 100, total)} de {total.toLocaleString('pt-BR')} produtos
              </p>
              <div className="flex items-center gap-1">
                <button disabled={pagina <= 1} onClick={() => navegar({ pagina: String(pagina - 1) })}
                  className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-40 bg-white transition-colors">
                  ← Anterior
                </button>
                <span className="px-3 py-1.5 text-xs text-gray-600 font-medium">{pagina} / {totalPaginas}</span>
                <button disabled={pagina >= totalPaginas} onClick={() => navegar({ pagina: String(pagina + 1) })}
                  className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-40 bg-white transition-colors">
                  Próxima →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tabela Promoções */}
      {aba === 'promocoes' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-10 px-4 py-3">
                  <input type="checkbox"
                    checked={selecionados.size === produtosPromo.length && produtosPromo.length > 0}
                    onChange={e => toggleAll(e.target.checked)}
                    className="w-4 h-4 accent-blue-600" />
                </th>
                <th className="text-left px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Produto</th>
                <th className="text-right px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Preço normal</th>
                <th className="text-right px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Preço promo</th>
                <th className="text-right px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Desconto</th>
                <th className="text-left px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Início</th>
                <th className="text-left px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Fim</th>
                <th className="text-center px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Ativa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {produtosPromo.map(p => {
                const desconto = p.preco_venda > 0 && p.preco_promocional
                  ? ((p.preco_venda - p.preco_promocional) / p.preco_venda) * 100
                  : 0
                const agora = new Date()
                const fim = p.promocao_fim ? new Date(p.promocao_fim) : null
                const expirada = fim && fim < agora
                return (
                  <tr key={p.id} className={`hover:bg-orange-50/30 transition-colors group ${selecionados.has(p.id) ? 'bg-orange-50/50' : ''}`}>
                    <td className="px-4 py-2.5">
                      <input type="checkbox" checked={selecionados.has(p.id)} onChange={() => toggleOne(p.id)}
                        className="w-4 h-4 accent-orange-500" />
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-gray-900 font-medium truncate max-w-xs">{p.nome}</p>
                      <p className="text-xs text-gray-400">{p.categoria ?? ''}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-500 text-xs line-through">
                      {fmt(p.preco_venda)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-orange-600">
                      {p.preco_promocional ? fmt(p.preco_promocional) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-xs font-medium bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                        -{desconto.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-500">
                      {p.promocao_inicio ? new Date(p.promocao_inicio).toLocaleDateString('pt-BR') : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {p.promocao_fim ? (
                        <span className={expirada ? 'text-red-500 font-medium' : 'text-gray-500'}>
                          {new Date(p.promocao_fim).toLocaleDateString('pt-BR')}
                          {expirada && ' (expirada)'}
                        </span>
                      ) : (
                        <span className="text-green-600 font-medium">Sem prazo</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <button onClick={() => togglePromocao(p)}
                        className={`w-10 h-5 rounded-full transition-colors relative ${p.promocao_ativa ? 'bg-orange-400' : 'bg-gray-300'}`}>
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${p.promocao_ativa ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {produtosPromo.length === 0 && (
                <tr><td colSpan={8} className="py-12 text-center text-gray-400">
                  Nenhuma promoção cadastrada. Selecione produtos na aba <strong>Preços</strong> e clique em &quot;Criar promoção&quot;.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
