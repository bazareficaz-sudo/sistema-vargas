'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatarTelefone, normalizarTelefone } from '@/lib/clientes/telefone'
import { numeroOculto } from '@/lib/whatsapp/contatos'
import ClienteFormDrawer from '@/components/clientes/ClienteFormDrawer'

export type ContatoWhatsApp = {
  id: string; telefone: string; nome_whatsapp: string | null; status: 'novo' | 'cliente' | 'ignorado'
  primeira_mensagem: string | null; primeira_em: string; ultima_em: string; total_mensagens: number
  cliente_id: string | null; clientes: { nome: string } | null
}

const STATUS_LABEL: Record<string, string> = { novo: 'Novos (sem cadastro)', cliente: 'Já são clientes', ignorado: 'Ignorados', todos: 'Todos' }
const STATUS_CLS: Record<string, string> = {
  novo: 'bg-amber-100 text-amber-700', cliente: 'bg-green-100 text-green-700', ignorado: 'bg-gray-100 text-gray-500',
}
const data = (s: string) => new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

export default function WhatsAppContatosClient({
  empresaId, contatos, total, pagina, totalPaginas, stats, filtros, indisponivel,
}: {
  empresaId: string
  contatos: ContatoWhatsApp[]
  total: number; pagina: number; totalPaginas: number
  stats: { novos: number; clientes: number; semana: number; semNome: number; vazios: number }
  filtros: { status: string; q: string }
  indisponivel: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [q, setQ] = useState(filtros.q)
  const [cadastrando, setCadastrando] = useState<ContatoWhatsApp | null>(null)
  const [erro, setErro] = useState('')
  const [buscandoNomes, setBuscandoNomes] = useState(false)
  const [avisoNomes, setAvisoNomes] = useState('')

  // Pergunta à Z-API o nome de quem está sem (40 por vez, até acabar ou parar
  // de achar). Só leitura no WhatsApp.
  const [diagnostico, setDiagnostico] = useState('')

  // Pergunta à Z-API o nome de quem está sem (40 por vez, até acabar ou parar
  // de achar). `refazer`: também quem já foi consultado e veio sem nome. Só
  // leitura no WhatsApp. O diagnóstico mostra só os NOMES dos campos que a
  // Z-API devolveu (nunca os valores), para entender quando não vem nome.
  async function buscarNomes(refazer = false) {
    setBuscandoNomes(true); setAvisoNomes(''); setErro(''); setDiagnostico('')
    let achados = 0, consultados = 0, desde: string | undefined
    const soma = { contato: {} as Record<string, number>, conversa: {} as Record<string, number>, situacoes: {} as Record<string, number> }
    const juntar = (alvo: Record<string, number>, de: Record<string, number> = {}) => Object.entries(de).forEach(([k, v]) => { alvo[k] = (alvo[k] ?? 0) + v })
    try {
      for (let rodada = 0; rodada < 5; rodada++) {
        const res = await fetch('/api/whatsapp/contatos/nomes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refazer, desde }) })
        const r = await res.json().catch(() => ({}))
        if (r.diagnostico) { juntar(soma.contato, r.diagnostico.contato); juntar(soma.conversa, r.diagnostico.conversa); juntar(soma.situacoes, r.diagnostico.situacoes) }
        if (!res.ok) { setErro(r.error ?? 'Não foi possível buscar os nomes.'); break }
        desde = r.desde
        achados += r.preenchidos ?? 0
        consultados += r.consultados ?? 0
        // Cada consulta marca o contato (com nome ou vazio): a fila anda. Erro para.
        if (!r.restantes || !r.consultados || r.erros) break
        setAvisoNomes(`Buscando… ${achados} nome${achados === 1 ? '' : 's'} encontrado${achados === 1 ? '' : 's'}`)
      }
      setAvisoNomes(`${achados} de ${consultados} nome${consultados === 1 ? '' : 's'} encontrado${achados === 1 ? '' : 's'} no WhatsApp. Os demais ganham o nome quando mandarem a próxima mensagem.`)
      const lista = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ') || 'nenhum'
      setDiagnostico(`Respostas: ${lista(soma.situacoes)} · campos no contato: ${lista(soma.contato)} · campos na conversa: ${lista(soma.conversa)}`)
    } finally {
      setBuscandoNomes(false)
      router.refresh()
    }
  }
  // Estável enquanto o mesmo contato está aberto: a gaveta recarrega quando muda.
  const inicial = useMemo(() => cadastrando
    // Número escondido pelo WhatsApp (@lid): o código não é telefone, não vai para o cadastro.
    ? { nome: cadastrando.nome_whatsapp || '', ...(numeroOculto(cadastrando.telefone) ? {} : { telefone: normalizarTelefone(cadastrando.telefone), whatsapp: normalizarTelefone(cadastrando.telefone) }) }
    : undefined, [cadastrando])

  function navegar(params: Record<string, string>) {
    const sp = new URLSearchParams({ status: filtros.status, ...(q ? { q } : {}) })
    Object.entries(params).forEach(([k, v]) => v ? sp.set(k, v) : sp.delete(k))
    if (!('pagina' in params)) sp.delete('pagina')
    startTransition(() => router.push(`/dashboard/integracoes/whatsapp/contatos?${sp}`))
  }

  // Só o status muda pela tela (regra do banco); vincular ao cliente é
  // automático quando o telefone é cadastrado.
  async function mudarStatus(c: ContatoWhatsApp, status: 'novo' | 'ignorado') {
    setErro('')
    const { error } = await createClient().from('whatsapp_contatos')
      .update({ status: status === 'novo' && c.cliente_id ? 'cliente' : status, updated_at: new Date().toISOString() })
      .eq('id', c.id)
    if (error) setErro('Não foi possível atualizar o contato.')
    else router.refresh()
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <a href="/dashboard/integracoes/whatsapp" className="hover:text-gray-600">WhatsApp</a><span>›</span>
        <span className="text-gray-600 font-medium">Contatos</span>
      </div>

      <h1 className="text-gray-900 text-xl font-semibold mb-1">Contatos do WhatsApp</h1>
      <p className="text-sm text-gray-500 mb-6">Quem mandou mensagem para a loja entra aqui sozinho. Os novos ainda não têm cadastro: cadastre quem for comprar ou pedir orçamento. Ao cadastrar (aqui ou no balcão) com o mesmo telefone, o contato e as mensagens passam para o cliente.</p>

      {indisponivel ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm">
          A lista de contatos ainda não foi ativada no banco. Peça para aplicar a migração <code>20261015120000_whatsapp_contatos.sql</code>.
        </div>
      ) : <>
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Novos sem cadastro', val: stats.novos, color: 'text-amber-600' },
            { label: 'Primeiro contato nos últimos 7 dias', val: stats.semana, color: 'text-gray-900' },
            { label: 'Já são clientes', val: stats.clientes, color: 'text-green-600' },
          ].map(s => (
            <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.val.toLocaleString('pt-BR')}</p>
            </div>
          ))}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-center">
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && navegar({ q })}
            placeholder="Buscar por nome ou telefone..."
            className="flex-1 min-w-48 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
          <select value={filtros.status} onChange={e => navegar({ status: e.target.value })}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>

        {(stats.semNome > 0 || stats.vazios > 0) && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-blue-800">
              {stats.semNome > 0
                ? `${stats.semNome} contato${stats.semNome === 1 ? '' : 's'} sem o nome do WhatsApp (chegaram antes de o sistema guardar o nome).`
                : `${stats.vazios} contato${stats.vazios === 1 ? '' : 's'} já consultado${stats.vazios === 1 ? '' : 's'} sem nome. O nome chega com a próxima mensagem de cada um.`}
            </span>
            <button onClick={() => buscarNomes(stats.semNome === 0)} disabled={buscandoNomes} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs rounded-lg whitespace-nowrap">
              {buscandoNomes ? 'Buscando…' : stats.semNome > 0 ? 'Buscar nomes no WhatsApp' : 'Consultar de novo'}
            </button>
          </div>
        )}
        {avisoNomes && <p className="text-sm text-gray-600 mb-1">{avisoNomes}</p>}
        {diagnostico && <p className="text-xs text-gray-400 mb-3">{diagnostico}</p>}
        {erro && <p className="text-sm text-red-600 mb-3">{erro}</p>}

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {contatos.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-3xl mb-3">💬</p>
              <p className="text-gray-500">Nenhum contato {filtros.status === 'todos' ? '' : `em "${STATUS_LABEL[filtros.status]}"`}</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Contato</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Primeira mensagem</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Última</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-16">Msgs</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-64"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {contatos.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50 align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{c.clientes?.nome || c.nome_whatsapp || 'Sem nome no WhatsApp'}</p>
                      {c.clientes?.nome && c.nome_whatsapp && <p className="text-xs text-gray-400">no WhatsApp: {c.nome_whatsapp}</p>}
                      {numeroOculto(c.telefone)
                        ? <p className="text-xs text-gray-400" title="O WhatsApp escondeu o número desta pessoa. Peça o telefone na conversa para cadastrar.">Número oculto pelo WhatsApp</p>
                        : <p className="text-xs text-gray-500 font-mono">{formatarTelefone(c.telefone)}</p>}
                      <span className={`inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_CLS[c.status]}`}>{c.status === 'novo' ? 'novo' : c.status === 'cliente' ? 'cliente' : 'ignorado'}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-md">
                      <p className="line-clamp-2">{c.primeira_mensagem ?? '—'}</p>
                      <p className="text-gray-400 mt-1">{data(c.primeira_em)}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{data(c.ultima_em)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{c.total_mensagens}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                      {!numeroOculto(c.telefone) && <a href={`https://wa.me/${c.telefone}`} target="_blank" rel="noreferrer" className="text-xs text-green-700 hover:underline">Abrir conversa</a>}
                      {c.cliente_id
                        ? <a href={`/dashboard/clientes/${c.cliente_id}`} className="text-xs text-blue-600 hover:underline">Ver cliente</a>
                        : <button onClick={() => setCadastrando(c)} className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md">Cadastrar cliente</button>}
                      {c.status === 'ignorado'
                        ? <button onClick={() => mudarStatus(c, 'novo')} className="text-xs text-gray-500 hover:underline">Reativar</button>
                        : !c.cliente_id && <button onClick={() => mudarStatus(c, 'ignorado')} title="Fornecedor, funcionário, engano…" className="text-xs text-gray-500 hover:underline">Ignorar</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPaginas > 1 && (
          <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
            <span>{total.toLocaleString('pt-BR')} contatos</span>
            <div className="flex gap-2">
              {pagina > 1 && <button onClick={() => navegar({ pagina: String(pagina - 1) })} className="px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-50">Anterior</button>}
              <span className="px-2 py-1">{pagina} / {totalPaginas}</span>
              {pagina < totalPaginas && <button onClick={() => navegar({ pagina: String(pagina + 1) })} className="px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-50">Próxima</button>}
            </div>
          </div>
        )}
      </>}

      <ClienteFormDrawer
        empresaId={empresaId}
        aberto={!!cadastrando}
        inicial={inicial}
        onFechar={() => setCadastrando(null)}
        // O gatilho do banco já ligou o contato pelo telefone.
        onSalvo={() => { setCadastrando(null); router.refresh() }}
      />
    </div>
  )
}
