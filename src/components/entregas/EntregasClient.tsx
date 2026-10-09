'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatarTelefone } from '@/lib/clientes/telefone'
import {
  PERIODOS, montarAgenda, contagemPorDia, diaLocalISO, somarDias, formatarDia,
  enderecoLimpo, linkWhatsApp, linkMapa, periodoDe, type PeriodoEntrega,
} from '@/lib/entregas/agenda'

// ENTREGAS — a agenda do dia para quem despacha.
//
// Lê direto de vendas: entrega_solicitada marca a venda com entrega, a data
// e o período vêm do PDV, e entrega_realizada_em é a baixa feita aqui. As
// pendentes aparecem até 180 dias atrás — o bastante para nenhuma ficar
// esquecida, sem arrastar o histórico inteiro.

type Entrega = {
  id: string; numero: number | null; total: number; created_at: string; status: string | null
  cliente_id: string | null; cliente_nome: string | null; vendedor_nome: string | null
  observacao: string | null; endereco_entrega_texto: string | null
  entrega_agendada_para: string | null; entrega_periodo: string | null; entrega_telefone: string | null
  entrega_realizada_em: string | null; entrega_realizada_por_nome: string | null
  clientes: { nome: string; telefone: string | null; whatsapp: string | null } | null
}
type Item = { venda_id: string; produto_nome: string | null; produto_sku: string | null; quantidade: number; tipo: string | null }

const COLS = 'id, numero, total, created_at, status, cliente_id, cliente_nome, vendedor_nome, observacao, endereco_entrega_texto, entrega_agendada_para, entrega_periodo, entrega_telefone, entrega_realizada_em, entrega_realizada_por_nome, clientes(nome, telefone, whatsapp)'
const JANELA_DIAS = 180

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const nomeCliente = (e: Entrega) => e.clientes?.nome ?? e.cliente_nome ?? 'Cliente não informado'
const telefoneDe = (e: Entrega) => e.entrega_telefone ?? e.clientes?.whatsapp ?? e.clientes?.telefone ?? null
const numeroVenda = (e: Entrega) => e.numero ? `#${e.numero}` : `#${e.id.slice(0, 8).toUpperCase()}`
const rotuloPeriodo = (p: string | null) => PERIODOS.find(x => x.v === periodoDe(p))?.l ?? ''
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const diaSemana = (dia: string) => { const [a, m, d] = dia.split('-').map(Number); return DIAS_SEMANA[new Date(a, m - 1, d).getDay()] }

