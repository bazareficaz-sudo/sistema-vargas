'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Fornecedor = { id: string; razao_social: string; nome_fantasia: string | null }
type ItemEntrada = {
  id: string; produto_id: string | null; nome_produto: string; sku: string | null
  quantidade: number; preco_custo_anterior: number; preco_custo_novo: number
  markup: number; preco_venda_novo: number; subtotal: number
  atualizar_custo: boolean; atualizar_preco: boolean
}
type ContaPagar = {
  id: string; descricao: string; valor: number; vencimento: string
  parcela: number; total_parcelas: number; forma_pagamento: string; status: string
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

type Aba = 'cabecalho' | 'itens' | 'contas'

export default function EditarEntradaClient({
  entrada, itens: itensIniciais, contasPagar: contasIniciais,
  fornecedores, empresaId,
}: {
  entrada: any
  itens: ItemEntrada[]
  contasPagar: ContaPagar[]
  fornecedores: Fornecedor[]
  empresaId: string
}) {
  const router = useRouter()
  const [aba, setAba] = useState<Aba>('cabecalho')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')

  // ── Cabeçalho ──
  const [fornecedorId, setFornecedorId] = useState(entrada.fornecedor_id ?? '')
  const [buscaForn, setBuscaForn] = useState(
    entrada.fornecedores?.nome_fantasia ?? entrada.fornecedores?.razao_social ?? ''
  )
  const [numeroNf, setNumeroNf] = useState(entrada.numero_nf ?? '')
  const [serie, setSerie] = useState(entrada.serie ?? '')
  const [dataEmissao, setDataEmissao] = useState(entrada.data_emissao ?? '')
  const [valorFrete, setValorFrete] = useState(String(entrada.valor_frete ?? '0'))
  const [valorDesconto, setValorDesconto] = useState(String(entrada.valor_desconto ?? '0'))
  const [valorOutros, setValorOutros] = useState(String(entrada.valor_outros ?? '0'))
  const [observacoes, setObservacoes] = useState(entrada.observacoes ?? '')

  // ── Itens ──
  const [itens, setItens] = useState<ItemEntrada[]>(itensIniciais)
  const [editandoItem, setEditandoItem] = useState<string | null>(null)
  const [itemForm, setItemForm] = useState<Partial<ItemEntrada>>({})

  // ── Contas a pagar ──
  const [contas, setContas] = useState<ContaPagar[]>(contasIniciais)
  const [editandoConta, setEditandoConta] = useState<string | null>(null)
  const [contaForm, setContaForm] = useState<Partial<ContaPagar>>({})

  const totalProdutos = itens.reduce((s, i) => s + Number(i.preco_custo_novo) * Number(i.quantidade), 0)
  const frete = parseFloat(String(valorFrete).replace(',', '.')) || 0
  const desconto = parseFloat(String(valorDesconto).replace(',', '.')) || 0
  const outros = parseFloat(String(valorOutros).replace(',', '.')) || 0
  const totalGeral = totalProdutos + frete + outros - desconto

  function flash(msg: string) { setOk(msg); setTimeout(() => setOk(''), 3000) }

  // ── Salvar cabeçalho ──
  async function salvarCabecalho() {
    if (!fornecedorId) { setErro('Selecione o fornecedor.'); return }
    setSalvando(true); setErro('')
    const sb = createClient()
    const { error } = await sb.from('entradas').update({
      fornecedor_id: fornecedorId,
      numero_nf: numeroNf || null,
      serie: serie || null,
      data_emissao: dataEmissao || null,
      valor_frete: frete,
      valor_desconto: desconto,
      valor_outros: outros,
      valor_total: totalGeral,
      observacoes: observacoes || null,
    }).eq('id', entrada.id)
    setSalvando(false)
    if (error) { setErro(error.message); return }
    flash('Dados da nota atualizados.')
    router.refresh()
  }

  // ── Editar item ──
  function abrirEdicaoItem(item: ItemEntrada) {
    setEditandoItem(item.id)
    setItemForm({ quantidade: item.quantidade, preco_custo_novo: item.preco_custo_novo, markup: item.markup, preco_venda_novo: item.preco_venda_novo })
  }

  async function salvarItem(item: ItemEntrada) {
    const qtdAntiga = item.quantidade
    const qtdNova = Number(itemForm.quantidade) || item.quantidade
    const custoNovo = parseFloat(String(itemForm.preco_custo_novo).replace(',', '.')) || item.preco_custo_novo
    const markupNovo = parseFloat(String(itemForm.markup).replace(',', '.')) || item.markup
    const vendaNovo = parseFloat(String(itemForm.preco_venda_novo).replace(',', '.')) || item.preco_venda_novo

    setSalvando(true); setErro('')
    const sb = createClient()

    const { error } = await sb.from('entrada_itens').update({
      quantidade: qtdNova,
      preco_custo_novo: custoNovo,
      markup: markupNovo,
      preco_venda_novo: vendaNovo,
      subtotal: custoNovo * qtdNova,
    }).eq('id', item.id)

    if (error) { setErro(error.message); setSalvando(false); return }

    // Atualiza estoque: reverte qtd antiga e aplica nova (se produto vinculado)
    if (item.produto_id) {
      const { data: prod } = await sb.from('produtos').select('estoque').eq('id', item.produto_id).single()
      if (prod) {
        const estoqueCorrigido = (prod.estoque ?? 0) - qtdAntiga + qtdNova
        await sb.from('produtos').update({ estoque: estoqueCorrigido }).eq('id', item.produto_id)
      }
    }

    setItens(prev => prev.map(i => i.id === item.id
      ? { ...i, quantidade: qtdNova, preco_custo_novo: custoNovo, markup: markupNovo, preco_venda_novo: vendaNovo, subtotal: custoNovo * qtdNova }
      : i))
    setEditandoItem(null)
    setSalvando(false)
    flash('Item atualizado.')
  }

  async function removerItem(item: ItemEntrada) {
    if (!confirm(`Remover "${item.nome_produto}" da entrada?`)) return
    setSalvando(true)
    const sb = createClient()
    await sb.from('entrada_itens').delete().eq('id', item.id)

    // Reverte estoque
    if (item.produto_id) {
      const { data: prod } = await sb.from('produtos').select('estoque').eq('id', item.produto_id).single()
      if (prod) {
        await sb.from('produtos').update({ estoque: Math.max(0, (prod.estoque ?? 0) - item.quantidade) }).eq('id', item.produto_id)
      }
    }

    setItens(prev => prev.filter(i => i.id !== item.id))
    setSalvando(false)
    flash('Item removido.')
  }

  // ── Editar conta ──
  function abrirEdicaoConta(c: ContaPagar) {
    setEditandoConta(c.id)
    setContaForm({ valor: c.valor, vencimento: c.vencimento, forma_pagamento: c.forma_pagamento })
  }

  async function salvarConta(c: ContaPagar) {
    setSalvando(true); setErro('')
    const sb = createClient()
    const { error } = await sb.from('contas_pagar').update({
      valor: parseFloat(String(contaForm.valor).replace(',', '.')) || c.valor,
      vencimento: contaForm.vencimento || c.vencimento,
      forma_pagamento: contaForm.forma_pagamento || c.forma_pagamento,
    }).eq('id', c.id)
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setContas(prev => prev.map(x => x.id === c.id
      ? { ...x, valor: parseFloat(String(contaForm.valor)) || x.valor, vencimento: contaForm.vencimento || x.vencimento, forma_pagamento: contaForm.forma_pagamento || x.forma_pagamento }
      : x))
    setEditandoConta(null)
    flash('Conta atualizada.')
  }

  async function cancelarEntrada() {
    if (!confirm('Cancelar esta entrada? O estoque dos produtos será revertido.')) return
    setSalvando(true)
    const sb = createClient()

    // Reverte estoque de todos os itens
    for (const item of itens) {
      if (item.produto_id) {
        const { data: prod } = await sb.from('produtos').select('estoque').eq('id', item.produto_id).single()
        if (prod) {
          await sb.from('produtos').update({ estoque: Math.max(0, (prod.estoque ?? 0) - item.quantidade) }).eq('id', item.produto_id)
        }
      }
    }

    await sb.from('entradas').update({ status: 'cancelada' }).eq('id', entrada.id)
    await sb.from('contas_pagar').update({ status: 'cancelado' }).eq('entrada_id', entrada.id)
    setSalvando(false)
    router.push('/dashboard/entradas')
    router.refresh()
  }

  const fornecedorAtual = fornecedores.find(f => f.id === fornecedorId)
  const cancelada = entrada.status === 'cancelada'

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <a href="/dashboard/entradas" className="hover:text-gray-600">entradas</a><span>›</span>
        <span className="text-gray-600 font-medium">NF {entrada.numero_nf || entrada.id.slice(0, 8)}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-gray-900 text-xl font-semibold">
              Entrada {entrada.numero_nf ? `NF ${entrada.numero_nf}` : `#${entrada.id.slice(0, 8)}`}
            </h1>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
              entrada.status === 'confirmada' ? 'bg-green-100 text-green-700' :
              entrada.status === 'cancelada' ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-700'
            }`}>
              {entrada.status === 'confirmada' ? 'Confirmada' : entrada.status === 'cancelada' ? 'Cancelada' : 'Rascunho'}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {entrada.fornecedores?.razao_social} · {new Date(entrada.created_at).toLocaleDateString('pt-BR')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs text-gray-400">Total</p>
            <p className="text-xl font-bold text-gray-900">{fmt(Number(entrada.valor_total))}</p>
          </div>
          {!cancelada && (
            <button onClick={cancelarEntrada} disabled={salvando}
              className="px-4 py-2 border border-red-300 text-red-600 text-sm rounded-lg hover:bg-red-50 transition-colors">
              Cancelar entrada
            </button>
          )}
        </div>
      </div>

      {/* Feedback */}
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">{erro}</div>}
      {ok && <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-lg mb-4">✓ {ok}</div>}

      {/* Abas */}
      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-fit">
        {([['cabecalho', 'Dados da NF'], ['itens', `Itens (${itens.length})`], ['contas', `Contas a Pagar (${contas.length})`]] as [Aba, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setAba(key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${aba === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── ABA: Cabeçalho ── */}
      {aba === 'cabecalho' && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          {/* Fornecedor */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Fornecedor</label>
            <div className="relative">
              <input value={buscaForn}
                onChange={e => { setBuscaForn(e.target.value); if (fornecedorId) setFornecedorId('') }}
                disabled={cancelada}
                placeholder="Buscar fornecedor..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 disabled:bg-gray-50" />
              {buscaForn && !fornecedorId && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
                  {fornecedores.filter(f =>
                    f.razao_social.toLowerCase().includes(buscaForn.toLowerCase()) ||
                    (f.nome_fantasia ?? '').toLowerCase().includes(buscaForn.toLowerCase())
                  ).slice(0, 8).map(f => (
                    <button key={f.id} onClick={() => { setFornecedorId(f.id); setBuscaForn(f.nome_fantasia ?? f.razao_social) }}
                      className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-gray-100 last:border-0">
                      <p className="text-sm font-medium text-gray-900">{f.nome_fantasia ?? f.razao_social}</p>
                      {f.nome_fantasia && <p className="text-xs text-gray-400">{f.razao_social}</p>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {fornecedorId && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-3 py-1 rounded-full">
                  ✓ {fornecedorAtual?.nome_fantasia ?? fornecedorAtual?.razao_social}
                </span>
                {!cancelada && <button onClick={() => { setFornecedorId(''); setBuscaForn('') }} className="text-xs text-gray-400 hover:text-gray-600">trocar</button>}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <F label="Nº da NF" value={numeroNf} onChange={setNumeroNf} disabled={cancelada} />
            <F label="Série" value={serie} onChange={setSerie} disabled={cancelada} />
            <F label="Data de emissão" value={dataEmissao} onChange={setDataEmissao} type="date" disabled={cancelada} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <F label="Frete (R$)" value={valorFrete} onChange={setValorFrete} disabled={cancelada} />
            <F label="Desconto (R$)" value={valorDesconto} onChange={setValorDesconto} disabled={cancelada} />
            <F label="Outros (R$)" value={valorOutros} onChange={setValorOutros} disabled={cancelada} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Observações</label>
            <textarea value={observacoes} onChange={e => setObservacoes(e.target.value)} rows={2} disabled={cancelada}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none disabled:bg-gray-50" />
          </div>

          {/* Resumo de valores */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Produtos ({itens.length} itens)</span>
              <span>{fmt(totalProdutos)}</span>
            </div>
            {frete > 0 && <div className="flex justify-between text-sm text-gray-600"><span>Frete</span><span>{fmt(frete)}</span></div>}
            {desconto > 0 && <div className="flex justify-between text-sm text-gray-600"><span>Desconto</span><span>-{fmt(desconto)}</span></div>}
            {outros > 0 && <div className="flex justify-between text-sm text-gray-600"><span>Outros</span><span>{fmt(outros)}</span></div>}
            <div className="flex justify-between text-base font-bold text-gray-900 border-t border-gray-200 pt-2">
              <span>Total</span><span>{fmt(totalGeral)}</span>
            </div>
          </div>

          {!cancelada && (
            <div className="flex justify-end">
              <button onClick={salvarCabecalho} disabled={salvando}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {salvando ? 'Salvando...' : 'Salvar dados da NF'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── ABA: Itens ── */}
      {aba === 'itens' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Produto</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">Qtd</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Custo ant.</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Custo novo</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-24">Markup</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Preço venda</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Subtotal</th>
                {!cancelada && <th className="px-4 py-3 w-28"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {itens.map(item => (
                <tr key={item.id} className="group hover:bg-gray-50">
                  {editandoItem === item.id ? (
                    <>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{item.nome_produto}</p>
                        {item.sku && <p className="text-xs text-gray-400 font-mono">{item.sku}</p>}
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" value={itemForm.quantidade}
                          onChange={e => setItemForm(p => ({ ...p, quantidade: parseFloat(e.target.value) || 0 }))}
                          className="w-full border border-blue-400 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none" />
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-gray-400">
                        {item.preco_custo_anterior > 0 ? fmt(item.preco_custo_anterior) : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" step="0.01" value={itemForm.preco_custo_novo}
                          onChange={e => setItemForm(p => ({ ...p, preco_custo_novo: parseFloat(e.target.value) || 0 }))}
                          className="w-full border border-blue-400 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none" />
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" step="0.01" value={itemForm.markup}
                          onChange={e => setItemForm(p => ({ ...p, markup: parseFloat(e.target.value) || 0 }))}
                          className="w-full border border-blue-400 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none" />
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" step="0.01" value={itemForm.preco_venda_novo}
                          onChange={e => setItemForm(p => ({ ...p, preco_venda_novo: parseFloat(e.target.value) || 0 }))}
                          className="w-full border border-blue-400 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none" />
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 text-xs">
                        {fmt((Number(itemForm.preco_custo_novo) || 0) * (Number(itemForm.quantidade) || 0))}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => salvarItem(item)} disabled={salvando}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg disabled:opacity-50">
                            Salvar
                          </button>
                          <button onClick={() => setEditandoItem(null)}
                            className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50">
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{item.nome_produto}</p>
                        {item.sku && <p className="text-xs text-gray-400 font-mono">{item.sku}</p>}
                        {!item.produto_id && <span className="text-xs text-orange-500">Manual</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-700">{item.quantidade}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-400">
                        {item.preco_custo_anterior > 0 ? fmt(item.preco_custo_anterior) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900">{fmt(Number(item.preco_custo_novo))}</td>
                      <td className="px-4 py-3 text-right text-gray-500 text-xs">{Number(item.markup).toFixed(1)}%</td>
                      <td className="px-4 py-3 text-right text-gray-900">{fmt(Number(item.preco_venda_novo))}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(Number(item.subtotal))}</td>
                      {!cancelada && (
                        <td className="px-4 py-3">
                          <div className="flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => abrirEdicaoItem(item)}
                              className="text-xs text-blue-600 hover:text-blue-800 font-medium">Editar</button>
                            <button onClick={() => removerItem(item)}
                              className="text-xs text-red-500 hover:text-red-700">Remover</button>
                          </div>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))}
              {itens.length === 0 && (
                <tr><td colSpan={8} className="py-10 text-center text-gray-400 text-sm">Nenhum item nesta entrada.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-200">
                <td colSpan={6} className="px-4 py-3 text-sm text-gray-600">{itens.length} item(s)</td>
                <td className="px-4 py-3 text-right font-bold text-gray-900">{fmt(totalProdutos)}</td>
                {!cancelada && <td></td>}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ── ABA: Contas a Pagar ── */}
      {aba === 'contas' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Descrição</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-24">Parcela</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-36">Vencimento</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-36">Forma Pgto</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Valor</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">Status</th>
                {!cancelada && <th className="px-4 py-3 w-16"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {contas.map(c => (
                <tr key={c.id} className="group hover:bg-gray-50">
                  {editandoConta === c.id ? (
                    <>
                      <td className="px-4 py-3 text-xs text-gray-600">{c.descricao}</td>
                      <td className="px-4 py-3 text-center text-xs text-gray-500">{c.parcela}/{c.total_parcelas}</td>
                      <td className="px-4 py-2">
                        <input type="date" value={contaForm.vencimento}
                          onChange={e => setContaForm(p => ({ ...p, vencimento: e.target.value }))}
                          className="w-full border border-blue-400 rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
                      </td>
                      <td className="px-4 py-2">
                        <select value={contaForm.forma_pagamento}
                          onChange={e => setContaForm(p => ({ ...p, forma_pagamento: e.target.value }))}
                          className="w-full border border-blue-400 rounded-lg px-2 py-1.5 text-xs focus:outline-none">
                          {['boleto','pix','transferência','dinheiro','cartão','cheque'].map(f => (
                            <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" step="0.01" value={contaForm.valor}
                          onChange={e => setContaForm(p => ({ ...p, valor: parseFloat(e.target.value) || 0 }))}
                          className="w-full border border-blue-400 rounded-lg px-2 py-1.5 text-xs text-right focus:outline-none" />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          c.status === 'pago' ? 'bg-green-100 text-green-700' :
                          c.status === 'vencido' ? 'bg-red-100 text-red-600' :
                          c.status === 'cancelado' ? 'bg-gray-100 text-gray-500' : 'bg-yellow-100 text-yellow-700'
                        }`}>{c.status}</span>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => salvarConta(c)} disabled={salvando}
                            className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg disabled:opacity-50">
                            Salvar
                          </button>
                          <button onClick={() => setEditandoConta(null)}
                            className="px-2.5 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50">
                            ✕
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-xs truncate">{c.descricao}</td>
                      <td className="px-4 py-3 text-center text-xs text-gray-500">{c.parcela}/{c.total_parcelas}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {new Date(c.vencimento + 'T00:00:00').toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 capitalize">{c.forma_pagamento}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{fmt(Number(c.valor))}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          c.status === 'pago' ? 'bg-green-100 text-green-700' :
                          c.status === 'vencido' ? 'bg-red-100 text-red-600' :
                          c.status === 'cancelado' ? 'bg-gray-100 text-gray-500' : 'bg-yellow-100 text-yellow-700'
                        }`}>{c.status.charAt(0).toUpperCase() + c.status.slice(1)}</span>
                      </td>
                      {!cancelada && (
                        <td className="px-4 py-3 text-center">
                          {c.status !== 'pago' && c.status !== 'cancelado' && (
                            <button onClick={() => abrirEdicaoConta(c)}
                              className="text-xs text-blue-600 hover:text-blue-800 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                              Editar
                            </button>
                          )}
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))}
              {contas.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-gray-400 text-sm">Nenhuma conta gerada.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-200">
                <td colSpan={4} className="px-4 py-3 text-sm text-gray-600">{contas.length} parcela(s)</td>
                <td className="px-4 py-3 text-right font-bold text-gray-900">
                  {fmt(contas.reduce((s, c) => s + Number(c.valor), 0))}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function F({ label, value, onChange, type = 'text', disabled }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400" />
    </div>
  )
}
