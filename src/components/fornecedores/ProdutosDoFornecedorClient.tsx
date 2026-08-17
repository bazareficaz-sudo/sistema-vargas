'use client'

import { useState } from 'react'
import Link from 'next/link'

// O que este fornecedor já entregou, e o que o comprador precisa decidir
// sobre cada item: quantidade mínima, múltiplo de caixa, prazo (quando
// difere do prazo geral do fornecedor), e qual é o preferido quando o
// mesmo produto tem mais de uma origem.
//
// Custo, última compra e prazo real são só leitura aqui — vêm da rodada
// noturna que lê entrada manual e XML. Editar isso à mão não faria
// sentido: na próxima madrugada o número calculado voltaria por cima.

type Linha = {
  id: string
  produto_id: string
  nome: string
  sku: string | null
  estoque: number
  custo_ultimo: number | null
  custo_medio: number | null
  quantidade_ultima: number | null
  ultima_compra_em: string | null
  compras_contadas: number
  prazo_entrega_real_dias: number | null
  prazo_entrega_dias: number | null
  quantidade_minima: number | null
  multiplo_embalagem: number | null
  preferencial: boolean
  observacao: string | null
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function ProdutosDoFornecedorClient({ fornecedor, lista, erro }: {
  fornecedor: { id: string; razao_social: string; nome_fantasia: string | null; prazo_entrega_dias: number | null }
  lista: Linha[]
  erro: string | null
}) {
  const [linhas, setLinhas] = useState(lista)
  const [busca, setBusca] = useState('')
  const [salvandoId, setSalvandoId] = useState<string | null>(null)

  const filtradas = linhas.filter(l =>
    !busca || l.nome.toLowerCase().includes(busca.toLowerCase()) || (l.sku ?? '').toLowerCase().includes(busca.toLowerCase()))

  async function salvar(l: Linha, campo: Partial<Pick<Linha, 'prazo_entrega_dias' | 'quantidade_minima' | 'multiplo_embalagem' | 'preferencial'>>) {
    setSalvandoId(l.id)
    const atualizado = { ...l, ...campo }
    setLinhas(prev => prev.map(x => x.id === l.id ? atualizado : (campo.preferencial ? { ...x, preferencial: false } : x)))
    try {
      await fetch('/api/fornecedor-produto', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fornecedorId: fornecedor.id, produtoId: l.produto_id,
          prazoEntregaDias: atualizado.prazo_entrega_dias,
          quantidadeMinima: atualizado.quantidade_minima,
          multiploEmbalagem: atualizado.multiplo_embalagem,
          preferencial: atualizado.preferencial,
        }),
      })
    } finally {
      setSalvandoId(null)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <Link href="/dashboard/fornecedores" className="hover:text-gray-600">fornecedores</Link><span>›</span>
        <span className="text-gray-600 font-medium">produtos</span>
      </div>

      <div className="mb-5">
        <h1 className="text-gray-900 text-xl font-semibold">{fornecedor.nome_fantasia || fornecedor.razao_social}</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          {linhas.length} produto(s) com histórico de compra
          {fornecedor.prazo_entrega_dias && ` · prazo geral cadastrado: ${fornecedor.prazo_entrega_dias} dias`}
        </p>
      </div>

      {erro && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>
      )}

      <input value={busca} onChange={e => setBusca(e.target.value)}
        placeholder="Buscar produto ou SKU..."
        className="mb-4 rounded-lg border border-slate-200 px-3 py-1.5 text-xs w-full max-w-sm" />

      {filtradas.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-slate-500 text-sm">
          {linhas.length === 0
            ? 'Sem histórico de compra deste fornecedor ainda. O cálculo roda de madrugada.'
            : 'Nenhum produto com esses termos.'}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Produto</th>
                <th className="text-right px-2 py-2 font-medium">Estoque</th>
                <th className="text-right px-2 py-2 font-medium">Último custo</th>
                <th className="text-right px-2 py-2 font-medium">Custo médio</th>
                <th className="text-left px-2 py-2 font-medium">Última compra</th>
                <th className="text-right px-2 py-2 font-medium">Prazo (dias)</th>
                <th className="text-right px-2 py-2 font-medium">Qtd. mínima</th>
                <th className="text-right px-2 py-2 font-medium">Múltiplo</th>
                <th className="text-center px-2 py-2 font-medium">Preferido</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map(l => (
                <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{l.nome}</div>
                    <div className="text-[11px] text-slate-400">{l.sku ?? '—'} · {l.compras_contadas} compra(s)</div>
                  </td>
                  <td className={`px-2 py-2 text-right ${l.estoque <= 0 ? 'text-red-600 font-medium' : 'text-slate-600'}`}>{l.estoque}</td>
                  <td className="px-2 py-2 text-right text-slate-700">{l.custo_ultimo ? brl(l.custo_ultimo) : '—'}</td>
                  <td className="px-2 py-2 text-right text-slate-500">{l.custo_medio ? brl(l.custo_medio) : '—'}</td>
                  <td className="px-2 py-2 text-slate-500 text-[12px]">
                    {l.ultima_compra_em ? new Date(l.ultima_compra_em).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input type="number" min={0} defaultValue={l.prazo_entrega_dias ?? ''}
                      onBlur={e => salvar(l, { prazo_entrega_dias: e.target.value === '' ? null : Number(e.target.value) })}
                      placeholder={l.prazo_entrega_real_dias ? String(Math.round(l.prazo_entrega_real_dias)) : '—'}
                      className="w-16 text-right border border-slate-200 rounded px-1.5 py-1 text-xs" />
                    {l.prazo_entrega_real_dias !== null && (
                      <div className="text-[10px] text-emerald-600">real: {l.prazo_entrega_real_dias}d</div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input type="number" min={0} defaultValue={l.quantidade_minima ?? ''}
                      onBlur={e => salvar(l, { quantidade_minima: e.target.value === '' ? null : Number(e.target.value) })}
                      className="w-16 text-right border border-slate-200 rounded px-1.5 py-1 text-xs" />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input type="number" min={0} defaultValue={l.multiplo_embalagem ?? ''}
                      onBlur={e => salvar(l, { multiplo_embalagem: e.target.value === '' ? null : Number(e.target.value) })}
                      className="w-16 text-right border border-slate-200 rounded px-1.5 py-1 text-xs" />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <input type="checkbox" checked={l.preferencial} disabled={salvandoId === l.id}
                      onChange={e => salvar(l, { preferencial: e.target.checked })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-[11px] text-slate-400">
        Custo, última compra e prazo real vêm do histórico de entradas e são recalculados toda noite —
        não dá para editá-los aqui. Prazo, quantidade mínima e múltiplo de embalagem são o que você
        souber e o cálculo ainda não aprendeu sozinho.
      </p>
    </div>
  )
}
