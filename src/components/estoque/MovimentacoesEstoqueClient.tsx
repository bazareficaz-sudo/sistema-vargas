'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PERIODO_OPCOES, PERIODO_LABELS, TIPOS_MOVIMENTO, TIPO_LABEL, deltaMovimento, type PeriodoPreset } from '@/lib/estoque/periodo'
import AjusteEstoqueModal from './AjusteEstoqueModal'
import GraficoEvolucaoEstoque from './GraficoEvolucaoEstoque'

type Deposito = { id: string; nome: string }
type ProdutoSelecionado = {
  id: string; nome: string; sku: string | null; ean: string | null
  categoria: string | null; unidade: string; estoque: number; estoque_minimo: number
}
// estoque_anterior/estoque_novo são nulos em movimentações antigas (gravadas
// antes deste módulo existir) — ver deltaMovimento em lib/estoque/periodo.ts.
type Movimento = {
  id: string; deposito_id: string | null; produto_id: string; produto_nome: string
  tipo: string; quantidade: number | null; estoque_anterior: number | null; estoque_novo: number | null
  motivo: string | null; referencia_tipo: string | null; referencia_id: string | null
  usuario: string | null; observacao: string | null; created_at: string
}
type ProdutoBusca = { id: string; nome: string; sku: string | null; ean: string | null }

const DATA_LANCAMENTO = '26/07/2026'

function delta(m: Movimento) { return deltaMovimento(m) }

function badgeTipo(m: Movimento) {
  const d = delta(m)
  const label = TIPO_LABEL[m.tipo] ?? m.tipo
  if (d > 0) return { label, cls: 'bg-green-100 text-green-700' }
  if (d < 0) return { label, cls: 'bg-red-100 text-red-600' }
  return { label, cls: 'bg-gray-100 text-gray-500' }
}

