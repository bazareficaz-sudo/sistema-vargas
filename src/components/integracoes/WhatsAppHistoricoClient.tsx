'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type Mensagem = {
  id: string; cliente_nome: string | null; telefone: string
  tipo: string; conteudo: string; status: string
  status_entrega: string | null; erro: string | null
  operador_nome: string | null; created_at: string; enviado_em: string | null
  referencia_tipo: string | null; referencia_id: string | null
}

const STATUS_CLS: Record<string, string> = {
  enviado:   'bg-green-100 text-green-700',
  pendente:  'bg-yellow-100 text-yellow-700',
  erro:      'bg-red-100 text-red-700',
  cancelado: 'bg-gray-100 text-gray-500',
  reenviado: 'bg-blue-100 text-blue-700',
  recebida:  'bg-purple-100 text-purple-700',
}

const ENTREGA_CLS: Record<string, string> = {
  enviado:   'text-gray-400',
  entregue:  'text-blue-500',
  lido:      'text-green-500',
}

const TIPO_LABEL: Record<string, string> = {
  cupom: 'Cupom', cobranca: 'Cobrança', orcamento: 'Orçamento',
  lista_produtos: 'Produtos', teste: 'Teste', manual: 'Manual',
  recebida: 'Recebida', confirmacao_pag: 'Confirmação Pgto',
  lembrete_venc: 'Lembrete Venc.', pos_venda: 'Pós-Venda',
}

export default function WhatsAppHistoricoClient({
  mensagens, total, pagina, totalPaginas, stats, filtros,
}: {
  mensagens: Mensagem[]
  total: number; pagina: number; totalPaginas: number
  stats: { total: number; enviados: number; erros: number; recebidas: number }
  filtros: { status: string; tipo: string; q: string }
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [expandido, setExpandido] = useState<string | null>(null)
  const [q, setQ] = useState(filtros.q)

  function navegar(params: Record<string, string>) {
    const sp = new URLSearchParams()
    if (filtros.status) sp.set('status', filtros.status)
    if (filtros.tipo) sp.set('tipo', filtros.tipo)
    if (q) sp.set('q', q)
    Object.entries(params).forEach(([k, v]) => v ? sp.set(k, v) : sp.delete(k))
    sp.delete('pagina')
    startTransition(() => router.push(`/dashboard/integracoes/whatsapp/historico?${sp}`))
  }

  function filtrar(key: string, val: string) {
    navegar({ [key]: val })
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <a href="/dashboard/integracoes/whatsapp" className="hover:text-gray-600">WhatsApp</a><span>›</span>
        <span className="text-gray-600 font-medium">Histórico</span>
      </div>

      <h1 className="text-gray-900 text-xl font-semibold mb-6">Histórico de Mensagens</h1>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total enviadas', val: stats.total, color: 'text-gray-900' },
          { label: 'Enviadas com sucesso', val: stats.enviados, color: 'text-green-600' },
          { label: 'Com erro', val: stats.erros, color: 'text-red-600' },
          { label: 'Recebidas', val: stats.recebidas, color: 'text-purple-600' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.val.toLocaleString('pt-BR')}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-center">
        <input value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && navegar({ q })}
          placeholder="Buscar por cliente ou telefone..."
          className="flex-1 min-w-48 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
        <select value={filtros.status} onChange={e => filtrar('status', e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
          <option value="">Todos os status</option>
          <option value="enviado">Enviado</option>
          <option value="pendente">Pendente</option>
          <option value="erro">Erro</option>
          <option value="recebida">Recebida</option>
          <option value="cancelado">Cancelado</option>
        </select>
        <select value={filtros.tipo} onChange={e => filtrar('tipo', e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
          <option value="">Todos os tipos</option>
          {Object.entries(TIPO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <a href="/dashboard/integracoes/whatsapp/historico" className="text-xs text-gray-400 hover:text-gray-600">Limpar</a>
      </div>

      {/* Tabela */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {mensagens.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-3xl mb-3">💬</p>
            <p className="text-gray-500">Nenhuma mensagem encontrada</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Data</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Cliente/Telefone</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">Tipo</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-20">Entrega</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-24">Operador</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {mensagens.map(m => (
                <>
                  <tr key={m.id} className="group hover:bg-gray-50 cursor-pointer" onClick={() => setExpandido(expandido === m.id ? null : m.id)}>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(m.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3">
                      {m.cliente_nome && <p className="font-medium text-gray-900 text-sm">{m.cliente_nome}</p>}
                      <p className="text-xs text-gray-400 font-mono">{m.telefone}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                        {TIPO_LABEL[m.tipo] ?? m.tipo}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_CLS[m.status] ?? STATUS_CLS.pendente}`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {m.status_entrega && (
                        <span className={`font-medium ${ENTREGA_CLS[m.status_entrega] ?? 'text-gray-400'}`}>
                          {m.status_entrega === 'lido' ? '✓✓ Lido' : m.status_entrega === 'entregue' ? '✓✓' : '✓'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{m.operador_nome?.split('@')[0] ?? '—'}</td>
                  </tr>
                  {expandido === m.id && (
                    <tr key={`${m.id}-exp`} className="bg-gray-50">
                      <td colSpan={6} className="px-6 py-4">
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-gray-600">Mensagem:</p>
                          <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans bg-white border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                            {m.conteudo}
                          </pre>
                          {m.erro && (
                            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                              <span className="font-medium">Erro:</span> {m.erro}
                            </div>
                          )}
                          {m.referencia_tipo && (
                            <p className="text-xs text-gray-400">Referência: {m.referencia_tipo} #{m.referencia_id?.slice(0, 8)}</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Paginação */}
      {totalPaginas > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">{total} mensagens</p>
          <div className="flex gap-2">
            {pagina > 1 && (
              <button onClick={() => navegar({ pagina: String(pagina - 1) })}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">← Anterior</button>
            )}
            <span className="px-3 py-1.5 text-sm text-gray-600">{pagina}/{totalPaginas}</span>
            {pagina < totalPaginas && (
              <button onClick={() => navegar({ pagina: String(pagina + 1) })}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Próxima →</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
