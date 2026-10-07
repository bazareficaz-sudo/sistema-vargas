'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Listagens de consulta rápida dentro do PDV web — pedidos (vendas) e
// orçamentos — sem sair da tela de venda e sem perder o carrinho aberto.
//
// Só leitura. Converter orçamento em venda NÃO acontece aqui: a conversão tem
// arbitragem própria no servidor (orcamentos.venda_id + trigger em vendas),
// para que um orçamento nunca vire duas vendas. Copiar os itens para o
// carrinho por fora dela reabriria exatamente esse buraco.
//
// Também não há totais somados no topo: o PDV não carrega as permissões de
// "ver totais de vendas", e a soma do dia é justamente o número que o gestor
// costuma esconder do balcão. Cada linha mostra o próprio total, que o
// vendedor já vê ao fechar a venda.

type Periodo = 'hoje' | '7d' | '30d'

function inicioDoPeriodo(p: Periodo): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (p === '7d') d.setDate(d.getDate() - 6)
  if (p === '30d') d.setDate(d.getDate() - 29)
  return d.toISOString()
}

const fmt = (v: number) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataHora = (s: string) => new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const data = (s: string) => new Date(s).toLocaleDateString('pt-BR')

/** Texto de busca seguro para um `.or()` do PostgREST (vírgula e parênteses são sintaxe). */
function termoBusca(q: string): string {
  return q.replace(/[,()"\\%*]/g, ' ').trim()
}

function Filtros<T extends string>({ opcoes, valor, onChange }: {
  opcoes: { v: T; l: string }[]; valor: T; onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
      {opcoes.map(o => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)}
          className={`px-3 py-1.5 ${valor === o.v ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
          {o.l}
        </button>
      ))}
    </div>
  )
}

type ItemLinha = { produto_nome: string; quantidade: number; preco_unitario: number; total: number; tipo?: string | null }

function ItensDetalhe({ itens, carregando }: { itens: ItemLinha[] | undefined; carregando: boolean }) {
  if (carregando || !itens) return <p className="text-xs text-gray-400 px-3 py-2">Carregando itens...</p>
  if (itens.length === 0) return <p className="text-xs text-gray-400 px-3 py-2">Sem itens.</p>
  return (
    <table className="w-full text-xs">
      <tbody>
        {itens.map((i, ix) => (
          <tr key={ix} className="border-t border-gray-100">
            <td className="px-3 py-1 text-gray-800">
              {i.tipo === 'devolucao' && <span className="mr-1 text-[9px] font-bold bg-red-500 text-white px-1 rounded">DEV</span>}
              {i.produto_nome}
            </td>
            <td className="px-2 py-1 text-right text-gray-500 whitespace-nowrap">{Number(i.quantidade).toLocaleString('pt-BR')} × {fmt(i.preco_unitario)}</td>
            <td className="px-3 py-1 text-right font-medium text-gray-900 whitespace-nowrap">{fmt(i.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ───────────────────────────── PEDIDOS ─────────────────────────────

type Venda = {
  id: string; numero: number | null; created_at: string
  cliente_nome: string | null; clientes: { nome: string } | null
  vendedor_nome: string | null; operador_nome: string | null
  forma_pagamento: string | null; total: number; status: string
  tipo_operacao: string | null; canal: string | null
  nfce_status: string | null; nfce_numero: string | null
}

const STATUS_VENDA: Record<string, string> = {
  concluida: 'bg-emerald-100 text-emerald-700',
  cancelada: 'bg-red-100 text-red-600',
  cancelado: 'bg-red-100 text-red-600',
  pendente: 'bg-amber-100 text-amber-700',
}

export function ListaPedidosPdv({ empresaId }: { empresaId: string }) {
  const sb = createClient()
  const [periodo, setPeriodo] = useState<Periodo>('hoje')
  const [q, setQ] = useState('')
  const [lista, setLista] = useState<Venda[]>([])
  const [carregando, setCarregando] = useState(true)
  const [aberta, setAberta] = useState<string | null>(null)
  const [itens, setItens] = useState<Record<string, ItemLinha[]>>({})
  const [gerando, setGerando] = useState<string | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let cancelado = false
    const t = setTimeout(async () => {
      setCarregando(true)
      let query = sb.from('vendas')
        .select('id, numero, created_at, cliente_nome, clientes(nome), vendedor_nome, operador_nome, forma_pagamento, total, status, tipo_operacao, canal, nfce_status, nfce_numero')
        .eq('empresa_id', empresaId)
        .gte('created_at', inicioDoPeriodo(periodo))
        .order('created_at', { ascending: false })
        .limit(200)
      const termo = termoBusca(q)
      if (termo) {
        query = /^\d+$/.test(termo)
          ? query.or(`numero.eq.${termo},cliente_nome.ilike.%${termo}%`)
          : query.or(`cliente_nome.ilike.%${termo}%,vendedor_nome.ilike.%${termo}%`)
      }
      const { data, error } = await query
      if (cancelado) return
      setErro(error ? 'Não foi possível carregar os pedidos.' : '')
      setLista((data ?? []) as unknown as Venda[])
      setCarregando(false)
    }, q ? 300 : 0)
    return () => { cancelado = true; clearTimeout(t) }
  }, [empresaId, periodo, q])

  async function alternar(id: string) {
    if (aberta === id) { setAberta(null); return }
    setAberta(id)
    if (!itens[id]) {
      const { data } = await sb.from('venda_itens')
        .select('produto_nome, quantidade, preco_unitario, total, tipo').eq('venda_id', id)
      setItens(p => ({ ...p, [id]: (data ?? []) as ItemLinha[] }))
    }
  }

  async function comprovante(id: string) {
    setGerando(id); setErro('')
    // Abre a aba já no clique: navegador bloqueia popup aberto depois de um await.
    const aba = window.open('', '_blank')
    try {
      const d = await fetch(`/api/vendas/${id}/comprovante-pdf`, { method: 'POST' }).then(r => r.json())
      if (!d?.ok || !d.url) throw new Error(d?.erro ?? 'Falha ao gerar o comprovante')
      if (aba) aba.location.href = d.url
      else window.open(d.url, '_blank')
    } catch (e: unknown) {
      aba?.close()
      setErro(e instanceof Error ? e.message : 'Falha ao gerar o comprovante')
    } finally {
      setGerando(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Filtros opcoes={[{ v: 'hoje', l: 'Hoje' }, { v: '7d', l: '7 dias' }, { v: '30d', l: '30 dias' }]}
          valor={periodo} onChange={setPeriodo} />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Nº do pedido, cliente ou vendedor"
          className="flex-1 min-w-[180px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500" />
        <a href="/dashboard/vendas" target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap">
          Abrir tela de Vendas ↗
        </a>
      </div>

      {erro && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs">{erro}</div>}

      <div className="border border-gray-200 rounded-xl overflow-hidden">
        {carregando ? (
          <p className="text-center text-sm text-gray-400 py-8">Carregando...</p>
        ) : lista.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">Nenhum pedido no período.</p>
        ) : lista.map(v => {
          const cliente = v.clientes?.nome ?? v.cliente_nome ?? 'Consumidor'
          const cancelada = v.status === 'cancelada' || v.status === 'cancelado'
          return (
            <div key={v.id} className="border-b border-gray-100 last:border-0">
              <button type="button" onClick={() => alternar(v.id)}
                className={`w-full grid grid-cols-[70px_90px_1fr_110px_100px] gap-2 items-center px-3 py-2 text-left text-sm hover:bg-gray-50 ${aberta === v.id ? 'bg-blue-50' : ''}`}>
                <span className="font-mono text-xs text-gray-500">#{v.numero ?? '—'}</span>
                <span className="text-xs text-gray-500">{dataHora(v.created_at)}</span>
                <span className="min-w-0">
                  <span className={`block truncate ${cancelada ? 'line-through text-gray-400' : 'text-gray-900'}`}>{cliente}</span>
                  <span className="block text-[11px] text-gray-400 truncate">
                    {[v.vendedor_nome && `Vend.: ${v.vendedor_nome}`, v.forma_pagamento, v.canal && v.canal !== 'PDV' ? v.canal : null,
                      v.tipo_operacao && v.tipo_operacao !== 'venda' ? v.tipo_operacao : null,
                      v.nfce_numero ? `NFC-e ${v.nfce_numero}` : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className={`justify-self-start text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_VENDA[v.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {v.status}
                </span>
                <span className={`text-right font-semibold ${cancelada ? 'text-gray-400' : 'text-gray-900'}`}>{fmt(v.total)}</span>
              </button>
              {aberta === v.id && (
                <div className="bg-gray-50/70 pb-2">
                  <ItensDetalhe itens={itens[v.id]} carregando={!itens[v.id]} />
                  <div className="flex justify-end gap-2 px-3 pt-2">
                    <button type="button" onClick={() => comprovante(v.id)} disabled={gerando === v.id}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">
                      {gerando === v.id ? 'Gerando...' : '🖨 Comprovante'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {lista.length === 200 && <p className="text-[11px] text-gray-400">Mostrando os 200 mais recentes. Refine pela busca ou abra a tela de Vendas.</p>}
    </div>
  )
}

// ──────────────────────────── ORÇAMENTOS ───────────────────────────

type Orcamento = {
  id: string; numero: number; status: string; created_at: string
  cliente_nome: string | null; clientes: { nome: string; telefone: string | null } | null
  operador_nome: string | null; total: number; validade: string | null
  observacao: string | null
  orcamento_itens: ItemLinha[]
}

const STATUS_ORC: Record<string, { label: string; cor: string }> = {
  aberto:     { label: 'Aberto',     cor: 'bg-blue-100 text-blue-700' },
  aprovado:   { label: 'Aprovado',   cor: 'bg-green-100 text-green-700' },
  cancelado:  { label: 'Cancelado',  cor: 'bg-red-100 text-red-600' },
  convertido: { label: 'Convertido', cor: 'bg-gray-100 text-gray-500' },
}

type FiltroOrc = 'pendentes' | 'todos'

export function ListaOrcamentosPdv({ empresaId }: { empresaId: string }) {
  const sb = createClient()
  const [filtro, setFiltro] = useState<FiltroOrc>('pendentes')
  const [periodo, setPeriodo] = useState<Periodo>('30d')
  const [q, setQ] = useState('')
  const [lista, setLista] = useState<Orcamento[]>([])
  const [carregando, setCarregando] = useState(true)
  const [aberto, setAberto] = useState<string | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let cancelado = false
    const t = setTimeout(async () => {
      setCarregando(true)
      let query = sb.from('orcamentos')
        .select('id, numero, status, created_at, cliente_nome, clientes(nome, telefone), operador_nome, total, validade, observacao, orcamento_itens(produto_nome, quantidade, preco_unitario, total)')
        .eq('empresa_id', empresaId)
        .gte('created_at', inicioDoPeriodo(periodo))
        .order('created_at', { ascending: false })
        .limit(200)
      // "Pendentes" = o que ainda pode virar venda.
      if (filtro === 'pendentes') query = query.in('status', ['aberto', 'aprovado'])
      const termo = termoBusca(q)
      if (termo) {
        query = /^\d+$/.test(termo)
          ? query.or(`numero.eq.${termo},cliente_nome.ilike.%${termo}%`)
          : query.ilike('cliente_nome', `%${termo}%`)
      }
      const { data, error } = await query
      if (cancelado) return
      setErro(error ? 'Não foi possível carregar os orçamentos.' : '')
      setLista((data ?? []) as unknown as Orcamento[])
      setCarregando(false)
    }, q ? 300 : 0)
    return () => { cancelado = true; clearTimeout(t) }
  }, [empresaId, filtro, periodo, q])

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const vencido = (o: Orcamento) => !!o.validade && o.status === 'aberto' && new Date(o.validade) < hoje

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Filtros opcoes={[{ v: 'pendentes', l: 'Abertos e aprovados' }, { v: 'todos', l: 'Todos' }]}
          valor={filtro} onChange={setFiltro} />
        <Filtros opcoes={[{ v: 'hoje', l: 'Hoje' }, { v: '7d', l: '7 dias' }, { v: '30d', l: '30 dias' }]}
          valor={periodo} onChange={setPeriodo} />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Nº do orçamento ou cliente"
          className="flex-1 min-w-[160px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500" />
        <a href="/dashboard/orcamentos" target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap">
          Abrir tela de Orçamentos ↗
        </a>
      </div>

      {erro && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs">{erro}</div>}

      <div className="border border-gray-200 rounded-xl overflow-hidden">
        {carregando ? (
          <p className="text-center text-sm text-gray-400 py-8">Carregando...</p>
        ) : lista.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">Nenhum orçamento encontrado.</p>
        ) : lista.map(o => {
          const st = STATUS_ORC[o.status] ?? { label: o.status, cor: 'bg-gray-100 text-gray-600' }
          return (
            <div key={o.id} className="border-b border-gray-100 last:border-0">
              <button type="button" onClick={() => setAberto(a => a === o.id ? null : o.id)}
                className={`w-full grid grid-cols-[70px_80px_1fr_110px_100px] gap-2 items-center px-3 py-2 text-left text-sm hover:bg-gray-50 ${aberto === o.id ? 'bg-blue-50' : ''}`}>
                <span className="font-mono text-xs text-gray-500">#{o.numero}</span>
                <span className="text-xs text-gray-500">{data(o.created_at)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-gray-900">{o.clientes?.nome ?? o.cliente_nome ?? 'Sem cliente'}</span>
                  <span className="block text-[11px] text-gray-400 truncate">
                    {[`${o.orcamento_itens?.length ?? 0} itens`, o.operador_nome,
                      o.validade ? `válido até ${data(o.validade)}` : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="justify-self-start flex items-center gap-1">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${st.cor}`}>{st.label}</span>
                  {vencido(o) && <span className="text-[10px] font-semibold text-red-600">vencido</span>}
                </span>
                <span className="text-right font-semibold text-gray-900">{fmt(o.total)}</span>
              </button>
              {aberto === o.id && (
                <div className="bg-gray-50/70 pb-2">
                  <ItensDetalhe itens={o.orcamento_itens ?? []} carregando={false} />
                  {o.observacao && <p className="px-3 pt-1 text-[11px] text-gray-500">Obs.: {o.observacao}</p>}
                  {o.clientes?.telefone && <p className="px-3 pt-1 text-[11px] text-gray-500">Telefone: {o.clientes.telefone}</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {lista.length === 200 && <p className="text-[11px] text-gray-400">Mostrando os 200 mais recentes. Refine pela busca ou abra a tela de Orçamentos.</p>}
    </div>
  )
}
