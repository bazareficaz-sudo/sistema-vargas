'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const STATUS_CORES: Record<string, string> = {
  novo:       'bg-blue-100 text-blue-700',
  confirmado: 'bg-green-100 text-green-700',
  faturado:   'bg-purple-100 text-purple-700',
  enviado:    'bg-cyan-100 text-cyan-700',
  entregue:   'bg-green-100 text-green-800',
  cancelado:  'bg-red-100 text-red-600',
  devolvido:  'bg-orange-100 text-orange-600',
}
const STATUS_LABEL: Record<string, string> = {
  novo: 'Novo', confirmado: 'Confirmado', faturado: 'Faturado',
  enviado: 'Enviado', entregue: 'Entregue', cancelado: 'Cancelado', devolvido: 'Devolvido',
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

export default function PedidosMarketplaceClient({ canal, pedidos: pedidosIniciais, empresaId, statusInicial, qInicial }: {
  canal: any; pedidos: any[]; empresaId: string; statusInicial: string; qInicial: string
}) {
  const router = useRouter()
  const [pedidos, setPedidos] = useState(pedidosIniciais)
  const [q, setQ] = useState(qInicial)
  const [statusFiltro, setStatusFiltro] = useState(statusInicial)
  const [detalhe, setDetalhe] = useState<any | null>(null)
  const [modal, setModal] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [rastreioForm, setRastreioForm] = useState({ transportadora: '', codigo_rastreio: '' })

  const formPedidoVazio = {
    id_externo: '', numero_pedido: '', cliente_nome: '', cliente_email: '', cliente_doc: '',
    entrega_cep: '', entrega_logradouro: '', entrega_numero: '', entrega_bairro: '', entrega_cidade: '', entrega_estado: '',
    valor_produtos: '', valor_frete: '', valor_desconto: '', data_pedido: '', observacoes: '', status: 'novo',
  }
  const [formPedido, setFormPedido] = useState(formPedidoVazio)
  const [itensForm, setItensForm] = useState<{ nome_produto: string; quantidade: string; preco_unitario: string }[]>([
    { nome_produto: '', quantidade: '1', preco_unitario: '' }
  ])

  function fp(k: string, v: any) { setFormPedido(p => ({ ...p, [k]: v })) }

  async function salvarPedido() {
    if (!formPedido.id_externo.trim()) { alert('ID externo obrigatório.'); return }
    setSalvando(true)
    const sb = createClient()
    const vProd = parseFloat(formPedido.valor_produtos) || 0
    const vFrete = parseFloat(formPedido.valor_frete) || 0
    const vDesc = parseFloat(formPedido.valor_desconto) || 0
    const { data: pedido, error } = await sb.from('marketplace_pedidos').insert({
      empresa_id: empresaId, canal_id: canal.id,
      id_externo: formPedido.id_externo.trim(),
      numero_pedido: formPedido.numero_pedido || null,
      cliente_nome: formPedido.cliente_nome || null,
      cliente_email: formPedido.cliente_email || null,
      cliente_doc: formPedido.cliente_doc || null,
      entrega_cep: formPedido.entrega_cep || null,
      entrega_logradouro: formPedido.entrega_logradouro || null,
      entrega_numero: formPedido.entrega_numero || null,
      entrega_bairro: formPedido.entrega_bairro || null,
      entrega_cidade: formPedido.entrega_cidade || null,
      entrega_estado: formPedido.entrega_estado || null,
      valor_produtos: vProd, valor_frete: vFrete, valor_desconto: vDesc,
      valor_total: vProd + vFrete - vDesc,
      status: formPedido.status,
      data_pedido: formPedido.data_pedido ? new Date(formPedido.data_pedido).toISOString() : new Date().toISOString(),
      observacoes: formPedido.observacoes || null,
    }).select().single()
    if (error) { alert(error.message); setSalvando(false); return }

    const itensFiltrados = itensForm.filter(i => i.nome_produto.trim())
    if (itensFiltrados.length > 0) {
      await sb.from('marketplace_pedido_itens').insert(itensFiltrados.map(i => ({
        pedido_id: pedido.id,
        nome_produto: i.nome_produto,
        quantidade: parseInt(i.quantidade) || 1,
        preco_unitario: parseFloat(i.preco_unitario) || 0,
        subtotal: (parseInt(i.quantidade) || 1) * (parseFloat(i.preco_unitario) || 0),
      })))
    }

    setPedidos(prev => [{ ...pedido, marketplace_pedido_itens: itensFiltrados }, ...prev])
    setModal(false)
    setFormPedido(formPedidoVazio)
    setItensForm([{ nome_produto: '', quantidade: '1', preco_unitario: '' }])
    setSalvando(false)
    router.refresh()
  }

  async function atualizarStatus(pedido: any, novoStatus: string) {
    const sb = createClient()
    await sb.from('marketplace_pedidos').update({ status: novoStatus, updated_at: new Date().toISOString() }).eq('id', pedido.id)
    setPedidos(prev => prev.map(p => p.id === pedido.id ? { ...p, status: novoStatus } : p))
    if (detalhe?.id === pedido.id) setDetalhe((p: any) => ({ ...p, status: novoStatus }))
  }

  async function salvarRastreio(pedido: any) {
    setSalvando(true)
    const sb = createClient()
    await sb.from('marketplace_pedidos').update({
      transportadora: rastreioForm.transportadora || null,
      codigo_rastreio: rastreioForm.codigo_rastreio || null,
      status: 'enviado',
      data_envio: new Date().toISOString(),
    }).eq('id', pedido.id)
    setPedidos(prev => prev.map(p => p.id === pedido.id ? { ...p, ...rastreioForm, status: 'enviado' } : p))
    if (detalhe?.id === pedido.id) setDetalhe((p: any) => ({ ...p, ...rastreioForm, status: 'enviado' }))
    setRastreioForm({ transportadora: '', codigo_rastreio: '' })
    setSalvando(false)
  }

  const filtrados = pedidos.filter(p => {
    const matchQ = !q || (p.cliente_nome ?? '').toLowerCase().includes(q.toLowerCase()) || (p.numero_pedido ?? '').includes(q) || p.id_externo.includes(q)
    const matchS = !statusFiltro || p.status === statusFiltro
    return matchQ && matchS
  })

  const totalNovos = pedidos.filter(p => p.status === 'novo').length
  const faturamento = pedidos.filter(p => !['cancelado', 'devolvido'].includes(p.status)).reduce((s, p) => s + Number(p.valor_total), 0)

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <a href="/dashboard/marketplaces" className="hover:text-gray-600">marketplaces</a><span>›</span>
        <a href={`/dashboard/marketplaces/${canal.id}`} className="hover:text-gray-600">{canal.nome}</a><span>›</span>
        <span className="text-gray-600 font-medium">pedidos</span>
      </div>

      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Pedidos — {canal.nome}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{pedidos.length} pedidos · {fmt(faturamento)} faturados</p>
        </div>
        <button onClick={() => setModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
          + Lançar pedido manual
        </button>
      </div>

      {/* Cards status */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        {[['novo','Novos','blue'],['confirmado','Confirmados','green'],['enviado','Enviados','cyan'],['entregue','Entregues','green'],['cancelado','Cancelados','red']].map(([s, l, c]) => {
          const n = pedidos.filter(p => p.status === s).length
          return (
            <button key={s} onClick={() => setStatusFiltro(statusFiltro === s ? '' : s)}
              className={`bg-white border rounded-xl p-3 text-left transition-all ${statusFiltro === s ? 'border-blue-400 ring-1 ring-blue-400' : 'border-gray-200 hover:border-gray-300'}`}>
              <p className="text-xs text-gray-500">{l}</p>
              <p className={`text-xl font-bold ${n > 0 && s === 'novo' ? 'text-orange-500' : 'text-gray-900'}`}>{n}</p>
            </button>
          )
        })}
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-3 mb-4">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar cliente, nº pedido, ID..."
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 w-72 bg-white" />
        {statusFiltro && (
          <button onClick={() => setStatusFiltro('')} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_CORES[statusFiltro]}`}>{STATUS_LABEL[statusFiltro]}</span>
            ✕
          </button>
        )}
      </div>

      <div className="grid grid-cols-5 gap-4">
        {/* Lista */}
        <div className="col-span-3 bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Pedido / Cliente</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">Data</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">Total</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.map(p => (
                <tr key={p.id} onClick={() => setDetalhe(p)}
                  className={`hover:bg-blue-50 transition-colors cursor-pointer ${detalhe?.id === p.id ? 'bg-blue-50' : ''}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 text-xs">{p.numero_pedido || p.id_externo}</p>
                    <p className="text-xs text-gray-500">{p.cliente_nome || '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {p.data_pedido ? new Date(p.data_pedido).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900 text-sm">{fmt(Number(p.valor_total))}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_CORES[p.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={4} className="py-12 text-center text-gray-400 text-sm">Nenhum pedido encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Detalhe do pedido selecionado */}
        <div className="col-span-2">
          {detalhe ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 sticky top-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{detalhe.numero_pedido || detalhe.id_externo}</h3>
                  <p className="text-xs text-gray-400 font-mono">ID: {detalhe.id_externo}</p>
                </div>
                <select value={detalhe.status} onChange={e => atualizarStatus(detalhe, e.target.value)}
                  className={`text-xs font-medium px-2 py-1 rounded-lg border-0 focus:outline-none cursor-pointer ${STATUS_CORES[detalhe.status]}`}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>

              {/* Cliente */}
              {detalhe.cliente_nome && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Cliente</p>
                  <p className="text-sm text-gray-900">{detalhe.cliente_nome}</p>
                  {detalhe.cliente_email && <p className="text-xs text-gray-500">{detalhe.cliente_email}</p>}
                  {detalhe.cliente_doc && <p className="text-xs text-gray-400 font-mono">{detalhe.cliente_doc}</p>}
                </div>
              )}

              {/* Endereço */}
              {detalhe.entrega_logradouro && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Entrega</p>
                  <p className="text-xs text-gray-600">
                    {detalhe.entrega_logradouro}, {detalhe.entrega_numero}<br />
                    {detalhe.entrega_bairro} — {detalhe.entrega_cidade}/{detalhe.entrega_estado}<br />
                    CEP {detalhe.entrega_cep}
                  </p>
                </div>
              )}

              {/* Itens */}
              {detalhe.marketplace_pedido_itens?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Itens</p>
                  <div className="space-y-1">
                    {detalhe.marketplace_pedido_itens.map((item: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-gray-700">{item.quantidade}× {item.nome_produto}</span>
                        <span className="text-gray-900 font-medium">{fmt(Number(item.subtotal))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Valores */}
              <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                <div className="flex justify-between text-xs text-gray-600">
                  <span>Produtos</span><span>{fmt(Number(detalhe.valor_produtos))}</span>
                </div>
                {Number(detalhe.valor_frete) > 0 && (
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>Frete</span><span>{fmt(Number(detalhe.valor_frete))}</span>
                  </div>
                )}
                {Number(detalhe.valor_desconto) > 0 && (
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>Desconto</span><span>-{fmt(Number(detalhe.valor_desconto))}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-gray-900 border-t border-gray-200 pt-1 mt-1">
                  <span>Total</span><span>{fmt(Number(detalhe.valor_total))}</span>
                </div>
              </div>

              {/* Rastreio */}
              {['confirmado','faturado'].includes(detalhe.status) && (
                <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-600">Informar envio</p>
                  <input value={rastreioForm.transportadora} onChange={e => setRastreioForm(p => ({ ...p, transportadora: e.target.value }))}
                    placeholder="Transportadora"
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500" />
                  <input value={rastreioForm.codigo_rastreio} onChange={e => setRastreioForm(p => ({ ...p, codigo_rastreio: e.target.value }))}
                    placeholder="Código de rastreio"
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500" />
                  <button onClick={() => salvarRastreio(detalhe)} disabled={salvando}
                    className="w-full py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-medium rounded-lg transition-colors">
                    Marcar como enviado
                  </button>
                </div>
              )}

              {detalhe.codigo_rastreio && (
                <div className="text-xs text-gray-600">
                  <p className="font-semibold text-gray-500 uppercase tracking-wide mb-1">Rastreio</p>
                  <p>{detalhe.transportadora} · <span className="font-mono">{detalhe.codigo_rastreio}</span></p>
                </div>
              )}

              {detalhe.observacoes && (
                <p className="text-xs text-gray-500 italic border-t border-gray-100 pt-3">{detalhe.observacoes}</p>
              )}
            </div>
          ) : (
            <div className="bg-white border border-dashed border-gray-200 rounded-xl p-8 text-center text-gray-400">
              <p className="text-2xl mb-2">📋</p>
              <p className="text-sm">Selecione um pedido para ver os detalhes</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal lançar pedido manual */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h2 className="text-lg font-semibold text-gray-900">Lançar Pedido Manual</h2>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-4">
                <FP label="ID externo *" value={formPedido.id_externo} onChange={v => fp('id_externo', v)} placeholder="ID na plataforma" />
                <FP label="Nº do pedido" value={formPedido.numero_pedido} onChange={v => fp('numero_pedido', v)} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <FP label="Nome do cliente" value={formPedido.cliente_nome} onChange={v => fp('cliente_nome', v)} />
                <FP label="E-mail" value={formPedido.cliente_email} onChange={v => fp('cliente_email', v)} />
                <FP label="CPF/CNPJ" value={formPedido.cliente_doc} onChange={v => fp('cliente_doc', v)} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <FP label="Valor produtos (R$)" value={formPedido.valor_produtos} onChange={v => fp('valor_produtos', v)} />
                <FP label="Frete (R$)" value={formPedido.valor_frete} onChange={v => fp('valor_frete', v)} />
                <FP label="Desconto (R$)" value={formPedido.valor_desconto} onChange={v => fp('valor_desconto', v)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FP label="Data do pedido" value={formPedido.data_pedido} onChange={v => fp('data_pedido', v)} type="datetime-local" />
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Status inicial</label>
                  <select value={formPedido.status} onChange={e => fp('status', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                    {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>

              {/* Itens */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600">Itens do pedido</label>
                  <button onClick={() => setItensForm(p => [...p, { nome_produto: '', quantidade: '1', preco_unitario: '' }])}
                    className="text-xs text-blue-600 hover:text-blue-700">+ Adicionar item</button>
                </div>
                <div className="space-y-2">
                  {itensForm.map((it, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input value={it.nome_produto} onChange={e => setItensForm(p => p.map((x, j) => j === i ? { ...x, nome_produto: e.target.value } : x))}
                        placeholder="Nome do produto"
                        className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500" />
                      <input type="number" value={it.quantidade} onChange={e => setItensForm(p => p.map((x, j) => j === i ? { ...x, quantidade: e.target.value } : x))}
                        className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 text-center" placeholder="Qtd" />
                      <input type="number" step="0.01" value={it.preco_unitario} onChange={e => setItensForm(p => p.map((x, j) => j === i ? { ...x, preco_unitario: e.target.value } : x))}
                        className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 text-right" placeholder="R$ unit." />
                      {itensForm.length > 1 && (
                        <button onClick={() => setItensForm(p => p.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-500 text-lg">×</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <FP label="Observações" value={formPedido.observacoes} onChange={v => fp('observacoes', v)} />
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setModal(false)} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={salvarPedido} disabled={salvando}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {salvando ? 'Salvando...' : 'Lançar pedido'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FP({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
    </div>
  )
}
