'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import BotaoRecalcular from './BotaoRecalcular'

// A lista do que comprar.
//
// O princípio da tela: nenhum número aparece sozinho. Toda linha traz o
// "porquê" a um clique de distância, montado dos fatos que produziram a
// recomendação — não de um texto gerado. Se o comprador não conseguir
// conferir a conta, ele vai ignorar a sugestão, e com razão.

type Metrica = {
  produto_id: string
  nome: string
  sku: string | null
  categoria: string | null
  marca: string | null
  unidade: string | null
  vendas_7: number; vendas_15: number; vendas_30: number
  vendas_60: number; vendas_90: number; vendas_180: number
  media_diaria: number; media_diaria_recente: number
  tendencia: number | null
  dias_sem_venda: number | null
  ultima_venda: string | null
  estoque_atual: number
  estoque_minimo: number
  estoque_outros_depositos: number
  pedido_aberto_qtd: number
  faltas_abertas: number
  encomendas_abertas: number
  unidades_solicitadas: number
  cobertura_dias: number | null
  previsao_ruptura: string | null
  lead_time_dias: number | null
  estoque_seguranca: number
  ponto_reposicao: number
  sugestao_quantidade: number
  custo_estimado: number
  score: number
  prioridade: string
  classe_abc: string | null
  giro: string
  motivos: string[]
  sinaisIA: { tipo: string; texto: string }[]
}

type ResumoIA = { texto: string; produtosAnalisados: number; geradoEm: string } | null

const TIPO_SINAL_IA: Record<string, { label: string; icone: string }> = {
  aceleracao:        { label: 'Acelerando',        icone: '📈' },
  queda_demanda:      { label: 'Demanda caindo',    icone: '📉' },
  demanda_perdida:    { label: 'Demanda perdida',   icone: '👻' },
  minimo_inadequado:  { label: 'Mínimo desatualizado', icone: '⚖️' },
  excesso_a_liquidar: { label: 'Liquidar',          icone: '🏷️' },
}

const PRIORIDADE: Record<string, { label: string; cor: string; ponto: string }> = {
  critico:      { label: 'Crítico',          cor: 'bg-red-100 text-red-700',        ponto: 'bg-red-500' },
  comprar:      { label: 'Comprar',          cor: 'bg-orange-100 text-orange-700',  ponto: 'bg-orange-500' },
  analisar:     { label: 'Analisar',         cor: 'bg-amber-100 text-amber-700',    ponto: 'bg-amber-400' },
  saudavel:     { label: 'Estoque saudável', cor: 'bg-emerald-100 text-emerald-700', ponto: 'bg-emerald-500' },
  excesso:      { label: 'Excesso',          cor: 'bg-sky-100 text-sky-700',        ponto: 'bg-sky-500' },
  sem_giro:     { label: 'Sem giro',         cor: 'bg-slate-100 text-slate-500',    ponto: 'bg-slate-300' },
  sem_dados:    { label: 'Sem dados',        cor: 'bg-slate-100 text-slate-400',    ponto: 'bg-slate-200' },
}

type Visao = 'tudo' | 'criticos' | 'comprar' | 'encomendas' | 'faltas'
  | 'ruptura' | 'pedido_aberto' | 'transferir' | 'excesso' | 'sem_giro'

const VISOES: { id: Visao; label: string; filtro: (m: Metrica) => boolean }[] = [
  { id: 'tudo',          label: 'Tudo',                filtro: () => true },
  { id: 'criticos',      label: 'Críticos',            filtro: m => m.prioridade === 'critico' },
  { id: 'comprar',       label: 'Sugestão de compra',  filtro: m => m.sugestao_quantidade > 0 && ['critico', 'comprar'].includes(m.prioridade) },
  { id: 'encomendas',    label: 'Encomendas',          filtro: m => m.encomendas_abertas > 0 },
  { id: 'faltas',        label: 'Faltas do PDV',       filtro: m => m.faltas_abertas > 0 },
  { id: 'ruptura',       label: 'Ruptura em 7 dias',   filtro: m => m.cobertura_dias !== null && m.cobertura_dias <= 7 },
  { id: 'pedido_aberto', label: 'Já pedido',           filtro: m => m.pedido_aberto_qtd > 0 },
  { id: 'transferir',    label: 'Tem em outro depósito', filtro: m => m.estoque_outros_depositos > 0 && m.estoque_atual <= 0 },
  { id: 'excesso',       label: 'Excesso de estoque',  filtro: m => m.prioridade === 'excesso' },
  { id: 'sem_giro',      label: 'Sem giro',            filtro: m => m.prioridade === 'sem_giro' },
]