export default function EntregasClient({ empresaId, empresaNome, podeBaixar }: {
  empresaId: string; empresaNome: string; podeBaixar: boolean
}) {
  const [hoje] = useState(() => diaLocalISO(new Date()))
  const [dia, setDia] = useState(hoje)
  const [pendentes, setPendentes] = useState<Entrega[]>([])
  const [feitas, setFeitas] = useState<Entrega[]>([])
  const [itens, setItens] = useState<Map<string, Item[]>>(new Map())
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [mexendo, setMexendo] = useState<string | null>(null)
  const [reagendando, setReagendando] = useState<string | null>(null)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [verFeitas, setVerFeitas] = useState(true)

  const carregar = useCallback(async (diaAlvo: string) => {
    const sb = createClient()
    setErro('')
    const desde = new Date(Date.now() - JANELA_DIAS * 86400000).toISOString()
    const [a, m, d] = diaAlvo.split('-').map(Number)
    const ini = new Date(a, m - 1, d).toISOString()
    const fim = new Date(a, m - 1, d + 1).toISOString()
    const [rp, rf] = await Promise.all([
      sb.from('vendas').select(COLS)
        .eq('empresa_id', empresaId).eq('entrega_solicitada', true).is('entrega_realizada_em', null)
        .gte('created_at', desde).order('created_at').limit(1000),
      sb.from('vendas').select(COLS)
        .eq('empresa_id', empresaId).eq('entrega_solicitada', true).not('entrega_realizada_em', 'is', null)
        .or(`entrega_agendada_para.eq.${diaAlvo},and(entrega_agendada_para.is.null,entrega_realizada_em.gte.${ini},entrega_realizada_em.lt.${fim})`)
        .order('entrega_realizada_em').limit(500),
    ])
    if (rp.error || rf.error) { setErro('Não foi possível carregar as entregas.'); setCarregando(false); return }
    const ativa = (e: Entrega) => e.status !== 'cancelada' && e.status !== 'cancelado'
    const p = (rp.data as unknown as Entrega[]).filter(ativa)
    const f = (rf.data as unknown as Entrega[]).filter(ativa)
    setPendentes(p); setFeitas(f); setCarregando(false)

    const ids = [...p, ...f].map(e => e.id)
    if (ids.length === 0) { setItens(new Map()); return }
    const { data: its } = await sb.from('venda_itens')
      .select('venda_id, produto_nome, produto_sku, quantidade, tipo').in('venda_id', ids)
    const porVenda = new Map<string, Item[]>()
    for (const it of (its ?? []) as Item[]) {
      if ((it.tipo ?? 'venda') !== 'venda') continue
      porVenda.set(it.venda_id, [...(porVenda.get(it.venda_id) ?? []), it])
    }
    setItens(porVenda)
  }, [empresaId])

  useEffect(() => {
    const t = setTimeout(() => carregar(dia), 0)
    return () => clearTimeout(t)
  }, [carregar, dia])

  const filtrar = useCallback((lista: Entrega[]) => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return lista
    const digitos = termo.replace(/\D/g, '')
    return lista.filter(e =>
      nomeCliente(e).toLowerCase().includes(termo)
      || (e.endereco_entrega_texto ?? '').toLowerCase().includes(termo)
      || numeroVenda(e).toLowerCase().includes(termo)
      || (digitos.length >= 4 && (telefoneDe(e) ?? '').includes(digitos)))
  }, [busca])

  const agenda = useMemo(() => montarAgenda(filtrar([...pendentes, ...feitas]), dia, hoje), [pendentes, feitas, dia, hoje, filtrar])
  const contagem = useMemo(() => contagemPorDia(pendentes), [pendentes])
  const proximosDias = useMemo(() => Array.from({ length: 7 }, (_, i) => somarDias(hoje, i)), [hoje])
  const paraImprimir = useMemo(() => [...agenda.atrasadas, ...agenda.doDia.flatMap(g => g.itens)], [agenda])

  async function acao(e: Entrega, corpo: Record<string, unknown>) {
    setMexendo(e.id); setErro('')
    try {
      const r = await fetch(`/api/entregas/${e.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      }).then(x => x.json())
      if (!r.ok) { setErro(r.erro ?? 'Não foi possível salvar.'); return }
      setReagendando(null)
      await carregar(dia)
    } catch {
      setErro('Falha de conexão. Tente de novo.')
    } finally {
      setMexendo(null)
    }
  }

  function alternarItens(id: string) {
    setAbertos(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const cartao = (e: Entrega, tom: 'normal' | 'atrasada' | 'semdata' | 'feita') => (
    <CartaoEntrega key={e.id} e={e} tom={tom} itens={itens.get(e.id) ?? []}
      aberto={abertos.has(e.id)} onItens={() => alternarItens(e.id)}
      ocupado={mexendo === e.id} podeBaixar={podeBaixar}
      reagendando={reagendando === e.id}
      onEntregue={() => acao(e, { acao: 'entregue' })}
      onDesfazer={() => acao(e, { acao: 'desfazer' })}
      onReagendar={() => setReagendando(reagendando === e.id ? null : e.id)}
      onSalvarAgenda={(data, periodo) => acao(e, { acao: 'reagendar', data, periodo })}
      sugestaoData={dia >= hoje ? dia : hoje} />
  )

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #romaneio-entregas, #romaneio-entregas * { visibility: visible; }
          #romaneio-entregas { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-gray-900">🚚 Entregas</h1>
          <p className="text-sm text-gray-500">Vendas com entrega marcada no PDV. Dê baixa quando o cliente receber.</p>
        </div>
        <button onClick={() => window.print()} disabled={paraImprimir.length === 0}
          className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-40">
          🖨 Imprimir romaneio ({paraImprimir.length})
        </button>
      </div>

      {/* Escolha do dia */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button onClick={() => setDia(somarDias(dia, -1))} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50" title="Dia anterior">◀</button>
        {proximosDias.map(d => {
          const n = contagem.get(d) ?? 0
          const ativo = d === dia
          return (
            <button key={d} onClick={() => setDia(d)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${ativo ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
              {d === hoje ? 'Hoje' : d === somarDias(hoje, 1) ? 'Amanhã' : `${diaSemana(d)} ${formatarDia(d).slice(0, 5)}`}
              {n > 0 && <span className={`ml-1.5 text-[11px] font-semibold px-1.5 rounded-full ${ativo ? 'bg-white/25' : 'bg-blue-100 text-blue-700'}`}>{n}</span>}
            </button>
          )
        })}
        <button onClick={() => setDia(somarDias(dia, 1))} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50" title="Próximo dia">▶</button>
        <input type="date" value={dia} onChange={ev => ev.target.value && setDia(ev.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700" />
        <input value={busca} onChange={ev => setBusca(ev.target.value)} placeholder="Buscar cliente, bairro, telefone, venda…"
          className="flex-1 min-w-[200px] border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 print:hidden">
        <Resumo rotulo={dia === hoje ? 'Para hoje' : `Para ${formatarDia(dia)}`} valor={agenda.totalDoDia} cor="text-blue-700" />
        <Resumo rotulo="Atrasadas" valor={agenda.atrasadas.length} cor={agenda.atrasadas.length ? 'text-red-600' : 'text-gray-400'} />
        <Resumo rotulo="Sem data" valor={agenda.semData.length} cor={agenda.semData.length ? 'text-amber-600' : 'text-gray-400'} />
        <Resumo rotulo="Entregues no dia" valor={agenda.realizadas.length} cor="text-emerald-600" />
      </div>

      {erro && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm print:hidden">{erro}</div>}

      {carregando ? (
        <p className="text-center py-12 text-gray-400 text-sm">Carregando entregas…</p>
      ) : (
        <div className="space-y-6 print:hidden">
          {agenda.atrasadas.length > 0 && (
            <Secao titulo="⚠️ Atrasadas" ajuda="Agendadas para dias anteriores e ainda sem baixa." cor="text-red-700">
              {agenda.atrasadas.map(e => cartao(e, 'atrasada'))}
            </Secao>
          )}

          {agenda.doDia.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-gray-200 rounded-xl text-sm text-gray-500">
              Nenhuma entrega pendente agendada para {dia === hoje ? 'hoje' : formatarDia(dia)}.
            </div>
          ) : agenda.doDia.map(g => (
            <Secao key={g.periodo} titulo={`${iconePeriodo(g.periodo)} ${g.rotulo}`} ajuda={`${g.itens.length} entrega(s)`} cor="text-gray-900">
              {g.itens.map(e => cartao(e, 'normal'))}
            </Secao>
          ))}

          {agenda.semData.length > 0 && (
            <Secao titulo="📭 Sem data" ajuda="Marcadas no PDV sem agendamento. Agende ou dê baixa para não ficarem esquecidas." cor="text-amber-700">
              {agenda.semData.map(e => cartao(e, 'semdata'))}
            </Secao>
          )}

          {agenda.realizadas.length > 0 && (
            <div>
              <button onClick={() => setVerFeitas(v => !v)} className="text-sm font-semibold text-emerald-700 mb-2">
                {verFeitas ? '▾' : '▸'} ✅ Entregues ({agenda.realizadas.length})
              </button>
              {verFeitas && <div className="grid gap-3 md:grid-cols-2">{agenda.realizadas.map(e => cartao(e, 'feita'))}</div>}
            </div>
          )}
        </div>
      )}

      {/* Romaneio: só aparece na impressão */}
      <div id="romaneio-entregas" className="hidden print:block text-black text-[12px]">
        <div className="flex justify-between items-end border-b-2 border-black pb-1 mb-3">
          <div>
            <p className="text-lg font-bold">Romaneio de entregas — {formatarDia(dia)}</p>
            {empresaNome && <p>{empresaNome}</p>}
          </div>
          <p>{paraImprimir.length} entrega(s) · emitido {new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>
        </div>
        {paraImprimir.map((e, i) => {
          const tel = telefoneDe(e)
          const its = itens.get(e.id) ?? []
          return (
            <div key={e.id} className="border border-black rounded mb-2 p-2" style={{ breakInside: 'avoid' }}>
              <div className="flex justify-between font-bold">
                <span>{i + 1}. {nomeCliente(e)} {tel && `· ${formatarTelefone(tel)}`}</span>
                <span>{numeroVenda(e)} · {fmt(e.total)}</span>
              </div>
              <p>{enderecoLimpo(e.endereco_entrega_texto) || 'Endereço não informado'}</p>
              <p>
                {e.entrega_agendada_para && e.entrega_agendada_para !== dia ? `ATRASADA (${formatarDia(e.entrega_agendada_para)}) · ` : ''}
                Período: {rotuloPeriodo(e.entrega_periodo)}{e.observacao ? ` · Obs.: ${e.observacao}` : ''}
              </p>
              {its.length > 0 && (
                <p className="mt-1">{its.map(it => `${Number(it.quantidade).toLocaleString('pt-BR')}× ${it.produto_nome ?? 'item'}`).join(' · ')}</p>
              )}
              <div className="flex gap-6 mt-3">
                <span>Recebido por: ______________________________</span>
                <span>Hora: ________</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function iconePeriodo(p: PeriodoEntrega) {
  return p === 'manha' ? '🌅' : p === 'tarde' ? '☀️' : p === 'noite' ? '🌙' : '🕒'
}

function Resumo({ rotulo, valor, cor }: { rotulo: string; valor: number; cor: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
      <p className="text-xs text-gray-500">{rotulo}</p>
      <p className={`text-2xl font-bold ${cor}`}>{valor}</p>
    </div>
  )
}

function Secao({ titulo, ajuda, cor, children }: { titulo: string; ajuda: string; cor: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className={`text-sm font-semibold ${cor}`}>{titulo}</h2>
        <span className="text-xs text-gray-400">{ajuda}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </div>
  )
}

function CartaoEntrega({
  e, tom, itens, aberto, onItens, ocupado, podeBaixar, reagendando,
  onEntregue, onDesfazer, onReagendar, onSalvarAgenda, sugestaoData,
}: {
  e: Entrega; tom: 'normal' | 'atrasada' | 'semdata' | 'feita'; itens: Item[]; aberto: boolean; onItens: () => void
  ocupado: boolean; podeBaixar: boolean; reagendando: boolean
  onEntregue: () => void; onDesfazer: () => void; onReagendar: () => void
  onSalvarAgenda: (data: string | null, periodo: PeriodoEntrega) => void; sugestaoData: string
}) {
  const [data, setData] = useState(e.entrega_agendada_para ?? sugestaoData)
  const [periodo, setPeriodo] = useState<PeriodoEntrega>(periodoDe(e.entrega_periodo))
  const tel = telefoneDe(e)
  const wa = linkWhatsApp(tel)
  const endereco = enderecoLimpo(e.endereco_entrega_texto)
  const mapa = linkMapa(endereco)
  const borda = tom === 'atrasada' ? 'border-red-300 bg-red-50/40' : tom === 'semdata' ? 'border-amber-300 bg-amber-50/40'
    : tom === 'feita' ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200 bg-white'

  return (
    <div className={`border rounded-xl p-3 space-y-2 ${borda} ${ocupado ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{nomeCliente(e)}</p>
          <p className="text-xs text-gray-500">
            Venda {numeroVenda(e)} · {fmt(e.total)} · {new Date(e.created_at).toLocaleDateString('pt-BR')}
            {e.vendedor_nome && ` · ${e.vendedor_nome}`}
          </p>
        </div>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 shrink-0">
          {tom === 'atrasada' && e.entrega_agendada_para ? `${formatarDia(e.entrega_agendada_para)} · ` : ''}
          {e.entrega_agendada_para ? rotuloPeriodo(e.entrega_periodo) : 'sem data'}
        </span>
      </div>

      <div className="text-sm text-gray-700 space-y-1">
        <p>📍 {endereco || <span className="text-gray-400">Endereço não informado</span>}
          {mapa && <a href={mapa} target="_blank" rel="noreferrer" className="ml-2 text-xs text-blue-600 hover:underline">mapa</a>}
        </p>
        {tel && (
          <p>📞 {formatarTelefone(tel)}
            {wa && <a href={wa} target="_blank" rel="noreferrer" className="ml-2 text-xs text-emerald-600 hover:underline">WhatsApp</a>}
          </p>
        )}
        {e.observacao && <p className="text-xs text-gray-500">📝 {e.observacao}</p>}
        {tom === 'feita' && e.entrega_realizada_em && (
          <p className="text-xs text-emerald-700">
            ✅ Entregue às {new Date(e.entrega_realizada_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            {e.entrega_realizada_por_nome && ` · baixa por ${e.entrega_realizada_por_nome}`}
          </p>
        )}
      </div>

      {aberto && (
        <ul className="text-xs text-gray-600 bg-white/70 border border-gray-100 rounded-lg px-3 py-2 space-y-0.5">
          {itens.length === 0 ? <li className="text-gray-400">Sem itens registrados.</li> : itens.map((it, i) => (
            <li key={i}>{Number(it.quantidade).toLocaleString('pt-BR')}× {it.produto_nome ?? 'item'}
              {it.produto_sku && <span className="text-gray-400 font-mono ml-1">{it.produto_sku}</span>}</li>
          ))}
        </ul>
      )}

      {reagendando && (
        <div className="flex flex-wrap items-center gap-2 bg-white border border-gray-200 rounded-lg p-2">
          <input type="date" value={data} onChange={ev => setData(ev.target.value)} className="border border-gray-200 rounded px-2 py-1 text-sm" />
          <select value={periodo} onChange={ev => setPeriodo(ev.target.value as PeriodoEntrega)} className="border border-gray-200 rounded px-2 py-1 text-sm">
            {PERIODOS.map(p => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
          <button onClick={() => onSalvarAgenda(data || null, periodo)} disabled={ocupado || !data}
            className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-medium disabled:opacity-40">Salvar</button>
          {e.entrega_agendada_para && (
            <button onClick={() => onSalvarAgenda(null, 'qualquer')} disabled={ocupado}
              className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700">Tirar data</button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button onClick={onItens} className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
          {aberto ? 'Ocultar itens' : `Itens (${itens.length})`}
        </button>
        {podeBaixar && tom !== 'feita' && (
          <>
            <button onClick={onReagendar} disabled={ocupado}
              className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
              📅 {e.entrega_agendada_para ? 'Reagendar' : 'Agendar'}
            </button>
            <button onClick={onEntregue} disabled={ocupado}
              className="ml-auto px-3 py-1 text-xs rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700">
              ✓ Entregue
            </button>
          </>
        )}
        {podeBaixar && tom === 'feita' && (
          <button onClick={onDesfazer} disabled={ocupado}
            className="ml-auto px-2.5 py-1 text-xs border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">
            Desfazer baixa
          </button>
        )}
      </div>
    </div>
  )
}
