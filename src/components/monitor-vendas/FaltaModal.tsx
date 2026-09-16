'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type AlvoFalta = {
  produtoId: string | null
  produtoNome: string
  produtoSku: string | null
  quantidadeSugerida: number
  vendaOrigem?: { id: string; hora: string; cliente: string | null } | null
}

export type FaltaResumo = {
  id: string
  produto_id: string | null
  produto_nome: string
  quantidade_solicitada: number
  status: string
}

// Cadastra uma falta a partir do Monitor de Vendas.
//
// Não edita a solicitação pendente que já existe: cria uma nova, do mesmo
// jeito que o balcão faz. É a mesma filosofia da tela de Faltas e Encomendas
// — "5 clientes diferentes desde 03/08" só existe porque cada solicitação
// continua inteira, nunca substituída pela mais recente.
export default function FaltaModal({
  alvo, empresaId, operador, faltasPendentes, onFechar, onSalvo,
}: {
  alvo: AlvoFalta
  empresaId: string
  operador: string
  faltasPendentes: { quantidade: number; ids: string[] } | undefined
  onFechar: () => void
  onSalvo: (falta: FaltaResumo) => void
}) {
  const sb = createClient()
  const [quantidade, setQuantidade] = useState(String(alvo.quantidadeSugerida || 1))
  const [observacao, setObservacao] = useState(
    alvo.vendaOrigem
      ? `Detectado no Monitor de Vendas — venda de ${alvo.vendaOrigem.cliente ?? 'cliente não identificado'} às ${alvo.vendaOrigem.hora}.`
      : ''
  )
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar() {
    const qtd = Number(quantidade.replace(',', '.'))
    if (!qtd || qtd <= 0) { setErro('Informe uma quantidade maior que zero.'); return }
    setSalvando(true)
    setErro('')
    try {
      const { data, error } = await sb.from('faltas').insert({
        empresa_id: empresaId,
        produto_id: alvo.produtoId,
        produto_nome: alvo.produtoNome,
        produto_sku: alvo.produtoSku,
        quantidade_solicitada: qtd,
        observacao: observacao || null,
        status: 'pendente',
        tipo: 'falta',
        origem: 'monitor_vendas',
        usuario_nome: operador,
      }).select('id, produto_id, produto_nome, quantidade_solicitada, status').single()
      if (error) throw error
      onSalvo(data as FaltaResumo)
    } catch (e: any) {
      setErro(e.message ?? 'Não foi possível registrar a falta.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-5">
        <h3 className="text-slate-900 font-semibold text-base">Registrar falta</h3>
        <p className="text-slate-500 text-sm mt-0.5">{alvo.produtoNome}</p>
        {alvo.produtoSku && <p className="text-slate-400 text-xs">{alvo.produtoSku}</p>}

        {faltasPendentes && faltasPendentes.quantidade > 0 && (
          <div className="mt-3 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2 text-xs text-orange-700">
            Já existe{faltasPendentes.ids.length > 1 ? 'm' : ''} {faltasPendentes.ids.length} solicitação
            {faltasPendentes.ids.length > 1 ? 'ões' : ''} pendente{faltasPendentes.ids.length > 1 ? 's' : ''}, somando{' '}
            {faltasPendentes.quantidade} unidade(s). Esta tela registra uma NOVA solicitação, não substitui as existentes.
          </div>
        )}

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600">Quantidade solicitada</label>
            <input
              type="text" inputMode="decimal" value={quantidade}
              onChange={e => setQuantidade(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Observação</label>
            <textarea
              value={observacao} onChange={e => setObservacao(e.target.value)} rows={3}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none" />
          </div>
        </div>

        {erro && <p className="mt-3 text-xs text-red-600">{erro}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onFechar} disabled={salvando}
            className="px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={salvar} disabled={salvando}
            className="px-3.5 py-1.5 rounded-lg text-sm bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50">
            {salvando ? 'Salvando...' : 'Registrar falta'}
          </button>
        </div>
      </div>
    </div>
  )
}