const brl = (v: number) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (v: number, casas = 0) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas })

/**
 * O "Entender sugestão" do item 10: a conta em português, montada dos
 * números da própria linha. Sem modelo, sem geração — o comprador precisa
 * poder conferir, não ser convencido.
 */
function narrativa(m: Metrica): string {
  const p: string[] = []
  if (m.vendas_30 > 0) p.push(`Vendemos ${num(m.vendas_30)} ${m.unidade ?? 'un'} nos últimos 30 dias.`)
  else if (m.vendas_90 > 0) p.push(`Vendemos ${num(m.vendas_90)} nos últimos 90 dias, nada nos últimos 30.`)
  else p.push('Não houve venda registrada no período.')

  p.push(`O estoque atual é ${num(m.estoque_atual)}.`)
  if (m.cobertura_dias !== null) p.push(`No ritmo atual isso dura cerca de ${m.cobertura_dias} dia(s).`)
  if (m.lead_time_dias) p.push(`O fornecedor costuma entregar em ~${m.lead_time_dias} dias.`)
  if (m.faltas_abertas > 0) p.push(`Foram registradas ${m.faltas_abertas} falta(s) no PDV.`)
  if (m.encomendas_abertas > 0) p.push(`Há ${m.encomendas_abertas} encomenda(s) de cliente em aberto.`)
  if (m.pedido_aberto_qtd > 0) p.push(`Já há ${num(m.pedido_aberto_qtd)} em pedido aberto, descontadas da sugestão.`)
  if (m.estoque_outros_depositos > 0) p.push(`Outro depósito tem ${num(m.estoque_outros_depositos)}.`)

  p.push(m.sugestao_quantidade > 0
    ? `Recomendação: comprar ${num(m.sugestao_quantidade)} ${m.unidade ?? 'un'}${m.custo_estimado > 0 ? ` (~${brl(m.custo_estimado)})` : ''}.`
    : 'Não há necessidade de compra no momento.')
  return p.join(' ')
}

