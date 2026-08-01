'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { usePermissao } from '@/contexts/PlanContext'
import { ETAPAS, ETAPA_INFO, proximaEtapa, type Etapa } from '@/lib/pedidos/etapas'
import PainelEtapaPedido from './PainelEtapaPedido'
import { PERIODO_OPCOES, PERIODO_LABELS, type PeriodoPreset } from '@/lib/estoque/periodo'
import { ORIGEM_ROTULO, ORIGEM_COR, type PedidoUnificado, type IndicadoresPedidos, type OrigemPedido } from '@/lib/pedidos/unificado'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const FISCAL_BADGE: Record<string, { texto: string; cls: string }> = {
  emitida: { texto: 'Emitida', cls: 'bg-emerald-100 text-emerald-700' },
  informada: { texto: 'Informada', cls: 'bg-sky-100 text-sky-700' },
  rejeitada: { texto: 'Rejeitada', cls: 'bg-red-100 text-red-600' },
  nao_emitida: { texto: 'Sem nota', cls: 'bg-gray-100 text-gray-500' },
}

type FiltroSituacao = 'todos' | 'sem_nota' | 'aguardando_envio' | 'cancelados' | 'sem_cliente'

export default function PedidosClient({
  pedidos, indicadores, periodoInicial, deInicial, ateInicial, truncou, limitePorFonte,
}: {
  pedidos: PedidoUnificado[]
  indicadores: IndicadoresPedidos
  periodoInicial: PeriodoPreset
  deInicial: string
  ateInicial: string
  truncou: boolean
  limitePorFonte: number
}) {
  const router = useRouter()
  // Sem esta permissao a pessoa continua vendo e trabalhando os pedidos —
  // some so o dinheiro: faturamento, ticket medio e o valor de cada linha.
  const podeVerTotais = usePermissao('ver_totais_vendas')
  const [busca, setBusca] = useState('')
  // Filtro por etapa: a pergunta operacional ("o que falta separar hoje?")
  // que a tela de historico nao respondia.
  const [etapasFiltro, setEtapasFiltro] = useState<Set<Etapa>>(new Set())
  const [detalhe, setDetalhe] = useState<PedidoUnificado | null>(null)
  const [lista, setLista] = useState<PedidoUnificado[] | null>(null)
  const [origens, setOrigens] = useState<Set<OrigemPedido>>(new Set())
  const [situacao, setSituacao] = useState<FiltroSituacao>('todos')

  function navegar(params: Record<string, string>) {
    const sp = new URLSearchParams({ periodo: periodoInicial, de: deInicial, ate: ateInicial, ...params })
    router.push(`/dashboard/pedidos?${sp.toString()}`)
  }

  function alternarOrigem(o: OrigemPedido) {
    setOrigens(prev => {
      const novo = new Set(prev)
      if (novo.has(o)) novo.delete(o); else novo.add(o)
      return novo
    })
  }

  // Origens que realmente aparecem no período — não adianta oferecer filtro
  // de TikTok numa loja que não vende lá.
  const origensPresentes = useMemo(() => {
    const set = new Set<OrigemPedido>()
    for (const p of pedidos) set.add(p.origem)
    return [...set]
  }, [pedidos])

  // A lista local reflete a mudanca de etapa na hora; `pedidos` continua
  // sendo a verdade vinda do servidor a cada recarga.
  const base = lista ?? pedidos
  useEffect(() => { setLista(null) }, [pedidos])

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return base.filter(p => {
      if (etapasFiltro.size > 0 && !etapasFiltro.has(p.etapa)) return false
      if (origens.size > 0 && !origens.has(p.origem)) return false
      if (situacao === 'sem_nota' && !(!p.cancelado && (p.fiscal === 'nao_emitida' || p.fiscal === 'rejeitada'))) return false
      if (situacao === 'aguardando_envio' && !(!p.cancelado && p.fonte === 'marketplace' && !p.enviado)) return false
      if (situacao === 'cancelados' && !p.cancelado) return false
      if (situacao === 'sem_cliente' && (p.cancelado || !!p.clienteNome?.trim())) return false
      if (!termo) return true
      return [p.numero, p.clienteNome, p.fiscalNumero, p.rastreio, p.origemNome]
        .some(c => (c ?? '').toLowerCase().includes(termo))
    })
  }, [base, busca, origens, situacao, etapasFiltro])

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span className="text-gray-600 font-medium">Pedidos</span>
      </div>

      <div className="mb-4">
        <h1 className="text-gray-900 text-xl font-semibold">Pedidos</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Todos os pedidos da empresa, de qualquer origem — PDV, aplicativo e marketplaces, na mesma lista.
        </p>
      </div>

      {/* Período */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {PERIODO_OPCOES.filter(p => p !== 'custom').map(p => (
          <button key={p} onClick={() => navegar({ periodo: p })}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${periodoInicial === p ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            {PERIODO_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <Card label="Pedidos" valor={String(indicadores.quantidade)} />
        {podeVerTotais && <Card label="Valor vendido" valor={brl(indicadores.valor)} />}
        {podeVerTotais && <Card label="Ticket médio" valor={brl(indicadores.ticketMedio)} />}
        <Card label="A separar" valor={String(indicadores.aSeparar)}
          cls={indicadores.aSeparar > 0 ? 'text-amber-600' : undefined}
          ativo={etapasFiltro.has('novo')}
          onClick={() => setEtapasFiltro(new Set<Etapa>(['novo', 'separando']))} />
        <Card label="A despachar" valor={String(indicadores.aDespachar)}
          cls={indicadores.aDespachar > 0 ? 'text-amber-600' : undefined}
          ativo={etapasFiltro.has('embalado')}
          onClick={() => setEtapasFiltro(new Set<Etapa>(['embalado']))} />
        <Card label="Aguardando nota" valor={String(indicadores.aguardandoNota)}
          cls={indicadores.aguardandoNota > 0 ? 'text-amber-600' : undefined}
          onClick={() => setSituacao(situacao === 'sem_nota' ? 'todos' : 'sem_nota')} ativo={situacao === 'sem_nota'} />
        <Card label="Aguardando envio" valor={String(indicadores.aguardandoEnvio)}
          cls={indicadores.aguardandoEnvio > 0 ? 'text-amber-600' : undefined}
          onClick={() => setSituacao(situacao === 'aguardando_envio' ? 'todos' : 'aguardando_envio')} ativo={situacao === 'aguardando_envio'} />
        <Card label="Cancelados" valor={String(indicadores.cancelados)}
          cls={indicadores.cancelados > 0 ? 'text-red-500' : undefined}
          onClick={() => setSituacao(situacao === 'cancelados' ? 'todos' : 'cancelados')} ativo={situacao === 'cancelados'} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Card label="Do marketplace" valor={String(indicadores.marketplace)} pequeno />
        <Card label="Do PDV / app" valor={String(indicadores.pdv)} pequeno />
        <Card label="Sem cliente identificado" valor={String(indicadores.semCliente)} pequeno
          onClick={() => setSituacao(situacao === 'sem_cliente' ? 'todos' : 'sem_cliente')} ativo={situacao === 'sem_cliente'} />
        <Card label="Total no período" valor={String(pedidos.length)} pequeno />
      </div>

      {truncou && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-700 mb-4">
          O período tem mais de {limitePorFonte} registros em alguma origem. A lista mostra os mais recentes — reduza o período para ver o resto.
        </div>
      )}

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-3">
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por número do pedido, cliente, número da nota, rastreio..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-500 mr-1">Origem:</span>
          {origensPresentes.map(o => (
            <button key={o} onClick={() => alternarOrigem(o)}
              className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${origens.has(o) ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
              {ORIGEM_ROTULO[o]}
            </button>
          ))}
          {(origens.size > 0 || situacao !== 'todos' || busca || etapasFiltro.size > 0) && (
            <button onClick={() => { setOrigens(new Set()); setSituacao('todos'); setBusca(''); setEtapasFiltro(new Set()) }}
              className="text-xs text-gray-500 hover:text-gray-700 underline ml-2">limpar filtros</button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-500 mr-1">Etapa:</span>
          {ETAPAS.map(e => {
            const on = etapasFiltro.has(e.valor)
            const qtd = base.filter(p => p.etapa === e.valor).length
            if (qtd === 0 && !on) return null
            return (
              <button key={e.valor} title={e.ajuda}
                onClick={() => setEtapasFiltro(s2 => {
                  const n = new Set(s2); n.has(e.valor) ? n.delete(e.valor) : n.add(e.valor); return n
                })}
                className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${on ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                {e.icone} {e.label} <span className="opacity-60">{qtd}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Lista */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            {filtrados.length === pedidos.length
              ? `${pedidos.length} pedido(s)`
              : `${filtrados.length} de ${pedidos.length} pedido(s)`}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600 whitespace-nowrap">Data</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600">Nº</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600">Origem</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600">Cliente</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600" title="O que a sua operação já fez com o pedido">Etapa</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600" title="O que o canal informa">Situação</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600">Nota</th>
                {podeVerTotais && <th className="text-right px-3 py-2.5 text-xs font-medium text-gray-600">Total</th>}
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.length === 0 && (
                <tr><td colSpan={podeVerTotais ? 9 : 8} className="text-center py-10 text-gray-400 text-sm">Nenhum pedido com os filtros atuais.</td></tr>
              )}
              {filtrados.map(p => {
                const fb = FISCAL_BADGE[p.fiscal]
                return (
                  <tr key={`${p.fonte}-${p.id}`} className={`hover:bg-gray-50 ${p.cancelado ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-2 text-gray-600 text-xs whitespace-nowrap">
                      {p.criadoEm ? new Date(p.criadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-900 font-mono text-xs">{p.numero}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ORIGEM_COR[p.origem]}`}>{p.origemNome}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-700 max-w-[220px] truncate">{p.clienteNome || <span className="text-gray-400">—</span>}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => setDetalhe(p)}
                        className={`text-xs px-2 py-0.5 rounded-full border font-medium hover:opacity-80 ${ETAPA_INFO[p.etapa]?.cor ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                        {ETAPA_INFO[p.etapa]?.icone} {ETAPA_INFO[p.etapa]?.label ?? p.etapa}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs ${p.cancelado ? 'text-red-600' : 'text-gray-600'}`}>{p.statusRotulo}</span>
                      {p.rastreio && <span className="block text-[11px] text-gray-400 font-mono">{p.rastreio}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${fb.cls}`}>{fb.texto}</span>
                      {p.fiscalNumero && <span className="block text-[11px] text-gray-400">nº {p.fiscalNumero}</span>}
                    </td>
                    {podeVerTotais && <td className="px-3 py-2 text-right font-medium text-gray-900 whitespace-nowrap">{brl(p.total)}</td>}
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {proximaEtapa(p.etapa) && !p.cancelado && (
                        <button onClick={() => setDetalhe(p)}
                          title={`Avançar para ${ETAPA_INFO[proximaEtapa(p.etapa)!].label}`}
                          className="text-xs text-gray-500 hover:text-blue-700 mr-3">avançar →</button>
                      )}
                      <a href={p.fonte === 'venda' ? '/dashboard/vendas' : '/dashboard/pedidos-ecommerce'}
                        className="text-xs text-blue-600 hover:underline">abrir →</a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {detalhe && (
        <PainelEtapaPedido pedido={detalhe} onFechar={() => setDetalhe(null)}
          onMudou={nova => setLista(l => (l ?? pedidos).map(x =>
            x.id === detalhe.id && x.fonte === detalhe.fonte ? { ...x, etapa: nova } : x))} />
      )}

      <p className="text-xs text-gray-400 mt-3">
        Esta tela reúne o que hoje vive em dois lugares: as vendas do PDV e os pedidos de marketplace.
        O botão &quot;abrir&quot; leva à tela específica de cada um — a ficha completa do pedido, com edição, vem na próxima etapa.
      </p>
    </div>
  )
}

function Card({ label, valor, cls, pequeno, onClick, ativo }: {
  label: string; valor: string; cls?: string; pequeno?: boolean
  onClick?: () => void; ativo?: boolean
}) {
  const conteudo = (
    <>
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`${pequeno ? 'text-base' : 'text-lg'} font-semibold mt-0.5 ${cls ?? 'text-gray-900'}`}>{valor}</p>
    </>
  )
  const base = `bg-white border rounded-xl p-3 text-left w-full ${ativo ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200'}`
  return onClick
    ? <button onClick={onClick} className={`${base} hover:border-blue-300 transition-colors`}>{conteudo}</button>
    : <div className={base}>{conteudo}</div>
}
