'use client'

import { useState } from 'react'
import RegrasWhatsApp from './RegrasWhatsApp'
import RegrasAlertas from './RegrasAlertas'

export type ProdutoRef = { produto_id: string; produto_nome: string; produto_sku: string | null }

export type Automacao = {
  id: string
  empresa_id: string
  nome: string
  tipo: string
  ativa: boolean
  observacao: string | null
  produtos: ProdutoRef[] | null
  forma_pagamento: string | null
  canal_venda: string | null
  marketplace_canal_id: string | null
  cliente_id: string | null
  cliente_nome: string | null
  modelo_fiscal: string | null
  numero_destino: string | null
  horario_envio: string | null
  tipo_relatorio: string | null
  dias_alerta: number | null
  limite_estoque: number | null
  ultima_execucao: string | null
  total_execucoes: number
  ultimo_status: string | null
  ultimo_erro: string | null
  created_at: string
}

export type Canal = { id: string; nome: string; plataforma: string }

type ModuloId = 'fiscal' | 'whatsapp' | 'reposicao' | 'alertas'

const MODULOS: { id: ModuloId; icone: string; titulo: string; descricao: string; cor: string; disponivel: boolean }[] = [
  { id: 'fiscal', icone: '📄', titulo: 'Emissão Fiscal', descricao: 'Emitir NFC-e automaticamente por produto, forma de pagamento, canal ou cliente.', cor: 'blue', disponivel: false },
  { id: 'whatsapp', icone: '💬', titulo: 'WhatsApp', descricao: 'Relatórios, alertas e avisos automáticos direto no WhatsApp.', cor: 'green', disponivel: true },
  { id: 'reposicao', icone: '🔄', titulo: 'Reposição de Estoque', descricao: 'Alertas de mínimo, pedido automático e análise de giro.', cor: 'amber', disponivel: false },
  { id: 'alertas', icone: '🔔', titulo: 'Alertas em Geral', descricao: 'Margem baixa, produto parado, inadimplência e meta de vendas.', cor: 'red', disponivel: true },
]

const CORES: Record<string, { badge: string; bg: string }> = {
  blue: { badge: 'bg-blue-50 text-blue-700 border-blue-200', bg: 'bg-blue-50' },
  green: { badge: 'bg-green-50 text-green-700 border-green-200', bg: 'bg-green-50' },
  amber: { badge: 'bg-amber-50 text-amber-700 border-amber-200', bg: 'bg-amber-50' },
  red: { badge: 'bg-red-50 text-red-700 border-red-200', bg: 'bg-red-50' },
}

export default function AutomacoesClient({ empresaId, automacoesIniciais, canais }: {
  empresaId: string; automacoesIniciais: Automacao[]; canais: Canal[]
}) {
  const [automacoes, setAutomacoes] = useState<Automacao[]>(automacoesIniciais)
  const [aberto, setAberto] = useState<ModuloId | null>(null)

  function toggle(id: ModuloId) {
    setAberto(prev => prev === id ? null : id)
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <span className="text-gray-600 font-medium">automações</span>
      </div>

      <div className="mb-5">
        <h1 className="text-gray-900 text-xl font-semibold flex items-center gap-2">⚡ Automações</h1>
        <p className="text-gray-500 text-sm mt-0.5">Centralize regras automáticas de fiscal, relatórios por WhatsApp, reposição de estoque e alertas.</p>
      </div>

      <div className="rounded-2xl bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 border border-indigo-100 px-5 py-4 mb-6">
        <p className="text-sm font-semibold text-indigo-900">✨ Configure o sistema para trabalhar por você</p>
        <p className="text-xs text-indigo-700 mt-0.5">Cada módulo lista suas regras ativas e permite criar novas. Depois de configuradas, elas rodam sozinhas — uma checagem automática roda a cada poucos minutos.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {MODULOS.map(m => {
          const cor = CORES[m.cor]
          const emAberto = aberto === m.id
          const qtdAtivas = automacoes.filter(a => moduloDoTipo(a.tipo) === m.id && a.ativa).length
          return (
            <div key={m.id} className={`bg-white border rounded-2xl overflow-hidden transition-all ${emAberto ? 'sm:col-span-2 border-gray-300' : 'border-gray-200'}`}>
              <button onClick={() => m.disponivel && toggle(m.id)}
                disabled={!m.disponivel}
                className={`w-full flex items-center justify-between px-5 py-4 text-left ${m.disponivel ? 'hover:bg-gray-50' : 'cursor-not-allowed opacity-70'}`}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{m.icone}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900 text-sm">{m.titulo}</p>
                      {qtdAtivas > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${cor.badge}`}>{qtdAtivas} ativa{qtdAtivas > 1 ? 's' : ''}</span>}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{m.descricao}</p>
                  </div>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full border flex-shrink-0 ${m.disponivel ? cor.badge : 'bg-gray-50 text-gray-400 border-gray-200'}`}>
                  {m.disponivel ? (emAberto ? 'Fechar' : 'Configurar') : 'Em breve'}
                </span>
              </button>

              {emAberto && (
                <div className="border-t border-gray-200 px-5 py-5">
                  {m.id === 'whatsapp' && (
                    <RegrasWhatsApp
                      empresaId={empresaId}
                      canais={canais}
                      automacoes={automacoes.filter(a => moduloDoTipo(a.tipo) === 'whatsapp')}
                      onChange={novas => setAutomacoes(prev => [...prev.filter(a => moduloDoTipo(a.tipo) !== 'whatsapp'), ...novas])}
                    />
                  )}
                  {m.id === 'alertas' && (
                    <RegrasAlertas
                      empresaId={empresaId}
                      automacoes={automacoes.filter(a => moduloDoTipo(a.tipo) === 'alertas')}
                      onChange={novas => setAutomacoes(prev => [...prev.filter(a => moduloDoTipo(a.tipo) !== 'alertas'), ...novas])}
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function moduloDoTipo(tipo: string): ModuloId {
  if (tipo.startsWith('emissao_fiscal_')) return 'fiscal'
  if (tipo.startsWith('whatsapp_')) return 'whatsapp'
  if (tipo.startsWith('reposicao_')) return 'reposicao'
  return 'alertas'
}
