'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatarTelefone } from '@/lib/clientes/telefone'
import { numeroOculto } from '@/lib/whatsapp/contatos'
import { doCliente, rotuloSaida, tempoDeEspera } from '@/lib/whatsapp/conversas'

export type Conversa = {
  id: string; telefone: string; nome_whatsapp: string | null; cliente_id: string | null; cliente_nome: string | null
  status: string; ultima_atividade: string | null; ultima_entrada_em: string | null; aguardando: boolean; nao_lida: boolean
}
export type Mensagem = {
  id: string; tipo: string; conteudo: string; status: string; erro: string | null
  created_at: string; enviado_em: string | null; operador_nome: string | null
}

const nomeDe = (c: Conversa) => c.cliente_nome || c.nome_whatsapp || (numeroOculto(c.telefone) ? 'Número oculto' : formatarTelefone(c.telefone))
const hora = (s: string) => new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
const FILTROS: Record<string, string> = { todas: 'Todas', aguardando: 'Aguardando resposta', nao_lidas: 'Não lidas' }

export default function WhatsAppConversasClient({ conversas, aberta, mensagens, contagem, filtros, indisponivel }: {
  conversas: Conversa[]; aberta: Conversa | null; mensagens: Mensagem[]
  contagem: { aguardando: number; naoLidas: number }
  filtros: { f: string; q: string }
  indisponivel: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [q, setQ] = useState(filtros.q)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const fim = useRef<HTMLDivElement>(null)

  const url = (p: Record<string, string | null>) => {
    const sp = new URLSearchParams()
    const base = { f: filtros.f, q: filtros.q, c: aberta?.id ?? null, ...p }
    Object.entries(base).forEach(([k, v]) => { if (v && !(k === 'f' && v === 'todas')) sp.set(k, v) })
    return `/dashboard/integracoes/whatsapp/conversas?${sp}`
  }
  const ir = (p: Record<string, string | null>) => startTransition(() => router.push(url(p)))

  // Atualiza sozinho (mensagem nova do cliente) enquanto a aba está aberta.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh() }, 20_000)
    return () => clearInterval(t)
  }, [router])

  // Abriu a conversa: marca como lida e desce para a última mensagem.
  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' })
    if (aberta?.nao_lida) {
      createClient().from('whatsapp_contatos').update({ lida_em: new Date().toISOString() }).eq('id', aberta.id)
        .then(() => router.refresh())
    }
  }, [aberta?.id, aberta?.nao_lida, mensagens.length, router])

  async function responder() {
    if (!aberta || !texto.trim()) return
    setEnviando(true); setErro('')
    try {
      // Mesma rota dos outros envios: registra, respeita opt-out e guarda o
      // resultado da Z-API. O banco liga a mensagem à conversa pelo telefone.
      const res = await fetch('/api/whatsapp/enviar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: aberta.telefone, mensagem: texto.trim(), tipo: 'atendimento', cliente_id: aberta.cliente_id, cliente_nome: aberta.cliente_nome }),
      })
      const r = await res.json().catch(() => ({}))
      if (!res.ok) setErro(r.error ?? 'Não foi possível enviar.')
      else setTexto('')
    } finally {
      setEnviando(false)
      router.refresh()
    }
  }

  if (indisponivel) return (
    <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm">
      A caixa de entrada ainda não foi ativada no banco. Peça para aplicar a migração <code>20261015200000_whatsapp_conversas.sql</code>.
    </div>
  )

  const oculto = aberta ? numeroOculto(aberta.telefone) : false

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <a href="/dashboard/integracoes/whatsapp" className="hover:text-gray-600">WhatsApp</a><span>›</span>
        <span className="text-gray-600 font-medium">Conversas</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 h-[calc(100vh-150px)] min-h-[520px]">
        {/* Lista */}
        <div className="bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden">
          <div className="p-3 border-b border-gray-100 space-y-2">
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && ir({ q, c: null })}
              placeholder="Buscar nome ou telefone..." className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500" />
            <div className="flex gap-1 flex-wrap">
              {Object.entries(FILTROS).map(([k, v]) => (
                <button key={k} onClick={() => ir({ f: k, c: null })}
                  className={`text-xs px-2 py-1 rounded-full ${filtros.f === k ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {v}{k === 'aguardando' && contagem.aguardando ? ` (${contagem.aguardando})` : ''}{k === 'nao_lidas' && contagem.naoLidas ? ` (${contagem.naoLidas})` : ''}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {conversas.length === 0 && <p className="p-6 text-sm text-gray-400 text-center">Nenhuma conversa aqui.</p>}
            {conversas.map(c => (
              <button key={c.id} onClick={() => ir({ c: c.id })}
                className={`w-full text-left px-3 py-2.5 hover:bg-gray-50 ${aberta?.id === c.id ? 'bg-teal-50' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm truncate ${c.nao_lida ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>{nomeDe(c)}</span>
                  {c.ultima_atividade && <span className="text-[11px] text-gray-400 whitespace-nowrap">{hora(c.ultima_atividade)}</span>}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {c.cliente_id && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 rounded">cliente</span>}
                  {c.aguardando && c.ultima_entrada_em && <span className="text-[11px] text-amber-700">aguardando há {tempoDeEspera(c.ultima_entrada_em)}</span>}
                  {c.nao_lida && <span className="ml-auto w-2 h-2 rounded-full bg-teal-500" />}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Conversa */}
        <div className="bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden">
          {!aberta ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400 p-6 text-center">
              Escolha uma conversa. As que estão aguardando resposta aparecem marcadas em amarelo.
            </div>
          ) : <>
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-gray-900">{nomeDe(aberta)}</p>
                <p className="text-xs text-gray-500">
                  {oculto ? 'Número oculto pelo WhatsApp' : formatarTelefone(aberta.telefone)}
                  {aberta.cliente_nome && aberta.nome_whatsapp ? ` · no WhatsApp: ${aberta.nome_whatsapp}` : ''}
                </p>
              </div>
              <div className="flex gap-3 text-xs">
                {aberta.cliente_id
                  ? <a href={`/dashboard/clientes/${aberta.cliente_id}`} className="text-blue-600 hover:underline">Ver cliente</a>
                  : <a href={`/dashboard/integracoes/whatsapp/contatos?q=${encodeURIComponent(aberta.nome_whatsapp ?? aberta.telefone)}`} className="text-blue-600 hover:underline">Cadastrar cliente</a>}
                {!oculto && <a href={`https://wa.me/${aberta.telefone}`} target="_blank" rel="noreferrer" className="text-green-700 hover:underline">Abrir no WhatsApp</a>}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-gray-50 px-4 py-3 space-y-2">
              {mensagens.length === 200 && <p className="text-center text-[11px] text-gray-400">Mostrando as últimas 200 mensagens.</p>}
              {mensagens.map(m => {
                const cliente = doCliente(m.tipo), rotulo = rotuloSaida(m.tipo)
                return (
                  <div key={m.id} className={`flex ${cliente ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[75%] rounded-xl px-3 py-2 text-sm shadow-sm ${cliente ? 'bg-white text-gray-800' : m.status === 'erro' ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-teal-100 text-gray-900'}`}>
                      {rotulo && <p className="text-[10px] uppercase tracking-wide text-teal-700 mb-0.5">{rotulo}</p>}
                      <p className="whitespace-pre-wrap break-words">{m.conteudo}</p>
                      <p className="text-[10px] text-gray-400 mt-1 text-right">
                        {hora(m.enviado_em ?? m.created_at)}
                        {!cliente && m.operador_nome ? ` · ${m.operador_nome.split('@')[0]}` : ''}
                        {m.status === 'erro' ? ` · não enviada${m.erro ? `: ${m.erro}` : ''}` : m.status === 'pendente' ? ' · enviando…' : ''}
                      </p>
                    </div>
                  </div>
                )
              })}
              <div ref={fim} />
            </div>

            <div className="border-t border-gray-100 p-3">
              {oculto ? (
                <p className="text-xs text-gray-500">O WhatsApp escondeu o número desta pessoa: responda pelo celular. Ao pedir o telefone dela, cadastre como cliente.</p>
              ) : <>
                <div className="flex gap-2 items-end">
                  <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={2} maxLength={4000}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); responder() } }}
                    placeholder="Escreva a resposta… (Enter envia, Shift+Enter quebra a linha)"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-teal-500" />
                  <button onClick={responder} disabled={enviando || !texto.trim()}
                    className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm rounded-lg">
                    {enviando ? 'Enviando…' : 'Enviar'}
                  </button>
                </div>
                {erro && <p className="text-xs text-red-600 mt-1">{erro}</p>}
                <p className="text-[11px] text-gray-400 mt-1">Sai pelo WhatsApp da loja (Z-API) e fica no histórico. O que for respondido direto no celular aparece aqui só se a Z-API estiver avisando as mensagens enviadas.</p>
              </>}
            </div>
          </>}
        </div>
      </div>
    </div>
  )
}