export default function MovimentacoesEstoqueClient({
  empresaId, depositos,
  modoInicial, produtoIdInicial, depositoInicial, tiposInicial, periodoInicial, deInicial, ateInicial, paginaInicial,
  produtoSelecionado, movimentosProduto, movimentosPeriodo, totalPeriodo, porPagina,
}: {
  empresaId: string
  depositos: Deposito[]
  modoInicial: 'produto' | 'periodo'
  produtoIdInicial: string
  depositoInicial: string
  tiposInicial: string[]
  periodoInicial: PeriodoPreset
  deInicial: string
  ateInicial: string
  paginaInicial: number
  produtoSelecionado: ProdutoSelecionado | null
  movimentosProduto: Movimento[]
  movimentosPeriodo: Movimento[]
  totalPeriodo: number
  porPagina: number
}) {
  const router = useRouter()
  const sb = createClient()
  const [modo, setModo] = useState(modoInicial)
  const [deposito, setDeposito] = useState(depositoInicial)
  const [tipos, setTipos] = useState<string[]>(tiposInicial)
  const [periodo, setPeriodo] = useState(periodoInicial)
  const [de, setDe] = useState(deInicial)
  const [ate, setAte] = useState(ateInicial)
  const [mostrarTipos, setMostrarTipos] = useState(false)
  const tiposRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!mostrarTipos) return
    function aoClicarFora(e: MouseEvent) {
      if (tiposRef.current && !tiposRef.current.contains(e.target as Node)) setMostrarTipos(false)
    }
    document.addEventListener('mousedown', aoClicarFora)
    return () => document.removeEventListener('mousedown', aoClicarFora)
  }, [mostrarTipos])
  const [ajustando, setAjustando] = useState(false)

  // Mantém o estado local em sincronia quando a navegação (router.push)
  // traz novas props do servidor — sem isso, o estado local podia ficar
  // preso no valor antigo depois de uma navegação (padrão já usado em
  // ProdutosClient.tsx).
  useEffect(() => { setModo(modoInicial) }, [modoInicial])
  useEffect(() => { setDeposito(depositoInicial) }, [depositoInicial])
  useEffect(() => { setTipos(tiposInicial) }, [tiposInicial])
  useEffect(() => { setPeriodo(periodoInicial) }, [periodoInicial])
  useEffect(() => { setDe(deInicial) }, [deInicial])
  useEffect(() => { setAte(ateInicial) }, [ateInicial])

  // Busca de produto (só relevante no modo "Por produto" sem produto selecionado ainda)
  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<ProdutoBusca[]>([])
  const buscarRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!busca || busca.length < 2) { setResultados([]); return }
    clearTimeout(buscarRef.current)
    buscarRef.current = setTimeout(async () => {
      const { data } = await sb.from('produtos')
        .select('id, nome, sku, ean')
        .eq('empresa_id', empresaId)
        .or(`nome.ilike.%${busca}%,sku.ilike.%${busca}%,ean.ilike.%${busca}%`)
        .limit(8)
      setResultados((data ?? []) as ProdutoBusca[])
    }, 300)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, empresaId])

  function navegar(params: Record<string, string>) {
    const sp = new URLSearchParams({
      modo, produto: produtoIdInicial, deposito, tipos: tipos.join(','),
      periodo, de, ate, pagina: '1',
      ...params,
    })
    router.push(`/dashboard/movimentacoes-estoque?${sp.toString()}`)
  }

  function urlExportar() {
    const sp = new URLSearchParams({
      modo, produto: produtoIdInicial, deposito, tipos: tipos.join(','), periodo, de, ate,
    })
    return `/api/movimentacoes-estoque/exportar?${sp.toString()}`
  }

  function alternarTipo(valor: string) {
    const novo = tipos.includes(valor) ? tipos.filter(t => t !== valor) : [...tipos, valor]
    setTipos(novo)
    navegar({ tipos: novo.join(',') })
  }

  const movimentos = modo === 'produto' ? movimentosProduto : movimentosPeriodo

  // Cards do período (só fazem sentido narrativa de saldo no modo produto).
  // Pega o primeiro/último movimento que REALMENTE tem saldo gravado — os
  // antigos vêm com estoque_anterior/estoque_novo nulos e, antes desta
  // guarda, o card estourava com "null.toLocaleString()" (erro 500 na tela).
  const primeiroComSaldo = movimentosProduto.find(m => m.estoque_anterior != null)
  const ultimoComSaldo = [...movimentosProduto].reverse().find(m => m.estoque_novo != null)
  const saldoInicial = produtoSelecionado
    ? (primeiroComSaldo?.estoque_anterior ?? produtoSelecionado.estoque ?? 0)
    : 0
  const saldoFinalCalculado = produtoSelecionado
    ? (ultimoComSaldo?.estoque_novo ?? produtoSelecionado.estoque ?? 0)
    : 0
  const totalEntradas = movimentosProduto.reduce((s, m) => s + Math.max(0, delta(m)), 0)
  const totalSaidas = movimentosProduto.reduce((s, m) => s + Math.max(0, -delta(m)), 0)
  const diferenca = produtoSelecionado ? (produtoSelecionado.estoque ?? 0) - saldoFinalCalculado : 0

  const totalPaginas = Math.max(1, Math.ceil(totalPeriodo / porPagina))

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>estoque</span><span>›</span>
        <span className="text-gray-600 font-medium">Movimentação de Estoque</span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Movimentação de Estoque</h1>
          <p className="text-sm text-gray-400 mt-0.5">Extrato de entradas, saídas e ajustes de cada produto</p>
        </div>
        <div className="flex gap-2">
          <a href={urlExportar()} download
            className="px-4 py-2 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
            ⬇ Exportar CSV
          </a>
          <button onClick={() => setAjustando(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
            + Ajustar estoque
          </button>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-700 mb-4">
        Histórico completo de vendas e entradas disponível a partir de <strong>{DATA_LANCAMENTO}</strong>.
        Movimentações anteriores a essa data podem não aparecer aqui, mesmo que o produto já existisse no sistema.
      </div>

      {/* Modo de consulta */}
      <div className="flex gap-2 mb-4">
        {(['periodo', 'produto'] as const).map(m => (
          <button key={m} onClick={() => { setModo(m); navegar({ modo: m, produto: m === 'periodo' ? '' : produtoIdInicial }) }}
            className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${modo === m ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {m === 'periodo' ? 'Por período' : 'Por produto'}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {PERIODO_OPCOES.map(p => (
            <button key={p} onClick={() => { setPeriodo(p); navegar({ periodo: p }) }}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${periodo === p ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
              {PERIODO_LABELS[p]}
            </button>
          ))}
        </div>

        {periodo === 'custom' && (
          <div className="flex gap-3 items-end">
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">De</label>
              <input type="date" value={de} onChange={e => { setDe(e.target.value); navegar({ periodo: 'custom', de: e.target.value }) }}
                className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Até</label>
              <input type="date" value={ate} onChange={e => { setAte(e.target.value); navegar({ periodo: 'custom', ate: e.target.value }) }}
                className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3 items-center">
          <div>
            <label className="block text-[11px] text-gray-500 mb-1">Depósito</label>
            <select value={deposito} onChange={e => { setDeposito(e.target.value); navegar({ deposito: e.target.value }) }}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm min-w-[160px]">
              <option value="">Todos os depósitos</option>
              {depositos.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
            </select>
          </div>

          <div className="relative">
            <label className="block text-[11px] text-gray-500 mb-1">Tipo de movimentação</label>
            <button onClick={() => setMostrarTipos(v => !v)}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm min-w-[160px] text-left bg-white">
              {tipos.length === 0 ? 'Todos os tipos' : `${tipos.length} selecionado(s)`}
            </button>
            {mostrarTipos && (
              <div className="absolute z-10 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-64 max-h-64 overflow-y-auto">
                {TIPOS_MOVIMENTO.map(t => (
                  <label key={t.value} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer text-sm">
                    <input type="checkbox" checked={tipos.includes(t.value)} onChange={() => alternarTipo(t.value)}
                      className="w-3.5 h-3.5 accent-blue-600" />
                    {t.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modo produto — busca ou resumo */}
      {modo === 'produto' && !produtoSelecionado && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">Buscar produto</label>
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Nome, SKU, EAN ou leia o código de barras..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
          {resultados.length > 0 && (
            <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden">
              {resultados.map(p => (
                <button key={p.id} onClick={() => navegar({ modo: 'produto', produto: p.id })}
                  className="w-full text-left px-3 py-2.5 hover:bg-blue-50 flex items-center justify-between border-b border-gray-100 last:border-0 bg-white">
                  <p className="text-sm text-gray-900">{p.nome}</p>
                  <p className="text-xs text-gray-400">{p.sku ?? '—'} {p.ean ? `· ${p.ean}` : ''}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {modo === 'produto' && produtoSelecionado && (
        <>
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">{produtoSelecionado.nome}</p>
              <p className="text-xs text-gray-400">
                {produtoSelecionado.sku ?? '—'} {produtoSelecionado.ean ? `· ${produtoSelecionado.ean}` : ''} {produtoSelecionado.categoria ? `· ${produtoSelecionado.categoria}` : ''} · {produtoSelecionado.unidade}
              </p>
            </div>
            <button onClick={() => navegar({ modo: 'produto', produto: '' })} className="text-xs text-blue-600 hover:underline">Trocar produto</button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            <Card label="Saldo inicial" valor={saldoInicial} />
            <Card label="Entradas" valor={totalEntradas} cls="text-green-600" />
            <Card label="Saídas" valor={totalSaidas} cls="text-red-600" />
            <Card label="Saldo final calculado" valor={saldoFinalCalculado} />
            <Card label="Estoque atual" valor={produtoSelecionado.estoque} />
            <Card label="Diferença" valor={diferenca} cls={diferenca !== 0 ? 'text-amber-600' : 'text-gray-400'} />
          </div>

          {diferenca !== 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-700 mb-4">
              ⚠️ Divergência: o saldo calculado a partir do histórico é <strong>{saldoFinalCalculado}</strong>, mas o estoque atual registrado é <strong>{produtoSelecionado.estoque}</strong>.
              A diferença pode vir de movimentações anteriores a {DATA_LANCAMENTO} (ainda não registradas) ou de outra alteração fora do período filtrado.
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
            <p className="text-sm font-semibold text-gray-900 mb-3">Evolução do Estoque</p>
            <GraficoEvolucaoEstoque
              pontos={movimentosProduto
                .filter(m => m.estoque_novo != null)   // movimentação antiga sem saldo não vira ponto
                .map(m => ({
                  data: new Date(m.created_at).toLocaleDateString('pt-BR'),
                  saldo: m.estoque_novo as number,
                }))}
            />
          </div>
        </>
      )}

      {modo === 'periodo' && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <p className="text-sm text-gray-600">
            <strong>{totalPeriodo}</strong> movimentação(ões) encontrada(s) no período.
          </p>
        </div>
      )}

      {/* Tabela extrato */}
      {(modo === 'periodo' || (modo === 'produto' && produtoSelecionado)) && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600 whitespace-nowrap">Data/Hora</th>
                  {modo === 'periodo' && <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600">Produto</th>}
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600">Depósito</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600">Tipo</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600">Documento / Motivo</th>
                  <th className="text-right px-3 py-2.5 text-xs font-medium text-gray-600">Entrada</th>
                  <th className="text-right px-3 py-2.5 text-xs font-medium text-gray-600">Saída</th>
                  <th className="text-right px-3 py-2.5 text-xs font-medium text-gray-600">Saldo após</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600">Usuário</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {movimentos.length === 0 && (
                  <tr><td colSpan={modo === 'periodo' ? 9 : 8} className="text-center py-10 text-gray-400 text-sm">Nenhuma movimentação encontrada com os filtros atuais.</td></tr>
                )}
                {movimentos.map(m => {
                  const d = delta(m)
                  const bt = badgeTipo(m)
                  const depNome = depositos.find(dp => dp.id === m.deposito_id)?.nome ?? '—'
                  return (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap text-xs">{new Date(m.created_at).toLocaleString('pt-BR')}</td>
                      {modo === 'periodo' && <td className="px-3 py-2 text-gray-900">{m.produto_nome}</td>}
                      <td className="px-3 py-2 text-gray-600 text-xs">{depNome}</td>
                      <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${bt.cls}`}>{bt.label}</span></td>
                      <td className="px-3 py-2 text-gray-600 text-xs max-w-[240px] truncate" title={m.motivo ?? ''}>{m.motivo || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-green-600">{d > 0 ? `+${d}` : ''}</td>
                      <td className="px-3 py-2 text-right font-mono text-red-600">{d < 0 ? Math.abs(d) : ''}</td>
                      <td className="px-3 py-2 text-right font-mono text-gray-900 font-medium">{m.estoque_novo ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{m.usuario || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {modo === 'periodo' && totalPaginas > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
              <span className="text-xs text-gray-400">Página {paginaInicial} de {totalPaginas}</span>
              <div className="flex gap-2">
                <button disabled={paginaInicial <= 1} onClick={() => navegar({ pagina: String(paginaInicial - 1) })}
                  className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50">← Anterior</button>
                <button disabled={paginaInicial >= totalPaginas} onClick={() => navegar({ pagina: String(paginaInicial + 1) })}
                  className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50">Próxima →</button>
              </div>
            </div>
          )}
        </div>
      )}

      {ajustando && (
        <AjusteEstoqueModal empresaId={empresaId} onClose={() => setAjustando(false)}
          onSalvo={() => { setAjustando(false); router.refresh() }} />
      )}
    </div>
  )
}

function Card({ label, valor, cls }: { label: string; valor: number | null | undefined; cls?: string }) {
  const texto = valor == null || Number.isNaN(valor) ? '—' : valor.toLocaleString('pt-BR')
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`text-lg font-semibold mt-0.5 ${cls ?? 'text-gray-900'}`}>{texto}</p>
    </div>
  )
}
