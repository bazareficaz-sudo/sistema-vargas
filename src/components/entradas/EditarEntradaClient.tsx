'use client'

import { useState, useMemo } from 'react'
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

type ProdutoInfo = { preco_venda: number; preco_custo: number; categoria: string | null; marca: string | null; tipo: string }

type HistoricoPreco = {
  id: string; produto_nome: string | null; produto_sku: string | null
  preco_venda_anterior: number | null; preco_venda_novo: number | null
  custo_anterior: number | null; custo_novo: number | null
  margem_anterior: number | null; margem_nova: number | null
  variacao_custo_pct: number | null; usuario_nome: string | null; created_at: string
}

type Aba = 'cabecalho' | 'itens' | 'revisao' | 'contas'

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function pct(v: number) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '%' }

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

export default function EditarEntradaClient({
  entrada, itens: itensIniciais, contasPagar: contasIniciais,
  fornecedores, produtosMap, historicoPrecos: histInicial, empresaId, operadorNome,
}: {
  entrada: any
  itens: ItemEntrada[]
  contasPagar: ContaPagar[]
  fornecedores: Fornecedor[]
  produtosMap: Record<string, ProdutoInfo>
  historicoPrecos: HistoricoPreco[]
  empresaId: string
  operadorNome: string
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

  // ── Revisão de preços ──
  type RevisaoItem = {
    id: string          // entrada_item id
    produto_id: string
    nome: string
    sku: string | null
    custo_anterior: number
    custo_novo: number
    preco_atual: number     // preço atual no cadastro do produto
    novo_preco: number      // preço que o usuário vai definir
    markup: number
    revisado: boolean
  }

  const revisaoInicial = useMemo<RevisaoItem[]>(() => {
    return itensIniciais
      .filter(i => i.produto_id && produtosMap[i.produto_id])
      .map(i => {
        const prod = produtosMap[i.produto_id!]
        const custoNovo = Number(i.preco_custo_novo)
        const markup = Number(i.markup) || (prod.preco_venda > 0 && custoNovo > 0
          ? ((prod.preco_venda - custoNovo) / custoNovo) * 100
          : 30)
        return {
          id: i.id,
          produto_id: i.produto_id!,
          nome: i.nome_produto,
          sku: i.sku,
          custo_anterior: Number(i.preco_custo_anterior),
          custo_novo: custoNovo,
          preco_atual: prod.preco_venda,
          novo_preco: Number(i.preco_venda_novo) || prod.preco_venda,
          markup: parseFloat(markup.toFixed(2)),
          revisado: false,
        }
      })
  }, [itensIniciais, produtosMap])

  const [revisaoItens, setRevisaoItens] = useState<RevisaoItem[]>(revisaoInicial)
  const [markupGlobal, setMarkupGlobal] = useState('')
  const [salvandoRevisao, setSalvandoRevisao] = useState(false)
  const [historicoPrecos, setHistoricoPrecos] = useState<HistoricoPreco[]>(histInicial)

  // ── Contas a pagar ──
  const [contas, setContas] = useState<ContaPagar[]>(contasIniciais)
  const [editandoConta, setEditandoConta] = useState<string | null>(null)
  const [contaForm, setContaForm] = useState<Partial<ContaPagar>>({})

  const totalProdutos = itens.reduce((s, i) => s + Number(i.preco_custo_novo) * Number(i.quantidade), 0)
  const frete = parseFloat(String(valorFrete).replace(',', '.')) || 0
  const desconto = parseFloat(String(valorDesconto).replace(',', '.')) || 0
  const outros = parseFloat(String(valorOutros).replace(',', '.')) || 0
  const totalGeral = totalProdutos + frete + outros - desconto

  function flash(msg: string) { setOk(msg); setTimeout(() => setOk(''), 3500) }

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
    if (item.produto_id) {
      const { data: prod } = await sb.from('produtos').select('estoque').eq('id', item.produto_id).single()
      if (prod) {
        await sb.from('produtos').update({ estoque: (prod.estoque ?? 0) - qtdAntiga + qtdNova }).eq('id', item.produto_id)
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

  // ── Revisão de preços ──
  function atualizarRevisaoItem(id: string, campo: keyof RevisaoItem, valor: number) {
    setRevisaoItens(prev => prev.map(r => {
      if (r.id !== id) return r
      const atualizado = { ...r, [campo]: valor }
      if (campo === 'markup') {
        atualizado.novo_preco = parseFloat((atualizado.custo_novo * (1 + valor / 100)).toFixed(2))
      }
      if (campo === 'novo_preco' && atualizado.custo_novo > 0) {
        atualizado.markup = parseFloat((((valor - atualizado.custo_novo) / atualizado.custo_novo) * 100).toFixed(2))
      }
      return atualizado
    }))
  }

  function aplicarMarkupGlobal() {
    const mk = parseFloat(markupGlobal.replace(',', '.'))
    if (isNaN(mk) || mk <= 0) return
    setRevisaoItens(prev => prev.map(r => ({
      ...r,
      markup: mk,
      novo_preco: parseFloat((r.custo_novo * (1 + mk / 100)).toFixed(2)),
    })))
  }

  function arredondar(tipo: '.90' | '.99') {
    setRevisaoItens(prev => prev.map(r => {
      const base = Math.floor(r.novo_preco)
      const dec = tipo === '.90' ? 0.90 : 0.99
      return { ...r, novo_preco: base + dec }
    }))
  }

  async function salvarRevisao() {
    const aAtualizar = revisaoItens.filter(r => !r.revisado)
    if (aAtualizar.length === 0) { flash('Nenhum item para salvar.'); return }
    setSalvandoRevisao(true)
    const sb = createClient()
    const fornecedorNome = entrada.fornecedores?.nome_fantasia ?? entrada.fornecedores?.razao_social ?? ''
    const novoHistorico: HistoricoPreco[] = []

    for (const r of aAtualizar) {
      const prod = produtosMap[r.produto_id]
      if (!prod) continue

      // Calcula margens
      const margemAnterior = prod.preco_custo > 0
        ? ((prod.preco_venda - prod.preco_custo) / prod.preco_custo) * 100 : 0
      const margemNova = r.custo_novo > 0
        ? ((r.novo_preco - r.custo_novo) / r.custo_novo) * 100 : 0
      const variacaoCusto = r.custo_anterior > 0
        ? ((r.custo_novo - r.custo_anterior) / r.custo_anterior) * 100 : 0

      // Atualiza produto
      await sb.from('produtos').update({
        preco_venda: r.novo_preco,
        preco_custo: r.custo_novo,
        updated_at: new Date().toISOString(),
      }).eq('id', r.produto_id)

      // Cria histórico
      const { data: hist } = await sb.from('historico_precos').insert({
        empresa_id: empresaId,
        produto_id: r.produto_id,
        produto_nome: r.nome,
        produto_sku: r.sku,
        entrada_id: entrada.id,
        numero_entrada: entrada.numero_entrada,
        numero_nf: entrada.numero_nf,
        fornecedor_id: entrada.fornecedor_id,
        fornecedor_nome: fornecedorNome,
        preco_venda_anterior: prod.preco_venda,
        preco_venda_novo: r.novo_preco,
        custo_anterior: r.custo_anterior,
        custo_novo: r.custo_novo,
        margem_anterior: parseFloat(margemAnterior.toFixed(2)),
        margem_nova: parseFloat(margemNova.toFixed(2)),
        variacao_custo_pct: parseFloat(variacaoCusto.toFixed(2)),
        usuario_nome: operadorNome,
        motivo: 'Revisão pela entrada de mercadoria',
      }).select().single()
      if (hist) novoHistorico.push(hist)
    }

    // Marca itens como revisados
    setRevisaoItens(prev => prev.map(r => ({ ...r, revisado: true })))
    setHistoricoPrecos(prev => [...novoHistorico, ...prev])

    // Atualiza status de revisão da entrada
    await sb.from('entradas').update({ status_revisao: 'revisado' }).eq('id', entrada.id)

    setSalvandoRevisao(false)
    flash(`${aAtualizar.length} preço(s) atualizado(s) com sucesso!`)
    router.refresh()
  }

  async function dispensarRevisao() {
    const sb = createClient()
    await sb.from('entradas').update({ status_revisao: 'dispensado' }).eq('id', entrada.id)
    flash('Revisão de preços dispensada.')
    router.refresh()
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
    for (const item of itens) {
      if (item.produto_id) {
        const { data: prod } = await sb.from('produtos').select('estoque').eq('id', item.produto_id).single()
        if (prod) await sb.from('produtos').update({ estoque: Math.max(0, (prod.estoque ?? 0) - item.quantidade) }).eq('id', item.produto_id)
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
  const statusRevisao = entrada.status_revisao ?? 'pendente'

  const REVISAO_BADGE: Record<string, string> = {
    revisado:   'bg-emerald-100 text-emerald-700',
    pendente:   'bg-orange-100 text-orange-700',
    em_revisao: 'bg-blue-100 text-blue-700',
    dispensado: 'bg-gray-100 text-gray-500',
  }

  const totalContas = contas.reduce((s, c) => s + Number(c.valor), 0)
  const totalPago = contas.filter(c => c.status === 'pago').reduce((s, c) => s + Number(c.valor), 0)

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <a href="/dashboard/entradas" className="hover:text-gray-600">entradas</a><span>›</span>
        <span className="text-gray-600 font-medium">
          {entrada.numero_entrada ?? `#${entrada.id.slice(0, 8)}`}
        </span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-gray-900 text-xl font-semibold">
              {entrada.numero_entrada
                ? <span className="font-mono bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded text-lg">{entrada.numero_entrada}</span>
                : `#${entrada.id.slice(0, 8)}`}
            </h1>
            {entrada.numero_nf && (
              <span className="text-sm text-gray-500">NF {entrada.numero_nf}{entrada.serie ? `/${entrada.serie}` : ''}</span>
            )}
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
              entrada.status === 'confirmada' ? 'bg-green-100 text-green-700' :
              entrada.status === 'cancelada' ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-700'
            }`}>
              {entrada.status === 'confirmada' ? 'Confirmada' : entrada.status === 'cancelada' ? 'Cancelada' : 'Rascunho'}
            </span>
            {entrada.status === 'confirmada' && (
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${REVISAO_BADGE[statusRevisao] ?? REVISAO_BADGE.pendente}`}>
                {statusRevisao === 'revisado' ? '✓ Preços revisados' :
                 statusRevisao === 'dispensado' ? '— Revisão dispensada' :
                 statusRevisao === 'em_revisao' ? '✎ Em revisão' : '⏳ Preços pendentes'}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {entrada.fornecedores?.razao_social} · {new Date(entrada.created_at).toLocaleDateString('pt-BR')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs text-gray-400">Total da nota</p>
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
      {ok  && <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-lg mb-4">✓ {ok}</div>}

      {/* Abas */}
      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-fit flex-wrap">
        {([
          ['cabecalho', 'Dados da NF'],
          ['itens', `Itens (${itens.length})`],
          ['revisao', revisaoItens.length > 0 ? `Revisão de Preços (${revisaoItens.length})` : 'Revisão de Preços'],
          ['contas', `Contas a Pagar (${contas.length})`],
        ] as [Aba, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setAba(key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${aba === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
            {key === 'revisao' && statusRevisao === 'pendente' && entrada.status === 'confirmada' && revisaoItens.length > 0 && (
              <span className="ml-1.5 w-2 h-2 bg-orange-400 rounded-full inline-block"></span>
            )}
          </button>
        ))}
      </div>

      {/* ── ABA: Cabeçalho ── */}
      {aba === 'cabecalho' && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
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

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Produtos ({itens.length} itens)</span><span>{fmt(totalProdutos)}</span>
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

      {/* ── ABA: Revisão de Preços ── */}
      {aba === 'revisao' && (
        <div className="space-y-4">
          {revisaoItens.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl py-12 text-center text-gray-400">
              <p className="text-base mb-1">Nenhum produto vinculado para revisar</p>
              <p className="text-sm">Apenas itens mapeados a produtos do sistema aparecem aqui.</p>
            </div>
          ) : (
            <>
              {/* Toolbar de ações em massa */}
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex flex-wrap gap-3 items-end">
                <div className="flex items-end gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Markup global (%)</label>
                    <input type="number" step="0.1" value={markupGlobal} onChange={e => setMarkupGlobal(e.target.value)}
                      placeholder="Ex: 35"
                      className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                  </div>
                  <button onClick={aplicarMarkupGlobal}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg">
                    Aplicar a todos
                  </button>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => arredondar('.90')}
                    className="px-3 py-2 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50">
                    Arredondar .90
                  </button>
                  <button onClick={() => arredondar('.99')}
                    className="px-3 py-2 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50">
                    Arredondar .99
                  </button>
                </div>
                <div className="ml-auto flex gap-2">
                  {statusRevisao !== 'dispensado' && (
                    <button onClick={dispensarRevisao}
                      className="px-4 py-2 border border-gray-300 text-gray-500 text-sm rounded-lg hover:bg-gray-50">
                      Dispensar revisão
                    </button>
                  )}
                  <button onClick={salvarRevisao} disabled={salvandoRevisao}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                    {salvandoRevisao ? 'Salvando...' : `Aplicar ${revisaoItens.filter(r => !r.revisado).length} preço(s)`}
                  </button>
                </div>
              </div>

              {/* Tabela de revisão */}
              <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Produto</th>
                      <th className="text-right px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Custo ant.</th>
                      <th className="text-right px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Custo novo</th>
                      <th className="text-right px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Variação</th>
                      <th className="text-right px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Preço atual</th>
                      <th className="text-right px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-24">Markup%</th>
                      <th className="text-right px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-36">Novo preço</th>
                      <th className="text-right px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Margem</th>
                      <th className="text-center px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-20">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {revisaoItens.map(r => {
                      const varCusto = r.custo_anterior > 0 ? ((r.custo_novo - r.custo_anterior) / r.custo_anterior) * 100 : 0
                      const margemNova = r.custo_novo > 0 ? ((r.novo_preco - r.custo_novo) / r.custo_novo) * 100 : 0
                      const prejuizo = r.novo_preco <= r.custo_novo
                      const custoCaiu = varCusto < -0.1
                      const custoSubiu = varCusto > 0.1
                      return (
                        <tr key={r.id} className={`group ${r.revisado ? 'bg-emerald-50/40' : prejuizo ? 'bg-red-50/40' : ''}`}>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900 text-sm">{r.nome}</p>
                            {r.sku && <p className="text-xs text-gray-400 font-mono">{r.sku}</p>}
                          </td>
                          <td className="px-3 py-3 text-right text-xs text-gray-400">
                            {r.custo_anterior > 0 ? fmt(r.custo_anterior) : '—'}
                          </td>
                          <td className="px-3 py-3 text-right font-medium text-gray-900">
                            {fmt(r.custo_novo)}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {r.custo_anterior > 0 ? (
                              <span className={`text-xs font-semibold ${custoSubiu ? 'text-red-600' : custoCaiu ? 'text-emerald-600' : 'text-gray-400'}`}>
                                {pct(varCusto)}
                              </span>
                            ) : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          <td className="px-3 py-3 text-right text-gray-500 text-xs">{fmt(r.preco_atual)}</td>
                          <td className="px-3 py-2">
                            <input type="number" step="0.1" value={r.markup}
                              disabled={r.revisado}
                              onChange={e => atualizarRevisaoItem(r.id, 'markup', parseFloat(e.target.value) || 0)}
                              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:border-blue-400 disabled:bg-gray-50 disabled:text-gray-300" />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" step="0.01" value={r.novo_preco}
                              disabled={r.revisado}
                              onChange={e => atualizarRevisaoItem(r.id, 'novo_preco', parseFloat(e.target.value) || 0)}
                              className={`w-full border rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:border-blue-400 font-semibold disabled:bg-gray-50 disabled:text-gray-300 ${prejuizo && !r.revisado ? 'border-red-300 text-red-700 bg-red-50' : 'border-gray-200'}`} />
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className={`text-xs font-semibold ${margemNova < 0 ? 'text-red-600' : margemNova < 15 ? 'text-orange-500' : 'text-emerald-600'}`}>
                              {margemNova.toFixed(1)}%
                            </span>
                            {prejuizo && !r.revisado && (
                              <p className="text-[10px] text-red-500">⚠ Prejuízo</p>
                            )}
                          </td>
                          <td className="px-3 py-3 text-center">
                            {r.revisado
                              ? <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">✓ Aplicado</span>
                              : <span className="text-[10px] bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-medium">Pendente</span>
                            }
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Histórico de preços desta entrada */}
              {historicoPrecos.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <h3 className="text-sm font-semibold text-gray-700">Histórico de alterações de preço</h3>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left px-4 py-2 text-xs text-gray-500">Produto</th>
                        <th className="text-right px-4 py-2 text-xs text-gray-500">Custo ant.</th>
                        <th className="text-right px-4 py-2 text-xs text-gray-500">Custo novo</th>
                        <th className="text-right px-4 py-2 text-xs text-gray-500">Preço ant.</th>
                        <th className="text-right px-4 py-2 text-xs text-gray-500">Preço novo</th>
                        <th className="text-right px-4 py-2 text-xs text-gray-500">Margem nova</th>
                        <th className="text-left px-4 py-2 text-xs text-gray-500">Usuário</th>
                        <th className="text-left px-4 py-2 text-xs text-gray-500">Data</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {historicoPrecos.map(h => (
                        <tr key={h.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-gray-800 font-medium text-xs">{h.produto_nome ?? '—'}</td>
                          <td className="px-4 py-2 text-right text-xs text-gray-400">{h.custo_anterior != null ? fmt(h.custo_anterior) : '—'}</td>
                          <td className="px-4 py-2 text-right text-xs text-gray-700">{h.custo_novo != null ? fmt(h.custo_novo) : '—'}</td>
                          <td className="px-4 py-2 text-right text-xs text-gray-400">{h.preco_venda_anterior != null ? fmt(h.preco_venda_anterior) : '—'}</td>
                          <td className="px-4 py-2 text-right text-xs font-semibold text-gray-900">{h.preco_venda_novo != null ? fmt(h.preco_venda_novo) : '—'}</td>
                          <td className="px-4 py-2 text-right text-xs">
                            <span className={`font-semibold ${(h.margem_nova ?? 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                              {h.margem_nova != null ? h.margem_nova.toFixed(1) + '%' : '—'}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-400">{h.usuario_nome ?? '—'}</td>
                          <td className="px-4 py-2 text-xs text-gray-400">{new Date(h.created_at).toLocaleString('pt-BR')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── ABA: Contas a Pagar ── */}
      {aba === 'contas' && (
        <div className="space-y-4">
          {/* Resumo financeiro */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total da nota', value: fmt(Number(entrada.valor_total)), cls: 'text-gray-900' },
              { label: 'Total em contas', value: fmt(totalContas), cls: totalContas > 0 ? 'text-blue-700' : 'text-gray-400' },
              { label: 'Total pago', value: fmt(totalPago), cls: totalPago > 0 ? 'text-emerald-600' : 'text-gray-400' },
              { label: 'Em aberto', value: fmt(totalContas - totalPago), cls: (totalContas - totalPago) > 0 ? 'text-orange-600' : 'text-gray-400' },
            ].map(s => (
              <div key={s.label} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                <p className={`text-lg font-bold ${s.cls}`}>{s.value}</p>
              </div>
            ))}
          </div>

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
                              className="px-2.5 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50">✕</button>
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
                  <tr>
                    <td colSpan={7} className="py-10 text-center">
                      <p className="text-gray-400 text-sm mb-2">Nenhuma conta gerada.</p>
                      <p className="text-xs text-gray-400">Crie a entrada com dados de pagamento para gerar contas a pagar automaticamente.</p>
                    </td>
                  </tr>
                )}
              </tbody>
              {contas.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-50 border-t border-gray-200">
                    <td colSpan={4} className="px-4 py-3 text-sm text-gray-600">{contas.length} parcela(s)</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{fmt(totalContas)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
