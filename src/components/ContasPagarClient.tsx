'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PagarContasModal from '@/components/contas-pagar/PagarContasModal'
import NovaDespesaModal from '@/components/contas-pagar/NovaDespesaModal'

type Conta = {
  id: string; descricao: string; valor: number; vencimento: string
  status: string; data_pagamento: string | null; forma_pagamento: string | null
  parcela: number; total_parcelas: number; observacoes: string | null
  valor_pago: number | null; juros: number | null; multa: number | null
  tipo_despesa_id: string | null; competencia: string | null
  fornecedores: { razao_social: string; nome_fantasia: string | null } | null
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

function rotuloCompetencia(iso: string) {
  const [a, m] = iso.split('-').map(Number)
  return new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
}

const STATUS_BADGE: Record<string, string> = {
  pendente: 'bg-yellow-100 text-yellow-700',
  vencido:  'bg-red-100 text-red-600',
  pago:     'bg-green-100 text-green-700',
  cancelado:'bg-gray-100 text-gray-500',
}
const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente', vencido: 'Vencido', pago: 'Pago', cancelado: 'Cancelado',
}

export default function ContasPagarClient({
  contas: inicial, statusFiltro, qInicial, empresaId,
  totalPendente, totalVencido, totalPago,
}: {
  contas: Conta[]; statusFiltro: string; qInicial: string; empresaId: string
  totalPendente: number; totalVencido: number; totalPago: number
}) {
  const router = useRouter()
  const [contas, setContas] = useState(inicial)
  const [q, setQ] = useState(qInicial)
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [modalPgto, setModalPgto] = useState<Conta[] | null>(null)
  const [modalNova, setModalNova] = useState(false)

  // Ordenação e filtro por fornecedor. Client-side: a tela já carrega a lista
  // do período, e o volume é de dezenas — paginar no servidor aqui só somaria
  // espera sem resolver problema que exista.
  const [ordem, setOrdem] = useState<'vencimento' | 'fornecedor' | 'valor'>('vencimento')
  const [fornecedorFiltro, setFornecedorFiltro] = useState('')

  const nomeForn = (c: Conta) =>
    c.fornecedores?.nome_fantasia || c.fornecedores?.razao_social || ''

  // Só os fornecedores que APARECEM na lista carregada. Uma lista fixa com o
  // cadastro inteiro encheria o seletor de nomes sem nenhuma conta.
  const fornecedoresPresentes = (() => {
    const m = new Map<string, number>()
    for (const c of contas) {
      const n = nomeForn(c) || '(sem fornecedor)'
      m.set(n, (m.get(n) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
  })()

  function navegar(params: Record<string, string>) {
    const sp = new URLSearchParams({ status: statusFiltro, q, ...params })
    router.push(`/dashboard/contas-pagar?${sp.toString()}`)
  }

  // Marca só o que está VISÍVEL. Usava `contas` (a lista inteira), então
  // filtrar por fornecedor e clicar no cabeçalho selecionava as 78 contas —
  // e o pagamento em massa iria muito além do que a tela mostrava.
  function toggleAll(c: boolean) {
    setSelecionadas(c ? new Set(selecionaveis.map(x => x.id)) : new Set())
  }
  function toggleOne(id: string) {
    setSelecionadas(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // A gravação em si é do modal — ele é quem sabe o rateio de juros/multa por
  // conta. Aqui só refletimos o resultado na lista para a tela não ficar
  // mostrando como pendente algo que acabou de ser pago.
  function aplicarPagamento(ids: string[], dados: { data: string; forma: string }) {
    setContas(prev => prev.map(c => ids.includes(c.id)
      ? { ...c, status: 'pago', data_pagamento: dados.data, forma_pagamento: dados.forma }
      : c))
    setSelecionadas(new Set())
    setModalPgto(null)
    router.refresh()
  }

  function pagarSelecionadas() {
    if (marcadas.length === 0) return
    setModalPgto(marcadas)
  }

  async function cancelar(id: string) {
    if (!confirm('Cancelar esta conta?')) return
    const sb = createClient()
    await sb.from('contas_pagar').update({ status: 'cancelado' }).eq('id', id)
    setContas(prev => prev.map(c => c.id === id ? { ...c, status: 'cancelado' } : c))
  }

  const filtradas = contas
    .filter(c => !q || c.descricao.toLowerCase().includes(q.toLowerCase()))
    .filter(c => !fornecedorFiltro || (nomeForn(c) || '(sem fornecedor)') === fornecedorFiltro)
    .slice()
    .sort((a, b) => {
      if (ordem === 'fornecedor') {
        // Desempata por vencimento: dentro do mesmo fornecedor, o que vence
        // antes é o que precisa ser decidido antes.
        const porNome = nomeForn(a).localeCompare(nomeForn(b), 'pt-BR')
        if (porNome !== 0) return porNome
        return String(a.vencimento ?? '').localeCompare(String(b.vencimento ?? ''))
      }
      if (ordem === 'valor') return (b.valor ?? 0) - (a.valor ?? 0)
      return String(a.vencimento ?? '').localeCompare(String(b.vencimento ?? ''))
    })
  const totalFiltrado = filtradas.reduce((s, c) => s + Number(c.valor), 0)
  // Conta paga ou cancelada não entra em pagamento em massa.
  const selecionaveis = filtradas.filter(c => c.status !== 'pago' && c.status !== 'cancelado')
  // O que será realmente pago: a interseção do que está marcado com o que
  // está na tela. Se o usuário marca contas e depois troca o filtro, o que
  // saiu de vista não é pago junto sem ele ver.
  const marcadas = selecionaveis.filter(c => selecionadas.has(c.id))

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>compras</span><span>›</span>
        <span className="text-gray-600 font-medium">contas a pagar</span>
      </div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-gray-900 text-xl font-semibold">Contas a Pagar</h1>
        <div className="flex gap-2">
          <a href="/dashboard/configuracoes/tipos-despesa"
            className="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 text-sm rounded-lg hover:bg-gray-50">
            Tipos de despesa
          </a>
          <button onClick={() => setModalNova(true)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
            + Nova despesa
          </button>
          <a href="/dashboard/contas-pagar/relatorio"
            className="px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg">
            📊 Relatório
          </a>
        </div>
      </div>

      {/* Cards resumo */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">A vencer</p>
          <p className="text-2xl font-bold text-yellow-600">{fmt(totalPendente)}</p>
        </div>
        <div className="bg-white border border-red-100 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Vencido</p>
          <p className="text-2xl font-bold text-red-600">{fmt(totalVencido)}</p>
        </div>
        <div className="bg-white border border-green-100 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Pago (total)</p>
          <p className="text-2xl font-bold text-green-600">{fmt(totalPago)}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex gap-1">
          {[['pendente','A vencer'], ['vencido','Vencidos'], ['pago','Pagos'], ['todos','Todos']].map(([s, l]) => (
            <button key={s} onClick={() => navegar({ status: s })}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${statusFiltro === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
              {l}
            </button>
          ))}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Filtrar por descrição..."
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 bg-white w-64" />

        <select value={fornecedorFiltro} onChange={e => setFornecedorFiltro(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 bg-white">
          <option value="">Todos os fornecedores</option>
          {fornecedoresPresentes.map(([nome, qtd]) => (
            <option key={nome} value={nome}>{nome} ({qtd})</option>
          ))}
        </select>

        <select value={ordem} onChange={e => setOrdem(e.target.value as any)}
          title="Ordem da lista"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 bg-white">
          <option value="vencimento">Ordenar por vencimento</option>
          <option value="fornecedor">Ordenar por fornecedor</option>
          <option value="valor">Ordenar por valor (maior primeiro)</option>
        </select>

        {(fornecedorFiltro || ordem !== 'vencimento') && (
          <button onClick={() => { setFornecedorFiltro(''); setOrdem('vencimento') }}
            className="text-xs text-gray-500 hover:text-gray-700 underline">limpar</button>
        )}
      </div>

      {/* Ações em massa */}
      {marcadas.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4 flex items-center gap-4">
          <span className="text-sm font-medium text-green-700">{marcadas.length} conta(s) selecionada(s)</span>
          <span className="text-sm text-green-800">
            {fmt(marcadas.reduce((s, c) => s + Number(c.valor), 0))}
          </span>
          <button onClick={pagarSelecionadas}
            className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors">
            ✓ Registrar pagamento
          </button>
          <button onClick={() => setSelecionadas(new Set())} className="ml-auto text-xs text-gray-500 hover:text-gray-700">Cancelar</button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="w-10 px-4 py-3">
                <input type="checkbox"
                  checked={selecionaveis.length > 0 && marcadas.length === selecionaveis.length}
                  onChange={e => toggleAll(e.target.checked)}
                  className="w-4 h-4 accent-blue-600" />
              </th>
              <th className="text-left px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Descrição</th>
              <th className="text-left px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Fornecedor</th>
              <th className="text-left px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Vencimento</th>
              <th className="text-left px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide" title="Mês a que a despesa pertence">Competência</th>
              <th className="text-right px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Valor</th>
              <th className="text-center px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Status</th>
              <th className="text-left px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Pagamento</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtradas.map(c => {
              const venc = new Date(c.vencimento + 'T00:00:00')
              const hoje = new Date(); hoje.setHours(0,0,0,0)
              const diasVenc = Math.ceil((venc.getTime() - hoje.getTime()) / 86400000)
              return (
                <tr key={c.id} className={`hover:bg-gray-50 transition-colors group ${c.status === 'vencido' ? 'bg-red-50/30' : ''}`}>
                  <td className="px-4 py-3">
                    {c.status !== 'pago' && c.status !== 'cancelado' && (
                      <input type="checkbox" checked={selecionadas.has(c.id)} onChange={() => toggleOne(c.id)}
                        className="w-4 h-4 accent-blue-600" />
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <p className="text-gray-900 font-medium text-xs">{c.descricao}</p>
                    {c.total_parcelas > 1 && (
                      <p className="text-xs text-gray-400">{c.parcela}/{c.total_parcelas} parcelas</p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-500">
                    {c.fornecedores?.nome_fantasia ?? c.fornecedores?.razao_social ?? '—'}
                  </td>
                  <td className="px-3 py-3">
                    <p className="text-xs text-gray-700">{venc.toLocaleDateString('pt-BR')}</p>
                    {c.status === 'pendente' && (
                      <p className={`text-xs ${diasVenc < 0 ? 'text-red-500' : diasVenc <= 7 ? 'text-orange-500' : 'text-gray-400'}`}>
                        {diasVenc < 0 ? `${Math.abs(diasVenc)}d atraso` : diasVenc === 0 ? 'Hoje' : `em ${diasVenc}d`}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {c.competencia ? (
                      <>
                        <p className="text-xs text-gray-700">{rotuloCompetencia(c.competencia)}</p>
                        {/* Só destaca quando difere do vencimento — é aí que a
                            informação muda alguma coisa para quem lê. */}
                        {c.competencia.slice(0, 7) !== String(c.vencimento).slice(0, 7) && (
                          <p className="text-[11px] text-blue-600">≠ vencimento</p>
                        )}
                      </>
                    ) : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-gray-900 text-sm">{fmt(Number(c.valor))}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-500">
                    {c.data_pagamento && (
                      <div>
                        <p>{new Date(c.data_pagamento + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                        {c.forma_pagamento && <p className="text-gray-400 capitalize">{c.forma_pagamento}</p>}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {c.status !== 'pago' && c.status !== 'cancelado' && (
                        <button onClick={() => setModalPgto([c])}
                          className="text-xs text-green-600 hover:text-green-800 font-medium">Pagar</button>
                      )}
                      {c.status !== 'cancelado' && c.status !== 'pago' && (
                        <button onClick={() => cancelar(c.id)}
                          className="text-xs text-red-500 hover:text-red-700">Cancelar</button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {filtradas.length === 0 && (
              <tr><td colSpan={9} className="py-12 text-center text-gray-400">Nenhuma conta encontrada.</td></tr>
            )}
          </tbody>
          {filtradas.length > 0 && (
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-200">
                <td colSpan={5} className="px-4 py-3 text-xs text-gray-500">{filtradas.length} conta(s)</td>
                <td className="px-3 py-3 text-right text-sm font-bold text-gray-900">{fmt(totalFiltrado)}</td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {modalNova && (
        <NovaDespesaModal
          empresaId={empresaId}
          onFechar={() => setModalNova(false)}
          onCriada={qtd => {
            setModalNova(false)
            alert(qtd > 1 ? `${qtd} contas criadas.` : 'Despesa criada.')
            router.refresh()
          }}
        />
      )}

      {modalPgto && (
        <PagarContasModal
          contas={modalPgto}
          empresaId={empresaId}
          onFechar={() => setModalPgto(null)}
          onPago={aplicarPagamento}
        />
      )}
    </div>
  )
}
