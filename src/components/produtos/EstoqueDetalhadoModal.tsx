'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type Produto = { id: string; nome: string; sku: string | null; unidade: string; estoque: number }

type PorDeposito = { deposito_id: string; nome: string; quantidade: number; estoque_minimo: number; localizacao: string | null }

type Movimento = {
  id: string
  data: string
  tipo: 'venda' | 'venda_marketplace' | 'devolucao' | 'entrada' | 'ajuste_entrada' | 'ajuste_saida' | 'transferencia_entrada' | 'transferencia_saida' | 'inventario' | 'avaria' | 'compra'
  quantidade: number
  detalhe: string
}

const TIPO_MOV: Record<Movimento['tipo'], { label: string; cor: string; sinal: string }> = {
  venda:                  { label: 'Venda',          cor: 'text-red-600 bg-red-50 border-red-200',       sinal: '−' },
  venda_marketplace:      { label: 'Venda Marketplace', cor: 'text-red-600 bg-red-50 border-red-200',     sinal: '−' },
  devolucao:              { label: 'Devolução',       cor: 'text-green-600 bg-green-50 border-green-200', sinal: '+' },
  entrada:                { label: 'Entrada',         cor: 'text-blue-600 bg-blue-50 border-blue-200',    sinal: '+' },
  compra:                 { label: 'Compra',          cor: 'text-blue-600 bg-blue-50 border-blue-200',    sinal: '+' },
  ajuste_entrada:         { label: 'Ajuste +',        cor: 'text-green-600 bg-green-50 border-green-200', sinal: '+' },
  ajuste_saida:           { label: 'Ajuste −',        cor: 'text-red-600 bg-red-50 border-red-200',       sinal: '−' },
  transferencia_entrada:  { label: 'Transf. entrada', cor: 'text-purple-600 bg-purple-50 border-purple-200', sinal: '+' },
  transferencia_saida:    { label: 'Transf. saída',   cor: 'text-orange-600 bg-orange-50 border-orange-200', sinal: '−' },
  inventario:             { label: 'Inventário',      cor: 'text-slate-600 bg-slate-50 border-slate-200', sinal: '±' },
  avaria:                 { label: 'Avaria',          cor: 'text-red-600 bg-red-50 border-red-200',       sinal: '−' },
}

const FILTROS: { key: string; label: string }[] = [
  { key: '', label: 'Todos' },
  { key: 'venda', label: 'Vendas' },
  { key: 'entrada', label: 'Entradas' },
  { key: 'devolucao', label: 'Devoluções' },
  { key: 'outros', label: 'Ajustes/outros' },
]

function fmtDT(s: string) { return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) }

