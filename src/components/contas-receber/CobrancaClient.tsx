'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import EnviarAtualizacaoContaModal from './EnviarAtualizacaoContaModal'

type Conta = {
  id: string; cliente_id: string | null; cliente_nome: string
  data_vencimento: string; valor_aberto: number; status: string
  numero_doc: string | null
}
type ClienteMap = {
  id: string; nome: string; cpf_cnpj: string | null; telefone: string | null
  saldo_devedor: number; valor_vencido: number; bloqueado_fiado: boolean
  cobranca_whatsapp_ativa: boolean
}
type Historico = {
  id: string; cliente_id: string; tipo: string; descricao: string | null
  promessa_data: string | null; promessa_valor: number | null; operador_nome: string | null; created_at: string
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtDt(d: string) { const [y,m,dia] = d.split('T')[0].split('-'); return `${dia}/${m}/${y}` }
function diasAtraso(d: string) {
  const v = new Date(d.split('T')[0] + 'T00:00:00')
  const h = new Date(); h.setHours(0,0,0,0)
  return Math.max(0, Math.floor((h.getTime() - v.getTime()) / 86400000))
}

type GrupoCliente = {
  cliente_id: string | null; cliente_nome: string; telefone: string | null
  total_vencido: number; contas: Conta[]; maior_atraso: number
}

export default function CobrancaClient({
  empresaId, operador, contasVencidas, historicoInicial, clientes
}: {
  empresaId: string; operador: string; contasVencidas: Conta[]
  historicoInicial: Historico[]; clientes: ClienteMap[]
}) {
  const sb = createClient()
  const [historico, setHistorico] = useState<Historico[]>(historicoInicial)
  const [filtroAtraso, setFiltroAtraso] = useState('todos')
  const [busca, setBusca] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)

  const [modalCob, setModalCob] = useState<GrupoCliente | null>(null)
  const [cobTipo, setCobTipo] = useState('whatsapp')
  const [cobDesc, setCobDesc] = useState('')
  const [promData, setPromData] = useState('')
  const [promValor, setPromValor] = useState('')
  const [salvando, setSalvando] = useState(false)

  // Envio da situação da conta: relatório de todas as compras em aberto,
  // com o total, o que vence e o que já venceu.
  const [modalAtualizacao, setModalAtualizacao] = useState<GrupoCliente | null>(null)
  const [modalBloquear, setModalBloquear] = useState<GrupoCliente | null>(null)
  const [motivoBloqueio, setMotivoBloqueio] = useState('')
  const [salvandoBlq, setSalvandoBlq] = useState(false)

  const clienteMap = useMemo(() => {
    const m: Record<string, ClienteMap> = {}
    clientes.forEach(c => { m[c.id] = c })
    return m
  }, [clientes])

  const grupos: GrupoCliente[] = useMemo(() => {
    const map: Record<string, GrupoCliente> = {}
    contasVencidas.forEach(c => {
      const key = c.cliente_id ?? c.cliente_nome
      if (!map[key]) {
        const cli = c.cliente_id ? clienteMap[c.cliente_id] : null
        map[key] = { cliente_id: c.cliente_id, cliente_nome: c.cliente_nome, telefone: cli?.telefone ?? null, total_vencido: 0, contas: [], maior_atraso: 0 }
      }
      const atraso = diasAtraso(c.data_vencimento)
      map[key].total_vencido += c.valor_aberto
      map[key].maior_atraso = Math.max(map[key].maior_atraso, atraso)
      map[key].contas.push(c)
    })
    return Object.values(map).sort((a, b) => b.total_vencido - a.total_vencido)
  }, [contasVencidas, clienteMap])

  const gruposFiltrados = useMemo(() => {
    let list = [...grupos]
    if (filtroAtraso === '1-7')   list = list.filter(g => g.maior_atraso >= 1  && g.maior_atraso <= 7)
    if (filtroAtraso === '8-15')  list = list.filter(g => g.maior_atraso >= 8  && g.maior_atraso <= 15)
    if (filtroAtraso === '16-30') list = list.filter(g => g.maior_atraso >= 16 && g.maior_atraso <= 30)
    if (filtroAtraso === '30+')   list = list.filter(g => g.maior_atraso > 30)
    if (busca) {
      const b = busca.toLowerCase()
      list = list.filter(g => g.cliente_nome.toLowerCase().includes(b) || (g.telefone ?? '').includes(b))
    }
    return list
  }, [grupos, filtroAtraso, busca])

  function whatsappLink(tel: string, nome: string, valor: number) {
    const numero = tel.replace(/\D/g,'')
    const msg = encodeURIComponent(`Olá ${nome}, passando para lembrar sobre seu débito de ${fmt(valor)} em aberto. Podemos combinar o pagamento?`)
    return `https://wa.me/55${numero}?text=${msg}`
  }

  async function registrarCobranca() {
    if (!modalCob) return
    setSalvando(true)
    try {
      const registros = modalCob.contas.map(c => ({
        empresa_id: empresaId, cliente_id: modalCob.cliente_id, conta_id: c.id,
        tipo: cobTipo, descricao: cobDesc || `Cobrança via ${cobTipo}`,
        promessa_data: promData || null, promessa_valor: promValor ? parseFloat(promValor.replace(',','.')) : null,
        operador_nome: operador,
      }))
      const { data, error } = await sb.from('cobranca_historico').insert(registros).select()
      if (error) throw error
      setHistorico(p => [...(data as Historico[]), ...p])
      setModalCob(null); setCobDesc(''); setPromData(''); setPromValor(''); setCobTipo('whatsapp')
    } catch(e:any) { alert('Erro: ' + e.message) }
    finally { setSalvando(false) }
  }

  async function bloquearCliente() {
    if (!modalBloquear?.cliente_id) return
    setSalvandoBlq(true)
    try {
      await sb.from('clientes').update({ bloqueado_fiado: true, motivo_bloqueio: motivoBloqueio || 'Inadimplência', status_credito: 'bloqueado' }).eq('id', modalBloquear.cliente_id)
      await sb.from('cobranca_historico').insert({ empresa_id: empresaId, cliente_id: modalBloquear.cliente_id, tipo: 'bloqueio', descricao: `Bloqueado: ${motivoBloqueio || 'Inadimplência'}`, operador_nome: operador })
      setModalBloquear(null); setMotivoBloqueio('')
    } catch(e:any) { alert('Erro: ' + e.message) }
    finally { setSalvandoBlq(false) }
  }

  const totalInadimplente = gruposFiltrados.reduce((s,g) => s + g.total_vencido, 0)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-slate-900 text-xl font-bold">Cobrança de Clientes</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {gruposFiltrados.length} cliente(s) com débito vencido —
            <span className="text-red-600 font-semibold ml-1">{fmt(totalInadimplente)}</span>
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar cliente ou telefone..."
          className="bg-white border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm w-56 focus:outline-none focus:border-blue-400 placeholder-slate-400 shadow-sm" />
        <select value={filtroAtraso} onChange={e => setFiltroAtraso(e.target.value)}
          className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-sm shadow-sm">
          <option value="todos">Qualquer atraso</option>
          <option value="1-7">1–7 dias</option>
          <option value="8-15">8–15 dias</option>
          <option value="16-30">16–30 dias</option>
          <option value="30+">Mais de 30 dias</option>
        </select>
      </div>

      {/* Lista de clientes inadimplentes */}
      <div className="space-y-2">
        {gruposFiltrados.length === 0 && (
          <div className="bg-white border border-slate-100 rounded-2xl p-10 text-center shadow-sm">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-slate-500">Nenhum cliente inadimplente encontrado</p>
          </div>
        )}
        {gruposFiltrados.map(g => {
          const key = g.cliente_id ?? g.cliente_nome
          const ultCobranca = historico.find(h => h.cliente_id === g.cliente_id)
          const cli = g.cliente_id ? clienteMap[g.cliente_id] : null
          return (
            <div key={key} className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
              <div
                className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => setExpandido(expandido === key ? null : key)}>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-slate-800 font-semibold">{g.cliente_nome}</p>
                    {cli?.bloqueado_fiado && (
                      <span className="text-xs bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded-full">Bloqueado</span>
                    )}
                  </div>
                  <p className="text-slate-400 text-xs mt-0.5">
                    {g.telefone ?? 'Sem telefone'} · {g.contas.length} conta(s) · maior atraso: {g.maior_atraso}d
                  </p>
                  {ultCobranca && (
                    <p className="text-slate-400 text-xs mt-0.5">Última cobrança: {fmtDt(ultCobranca.created_at)}</p>
                  )}
                </div>
                <div className="text-right mr-4">
                  <p className="text-red-600 font-bold text-lg">{fmt(g.total_vencido)}</p>
                  <p className="text-slate-400 text-xs">{g.maior_atraso}d de atraso</p>
                </div>
                <div className="flex gap-2">
                  {g.telefone && cli?.cobranca_whatsapp_ativa !== false && (
                    <a href={whatsappLink(g.telefone, g.cliente_nome, g.total_vencido)}
                      target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs rounded-lg font-medium">
                      WhatsApp
                    </a>
                  )}
                  {g.cliente_id && cli?.cobranca_whatsapp_ativa !== false && (
                    <button onClick={e => { e.stopPropagation(); setModalAtualizacao(g) }}
                      title="Enviar a situação da conta em PDF pelo WhatsApp"
                      className="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white text-xs rounded-lg font-medium">
                      📄 Situação da conta
                    </button>
                  )}
                  {g.cliente_id && cli?.cobranca_whatsapp_ativa === false && (
                    <span title="Este cliente desativou a cobrança automática via WhatsApp"
                      className="px-3 py-1.5 bg-gray-100 text-gray-400 text-xs rounded-lg font-medium">
                      🔕 Cobrança desativada
                    </span>
                  )}
                  <button onClick={e => { e.stopPropagation(); setModalCob(g) }}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg font-medium">
                    Registrar
                  </button>
                  {!cli?.bloqueado_fiado && g.cliente_id && (
                    <button onClick={e => { e.stopPropagation(); setModalBloquear(g) }}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-lg font-medium">
                      Bloquear
                    </button>
                  )}
                </div>
                <span className="text-slate-400 text-sm">{expandido === key ? '▲' : '▼'}</span>
              </div>

              {expandido === key && (
                <div className="border-t border-slate-100">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 bg-slate-50 border-b border-slate-100">
                        <th className="px-5 py-2 text-left font-medium">Documento</th>
                        <th className="px-5 py-2 text-center font-medium">Vencimento</th>
                        <th className="px-5 py-2 text-center font-medium">Atraso</th>
                        <th className="px-5 py-2 text-right font-medium">Em Aberto</th>
                        <th className="px-5 py-2 text-center font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.contas.map(c => (
                        <tr key={c.id} className="text-slate-600 border-b border-slate-50 hover:bg-slate-50">
                          <td className="px-5 py-2">{c.numero_doc ?? '—'}</td>
                          <td className="px-5 py-2 text-center">{fmtDt(c.data_vencimento)}</td>
                          <td className="px-5 py-2 text-center text-red-500 font-medium">{diasAtraso(c.data_vencimento)}d</td>
                          <td className="px-5 py-2 text-right font-semibold text-slate-800">{fmt(c.valor_aberto)}</td>
                          <td className="px-5 py-2 text-center">
                            <span className="bg-red-50 text-red-600 border border-red-100 px-1.5 py-0.5 rounded-full">{c.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {historico.filter(h => h.cliente_id === g.cliente_id).slice(0,3).map(h => (
                    <div key={h.id} className="px-5 py-2 border-t border-slate-50 flex items-center gap-2 text-xs text-slate-400">
                      <span className="text-slate-500 capitalize font-medium">{h.tipo}</span>
                      <span>·</span><span>{h.descricao}</span>
                      <span>·</span><span>{fmtDt(h.created_at)}</span>
                      <span>·</span><span>{h.operador_nome}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* MODAL REGISTRAR COBRANÇA */}
      {modalCob && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-slate-900 font-semibold">Registrar Contato — {modalCob.cliente_nome}</h2>
              <button onClick={() => setModalCob(null)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-slate-500 text-xs font-medium">Tipo de Contato</label>
                <select value={cobTipo} onChange={e => setCobTipo(e.target.value)}
                  className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm">
                  <option value="whatsapp">WhatsApp</option>
                  <option value="ligacao">Ligação</option>
                  <option value="presencial">Presencial</option>
                  <option value="email">E-mail</option>
                  <option value="promessa">Promessa de pagamento</option>
                  <option value="renegociacao">Renegociação</option>
                </select>
              </div>
              <div>
                <label className="text-slate-500 text-xs font-medium">Observação</label>
                <textarea value={cobDesc} onChange={e => setCobDesc(e.target.value)} rows={3}
                  className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm resize-none" />
              </div>
              {cobTipo === 'promessa' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-500 text-xs font-medium">Data da promessa</label>
                    <input type="date" value={promData} onChange={e => setPromData(e.target.value)}
                      className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-slate-500 text-xs font-medium">Valor prometido</label>
                    <input value={promValor} onChange={e => setPromValor(e.target.value)}
                      className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button onClick={() => setModalCob(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm hover:bg-slate-200">Cancelar</button>
              <button onClick={registrarCobranca} disabled={salvando}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm disabled:opacity-50">
                {salvando ? 'Salvando...' : 'Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL BLOQUEIO */}
      {modalBloquear && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-slate-900 font-semibold">Bloquear Cliente</h2>
              <button onClick={() => setModalBloquear(null)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
                Bloquear <strong>{modalBloquear.cliente_nome}</strong> para novas compras fiadas?
              </div>
              <div>
                <label className="text-slate-500 text-xs font-medium">Motivo do bloqueio</label>
                <input value={motivoBloqueio} onChange={e => setMotivoBloqueio(e.target.value)}
                  placeholder="Ex: Inadimplência, Limite excedido..."
                  className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button onClick={() => setModalBloquear(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm hover:bg-slate-200">Cancelar</button>
              <button onClick={bloquearCliente} disabled={salvandoBlq}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm disabled:opacity-50">
                {salvandoBlq ? 'Bloqueando...' : 'Confirmar Bloqueio'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalAtualizacao?.cliente_id && (
        <EnviarAtualizacaoContaModal
          clienteId={modalAtualizacao.cliente_id}
          clienteNome={modalAtualizacao.cliente_nome}
          telefone={modalAtualizacao.telefone}
          onFechar={() => setModalAtualizacao(null)}
        />
      )}
    </div>
  )
}
