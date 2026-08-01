'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ETAPA_INFO, type Etapa } from '@/lib/pedidos/etapas'

// Histórico de alterações — quem mudou o quê, quando, e se foi pessoa ou
// sincronização.
//
// A separação pessoa/automático é o filtro mais útil da tela: sem ela,
// procurar "quem mexeu neste pedido" vira garimpo no meio de centenas de
// eventos que a sincronização do canal gerou sozinha.

type Evento = {
  id: string; fonte: string; referencia_id: string; tipo: string
  etapa_anterior: string | null; etapa_nova: string | null
  descricao: string; observacao: string | null
  usuario_nome: string | null; automatico: boolean; created_at: string
  pedidoNumero: string | null; pedidoCliente: string | null
}

const hoje = () => new Date().toISOString().slice(0, 10)
const diasAtras = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

export default function AuditoriaPedidosClient({ usuarios }: {
  usuarios: { id: string; nome: string | null }[]
}) {
  const [de, setDe] = useState(diasAtras(30))
  const [ate, setAte] = useState(hoje())
  const [usuario, setUsuario] = useState('')
  const [fonte, setFonte] = useState('')
  const [origem, setOrigem] = useState('')
  const [pagina, setPagina] = useState(0)

  const [eventos, setEventos] = useState<Evento[] | null>(null)
  const [total, setTotal] = useState(0)
  const [porPagina, setPorPagina] = useState(100)
  const [erro, setErro] = useState('')

  useEffect(() => {
    setEventos(null); setErro('')
    const sp = new URLSearchParams({ de, ate, pagina: String(pagina) })
    if (usuario) sp.set('usuario', usuario)
    if (fonte) sp.set('fonte', fonte)
    if (origem) sp.set('origem', origem)
    fetch(`/api/pedidos/auditoria?${sp}`).then(r => r.json()).then(d => {
      if (!d.ok) { setErro(d.erro ?? 'Não foi possível carregar o histórico'); setEventos([]); return }
      setEventos(d.eventos); setTotal(d.total); setPorPagina(d.porPagina)
    }).catch(() => { setErro('Falha de conexão'); setEventos([]) })
  }, [de, ate, usuario, fonte, origem, pagina])

  // Trocar filtro com a paginação avançada mostraria uma página vazia.
  function mudarFiltro(fn: () => void) { fn(); setPagina(0) }

  const ultimaPagina = Math.max(0, Math.ceil(total / porPagina) - 1)

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <Link href="/dashboard/pedidos" className="hover:text-gray-600">Pedidos</Link>
        <span>›</span><span className="text-gray-600 font-medium">Histórico</span>
      </div>

      <div className="mb-4">
        <h1 className="text-gray-900 text-xl font-semibold">Histórico de alterações</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Toda mudança de etapa fica registrada aqui, com autor e horário. Nada nesta lista pode ser editado ou apagado.
        </p>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] text-gray-500 mb-1">De</label>
          <input type="date" value={de} onChange={e => mudarFiltro(() => setDe(e.target.value))}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-900" />
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-1">Até</label>
          <input type="date" value={ate} onChange={e => mudarFiltro(() => setAte(e.target.value))}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-900" />
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-1">Quem fez</label>
          <select value={usuario} onChange={e => mudarFiltro(() => setUsuario(e.target.value))}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-900">
            <option value="">Qualquer pessoa</option>
            {usuarios.map(u => <option key={u.id} value={u.id}>{u.nome ?? u.id.slice(0, 8)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-1">Origem do pedido</label>
          <select value={fonte} onChange={e => mudarFiltro(() => setFonte(e.target.value))}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-900">
            <option value="">Todas</option>
            <option value="venda">PDV / aplicativo</option>
            <option value="marketplace">Marketplace</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-1">Feito por</label>
          <select value={origem} onChange={e => mudarFiltro(() => setOrigem(e.target.value))}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-900">
            <option value="">Pessoa ou sistema</option>
            <option value="pessoa">Só pessoas</option>
            <option value="automatico">Só sincronização</option>
          </select>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100">
          <p className="text-xs text-gray-500">
            {eventos === null ? 'Carregando...' : `${total} evento(s) no período`}
          </p>
        </div>

        {erro && <p className="px-4 py-6 text-sm text-red-600">{erro}</p>}

        {eventos !== null && eventos.length === 0 && !erro && (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-gray-400">Nenhum evento com os filtros atuais.</p>
            <p className="text-xs text-gray-400 mt-1">
              O registro começa a partir do momento em que o controle de etapas foi ativado — o que aconteceu antes disso não foi gravado.
            </p>
          </div>
        )}

        {eventos !== null && eventos.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600 whitespace-nowrap">Quando</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600">Pedido</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600">Mudança</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600">Quem</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-600">Observação</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {eventos.map(ev => {
                  const info = ev.etapa_nova ? ETAPA_INFO[ev.etapa_nova as Etapa] : null
                  return (
                    <tr key={ev.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-600 text-xs whitespace-nowrap">
                        {new Date(ev.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="px-3 py-2">
                        <p className="text-gray-900 font-mono text-xs">{ev.pedidoNumero ?? '—'}</p>
                        {ev.pedidoCliente && <p className="text-[11px] text-gray-400 truncate max-w-[160px]">{ev.pedidoCliente}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${info?.cor ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                          {ev.descricao}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {ev.automatico
                          ? <span className="text-gray-400">sincronização</span>
                          : <span className="text-gray-700">{ev.usuario_nome ?? 'usuário removido'}</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500 max-w-[240px]">{ev.observacao ?? '—'}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <a href={`/dashboard/pedidos/${ev.fonte}/${ev.referencia_id}`}
                          className="text-xs text-blue-600 hover:underline">abrir →</a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > porPagina && (
          <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between">
            <button onClick={() => setPagina(p => Math.max(0, p - 1))} disabled={pagina === 0}
              className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-30">← anterior</button>
            <span className="text-xs text-gray-500">página {pagina + 1} de {ultimaPagina + 1}</span>
            <button onClick={() => setPagina(p => Math.min(ultimaPagina, p + 1))} disabled={pagina >= ultimaPagina}
              className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-30">próxima →</button>
          </div>
        )}
      </div>
    </div>
  )
}