export default function EstoqueDetalhadoModal({ produto, empresaId, onClose }: {
  produto: Produto
  empresaId: string
  onClose: () => void
}) {
  const [carregando, setCarregando] = useState(true)
  const [porDeposito, setPorDeposito] = useState<PorDeposito[]>([])
  const [movimentos, setMovimentos] = useState<Movimento[]>([])
  const [filtro, setFiltro] = useState('')

  useEffect(() => {
    let ativo = true
    async function carregar() {
      const sb = createClient()

      // Sem embed de "vendas" aqui de propósito — o relacionamento
      // venda_itens -> vendas não está sendo reconhecido pelo PostgREST
      // nesta base (erro "Could not find a relationship..."), o que fazia a
      // consulta inteira falhar e a movimentação sumir por completo. A
      // junção com vendas é feita manualmente abaixo.
      const vendaItensSelect = 'id, quantidade, tipo, created_at, venda_id'

      const [estoqueRes, vendasRes, devolucoesRes, entradasRes, movRes] = await Promise.all([
        sb.from('produto_estoque').select('deposito_id, quantidade, estoque_minimo, localizacao, depositos(nome)')
          .eq('empresa_id', empresaId).eq('produto_id', produto.id),
        sb.from('venda_itens').select(vendaItensSelect)
          .eq('produto_id', produto.id).eq('tipo', 'venda').order('created_at', { ascending: false }).limit(100),
        // Consulta separada da de vendas — se não fosse assim, um SKU com muitas
        // vendas empurraria as devoluções pra fora do .limit(100) e elas
        // nunca apareceriam na aba "Devoluções", mesmo existindo.
        sb.from('venda_itens').select(vendaItensSelect)
          .eq('produto_id', produto.id).eq('tipo', 'devolucao').order('created_at', { ascending: false }).limit(100),
        // Sem embed de "entradas"/"fornecedores" pelo mesmo motivo do venda_itens acima.
        sb.from('entrada_itens').select('id, quantidade, entrada_id, created_at')
          .eq('produto_id', produto.id).order('created_at', { ascending: false }).limit(100),
        sb.from('estoque_movimentacoes').select('id, tipo, quantidade, motivo, observacao, created_at')
          .eq('empresa_id', empresaId).eq('produto_id', produto.id)
          .not('tipo', 'in', '(venda,devolucao)')
          .order('created_at', { ascending: false }).limit(50),
      ])
      if (!ativo) return

      const itensVenda = [...(vendasRes.data ?? []), ...(devolucoesRes.data ?? [])] as any[]
      const vendaIds = Array.from(new Set<string>(itensVenda.map(v => v.venda_id).filter(Boolean)))
      const vendasMap = new Map<string, { created_at: string; numero: number | null; vendedor_nome: string | null; operador_nome: string | null }>()
      if (vendaIds.length > 0) {
        const { data: vendasInfo } = await sb.from('vendas').select('id, created_at, numero, vendedor_nome, operador_nome').in('id', vendaIds)
        for (const v of vendasInfo ?? []) vendasMap.set(v.id, v)
      }
      const entradaIds = Array.from(new Set<string>((entradasRes.data ?? []).map((e: any) => e.entrada_id).filter(Boolean)))
      const entradasMap = new Map<string, { numero_entrada: string | null; numero_nf: string | null; data_entrada: string; fornecedor_id: string | null }>()
      if (entradaIds.length > 0) {
        const { data: entradasInfo } = await sb.from('entradas').select('id, numero_entrada, numero_nf, data_entrada, fornecedor_id').in('id', entradaIds)
        for (const ent of entradasInfo ?? []) entradasMap.set(ent.id, ent)
      }
      const fornecedorIds = Array.from(new Set<string>(Array.from(entradasMap.values()).map(e => e.fornecedor_id).filter((v): v is string => Boolean(v))))
      const fornecedoresMap = new Map<string, { razao_social: string | null; nome_fantasia: string | null }>()
      if (fornecedorIds.length > 0) {
        const { data: fornecedoresInfo } = await sb.from('fornecedores').select('id, razao_social, nome_fantasia').in('id', fornecedorIds)
        for (const f of fornecedoresInfo ?? []) fornecedoresMap.set(f.id, f)
      }
      if (!ativo) return

      setPorDeposito((estoqueRes.data ?? []).map((r: any) => ({
        deposito_id: r.deposito_id,
        nome: r.depositos?.nome ?? '—',
        quantidade: Number(r.quantidade) || 0,
        estoque_minimo: Number(r.estoque_minimo) || 0,
        localizacao: r.localizacao,
      })))

      function mapVendaItem(v: any): Movimento {
        const venda = vendasMap.get(v.venda_id)
        const data = venda?.created_at ?? v.created_at
        const quem = venda?.vendedor_nome || venda?.operador_nome || ''
        const numero = venda?.numero ? `#${venda.numero}` : ''
        return {
          id: `venda-${v.id}`,
          data,
          tipo: v.tipo === 'devolucao' ? 'devolucao' : 'venda',
          quantidade: Number(v.quantidade) || 0,
          detalhe: [numero, quem].filter(Boolean).join(' · ') || (v.tipo === 'devolucao' ? 'Devolução no PDV' : 'Venda no PDV'),
        }
      }
      const movVendas: Movimento[] = itensVenda.map(mapVendaItem)

      const movEntradas: Movimento[] = (entradasRes.data ?? []).map((e: any) => {
        const ent = entradasMap.get(e.entrada_id)
        const forn = ent?.fornecedor_id ? fornecedoresMap.get(ent.fornecedor_id) : undefined
        const fornecedor = forn?.nome_fantasia || forn?.razao_social || ''
        const numero = ent?.numero_entrada || (ent?.numero_nf ? `NF ${ent.numero_nf}` : '')
        return {
          id: `entrada-${e.id}`,
          data: ent?.data_entrada ?? e.created_at ?? new Date().toISOString(),
          tipo: 'entrada',
          quantidade: Number(e.quantidade) || 0,
          detalhe: [numero, fornecedor].filter(Boolean).join(' · ') || 'Entrada de mercadoria',
        }
      })

      const movAjustes: Movimento[] = (movRes.data ?? []).map((m: any) => ({
        id: `mov-${m.id}`,
        data: m.created_at,
        tipo: (TIPO_MOV[m.tipo as Movimento['tipo']] ? m.tipo : 'ajuste_entrada') as Movimento['tipo'],
        quantidade: Number(m.quantidade) || 0,
        detalhe: m.motivo || m.observacao || TIPO_MOV[m.tipo as Movimento['tipo']]?.label || m.tipo,
      }))

      const todos = [...movVendas, ...movEntradas, ...movAjustes].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
      setMovimentos(todos)
      setCarregando(false)
    }
    carregar()
    return () => { ativo = false }
  }, [produto.id, empresaId])

  const movimentosFiltrados = movimentos.filter(m => {
    if (!filtro) return true
    if (filtro === 'outros') return !['venda', 'venda_marketplace', 'entrada', 'devolucao'].includes(m.tipo)
    if (filtro === 'venda') return m.tipo === 'venda' || m.tipo === 'venda_marketplace'
    return m.tipo === filtro
  })

  const totalDepositos = porDeposito.reduce((s, d) => s + d.quantidade, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Estoque Detalhado</h2>
            <p className="text-xs text-gray-400">{produto.nome} {produto.sku && `· SKU ${produto.sku}`}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-4 bg-blue-50 border-b border-blue-100 flex items-center justify-between flex-shrink-0">
          <span className="text-sm text-blue-900 font-medium">Estoque atual</span>
          <span className="text-xl font-bold text-blue-700">{produto.estoque} {produto.unidade}</span>
        </div>

        {carregando ? (
          <div className="px-6 py-10 text-center text-gray-400 text-sm">Carregando...</div>
        ) : (
          <div className="px-6 py-5 space-y-6">
            {porDeposito.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Estoque por depósito</p>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-3 py-2 font-medium text-gray-500 text-xs">Depósito</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-500 text-xs">Localização</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-500 text-xs">Qtd.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {porDeposito.map(d => (
                        <tr key={d.deposito_id}>
                          <td className="px-3 py-2 text-gray-800">{d.nome}</td>
                          <td className="px-3 py-2 text-gray-400 text-xs">{d.localizacao || '—'}</td>
                          <td className={`px-3 py-2 text-right font-medium ${d.quantidade <= d.estoque_minimo ? 'text-red-600' : 'text-gray-800'}`}>{d.quantidade}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200 bg-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-600" colSpan={2}>Total nos depósitos</td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-900">{totalDepositos}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Movimentação do produto (vendas, entradas, devoluções)</p>
              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                {FILTROS.map(f => (
                  <button key={f.key} onClick={() => setFiltro(f.key)}
                    className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${filtro === f.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
                    {f.label}
                  </button>
                ))}
              </div>

              {movimentosFiltrados.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Nenhuma movimentação encontrada.</p>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-3 py-2 font-medium text-gray-500 text-xs">Data</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-500 text-xs">Tipo</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-500 text-xs">Detalhe</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-500 text-xs">Qtd.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {movimentosFiltrados.map(m => {
                        const info = TIPO_MOV[m.tipo]
                        return (
                          <tr key={m.id}>
                            <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{fmtDT(m.data)}</td>
                            <td className="px-3 py-2">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${info.cor}`}>{info.label}</span>
                            </td>
                            <td className="px-3 py-2 text-gray-700 text-xs">{m.detalhe}</td>
                            <td className={`px-3 py-2 text-right font-medium ${info.cor.split(' ')[0]}`}>{info.sinal} {m.quantidade}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center flex-shrink-0">
          <a href={`/dashboard/movimentacoes-estoque?modo=produto&produto=${produto.id}`}
            className="text-sm text-blue-600 hover:underline">Ver extrato completo →</a>
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Fechar</button>
        </div>
      </div>
    </div>
  )
}