export default function AuxiliarComprasClient({ lista, calculadoEm, resumoIA }: {
  lista: Metrica[]
  calculadoEm: string | null
  resumoIA: ResumoIA
}) {
  const router = useRouter()
  const [visao, setVisao] = useState<Visao>('comprar')
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState('')
  const [aberto, setAberto] = useState<string | null>(null)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [enviando, setEnviando] = useState(false)
  const [avisoLista, setAvisoLista] = useState('')

  const categorias = useMemo(
    () => [...new Set(lista.map(m => m.categoria).filter(Boolean))].sort() as string[],
    [lista])

  const filtrada = useMemo(() => {
    const f = VISOES.find(v => v.id === visao)!.filtro
    return lista.filter(m => {
      if (!f(m)) return false
      if (categoria && m.categoria !== categoria) return false
      if (busca) {
        const t = busca.toLowerCase()
        if (!`${m.nome} ${m.sku ?? ''} ${m.marca ?? ''}`.toLowerCase().includes(t)) return false
      }
      return true
    })
  }, [lista, visao, busca, categoria])

  const kpi = useMemo(() => {
    const criticos = lista.filter(m => m.prioridade === 'critico')
    const paraComprar = lista.filter(m => m.sugestao_quantidade > 0 && ['critico', 'comprar'].includes(m.prioridade))
    return {
      criticos: criticos.length,
      ruptura7: lista.filter(m => m.cobertura_dias !== null && m.cobertura_dias <= 7).length,
      encomendas: lista.reduce((s, m) => s + m.encomendas_abertas, 0),
      faltas: lista.reduce((s, m) => s + m.faltas_abertas, 0),
      sugestoes: paraComprar.length,
      excesso: lista.filter(m => m.prioridade === 'excesso').length,
      valor: paraComprar.reduce((s, m) => s + Number(m.custo_estimado), 0),
      jaPedido: lista.filter(m => m.pedido_aberto_qtd > 0).length,
      transferir: lista.filter(m => m.estoque_outros_depositos > 0 && m.estoque_atual <= 0).length,
      rupturaPorCadastro: criticos.filter(m => m.estoque_atual <= 0).length,
    }
  }, [lista])

  const valorDaVisao = filtrada.reduce((s, m) => s + Number(m.custo_estimado), 0)

  function alternarSelecao(produtoId: string) {
    setSelecionados(prev => {
      const n = new Set(prev)
      if (n.has(produtoId)) n.delete(produtoId); else n.add(produtoId)
      return n
    })
  }

  function alternarSelecaoTodos() {
    const idsVisiveis = filtrada.map(m => m.produto_id)
    const todosDentro = idsVisiveis.every(id => selecionados.has(id))
    setSelecionados(prev => {
      const n = new Set(prev)
      for (const id of idsVisiveis) { if (todosDentro) n.delete(id); else n.add(id) }
      return n
    })
  }

  // A quantidade que vai para a lista é a sugestão calculada — o comprador
  // ainda pode mudar depois, na própria lista. 1 é só um piso para produto
  // sem sugestão numérica (ex.: adicionado manualmente pela seleção, sem
  // prioridade de compra) não entrar com quantidade zero.
  async function adicionarALista() {
    const itensSelecionados = lista.filter(m => selecionados.has(m.produto_id))
    if (itensSelecionados.length === 0) return
    setEnviando(true); setAvisoLista('')
    try {
      const d = await fetch('/api/compras-lista/adicionar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itens: itensSelecionados.map(m => ({
            produtoId: m.produto_id,
            quantidade: m.sugestao_quantidade > 0 ? m.sugestao_quantidade : 1,
            motivo: PRIORIDADE[m.prioridade]?.label ?? m.prioridade,
          })),
        }),
      }).then(r => r.json())
      if (!d.ok) { setAvisoLista(d.erro ?? 'Não foi possível adicionar à lista.'); return }
      setAvisoLista(`${d.adicionados + d.atualizados} produto(s) na lista de compra.`)
      setSelecionados(new Set())
      router.refresh()
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <span className="text-gray-600 font-medium">auxiliar de compras</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Auxiliar de Compras</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {lista.length} produto(s) analisados
            {calculadoEm && ` · cálculo de ${new Date(calculadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
        <BotaoRecalcular compacto />
      </div>

      {/* ── Resumo ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-5">
        <Cartao valor={kpi.criticos} label="Críticos" tom="vermelho" />
        <Cartao valor={kpi.ruptura7} label="Ruptura em 7 dias" tom="vermelho" />
        <Cartao valor={kpi.encomendas} label="Encomendas" tom="laranja" />
        <Cartao valor={kpi.faltas} label="Faltas do PDV" tom="laranja" />
        <Cartao valor={kpi.sugestoes} label="Sugestões de compra" />
        <Cartao valor={kpi.excesso} label="Excesso de estoque" />
        <Cartao valor={brl(kpi.valor)} label="Reposição estimada" />
      </div>

      <AnaliseInteligente resumo={resumoIA} />

      {/* O aviso mais importante desta tela hoje. A conta só é tão boa
          quanto o estoque que a alimenta, e o estoque não está bom. */}
      {kpi.rupturaPorCadastro > kpi.criticos * 0.5 && kpi.criticos > 20 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>{kpi.rupturaPorCadastro} dos {kpi.criticos} produtos críticos</strong> estão marcados como
          crítico porque o cadastro diz que o estoque é zero ou negativo — e eles continuam vendendo.
          Se esses itens estão na prateleira, o problema é o saldo, não a compra.
          {' '}Vale conferir o estoque antes de transformar esta lista em pedido.
        </div>
      )}

      {(kpi.jaPedido > 0 || kpi.transferir > 0) && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-900">
          {kpi.jaPedido > 0 && <>Existem <strong>{kpi.jaPedido}</strong> produto(s) com pedido de compra já em aberto — a sugestão deles já vem descontada. </>}
          {kpi.transferir > 0 && <><strong>{kpi.transferir}</strong> poderia(m) vir de outro depósito em vez de compra.</>}
        </div>
      )}

      {/* ── Visões rápidas ──────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {VISOES.map(v => {
          const n = lista.filter(v.filtro).length
          return (
            <button key={v.id} onClick={() => setVisao(v.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                visao === v.id
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}>
              {v.label} <span className={visao === v.id ? 'text-slate-300' : 'text-slate-400'}>{n}</span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar produto, SKU ou marca..."
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs flex-1 min-w-[200px]" />
        <select value={categoria} onChange={e => setCategoria(e.target.value)}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs max-w-[220px]">
          <option value="">Todas as categorias</option>
          {categorias.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-xs text-slate-400">
          {filtrada.length} produto(s){valorDaVisao > 0 && ` · ${brl(valorDaVisao)}`}
        </span>
      </div>

      {avisoLista && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <span>{avisoLista}</span>
          <Link href="/dashboard/compras-lista" className="underline font-medium">ver lista de compra →</Link>
        </div>
      )}

      {selecionados.size > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm">
          <span className="font-medium text-slate-700">{selecionados.size} selecionado(s)</span>
          <button onClick={adicionarALista} disabled={enviando}
            className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 disabled:opacity-50">
            {enviando ? 'Adicionando…' : 'Adicionar à Lista de Compra'}
          </button>
          <button onClick={() => setSelecionados(new Set())} className="ml-auto text-xs text-slate-400 hover:text-slate-600">
            limpar seleção
          </button>
        </div>
      )}

      {/* ── Lista ───────────────────────────────────────────────── */}
      {filtrada.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-slate-500 text-sm">Nada nesta visão.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input type="checkbox"
                    checked={filtrada.length > 0 && filtrada.every(m => selecionados.has(m.produto_id))}
                    onChange={alternarSelecaoTodos} />
                </th>
                <th className="text-left px-3 py-2 font-medium">Produto</th>
                <th className="text-center px-2 py-2 font-medium">Prioridade</th>
                <th className="text-right px-2 py-2 font-medium">Estoque</th>
                <th className="text-right px-2 py-2 font-medium">V.30d</th>
                <th className="text-right px-2 py-2 font-medium">Méd/dia</th>
                <th className="text-right px-2 py-2 font-medium">Cobertura</th>
                <th className="text-center px-2 py-2 font-medium">Balcão</th>
                <th className="text-right px-2 py-2 font-medium">Sugestão</th>
                <th className="text-right px-2 py-2 font-medium">Custo est.</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtrada.map(m => {
                const pr = PRIORIDADE[m.prioridade] ?? PRIORIDADE.sem_dados
                const expandido = aberto === m.produto_id
                return (
                  <Fragment key={m.produto_id}>
                    <tr className="border-t border-slate-100 hover:bg-slate-50/60">
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={selecionados.has(m.produto_id)}
                          onChange={() => alternarSelecao(m.produto_id)} />
                      </td>
                      <td className="px-3 py-2 max-w-[280px]">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pr.ponto}`} />
                          <span className="font-medium text-slate-800 truncate">{m.nome}</span>
                          {m.classe_abc === 'A' && (
                            <span className="text-[10px] font-bold text-violet-700 bg-violet-100 px-1 rounded">A</span>
                          )}
                          {m.sinaisIA.length > 0 && (
                            <span title={m.sinaisIA.map(s => TIPO_SINAL_IA[s.tipo]?.label ?? s.tipo).join(', ')}
                              className="text-[10px] shrink-0">
                              {m.sinaisIA.map(s => TIPO_SINAL_IA[s.tipo]?.icone ?? '🤖').join('')}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 pl-3.5">
                          {m.sku ?? '—'}{m.categoria ? ` · ${m.categoria}` : ''}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${pr.cor}`}>
                          {pr.label}
                        </span>
                        <div className="text-[10px] text-slate-400 mt-0.5">score {m.score}</div>
                      </td>
                      <td className={`px-2 py-2 text-right font-medium ${m.estoque_atual <= 0 ? 'text-red-600' : 'text-slate-700'}`}>
                        {num(m.estoque_atual, 1)}
                        {m.pedido_aberto_qtd > 0 && (
                          <div className="text-[10px] text-sky-600">+{num(m.pedido_aberto_qtd)} pedido</div>
                        )}
                        {m.estoque_outros_depositos > 0 && (
                          <div className="text-[10px] text-indigo-600">+{num(m.estoque_outros_depositos)} outro dep.</div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right text-slate-600">{num(m.vendas_30, 1)}</td>
                      <td className="px-2 py-2 text-right text-slate-600">
                        {num(m.media_diaria_recente, 2)}
                        {m.tendencia !== null && m.tendencia >= 1.5 && (
                          <span className="ml-1 text-[10px] text-emerald-600">↑{Math.round((m.tendencia - 1) * 100)}%</span>
                        )}
                        {m.tendencia !== null && m.tendencia <= 0.5 && (
                          <span className="ml-1 text-[10px] text-amber-600">↓{Math.round((1 - m.tendencia) * 100)}%</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Cobertura dias={m.cobertura_dias} />
                        {m.previsao_ruptura && (
                          <div className="text-[10px] text-slate-400">
                            acaba {new Date(m.previsao_ruptura + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center whitespace-nowrap">
                        {m.encomendas_abertas > 0 && (
                          <span className="text-[11px] text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded-full mr-1">
                            📌 {m.encomendas_abertas}
                          </span>
                        )}
                        {m.faltas_abertas > 0 && (
                          <span className="text-[11px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-full">
                            🔍 {m.faltas_abertas}
                          </span>
                        )}
                        {m.encomendas_abertas === 0 && m.faltas_abertas === 0 && (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {m.sugestao_quantidade > 0
                          ? <span className="font-semibold text-slate-900">{num(m.sugestao_quantidade)}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2 py-2 text-right text-slate-600">
                        {m.custo_estimado > 0 ? brl(m.custo_estimado) : '—'}
                      </td>
                      <td className="px-2 py-2">
                        <button onClick={() => setAberto(expandido ? null : m.produto_id)}
                          className="text-[11px] text-slate-400 hover:text-slate-700 whitespace-nowrap">
                          {expandido ? 'fechar' : 'entender'}
                        </button>
                      </td>
                    </tr>

                    {expandido && (
                      <tr className="bg-slate-50/80">
                        <td colSpan={11} className="px-5 py-4">
                          <p className="text-sm text-slate-700 mb-3">{narrativa(m)}</p>

                          {m.motivos.length > 0 && (
                            <div className="mb-3">
                              <p className="text-[11px] font-medium text-slate-500 mb-1">Por que este produto apareceu aqui</p>
                              <ul className="space-y-0.5">
                                {m.motivos.map((mo, i) => (
                                  <li key={i} className="text-[12px] text-slate-600">✓ {mo}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {m.sinaisIA.length > 0 && (
                            <div className="mb-3 rounded-lg bg-violet-50 border border-violet-100 px-3 py-2">
                              <p className="text-[11px] font-medium text-violet-700 mb-1">
                                🤖 O cálculo não vê isto sozinho — a IA achou
                              </p>
                              <ul className="space-y-0.5">
                                {m.sinaisIA.map((s, i) => (
                                  <li key={i} className="text-[12px] text-violet-900">
                                    {TIPO_SINAL_IA[s.tipo]?.icone ?? '🤖'} <strong>{TIPO_SINAL_IA[s.tipo]?.label ?? s.tipo}:</strong> {s.texto}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-1.5 text-[11px]">
                            <Dado rotulo="Vendas 7d"   valor={num(m.vendas_7, 1)} />
                            <Dado rotulo="Vendas 30d"  valor={num(m.vendas_30, 1)} />
                            <Dado rotulo="Vendas 90d"  valor={num(m.vendas_90, 1)} />
                            <Dado rotulo="Média/dia (90d)" valor={num(m.media_diaria, 3)} />
                            <Dado rotulo="Média/dia (15d)" valor={num(m.media_diaria_recente, 3)} />
                            <Dado rotulo="Giro" valor={m.giro.replace('_', ' ')} />
                            <Dado rotulo="Ponto de reposição" valor={num(m.ponto_reposicao, 1)} />
                            <Dado rotulo="Estoque de segurança" valor={num(m.estoque_seguranca, 1)} />
                            <Dado rotulo="Mínimo cadastrado" valor={m.estoque_minimo > 0 ? num(m.estoque_minimo) : 'não definido'} />
                            <Dado rotulo="Classe ABC" valor={m.classe_abc ?? '—'} />
                            <Dado rotulo="Última venda" valor={m.ultima_venda ? new Date(m.ultima_venda).toLocaleDateString('pt-BR') : 'nunca'} />
                            <Dado rotulo="Sem venda há" valor={m.dias_sem_venda !== null ? `${m.dias_sem_venda} dias` : '—'} />
                          </div>

                          {(m.faltas_abertas > 0 || m.encomendas_abertas > 0) && (
                            <Link href="/dashboard/auxiliar-compras/faltas"
                              className="inline-block mt-3 text-[12px] text-slate-600 underline hover:text-slate-900">
                              ver as {m.faltas_abertas + m.encomendas_abertas} solicitação(ões) do balcão
                            </Link>
                          )}

                          <FornecedoresDoProduto produtoId={m.produto_id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-[11px] text-slate-400">
        Produto sem venda, sem falta e sem estoque não entra nesta lista — o sistema não teria base para
        recomendar nada sobre ele. O cálculo roda de madrugada; use &quot;Recalcular agora&quot; depois de
        uma entrada grande ou de corrigir estoque.
      </p>
    </div>
  )
}

// ── Peças ──────────────────────────────────────────────────────

function Cartao({ valor, label, tom }: { valor: number | string; label: string; tom?: 'vermelho' | 'laranja' }) {
  const n = typeof valor === 'number' ? valor : 1
  const cor = tom === 'vermelho' && n > 0 ? 'border-red-200 bg-red-50 text-red-700'
    : tom === 'laranja' && n > 0 ? 'border-orange-200 bg-orange-50 text-orange-700'
    : 'border-slate-200 bg-white text-slate-800'
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${cor}`}>
      <div className="text-lg font-semibold leading-tight">{valor}</div>
      <div className="text-[10px] opacity-70 mt-0.5">{label}</div>
    </div>
  )
}

