'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// A bancada de montagem entre "o Auxiliar sugeriu" e "o pedido foi para o
// fornecedor".
//
// Agrupada por fornecedor sempre — é a pergunta que esta tela existe para
// responder: quais produtos vão juntos no mesmo pedido. Um item sem
// fornecedor fica isolado no topo, porque ele não pode virar pedido até
// alguém decidir de onde vem.

type Item = {
  id: string
  produto_id: string
  nome: string
  sku: string | null
  estoque: number
  unidade: string
  quantidade: number
  fornecedor_id: string | null
  custo_unitario_estimado: number | null
  observacao: string | null
  motivo: string | null
}

type Fornecedor = { id: string; razao_social: string; nome_fantasia: string | null }
type HistoricoLinha = { produto_id: string; fornecedor_id: string; custo_ultimo: number | null; preferencial: boolean }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const nomeForn = (f: Fornecedor) => f.nome_fantasia || f.razao_social

export default function ComprasListaClient({ lista, itens: itensIniciais, fornecedores, historicoPorProduto, erro }: {
  lista: { id: string; nome: string; status: string; created_at: string }
  itens: Item[]
  fornecedores: Fornecedor[]
  historicoPorProduto: HistoricoLinha[]
  erro: string | null
}) {
  const router = useRouter()
  const [itens, setItens] = useState(itensIniciais)
  const [processando, setProcessando] = useState<string | null>(null)
  const [aviso, setAviso] = useState('')
  const [resultado, setResultado] = useState<{ pedidos: { pedidoId: string; fornecedorId: string; itens: number; total: number }[]; semFornecedor: number } | null>(null)

  const nomeDoFornecedor = useMemo(() => new Map(fornecedores.map(f => [f.id, nomeForn(f)])), [fornecedores])

  const historicoDoProduto = useMemo(() => {
    const m = new Map<string, HistoricoLinha[]>()
    for (const h of historicoPorProduto) {
      const arr = m.get(h.produto_id) ?? []
      arr.push(h)
      m.set(h.produto_id, arr)
    }
    return m
  }, [historicoPorProduto])

  const grupos = useMemo(() => {
    const m = new Map<string, Item[]>()
    for (const it of itens) {
      const chave = it.fornecedor_id ?? '__sem_fornecedor__'
      const arr = m.get(chave) ?? []
      arr.push(it)
      m.set(chave, arr)
    }
    const semForn = m.get('__sem_fornecedor__') ?? []
    m.delete('__sem_fornecedor__')
    const comForn = [...m.entries()].sort((a, b) =>
      (nomeDoFornecedor.get(a[0]) ?? '').localeCompare(nomeDoFornecedor.get(b[0]) ?? ''))
    return { semForn, comForn }
  }, [itens, nomeDoFornecedor])

  const totalGeral = itens.reduce((s, i) => s + i.quantidade * (i.custo_unitario_estimado ?? 0), 0)

  async function salvarItem(id: string, campo: Partial<Pick<Item, 'quantidade' | 'fornecedor_id' | 'observacao'>>) {
    setItens(prev => prev.map(i => i.id === id ? { ...i, ...campo } : i))
    await fetch(`/api/compras-lista/${lista.id}/item`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: id,
        ...('quantidade' in campo ? { quantidade: campo.quantidade } : {}),
        ...('fornecedor_id' in campo ? { fornecedorId: campo.fornecedor_id } : {}),
        ...('observacao' in campo ? { observacao: campo.observacao } : {}),
      }),
    })
  }

  async function removerItem(id: string) {
    setItens(prev => prev.filter(i => i.id !== id))
    await fetch(`/api/compras-lista/${lista.id}/item?itemId=${id}`, { method: 'DELETE' })
  }

  async function gerarPedido(fornecedorId: string, itensDoGrupo: Item[]) {
    setProcessando(fornecedorId); setAviso(''); setResultado(null)
    try {
      const d = await fetch(`/api/compras-lista/${lista.id}/gerar-pedidos`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds: itensDoGrupo.map(i => i.id) }),
      }).then(r => r.json())
      if (!d.ok) { setAviso(d.erro ?? 'Não foi possível gerar o pedido.'); return }
      setResultado(d)
      setItens(prev => prev.filter(i => !itensDoGrupo.some(g => g.id === i.id)))
      router.refresh()
    } finally {
      setProcessando(null)
    }
  }

  async function gerarTodos() {
    const comFornecedor = itens.filter(i => i.fornecedor_id)
    if (comFornecedor.length === 0) { setAviso('Nenhum item com fornecedor definido.'); return }
    setProcessando('__todos__'); setAviso(''); setResultado(null)
    try {
      const d = await fetch(`/api/compras-lista/${lista.id}/gerar-pedidos`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).then(r => r.json())
      if (!d.ok) { setAviso(d.erro ?? 'Não foi possível gerar os pedidos.'); return }
      setResultado(d)
      setItens(prev => prev.filter(i => !i.fornecedor_id))
      router.refresh()
    } finally {
      setProcessando(null)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <Link href="/dashboard/compras-lista" className="hover:text-gray-600">lista de compra</Link><span>›</span>
        <span className="text-gray-600 font-medium">{lista.nome}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">{lista.nome}</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {itens.length} item(ns) · {grupos.comForn.length} fornecedor(es) · {brl(totalGeral)} estimado
          </p>
        </div>
        {grupos.comForn.length > 0 && (
          <button onClick={gerarTodos} disabled={processando !== null}
            className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
            {processando === '__todos__' ? 'Gerando…' : `Gerar ${grupos.comForn.length} pedido(s)`}
          </button>
        )}
      </div>

      {erro && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>}
      {aviso && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{aviso}</div>}

      {resultado && (
        <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
          <p className="text-emerald-800 font-medium mb-1.5">
            {resultado.pedidos.length} pedido(s) criado(s) como rascunho — revise antes de enviar ao fornecedor:
          </p>
          <div className="flex flex-wrap gap-2">
            {resultado.pedidos.map(p => (
              <Link key={p.pedidoId} href={`/dashboard/pedidos-compra/novo?id=${p.pedidoId}`}
                className="px-2.5 py-1 rounded-full bg-white border border-emerald-300 text-emerald-800 text-xs hover:bg-emerald-100">
                {nomeDoFornecedor.get(p.fornecedorId) ?? 'Fornecedor'} · {p.itens} itens · {brl(p.total)} →
              </Link>
            ))}
          </div>
        </div>
      )}

      {itens.length === 0 && !resultado ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center text-slate-500 text-sm">
          Lista vazia. Adicione produtos pelo <Link href="/dashboard/auxiliar-compras" className="text-blue-600 underline">Auxiliar de Compras</Link>.
        </div>
      ) : (
        <div className="space-y-4">
          {grupos.semForn.length > 0 && (
            <GrupoCartao
              titulo="Sem fornecedor definido"
              subtitulo="Escolha um fornecedor para poder gerar o pedido"
              destaque
              itens={grupos.semForn}
              fornecedores={fornecedores}
              historicoDoProduto={historicoDoProduto}
              onSalvar={salvarItem}
              onRemover={removerItem}
            />
          )}
          {grupos.comForn.map(([fornecedorId, itensDoGrupo]) => (
            <GrupoCartao
              key={fornecedorId}
              titulo={nomeDoFornecedor.get(fornecedorId) ?? 'Fornecedor'}
              itens={itensDoGrupo}
              fornecedores={fornecedores}
              historicoDoProduto={historicoDoProduto}
              onSalvar={salvarItem}
              onRemover={removerItem}
              onGerarPedido={() => gerarPedido(fornecedorId, itensDoGrupo)}
              gerando={processando === fornecedorId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function GrupoCartao({ titulo, subtitulo, destaque, itens, fornecedores, historicoDoProduto, onSalvar, onRemover, onGerarPedido, gerando }: {
  titulo: string
  subtitulo?: string
  destaque?: boolean
  itens: Item[]
  fornecedores: Fornecedor[]
  historicoDoProduto: Map<string, HistoricoLinha[]>
  onSalvar: (id: string, campo: Partial<Pick<Item, 'quantidade' | 'fornecedor_id' | 'observacao'>>) => void
  onRemover: (id: string) => void
  onGerarPedido?: () => void
  gerando?: boolean
}) {
  const total = itens.reduce((s, i) => s + i.quantidade * (i.custo_unitario_estimado ?? 0), 0)

  return (
    <div className={`rounded-xl border bg-white overflow-hidden ${destaque ? 'border-amber-300' : 'border-slate-200'}`}>
      <div className={`flex items-center justify-between px-4 py-2.5 ${destaque ? 'bg-amber-50' : 'bg-slate-50'}`}>
        <div>
          <span className="font-medium text-slate-800 text-sm">{titulo}</span>
          <span className="text-slate-400 text-xs ml-2">{itens.length} item(ns) · {brl(total)}</span>
          {subtitulo && <p className="text-[11px] text-amber-700 mt-0.5">{subtitulo}</p>}
        </div>
        {onGerarPedido && (
          <button onClick={onGerarPedido} disabled={gerando}
            className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 disabled:opacity-50">
            {gerando ? 'Gerando…' : 'Gerar pedido deste fornecedor'}
          </button>
        )}
      </div>
      <div className="divide-y divide-slate-100">
        {itens.map(it => (
          <LinhaItem key={it.id} item={it} fornecedores={fornecedores}
            historico={historicoDoProduto.get(it.produto_id) ?? []}
            onSalvar={onSalvar} onRemover={onRemover} />
        ))}
      </div>
    </div>
  )
}

function LinhaItem({ item, fornecedores, historico, onSalvar, onRemover }: {
  item: Item
  fornecedores: Fornecedor[]
  historico: HistoricoLinha[]
  onSalvar: (id: string, campo: Partial<Pick<Item, 'quantidade' | 'fornecedor_id' | 'observacao'>>) => void
  onRemover: (id: string) => void
}) {
  const idsComHistorico = new Set(historico.map(h => h.fornecedor_id))
  const preferencial = historico.find(h => h.preferencial)?.fornecedor_id

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
      <div className="min-w-[220px] flex-1">
        <div className="font-medium text-slate-800">{item.nome}</div>
        <div className="text-[11px] text-slate-400">
          {item.sku ?? '—'} · estoque {item.estoque}
          {item.motivo && ` · ${item.motivo}`}
        </div>
      </div>

      <input type="number" min={0.001} step="0.001" defaultValue={item.quantidade}
        onBlur={e => { const v = parseFloat(e.target.value); if (v > 0) onSalvar(item.id, { quantidade: v }) }}
        className="w-20 text-right border border-slate-200 rounded px-2 py-1 text-xs" />
      <span className="text-[11px] text-slate-400 -ml-2">{item.unidade}</span>

      <select value={item.fornecedor_id ?? ''} onChange={e => onSalvar(item.id, { fornecedor_id: e.target.value || null })}
        className="border border-slate-200 rounded px-2 py-1 text-xs max-w-[180px]">
        <option value="">Sem fornecedor</option>
        {fornecedores.map(f => (
          <option key={f.id} value={f.id}>
            {(idsComHistorico.has(f.id) ? '★ ' : '') + (f.nome_fantasia || f.razao_social) + (f.id === preferencial ? ' (preferido)' : '')}
          </option>
        ))}
      </select>

      {item.custo_unitario_estimado != null && (
        <span className="text-[11px] text-slate-500 whitespace-nowrap">
          {brl(item.custo_unitario_estimado)}/{item.unidade} · {brl(item.quantidade * item.custo_unitario_estimado)}
        </span>
      )}

      <input defaultValue={item.observacao ?? ''} placeholder="observação"
        onBlur={e => onSalvar(item.id, { observacao: e.target.value || null })}
        className="flex-1 min-w-[100px] border border-slate-200 rounded px-2 py-1 text-xs" />

      <button onClick={() => onRemover(item.id)} className="text-slate-300 hover:text-red-500 text-xs">✕</button>
    </div>
  )
}
