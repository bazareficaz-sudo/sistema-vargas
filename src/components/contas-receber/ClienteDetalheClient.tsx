'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type Cliente = {
  id: string; nome: string; cpf_cnpj: string | null; telefone: string | null
  email: string | null; cidade: string | null; estado: string | null
  permite_fiado: boolean; limite_credito: number; saldo_devedor: number
  valor_vencido: number; maior_atraso_dias: number; bloqueado_fiado: boolean
  motivo_bloqueio: string | null; observacoes_financeiras: string | null
  data_ultima_compra_fiada: string | null; data_ultimo_pagamento: string | null
  saldo_credito: number; status_credito: string
}
type Conta = {
  id: string; numero_doc: string | null; parcela_numero: number; total_parcelas: number
  data_vencimento: string; valor_original: number; valor_aberto: number; status: string; origem: string
}
type Credito = {
  id: string; valor_original: number; saldo_disponivel: number; origem: string; status: string; created_at: string
}
type Historico = {
  id: string; tipo: string; descricao: string | null; operador_nome: string | null; created_at: string
}

const STATUS_COR: Record<string,string> = {
  aberto:'text-blue-400', parcial:'text-yellow-400', recebido:'text-green-400',
  vencido:'text-red-400', cancelado:'text-gray-500', renegociado:'text-purple-400'
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtDt(d: string) { const s = d.split('T')[0].split('-'); return `${s[2]}/${s[1]}/${s[0]}` }

export default function ClienteDetalheClient({
  cliente, contasIniciais, creditosIniciais, historicoIniciais, empresaId, operador
}: {
  cliente: Cliente; contasIniciais: Conta[]; creditosIniciais: Credito[]
  historicoIniciais: Historico[]; empresaId: string; operador: string
}) {
  const sb = createClient()
  const [tab, setTab] = useState<'financeiro'|'contas'|'creditos'|'historico'>('financeiro')
  const [cli, setCli] = useState(cliente)
  const [salvando, setSalvando] = useState(false)

  async function salvarFinanceiro() {
    setSalvando(true)
    try {
      const { error } = await sb.from('clientes').update({
        permite_fiado: cli.permite_fiado,
        limite_credito: cli.limite_credito,
        bloqueado_fiado: cli.bloqueado_fiado,
        motivo_bloqueio: cli.motivo_bloqueio,
        observacoes_financeiras: cli.observacoes_financeiras,
        status_credito: cli.bloqueado_fiado ? 'bloqueado' : cli.permite_fiado ? 'liberado' : 'restrito',
      }).eq('id', cli.id)
      if (error) throw error
      alert('Configurações financeiras salvas!')
    } catch(e:any) { alert('Erro: ' + e.message) }
    finally { setSalvando(false) }
  }

  const totalAberto  = contasIniciais.filter(c => ['aberto','parcial','vencido'].includes(c.status)).reduce((s,c) => s + c.valor_aberto, 0)
  const totalVencido = contasIniciais.filter(c => c.status === 'vencido').reduce((s,c) => s + c.valor_aberto, 0)
  const creditoDisp  = creditosIniciais.filter(c => ['disponivel','parcial'].includes(c.status)).reduce((s,c) => s + c.saldo_disponivel, 0)

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/clientes" className="text-gray-500 hover:text-white text-sm">← Clientes</Link>
          </div>
          <h1 className="text-white text-xl font-semibold mt-1">{cli.nome}</h1>
          <p className="text-gray-500 text-sm">{cli.cpf_cnpj ?? ''} {cli.telefone ? `· ${cli.telefone}` : ''}</p>
        </div>
        <div className="flex gap-2">
          <span className={`text-xs px-2 py-1 rounded-full ${
            cli.bloqueado_fiado ? 'bg-red-500/20 text-red-400' :
            cli.permite_fiado   ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'
          }`}>
            {cli.bloqueado_fiado ? 'Bloqueado' : cli.permite_fiado ? 'Fiado Liberado' : 'Sem Fiado'}
          </span>
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-500 text-xs">Limite de Crédito</p>
          <p className="text-blue-400 font-bold text-lg mt-1">{fmt(cli.limite_credito)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-500 text-xs">Em Aberto (Fiado)</p>
          <p className="text-yellow-400 font-bold text-lg mt-1">{fmt(totalAberto)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-500 text-xs">Vencido</p>
          <p className="text-red-400 font-bold text-lg mt-1">{fmt(totalVencido)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-500 text-xs">Crédito Disponível</p>
          <p className="text-green-400 font-bold text-lg mt-1">{fmt(creditoDisp)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {(['financeiro','contas','creditos','historico'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize transition-colors ${tab === t ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'}`}>
            {t === 'financeiro' ? 'Configuração Financeira' : t === 'contas' ? 'Contas a Receber' : t === 'creditos' ? 'Créditos' : 'Histórico'}
          </button>
        ))}
      </div>

      {/* Tab Financeiro */}
      {tab === 'financeiro' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4 max-w-lg">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-white text-sm font-medium">Permite Fiado</label>
              <p className="text-gray-500 text-xs">Habilitar compras sem pagamento imediato</p>
            </div>
            <button onClick={() => setCli(p => ({ ...p, permite_fiado: !p.permite_fiado }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${cli.permite_fiado ? 'bg-blue-600' : 'bg-gray-700'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${cli.permite_fiado ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          <div>
            <label className="text-gray-400 text-xs">Limite de Crédito (R$)</label>
            <input type="number" value={cli.limite_credito}
              onChange={e => setCli(p => ({ ...p, limite_credito: parseFloat(e.target.value) || 0 }))}
              className="w-full mt-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-white text-sm font-medium">Bloqueado para Fiado</label>
              <p className="text-gray-500 text-xs">Impede novas compras fiadas</p>
            </div>
            <button onClick={() => setCli(p => ({ ...p, bloqueado_fiado: !p.bloqueado_fiado }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${cli.bloqueado_fiado ? 'bg-red-600' : 'bg-gray-700'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${cli.bloqueado_fiado ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {cli.bloqueado_fiado && (
            <div>
              <label className="text-gray-400 text-xs">Motivo do Bloqueio</label>
              <input value={cli.motivo_bloqueio ?? ''} onChange={e => setCli(p => ({ ...p, motivo_bloqueio: e.target.value }))}
                className="w-full mt-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
            </div>
          )}

          <div>
            <label className="text-gray-400 text-xs">Observações Financeiras</label>
            <textarea value={cli.observacoes_financeiras ?? ''} rows={3}
              onChange={e => setCli(p => ({ ...p, observacoes_financeiras: e.target.value }))}
              className="w-full mt-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm resize-none" />
          </div>

          {(cli.data_ultima_compra_fiada || cli.data_ultimo_pagamento) && (
            <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
              {cli.data_ultima_compra_fiada && <p>Última compra fiada: <span className="text-gray-300">{fmtDt(cli.data_ultima_compra_fiada)}</span></p>}
              {cli.data_ultimo_pagamento     && <p>Último pagamento: <span className="text-gray-300">{fmtDt(cli.data_ultimo_pagamento)}</span></p>}
            </div>
          )}

          <button onClick={salvarFinanceiro} disabled={salvando}
            className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {salvando ? 'Salvando...' : 'Salvar Configurações'}
          </button>
        </div>
      )}

      {/* Tab Contas */}
      {tab === 'contas' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {contasIniciais.length === 0
            ? <p className="text-center py-10 text-gray-600">Nenhuma conta a receber</p>
            : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800 text-xs uppercase">
                    <th className="px-4 py-3 text-left">Documento</th>
                    <th className="px-4 py-3 text-left">Origem</th>
                    <th className="px-4 py-3 text-center">Vencimento</th>
                    <th className="px-4 py-3 text-right">Valor</th>
                    <th className="px-4 py-3 text-right">Em Aberto</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {contasIniciais.map(c => (
                    <tr key={c.id} className="text-gray-300 hover:bg-gray-800/30">
                      <td className="px-4 py-2.5">
                        {c.numero_doc ?? '—'}
                        {c.total_parcelas > 1 && <span className="text-gray-600 text-xs ml-1">{c.parcela_numero}/{c.total_parcelas}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs capitalize">{c.origem}</td>
                      <td className="px-4 py-2.5 text-center text-gray-400">{fmtDt(c.data_vencimento)}</td>
                      <td className="px-4 py-2.5 text-right">{fmt(c.valor_original)}</td>
                      <td className={`px-4 py-2.5 text-right font-medium ${STATUS_COR[c.status]}`}>
                        {c.valor_aberto > 0 ? fmt(c.valor_aberto) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-xs capitalize ${STATUS_COR[c.status]}`}>{c.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </div>
      )}

      {/* Tab Créditos */}
      {tab === 'creditos' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {creditosIniciais.length === 0
            ? <p className="text-center py-10 text-gray-600">Nenhum crédito registrado</p>
            : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800 text-xs uppercase">
                    <th className="px-4 py-3 text-left">Origem</th>
                    <th className="px-4 py-3 text-center">Data</th>
                    <th className="px-4 py-3 text-right">Valor Original</th>
                    <th className="px-4 py-3 text-right">Saldo</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {creditosIniciais.map(c => (
                    <tr key={c.id} className="text-gray-300 hover:bg-gray-800/30">
                      <td className="px-4 py-2.5 capitalize">{c.origem}</td>
                      <td className="px-4 py-2.5 text-center text-gray-400">{fmtDt(c.created_at)}</td>
                      <td className="px-4 py-2.5 text-right">{fmt(c.valor_original)}</td>
                      <td className="px-4 py-2.5 text-right text-green-400 font-medium">{fmt(c.saldo_disponivel)}</td>
                      <td className="px-4 py-2.5 text-center text-xs capitalize text-gray-400">{c.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </div>
      )}

      {/* Tab Histórico */}
      {tab === 'historico' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl divide-y divide-gray-800">
          {historicoIniciais.length === 0
            ? <p className="text-center py-10 text-gray-600">Sem histórico de cobrança</p>
            : historicoIniciais.map(h => (
              <div key={h.id} className="px-4 py-3 flex items-start gap-3">
                <span className="text-gray-500 text-xs mt-0.5">{fmtDt(h.created_at)}</span>
                <div className="flex-1">
                  <p className="text-gray-400 text-sm capitalize">{h.tipo}</p>
                  {h.descricao && <p className="text-gray-600 text-xs mt-0.5">{h.descricao}</p>}
                </div>
                <span className="text-gray-600 text-xs">{h.operador_nome ?? ''}</span>
              </div>
            ))
          }
        </div>
      )}
    </div>
  )
}
