'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import ImprimirEtiquetaModal from '@/components/etiquetas/ImprimirEtiquetaModal'
import type { ProdutoParaEtiqueta } from '@/lib/etiquetas/tipos'

type Entrada = {
  id: string
  numero_entrada: string | null
  numero_nf: string | null
  serie: string | null
  data_emissao: string | null
  data_entrada: string
  valor_total: number
  status: string
  status_revisao: string | null
  created_at: string
  fornecedores: { razao_social: string; nome_fantasia: string | null } | null
  qtd_itens?: number
  total_contas?: number
}

type Fornecedor = { id: string; razao_social: string; nome_fantasia: string | null }

type ItemEntrada = {
  id: string
  nome_produto: string | null
  sku: string | null
  quantidade: number
  preco_custo_novo: number | null
  subtotal: number | null
}

const STATUS_CLS: Record<string, string> = {
  confirmada: 'bg-green-100 text-green-700',
  cancelada:  'bg-red-100 text-red-600',
  rascunho:   'bg-yellow-100 text-yellow-700',
}
const STATUS_LABEL: Record<string, string> = {
  confirmada: 'Confirmada',
  cancelada:  'Cancelada',
  rascunho:   'Rascunho',
}
const REVISAO_CLS: Record<string, string> = {
  revisado:   'bg-emerald-50 text-emerald-600 border border-emerald-100',
  pendente:   'bg-orange-50 text-orange-600 border border-orange-100',
  em_revisao: 'bg-blue-50 text-blue-600 border border-blue-100',
  dispensado: 'bg-gray-100 text-gray-500 border border-gray-200',
}
const REVISAO_LABEL: Record<string, string> = {
  revisado:   '✓ Revisado',
  pendente:   '⏳ Preços pendentes',
  em_revisao: '✎ Em revisão',
  dispensado: '— Dispensado',
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtData(d: string | null | undefined) {
  if (!d) return '—'
  // data_entrada é TIMESTAMPTZ (já vem com hora/timezone) — só datas puras
  // "YYYY-MM-DD" (10 chars, ex: data_emissao) precisam do T00:00:00 anexado.
  const date = d.length <= 10 ? new Date(d + 'T00:00:00') : new Date(d)
  return isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR')
}

export default function EntradasListClient({
  entradas: inicial,
  fornecedores,
  pendencias,
  empresaId,
  operador,
}: {
  entradas: Entrada[]
  fornecedores: Fornecedor[]
  pendencias: { semRevisao: number; semContas: number; rascunho: number }
  empresaId: string
  operador: string
}) {
  const [lista, setLista] = useState<Entrada[]>(inicial)
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [filtroRevisao, setFiltroRevisao] = useState('')
  const [filtroForn, setFiltroForn] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [confirmando, setConfirmando] = useState<Entrada | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')
  const [carregandoAcao, setCarregandoAcao] = useState<string | null>(null)
  const [etiquetaProdutos, setEtiquetaProdutos] = useState<(ProdutoParaEtiqueta & { estoque: number })[] | null>(null)

  // Busca por produto: o nome/SKU do item fica em entrada_itens (já
  // desnormalizado), então dá pra achar a entrada pelo que foi comprado sem
  // precisar abrir uma por uma. `idsComProduto = null` significa "sem busca
  // de produto ativa" — diferente de Set vazio, que é "buscou e não achou".
  const [buscaProduto, setBuscaProduto] = useState('')
  const [idsComProduto, setIdsComProduto] = useState<Set<string> | null>(null)
  const [buscandoProduto, setBuscandoProduto] = useState(false)

  // Itens expandidos direto na linha, sem abrir a entrada. Carrega sob
  // demanda e guarda em cache — reabrir a mesma entrada não consulta de novo.
  const [expandida, setExpandida] = useState<string | null>(null)
  const [itensPorEntrada, setItensPorEntrada] = useState<Record<string, ItemEntrada[]>>({})
  const [carregandoItens, setCarregandoItens] = useState<string | null>(null)

  useEffect(() => {
    const termo = buscaProduto.trim()
    if (termo.length < 2) { setIdsComProduto(null); setBuscandoProduto(false); return }
    setBuscandoProduto(true)
    let ativo = true
    const timer = setTimeout(async () => {
      const sb = createClient()
      // Restringe às entradas já carregadas: além de ser mais rápido, é o que
      // garante que o resultado é só desta empresa (entrada_itens não tem
      // empresa_id próprio).
      const escapado = termo.replace(/[%,()]/g, ' ')
      const { data } = await sb.from('entrada_itens')
        .select('entrada_id')
        .in('entrada_id', lista.map(e => e.id))
        .or(`nome_produto.ilike.%${escapado}%,sku.ilike.%${escapado}%`)
      if (!ativo) return
      setIdsComProduto(new Set((data ?? []).map(r => r.entrada_id)))
      setBuscandoProduto(false)
    }, 350)
    return () => { ativo = false; clearTimeout(timer) }
  }, [buscaProduto, lista])

  async function alternarItens(entradaId: string) {
    if (expandida === entradaId) { setExpandida(null); return }
    setExpandida(entradaId)
    if (itensPorEntrada[entradaId]) return // já em cache
    setCarregandoItens(entradaId)
    const sb = createClient()
    const { data } = await sb.from('entrada_itens')
      .select('id, nome_produto, sku, quantidade, preco_custo_novo, subtotal')
      .eq('entrada_id', entradaId)
      .order('nome_produto')
    setItensPorEntrada(prev => ({ ...prev, [entradaId]: (data ?? []) as ItemEntrada[] }))
    setCarregandoItens(null)
  }

  // Mesmo padrão de src/components/entradas-xml/EntradasXmlClient.tsx, mas
  // lendo direto de entrada_itens (entrada manual já vincula produto_id sem
  // precisar de mapeamento intermediário, diferente da entrada por XML).
  async function imprimirEtiquetasEntrada(entradaId: string) {
    setCarregandoAcao(`etiqueta-${entradaId}`)
    const sb = createClient()
    try {
      const { data: itens, error } = await sb.from('entrada_itens')
        .select('produto_id, quantidade').eq('entrada_id', entradaId)
      if (error) { alert('Erro ao buscar itens da entrada: ' + error.message); return }
      if (!itens || itens.length === 0) { alert('Esta entrada não tem itens vinculados a produto.'); return }

      const qtdPorProduto = new Map<string, number>()
      for (const item of itens) {
        if (!item.produto_id) continue
        qtdPorProduto.set(item.produto_id, (qtdPorProduto.get(item.produto_id) ?? 0) + (item.quantidade || 0))
      }
      const ids = Array.from(qtdPorProduto.keys())
      if (ids.length === 0) { alert('Nenhum item desta entrada está vinculado a um produto.'); return }

      const { data: dadosProdutos, error: errProdutos } = await sb.from('produtos')
        .select('id, nome, sku, ean, preco_venda, preco_promocional, promocao_ativa, promocao_inicio, promocao_fim, marca, unidade, categoria')
        .in('id', ids)
      if (errProdutos) { alert('Erro ao buscar produtos: ' + errProdutos.message); return }
      const porId = new Map((dadosProdutos ?? []).map(p => [p.id, p]))

      const produtosEtiqueta = ids.map(id => {
        const p = porId.get(id)
        return {
          id, nome: p?.nome ?? '(produto)', sku: p?.sku ?? null, ean: p?.ean ?? null,
          preco_venda: p?.preco_venda ?? 0, preco_promocional: p?.preco_promocional ?? null,
          promocao_ativa: p?.promocao_ativa ?? false,
          promocao_inicio: p?.promocao_inicio ?? null, promocao_fim: p?.promocao_fim ?? null,
          marca: p?.marca ?? null, unidade: p?.unidade ?? 'UN', categoria: p?.categoria ?? null,
          estoque: qtdPorProduto.get(id) ?? 0,
        } as ProdutoParaEtiqueta & { estoque: number }
      })
      setEtiquetaProdutos(produtosEtiqueta)
    } finally {
      setCarregandoAcao(null)
    }
  }

  async function excluirEntrada(entrada: Entrada) {
    setExcluindo(true)
    setErroExclusao('')
    const supabase = createClient()
    try {
      if (entrada.status === 'confirmada') {
        // Reverte estoque: busca itens e decrementa quantidade
        const { data: itens } = await supabase
          .from('entrada_itens')
          .select('produto_id, quantidade')
          .eq('entrada_id', entrada.id)
        if (itens && itens.length > 0) {
          for (const item of itens) {
            const { data: prod } = await supabase
              .from('produtos')
              .select('quantidade_estoque')
              .eq('id', item.produto_id)
              .single()
            if (prod) {
              await supabase
                .from('produtos')
                .update({ quantidade_estoque: Math.max(0, (prod.quantidade_estoque ?? 0) - item.quantidade) })
                .eq('id', item.produto_id)
            }
          }
        }
        // Remove contas a pagar vinculadas
        await supabase.from('contas_pagar').delete().eq('entrada_id', entrada.id)
      }
      // Remove itens e a entrada (cascade via FK ou explícito)
      await supabase.from('entrada_itens').delete().eq('entrada_id', entrada.id)
      const { error } = await supabase.from('entradas').delete().eq('id', entrada.id)
      if (error) throw error
      setLista(prev => prev.filter(e => e.id !== entrada.id))
      setConfirmando(null)
    } catch (e: any) {
      setErroExclusao(e.message ?? 'Erro ao excluir')
    } finally {
      setExcluindo(false)
    }
  }

  const filtradas = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return lista.filter(e => {
      if (filtroStatus && e.status !== filtroStatus) return false
      if (filtroRevisao && (e.status_revisao ?? 'pendente') !== filtroRevisao) return false
      if (filtroForn && e.fornecedores && !(e.fornecedores.razao_social + (e.fornecedores.nome_fantasia ?? '')).toLowerCase().includes(filtroForn.toLowerCase())) return false
      if (dataInicio && e.data_entrada < dataInicio) return false
      if (dataFim && e.data_entrada > dataFim) return false
      if (idsComProduto && !idsComProduto.has(e.id)) return false
      if (q) {
        const hay = [e.numero_entrada, e.numero_nf, e.fornecedores?.razao_social, e.fornecedores?.nome_fantasia].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [lista, busca, filtroStatus, filtroRevisao, filtroForn, dataInicio, dataFim, idsComProduto])

  const temFiltro = busca || buscaProduto || filtroStatus || filtroRevisao || filtroForn || dataInicio || dataFim
  function limpar() {
    setBusca(''); setBuscaProduto(''); setFiltroStatus(''); setFiltroRevisao('')
    setFiltroForn(''); setDataInicio(''); setDataFim('')
  }

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>compras</span><span>›</span>
        <span className="text-gray-600 font-medium">entradas</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Entradas de Mercadoria</h1>
          <p className="text-gray-500 text-sm mt-0.5">{filtradas.length} de {lista.length} entradas</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/entradas/produtos"
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
            📦 Produtos Comprados
          </Link>
          <Link href="/dashboard/entradas/nova"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
            + Nova entrada
          </Link>
        </div>
      </div>

      {/* Painel de pendências */}
      {(pendencias.semRevisao > 0 || pendencias.semContas > 0 || pendencias.rascunho > 0) && (
        <div className="mb-5 grid grid-cols-3 gap-3">
          {pendencias.rascunho > 0 && (
            <button onClick={() => setFiltroStatus('rascunho')}
              className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-left hover:bg-yellow-100 transition-colors">
              <span className="text-xl">📝</span>
              <div>
                <p className="text-sm font-semibold text-yellow-800">{pendencias.rascunho}</p>
                <p className="text-xs text-yellow-600">Rascunhos não finalizados</p>
              </div>
            </button>
          )}
          {pendencias.semRevisao > 0 && (
            <button onClick={() => setFiltroRevisao('pendente')}
              className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-left hover:bg-orange-100 transition-colors">
              <span className="text-xl">💰</span>
              <div>
                <p className="text-sm font-semibold text-orange-800">{pendencias.semRevisao}</p>
                <p className="text-xs text-orange-600">Preços pendentes de revisão</p>
              </div>
            </button>
          )}
          {pendencias.semContas > 0 && (
            <button onClick={() => { setFiltroStatus('confirmada'); setFiltroRevisao('') }}
              className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-left hover:bg-red-100 transition-colors">
              <span className="text-xl">💸</span>
              <div>
                <p className="text-sm font-semibold text-red-800">{pendencias.semContas}</p>
                <p className="text-xs text-red-600">Sem contas a pagar geradas</p>
              </div>
            </button>
          )}
        </div>
      )}

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-gray-500 mb-1">Buscar (nº entrada, NF, fornecedor)</label>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="ENT-000001, 12345..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-gray-500 mb-1">
            Buscar por produto comprado
            {buscandoProduto && <span className="text-gray-400 font-normal"> · procurando…</span>}
            {!buscandoProduto && idsComProduto && (
              <span className="text-blue-500 font-normal"> · {idsComProduto.size} entrada(s)</span>
            )}
          </label>
          <input value={buscaProduto} onChange={e => setBuscaProduto(e.target.value)}
            placeholder="Nome ou SKU do produto..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
            <option value="">Todos</option>
            <option value="rascunho">Rascunho</option>
            <option value="confirmada">Confirmada</option>
            <option value="cancelada">Cancelada</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Revisão de preços</label>
          <select value={filtroRevisao} onChange={e => setFiltroRevisao(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
            <option value="">Todos</option>
            <option value="pendente">Pendente</option>
            <option value="em_revisao">Em revisão</option>
            <option value="revisado">Revisado</option>
            <option value="dispensado">Dispensado</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Data início</label>
          <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Data fim</label>
          <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
        </div>
        {temFiltro && (
          <button onClick={limpar} className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50">
            ✕ Limpar
          </button>
        )}
      </div>

      {/* Tabela */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Nº Entrada</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Nº NF</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Fornecedor</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Itens</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Data entrada</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Total</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Status</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Preços</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtradas.map(e => {
              const revisao = e.status_revisao ?? 'pendente'
              const linhaPrincipal = (
                <tr key={e.id} className="hover:bg-gray-50 transition-colors group">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded">
                      {e.numero_entrada ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-500 text-xs">{e.numero_nf ?? '—'}{e.serie ? `/${e.serie}` : ''}</td>
                  <td className="px-4 py-3">
                    <p className="text-gray-900 font-medium text-sm">
                      {e.fornecedores?.nome_fantasia ?? e.fornecedores?.razao_social ?? '—'}
                    </p>
                    {e.fornecedores?.nome_fantasia && (
                      <p className="text-xs text-gray-400">{e.fornecedores.razao_social}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {(e.qtd_itens ?? 0) > 0 ? (
                      <button onClick={() => alternarItens(e.id)}
                        title={expandida === e.id ? 'Esconder itens' : 'Ver os itens comprados'}
                        className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                          expandida === e.id
                            ? 'bg-blue-100 text-blue-700 border-blue-200'
                            : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200'
                        }`}>
                        {expandida === e.id ? '▾' : '▸'} {e.qtd_itens}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {fmtData(e.data_entrada)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">
                    {fmt(Number(e.valor_total))}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_CLS[e.status] ?? STATUS_CLS.rascunho}`}>
                      {STATUS_LABEL[e.status] ?? e.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {e.status === 'confirmada' && (
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${REVISAO_CLS[revisao] ?? REVISAO_CLS.pendente}`}>
                        {REVISAO_LABEL[revisao] ?? revisao}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-3">
                      <Link
                        href={e.status === 'rascunho' ? `/dashboard/entradas/nova?rascunho=${e.id}` : `/dashboard/entradas/${e.id}`}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap">
                        {e.status === 'rascunho' ? 'Continuar →' : 'Abrir →'}
                      </Link>
                      {e.status === 'confirmada' && (
                        <button
                          onClick={() => imprimirEtiquetasEntrada(e.id)}
                          disabled={carregandoAcao === `etiqueta-${e.id}`}
                          className="text-xs text-purple-600 hover:text-purple-800 font-medium whitespace-nowrap disabled:opacity-50">
                          {carregandoAcao === `etiqueta-${e.id}` ? 'Carregando…' : '🏷️ Etiquetas'}
                        </button>
                      )}
                      {e.status !== 'cancelada' && (
                        <button
                          onClick={() => { setErroExclusao(''); setConfirmando(e) }}
                          title="Excluir entrada"
                          className="text-red-400 hover:text-red-600 text-sm transition-colors">
                          🗑
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
              const linhaItens = expandida === e.id ? (
                <tr key={`${e.id}-itens`} className="bg-blue-50/30">
                  <td colSpan={9} className="px-4 py-3">
                    {carregandoItens === e.id ? (
                      <p className="text-xs text-gray-400">Carregando itens…</p>
                    ) : (itensPorEntrada[e.id] ?? []).length === 0 ? (
                      <p className="text-xs text-gray-400">Esta entrada não tem itens.</p>
                    ) : (
                      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-gray-50 text-gray-500 border-b border-gray-200">
                              <th className="text-left px-3 py-1.5 font-medium">SKU</th>
                              <th className="text-left px-3 py-1.5 font-medium">Produto</th>
                              <th className="text-right px-3 py-1.5 font-medium">Qtd</th>
                              <th className="text-right px-3 py-1.5 font-medium">Custo un.</th>
                              <th className="text-right px-3 py-1.5 font-medium">Subtotal</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {(itensPorEntrada[e.id] ?? []).map(item => (
                              <tr key={item.id} className="text-gray-600">
                                <td className="px-3 py-1.5 font-mono text-gray-400">{item.sku ?? '—'}</td>
                                <td className="px-3 py-1.5 text-gray-900">{item.nome_produto ?? '—'}</td>
                                <td className="px-3 py-1.5 text-right">{Number(item.quantidade).toLocaleString('pt-BR')}</td>
                                <td className="px-3 py-1.5 text-right">{item.preco_custo_novo != null ? fmt(Number(item.preco_custo_novo)) : '—'}</td>
                                <td className="px-3 py-1.5 text-right font-medium text-gray-900">
                                  {item.subtotal != null ? fmt(Number(item.subtotal)) : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </td>
                </tr>
              ) : null
              return linhaItens ? [linhaPrincipal, linhaItens] : linhaPrincipal
            })}
            {filtradas.length === 0 && (
              <tr>
                <td colSpan={9} className="py-12 text-center text-gray-400">
                  {temFiltro ? 'Nenhuma entrada encontrada com esses filtros.' : (
                    <>Nenhuma entrada registrada. <Link href="/dashboard/entradas/nova" className="text-blue-600 hover:underline">Criar primeira entrada</Link></>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal de confirmação de exclusão */}
      {confirmando && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Excluir entrada?</h2>
            <p className="text-sm text-gray-500 mb-4">
              {confirmando.numero_entrada ?? 'Rascunho'} —{' '}
              {confirmando.fornecedores?.nome_fantasia ?? confirmando.fornecedores?.razao_social ?? 'Fornecedor não informado'}
            </p>

            {confirmando.status === 'confirmada' ? (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-700">
                <p className="font-semibold mb-1">⚠️ Atenção — entrada confirmada</p>
                <ul className="list-disc list-inside space-y-0.5 text-xs">
                  <li>O estoque dos produtos será revertido</li>
                  <li>As contas a pagar vinculadas serão removidas</li>
                  <li>Esta ação não pode ser desfeita</li>
                </ul>
              </div>
            ) : (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 mb-4 text-sm text-yellow-700">
                <p className="text-xs">O rascunho será excluído permanentemente.</p>
              </div>
            )}

            {erroExclusao && (
              <p className="text-xs text-red-600 mb-3">Erro: {erroExclusao}</p>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setConfirmando(null); setErroExclusao('') }}
                disabled={excluindo}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                Cancelar
              </button>
              <button
                onClick={() => excluirEntrada(confirmando)}
                disabled={excluindo}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-50">
                {excluindo ? 'Excluindo...' : 'Confirmar exclusão'}
              </button>
            </div>
          </div>
        </div>
      )}

      {etiquetaProdutos && (
        <ImprimirEtiquetaModal
          produtos={etiquetaProdutos}
          empresaId={empresaId}
          operadorNome={operador}
          modoQtdPadrao="estoque"
          labelModoEstoque="Igual à quantidade recebida"
          onClose={() => setEtiquetaProdutos(null)}
        />
      )}
    </div>
  )
}
