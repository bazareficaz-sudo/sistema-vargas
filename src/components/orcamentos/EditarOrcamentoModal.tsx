'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

type Item = {
  id?: string
  produto_id: string | null
  produto_nome: string
  produto_sku: string | null
  quantidade: number
  preco_unitario: number
  desconto: number   // percentual por item
}

type Cliente = { id: string; nome: string; telefone: string | null }

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Total de um item já com o desconto percentual dele aplicado.
function totalItem(i: Item): number {
  const bruto = (Number(i.quantidade) || 0) * (Number(i.preco_unitario) || 0)
  const desc = bruto * ((Number(i.desconto) || 0) / 100)
  return Math.round((bruto - desc) * 100) / 100
}

export default function EditarOrcamentoModal({ empresaId, orcamento, onClose, onSalvo }: {
  empresaId: string
  orcamento: any
  onClose: () => void
  onSalvo: () => void
}) {
  const sb = createClient()

  const [clienteId, setClienteId] = useState<string | null>(orcamento.cliente_id ?? null)
  const [clienteNome, setClienteNome] = useState<string>(orcamento.cliente_nome ?? orcamento.clientes?.nome ?? '')
  const [buscaCliente, setBuscaCliente] = useState('')
  const [clientesEncontrados, setClientesEncontrados] = useState<Cliente[]>([])

  const [validade, setValidade] = useState<string>(orcamento.validade ?? '')
  const [observacao, setObservacao] = useState<string>(orcamento.observacao ?? '')
  const [descontoGeral, setDescontoGeral] = useState<string>(String(orcamento.desconto ?? 0))

  const [itens, setItens] = useState<Item[]>(
    (orcamento.orcamento_itens ?? []).map((i: any) => ({
      id: i.id,
      produto_id: i.produto_id ?? null,
      produto_nome: i.produto_nome,
      produto_sku: i.produto_sku ?? null,
      quantidade: Number(i.quantidade) || 1,
      preco_unitario: Number(i.preco_unitario) || 0,
      desconto: Number(i.desconto) || 0,
    })),
  )

  const [buscaProduto, setBuscaProduto] = useState('')
  const [produtosEncontrados, setProdutosEncontrados] = useState<any[]>([])
  const buscaRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  // Orçamento já convertido em venda não pode ser editado: a venda foi
  // gerada a partir destes números, e mexer aqui criaria divergência entre
  // o que o cliente aprovou e o que foi vendido.
  const bloqueado = orcamento.status === 'convertido'

  useEffect(() => {
    const termo = buscaProduto.trim()
    if (termo.length < 2) { setProdutosEncontrados([]); return }
    clearTimeout(buscaRef.current)
    buscaRef.current = setTimeout(async () => {
      const { data } = await sb.from('produtos')
        .select('id, nome, sku, preco_venda, estoque')
        .eq('empresa_id', empresaId).eq('ativo', true)
        .or(`nome.ilike.%${termo}%,sku.ilike.%${termo}%,ean.ilike.%${termo}%`)
        .limit(8)
      setProdutosEncontrados(data ?? [])
    }, 250)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaProduto, empresaId])

  useEffect(() => {
    const termo = buscaCliente.trim()
    if (termo.length < 2) { setClientesEncontrados([]); return }
    const t = setTimeout(async () => {
      const { data } = await sb.from('clientes')
        .select('id, nome, telefone').eq('empresa_id', empresaId)
        .is('mesclado_em', null)
        .ilike('nome', `%${termo}%`).limit(6)
      setClientesEncontrados((data ?? []) as Cliente[])
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaCliente, empresaId])

  const subtotal = itens.reduce((s, i) => s + totalItem(i), 0)
  const total = Math.max(0, subtotal - (Number(descontoGeral) || 0))

  function alterarItem(idx: number, campo: keyof Item, valor: any) {
    setItens(prev => prev.map((i, n) => n === idx ? { ...i, [campo]: valor } : i))
  }

  function adicionarProduto(p: any) {
    setItens(prev => [...prev, {
      produto_id: p.id, produto_nome: p.nome, produto_sku: p.sku ?? null,
      quantidade: 1, preco_unitario: Number(p.preco_venda) || 0, desconto: 0,
    }])
    setBuscaProduto(''); setProdutosEncontrados([])
  }

  async function salvar() {
    if (bloqueado) return
    if (itens.length === 0) { setErro('O orçamento precisa de pelo menos um item.'); return }
    setSalvando(true); setErro('')

    const { error: erroOrc } = await sb.from('orcamentos').update({
      cliente_id: clienteId,
      cliente_nome: clienteNome.trim() || null,
      validade: validade || null,
      observacao: observacao.trim() || null,
      subtotal,
      desconto: Number(descontoGeral) || 0,
      total,
      updated_at: new Date().toISOString(),
    }).eq('id', orcamento.id)

    if (erroOrc) { setErro('Erro ao salvar: ' + erroOrc.message); setSalvando(false); return }

    // Itens: troca o conjunto inteiro. É seguro aqui porque orcamento_itens
    // não é referenciado por mais nada (diferente de venda_itens, que carrega
    // histórico de estoque e fiscal) e o volume por orçamento é pequeno.
    const { error: erroDel } = await sb.from('orcamento_itens').delete().eq('orcamento_id', orcamento.id)
    if (erroDel) { setErro('Erro ao atualizar os itens: ' + erroDel.message); setSalvando(false); return }

    const { error: erroIns } = await sb.from('orcamento_itens').insert(
      itens.map(i => ({
        orcamento_id: orcamento.id,
        produto_id: i.produto_id,
        produto_nome: i.produto_nome,
        produto_sku: i.produto_sku,
        quantidade: Number(i.quantidade) || 0,
        preco_unitario: Number(i.preco_unitario) || 0,
        desconto: Number(i.desconto) || 0,
        total: totalItem(i),
      })),
    )
    if (erroIns) { setErro('Erro ao gravar os itens: ' + erroIns.message); setSalvando(false); return }

    setSalvando(false)
    onSalvo()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !salvando && onClose()}>
      <div className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Editar orçamento #{orcamento.numero}</h2>
            <p className="text-xs text-gray-400">As alterações valem só para este orçamento — não mexem no cadastro do produto.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {bloqueado ? (
          <div className="p-5">
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <p className="text-sm text-amber-800 font-medium">Este orçamento já foi convertido em venda</p>
              <p className="text-xs text-amber-700 mt-1">
                A venda foi gerada a partir destes números. Editar aqui deixaria o orçamento diferente do que foi
                efetivamente vendido. Se precisa corrigir, ajuste a venda ou reabra o orçamento antes.
              </p>
            </div>
            <button onClick={onClose} className="mt-4 px-4 py-2 bg-gray-600 text-white text-sm rounded-lg">Fechar</button>
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Cliente */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Cliente</label>
              <div className="flex gap-2">
                <input value={clienteNome} onChange={e => { setClienteNome(e.target.value); setClienteId(null) }}
                  placeholder="Consumidor"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                <input value={buscaCliente} onChange={e => setBuscaCliente(e.target.value)}
                  placeholder="buscar cliente cadastrado..."
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              {clientesEncontrados.length > 0 && (
                <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden">
                  {clientesEncontrados.map(c => (
                    <button key={c.id} type="button"
                      onClick={() => { setClienteId(c.id); setClienteNome(c.nome); setBuscaCliente(''); setClientesEncontrados([]) }}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-0 text-sm">
                      {c.nome} {c.telefone && <span className="text-xs text-gray-400">· {c.telefone}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Validade</label>
                <input type="date" value={validade ? String(validade).slice(0, 10) : ''} onChange={e => setValidade(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Desconto geral (R$)</label>
                <input type="number" step="0.01" min="0" value={descontoGeral} onChange={e => setDescontoGeral(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
            </div>

            {/* Itens */}
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">Itens</p>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left px-3 py-2">Produto</th>
                      <th className="text-center px-2 py-2 w-20">Qtd</th>
                      <th className="text-right px-2 py-2 w-28">Preço</th>
                      <th className="text-center px-2 py-2 w-20">Desc%</th>
                      <th className="text-right px-3 py-2 w-24">Total</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {itens.length === 0 && (
                      <tr><td colSpan={6} className="text-center py-6 text-gray-400 text-sm">Nenhum item — adicione abaixo.</td></tr>
                    )}
                    {itens.map((item, idx) => (
                      <tr key={item.id ?? `novo-${idx}`}>
                        <td className="px-3 py-1.5">
                          <input value={item.produto_nome} onChange={e => alterarItem(idx, 'produto_nome', e.target.value)}
                            className="w-full border border-transparent hover:border-gray-200 focus:border-blue-500 rounded px-1.5 py-1 text-sm focus:outline-none" />
                          {item.produto_sku && <span className="text-[11px] text-gray-400 px-1.5">{item.produto_sku}</span>}
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" step="0.001" min="0" value={item.quantidade}
                            onChange={e => alterarItem(idx, 'quantidade', parseFloat(e.target.value) || 0)}
                            className="w-full border border-gray-200 rounded px-1.5 py-1 text-sm text-center focus:outline-none focus:border-blue-500" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" step="0.01" min="0" value={item.preco_unitario}
                            onChange={e => alterarItem(idx, 'preco_unitario', parseFloat(e.target.value) || 0)}
                            className="w-full border border-gray-200 rounded px-1.5 py-1 text-sm text-right focus:outline-none focus:border-blue-500" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" step="0.01" min="0" max="100" value={item.desconto}
                            onChange={e => alterarItem(idx, 'desconto', parseFloat(e.target.value) || 0)}
                            className="w-full border border-gray-200 rounded px-1.5 py-1 text-sm text-center focus:outline-none focus:border-blue-500" />
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium text-gray-900">{fmt(totalItem(item))}</td>
                        <td className="px-2 py-1.5 text-center">
                          <button type="button" onClick={() => setItens(prev => prev.filter((_, n) => n !== idx))}
                            title="Remover item" className="text-red-400 hover:text-red-600">🗑</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-2">
                <input value={buscaProduto} onChange={e => setBuscaProduto(e.target.value)}
                  placeholder="+ Adicionar produto — nome, SKU ou código de barras..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                {produtosEncontrados.length > 0 && (
                  <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden">
                    {produtosEncontrados.map(p => (
                      <button key={p.id} type="button" onClick={() => adicionarProduto(p)}
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-0 flex justify-between">
                        <span className="text-sm text-gray-900">{p.nome}</span>
                        <span className="text-xs text-gray-400">{p.sku} · {fmt(Number(p.preco_venda) || 0)} · est. {p.estoque}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Observação</label>
              <textarea value={observacao} onChange={e => setObservacao(e.target.value)} rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>

            {/* Totais */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 space-y-1">
              <div className="flex justify-between text-sm text-gray-600"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
              {(Number(descontoGeral) || 0) > 0 && (
                <div className="flex justify-between text-sm text-orange-600"><span>Desconto geral</span><span>−{fmt(Number(descontoGeral) || 0)}</span></div>
              )}
              <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2 mt-1">
                <span>Total</span><span className="text-blue-700">{fmt(total)}</span>
              </div>
            </div>

            {erro && <p className="text-sm text-red-600">{erro}</p>}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} disabled={salvando}
                className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={salvar} disabled={salvando}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                {salvando ? 'Salvando...' : 'Salvar alterações'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