function Cobertura({ dias }: { dias: number | null }) {
  if (dias === null) return <span className="text-slate-400 text-xs">sem giro</span>
  if (dias <= 7) return <span className="text-red-600 font-semibold">{dias}d</span>
  if (dias <= 20) return <span className="text-orange-600 font-medium">{dias}d</span>
  if (dias <= 90) return <span className="text-slate-700">{dias}d</span>
  return <span className="text-sky-600">{dias}d</span>
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <div className="text-slate-400">{rotulo}</div>
      <div className="text-slate-800 font-medium">{valor}</div>
    </div>
  )
}

type OpcaoFornecedor = {
  fornecedor_id: string
  nome: string
  custo_ultimo: number | null
  ultima_compra_em: string | null
  compras_contadas: number
  prazo_entrega_real_dias: number | null
  prazo_entrega_dias: number | null
  quantidade_minima: number | null
  preferencial: boolean
}

/**
 * Fornecedores históricos deste produto, carregados só quando a linha é
 * expandida — item 19 e 20 do pedido original. Recomendação vem do
 * servidor (src/lib/fornecedores/sugestao.ts); esta tela só mostra o
 * porquê, nunca escolhe sozinha.
 */
function FornecedoresDoProduto({ produtoId }: { produtoId: string }) {
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando')
  const [fornecedores, setFornecedores] = useState<OpcaoFornecedor[]>([])
  const [recomendado, setRecomendado] = useState<{ fornecedorId: string; motivos: string[] } | null>(null)

  useEffect(() => {
    let vivo = true
    fetch(`/api/produtos/${produtoId}/fornecedores`)
      .then(r => r.json())
      .then(d => {
        if (!vivo) return
        if (!d.ok) { setEstado('erro'); return }
        setFornecedores(d.fornecedores ?? [])
        setRecomendado(d.recomendado ?? null)
        setEstado('pronto')
      })
      .catch(() => { if (vivo) setEstado('erro') })
    return () => { vivo = false }
  }, [produtoId])

  if (estado === 'carregando') {
    return <p className="mt-3 text-[11px] text-slate-400">Carregando fornecedores…</p>
  }
  if (estado === 'erro') {
    return <p className="mt-3 text-[11px] text-red-500">Não foi possível carregar os fornecedores.</p>
  }
  if (fornecedores.length === 0) {
    return <p className="mt-3 text-[11px] text-slate-400">Sem histórico de compra deste produto ainda.</p>
  }

  return (
    <div className="mt-3">
      <p className="text-[11px] font-medium text-slate-500 mb-1.5">Fornecedores deste produto</p>
      <div className="space-y-1.5">
        {fornecedores.map(f => {
          const ganhador = recomendado?.fornecedorId === f.fornecedor_id
          const prazo = f.prazo_entrega_real_dias ?? f.prazo_entrega_dias
          return (
            <div key={f.fornecedor_id}
              className={`text-[12px] rounded-lg px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 ${
                ganhador ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50 border border-slate-100'
              }`}>
              <span className="font-medium text-slate-800">{f.nome}</span>
              {ganhador && <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">recomendado</span>}
              {f.preferencial && <span className="text-[10px] text-orange-700">★ preferencial</span>}
              {f.custo_ultimo != null && <span className="text-slate-600">{brl(f.custo_ultimo)}</span>}
              {prazo != null && (
                <span className="text-slate-500">
                  ~{prazo}d{f.prazo_entrega_real_dias != null ? ' (medido)' : ' (cadastrado)'}
                </span>
              )}
              <span className="text-slate-400">{f.compras_contadas} compra(s)</span>
              {f.ultima_compra_em && (
                <span className="text-slate-400">última {new Date(f.ultima_compra_em).toLocaleDateString('pt-BR')}</span>
              )}
            </div>
          )
        })}
      </div>
      {recomendado && (
        <p className="mt-1.5 text-[11px] text-slate-400">
          {fornecedores.find(f => f.fornecedor_id === recomendado.fornecedorId)?.nome}: {recomendado.motivos.join(' · ')}
        </p>
      )}
    </div>
  )
}

/**
 * Item 37 do pedido original: um card que resume o dia para o comprador
 * ler em 10 segundos. Único lugar da tela onde a IA fala em prosa — em
 * todo o resto (motivos, narrativa) o texto é montado por regra, sem
 * modelo nenhum.
 */
function AnaliseInteligente({ resumo }: { resumo: ResumoIA }) {
  const router = useRouter()
  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState('')

  async function gerar() {
    setGerando(true); setErro('')
    try {
      const d = await fetch('/api/reposicao/ia/recalcular', { method: 'POST' }).then(r => r.json())
      if (!d.ok) { setErro(d.erro ?? 'Não foi possível gerar a análise.'); return }
      router.refresh()
    } catch {
      setErro('Falha de rede.')
    } finally {
      setGerando(false)
    }
  }

  if (!resumo) {
    return (
      <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 flex items-center justify-between gap-3">
        <p className="text-sm text-violet-800">
          🤖 A análise inteligente ainda não rodou para esta empresa — ela olha para os produtos de
          maior score em busca de padrões que o cálculo sozinho não vê (aceleração, demanda perdida, mínimo desatualizado).
        </p>
        <button onClick={gerar} disabled={gerando}
          className="shrink-0 px-3 py-1.5 rounded-lg bg-violet-700 text-white text-xs font-medium hover:bg-violet-800 disabled:opacity-50">
          {gerando ? 'Gerando…' : 'Gerar agora'}
        </button>
      </div>
    )
  }

  return (
    <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-violet-700 mb-1">🤖 Análise Inteligente</p>
          <p className="text-sm text-violet-900">{resumo.texto}</p>
        </div>
        <button onClick={gerar} disabled={gerando}
          className="shrink-0 px-2.5 py-1 rounded-lg border border-violet-300 bg-white text-violet-700 text-[11px] font-medium hover:bg-violet-100 disabled:opacity-50">
          {gerando ? 'Gerando…' : 'Atualizar'}
        </button>
      </div>
      <p className="text-[10px] text-violet-500 mt-1.5">
        {resumo.produtosAnalisados} produtos analisados · {new Date(resumo.geradoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
      </p>
      {erro && <p className="text-[11px] text-red-600 mt-1">{erro}</p>}
    </div>
  )
}
