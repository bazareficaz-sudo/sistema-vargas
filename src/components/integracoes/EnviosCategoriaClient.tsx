'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatarTelefone } from '@/lib/clientes/telefone'
import type { Categoria } from '@/lib/clientes/categorias'
import {
  HORARIO, INTERVALO_MINIMO_S, LIMITE_POR_DIA, SITUACAO_ITEM, avisoDaSituacao, esperaAutomatica, montarMensagem,
} from '@/lib/whatsapp/envioCategoria'

// Envio por categoria (envio assistido): monta a fila e manda uma por vez,
// no clique ou no automático com a tela aberta. O ritmo é do banco; a tela
// só mostra e espera.

export type ResumoLote = {
  id: string; nome: string; categoria_nome: string | null; comprou_dias: number | null; status: string; total: number
  criado_por_nome: string | null; created_at: string; pendentes: number; enviados: number; problemas: number; pulados: number; ultimo_envio: string | null
}
export type Lote = { id: string; nome: string; mensagem: string; categoria_nome: string | null; comprou_dias: number | null; status: string; total: number; criado_por_nome: string | null; created_at: string }
export type ItemLote = { id: string; nome: string; telefone: string; status: string; motivo: string | null; enviado_em: string | null; ordem: number }

const STATUS_LOTE: Record<string, { rotulo: string; cor: string }> = {
  ativo: { rotulo: 'Em andamento', cor: 'bg-blue-100 text-blue-700' },
  pausado: { rotulo: 'Pausado', cor: 'bg-amber-100 text-amber-800' },
  concluido: { rotulo: 'Concluído', cor: 'bg-emerald-100 text-emerald-700' },
  cancelado: { rotulo: 'Cancelado', cor: 'bg-gray-100 text-gray-500' },
}
const PERIODOS = [
  { dias: '', rotulo: 'Todos da categoria' },
  { dias: '30', rotulo: 'Compraram nos últimos 30 dias' },
  { dias: '90', rotulo: 'Compraram nos últimos 90 dias' },
  { dias: '180', rotulo: 'Compraram nos últimos 6 meses' },
  { dias: '365', rotulo: 'Compraram no último ano' },
]
const quando = (s: string) => new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

function Bolha({ texto }: { texto: string }) {
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: '#efeae2' }}>
      <p className="ml-auto max-w-[90%] w-fit bg-[#d9fdd3] rounded-lg rounded-tr-none px-3 py-2 text-sm whitespace-pre-wrap break-words shadow-sm">{texto}</p>
    </div>
  )
}

export default function EnviosCategoriaClient({ empresaId, indisponivel, lotes, categorias, whatsappAtivo, loja, enviadosHoje, lote, itens }: {
  empresaId: string; indisponivel: boolean; lotes: ResumoLote[]; categorias: (Categoria & { clientes: number })[]
  whatsappAtivo: boolean; loja: string; enviadosHoje: number; lote: Lote | null; itens: ItemLote[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [novo, setNovo] = useState(!lote)
  const [form, setForm] = useState({ categoria: '', dias: '', nome: '', mensagem: 'Olá, {nome}! ' })
  const [criando, setCriando] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [hoje, setHoje] = useState(enviadosHoje)
  const [enviando, setEnviando] = useState(false)
  const [auto, setAuto] = useState(false)
  const [falta, setFalta] = useState(0)
  const caixa = useRef<HTMLTextAreaElement>(null)

  const proximo = itens.find(i => i.status === 'pendente')
  const conta = (s: string[]) => itens.filter(i => s.includes(i.status)).length

  function inserir(marca: string) {
    const el = caixa.current
    const ini = el?.selectionStart ?? form.mensagem.length, fim = el?.selectionEnd ?? form.mensagem.length
    setForm(f => ({ ...f, mensagem: f.mensagem.slice(0, ini) + marca + f.mensagem.slice(fim) }))
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(ini + marca.length, ini + marca.length) } })
  }

  async function montarFila() {
    if (!form.categoria || !form.mensagem.trim()) return
    setCriando(true); setErro('')
    const { data, error } = await createClient().rpc('whatsapp_lote_criar', {
      p_empresa: empresaId, p_nome: form.nome, p_mensagem: form.mensagem, p_categoria: form.categoria,
      p_comprou_dias: form.dias ? Number(form.dias) : null,
    })
    setCriando(false)
    if (error || !data) { setErro(error?.message ?? 'Não foi possível montar a fila.'); return }
    setNovo(false); setAviso('')
    startTransition(() => router.push(`/dashboard/integracoes/whatsapp/envios?l=${data}`))
  }

  // Um envio. Devolve quantos segundos esperar para o próximo, ou null para parar.
  async function passo(): Promise<number | null> {
    if (!lote) return null
    setEnviando(true); setErro('')
    try {
      const res = await fetch('/api/whatsapp/lotes/proximo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loteId: lote.id }),
      })
      const r = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(r.error ?? 'Não foi possível enviar.'); return null }
      if (typeof r.enviados_hoje === 'number') setHoje(r.enviados_hoje)
      if (r.situacao === 'ok') {
        setAviso(r.resultado === 'enviado' ? `Enviado para ${r.nome}.` : r.resultado === 'incerto'
          ? `${r.nome}: a Z-API não respondeu. Pode ter saído ou não — não será reenviado.` : `${r.nome}: não enviado (${r.erro ?? 'erro'}).`)
        router.refresh()
        return r.resultado === 'incerto' ? null : esperaAutomatica()
      }
      setAviso(avisoDaSituacao(r.situacao, r.espera_s))
      if (r.situacao === 'aguarde') return Number(r.espera_s ?? INTERVALO_MINIMO_S) + 1
      router.refresh()
      return null
    } catch {
      setErro('Sem conexão com o sistema. O envio automático parou.')
      return null
    } finally {
      setEnviando(false)
    }
  }
  const passoRef = useRef(passo)
  useEffect(() => { passoRef.current = passo })

  // Automático: um, espera (60–120 s, ou o que o banco pedir), o próximo.
  // Só com esta tela aberta; para no limite do dia, fora do horário, no fim
  // da fila e em qualquer envio sem confirmação.
  useEffect(() => {
    if (!auto) return
    let vivo = true
    let t: ReturnType<typeof setTimeout> | undefined
    const rodar = async () => {
      const espera = await passoRef.current()
      if (!vivo) return
      if (espera === null) { setAuto(false); setFalta(0); return }
      let resta = espera
      setFalta(resta)
      const tic = () => {
        if (!vivo) return
        resta -= 1; setFalta(resta)
        if (resta <= 0) rodar(); else t = setTimeout(tic, 1000)
      }
      t = setTimeout(tic, 1000)
    }
    rodar()
    const sair = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', sair)
    return () => { vivo = false; if (t) clearTimeout(t); window.removeEventListener('beforeunload', sair) }
  }, [auto])

  async function mudarStatus(status: 'ativo' | 'pausado' | 'cancelado') {
    if (!lote) return
    if (status === 'cancelado' && !confirm('Cancelar este envio? Quem ainda está na fila não recebe.')) return
    setAuto(false)
    const { error } = await createClient().rpc('whatsapp_lote_status', { p_lote: lote.id, p_status: status })
    if (error) setErro(error.message); else router.refresh()
  }

  if (indisponivel) return (
    <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm">
      O envio por categoria ainda não foi ativado no banco. Peça para aplicar a migração <code>20261020180000_whatsapp_envio_categoria.sql</code>.
    </div>
  )

  const categoriaEscolhida = categorias.find(c => c.id === form.categoria)
  const exemplo = montarMensagem(form.mensagem, 'João Silva', loja)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Envio por categoria</h1>
          <p className="text-gray-500 text-sm mt-0.5">Mensagem para uma categoria de clientes (ex.: Eletricistas), enviada uma por vez pelo WhatsApp da loja.</p>
        </div>
        <div className={`text-sm rounded-lg px-3 py-1.5 ${hoje >= LIMITE_POR_DIA ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
          Hoje: <b>{hoje}</b> de {LIMITE_POR_DIA}
        </div>
      </div>

      <div className="text-xs bg-blue-50 border border-blue-100 text-blue-900 rounded-lg px-3 py-2 leading-relaxed">
        <b>Para proteger o número da loja:</b> uma mensagem por vez · até {LIMITE_POR_DIA} por dia · pelo menos {INTERVALO_MINIMO_S} s entre uma e outra ·
        só das {HORARIO.de}h às {HORARIO.ate}h · quem pediu para não receber WhatsApp fica de fora · quem recebeu um envio nos últimos 7 dias também ·
        toda mensagem vai com &quot;responda SAIR&quot; e quem responder SAIR não recebe mais. Sem confirmação da Z-API, a mensagem não é reenviada.
      </div>
      {!whatsappAtivo && <p className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">O WhatsApp da loja não está ativo em Integrações → WhatsApp: dá para montar a fila, mas nada é enviado.</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Lista de envios */}
        <aside className="bg-white border border-gray-200 rounded-xl overflow-hidden self-start">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-800">Envios</span>
            <button onClick={() => { setNovo(true); setAuto(false); setErro(''); setAviso('') }} className="text-xs px-3 py-1 rounded-full bg-[#008069] text-white hover:bg-[#017561]">+ Novo envio</button>
          </div>
          {lotes.length === 0 && <p className="p-4 text-sm text-gray-400">Nenhum envio ainda.</p>}
          <ul className="divide-y divide-gray-100">
            {lotes.map(x => (
              <li key={x.id}>
                <Link href={`/dashboard/integracoes/whatsapp/envios?l=${x.id}`} onClick={() => { setNovo(false); setAuto(false) }}
                  className={`block px-4 py-2.5 hover:bg-gray-50 ${lote?.id === x.id && !novo ? 'bg-[#f0f2f5]' : ''}`}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-900 truncate">{x.nome}</span>
                    <span className={`text-[10px] px-1.5 rounded-full whitespace-nowrap ${STATUS_LOTE[x.status]?.cor ?? ''}`}>{STATUS_LOTE[x.status]?.rotulo ?? x.status}</span>
                  </span>
                  <span className="block text-[11px] text-gray-500">{x.categoria_nome ?? 'categoria apagada'} · {quando(x.created_at)}</span>
                  <span className="block text-[11px] text-gray-500">{x.enviados} de {x.total} enviados{x.problemas ? ` · ${x.problemas} com problema` : ''}{x.pendentes ? ` · ${x.pendentes} na fila` : ''}</span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>

        {/* Novo envio ou o envio aberto */}
        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 min-w-0">
          {novo || !lote ? <>
            <h2 className="text-base font-semibold text-gray-900">Novo envio</h2>
            {categorias.length === 0 ? (
              <p className="text-sm text-gray-600">Nenhuma categoria de cliente ainda. Crie em <Link href="/dashboard/clientes" className="text-blue-600 hover:underline">Clientes → 🏷 Categorias</Link> e marque os clientes.</p>
            ) : <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs font-medium text-gray-600 mb-1">Categoria *</span>
                  <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="">Escolha…</option>
                    {categorias.map(c => <option key={c.id} value={c.id}>{c.nome} ({c.clientes} cliente{c.clientes === 1 ? '' : 's'})</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-gray-600 mb-1">Quem</span>
                  <select value={form.dias} onChange={e => setForm(f => ({ ...f, dias: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                    {PERIODOS.map(p => <option key={p.dias} value={p.dias}>{p.rotulo}</option>)}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">Nome do envio <span className="font-normal text-gray-400">(só para você achar depois)</span></span>
                <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} maxLength={80}
                  placeholder={categoriaEscolhida ? `${categoriaEscolhida.nome} — chegou disjuntor` : 'Ex.: Eletricistas — chegou disjuntor'}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </label>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-600">Mensagem *</span>
                  <span className="flex gap-1">
                    <button type="button" onClick={() => inserir('{nome}')} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 hover:bg-gray-200">+ {'{nome}'}</button>
                    <button type="button" onClick={() => inserir('{loja}')} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 hover:bg-gray-200">+ {'{loja}'}</button>
                  </span>
                </div>
                <textarea ref={caixa} value={form.mensagem} onChange={e => setForm(f => ({ ...f, mensagem: e.target.value }))} rows={5} maxLength={1000}
                  placeholder="Olá, {nome}! Chegou a linha nova de disjuntores Steck aqui na {loja}…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y" />
                <p className="text-[11px] text-gray-400">{'{nome}'} vira o primeiro nome do cliente; {'{loja}'}, o nome da loja. Escreva como se fosse para uma pessoa — mensagem pessoal tem resposta e não parece propaganda.</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">Como chega (exemplo com &quot;João Silva&quot;)</p>
                <Bolha texto={exemplo} />
              </div>
              {erro && <p className="text-sm text-red-600">{erro}</p>}
              <div className="flex justify-end gap-2">
                {lote && <button onClick={() => setNovo(false)} className="px-3 py-2 text-sm text-gray-600">Voltar</button>}
                <button onClick={montarFila} disabled={criando || !form.categoria || !form.mensagem.trim()}
                  className="px-4 py-2 rounded-lg bg-[#008069] text-white text-sm disabled:opacity-50">{criando ? 'Montando…' : 'Montar fila'}</button>
              </div>
              <p className="text-[11px] text-gray-400 text-right">Montar a fila não envia nada. Você confere a lista e envia na tela seguinte.</p>
            </>}
          </> : <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-gray-900">{lote.nome}</h2>
                <p className="text-xs text-gray-500">
                  {lote.categoria_nome ?? 'categoria apagada'}{lote.comprou_dias ? ` · compraram nos últimos ${lote.comprou_dias} dias` : ''} · montado {quando(lote.created_at)}{lote.criado_por_nome ? ` por ${lote.criado_por_nome}` : ''}
                </p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_LOTE[lote.status]?.cor ?? ''}`}>{STATUS_LOTE[lote.status]?.rotulo ?? lote.status}</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              {[['Na fila', conta(['pendente', 'enviando']), 'text-gray-800'], ['Enviados', conta(['enviado']), 'text-emerald-700'],
                ['Com problema', conta(['erro', 'incerto']), 'text-red-700'], ['Fora', conta(['pulado']), 'text-gray-400']].map(([r, n, cor]) => (
                <div key={r as string} className="rounded-lg bg-gray-50 py-2">
                  <p className={`text-xl font-semibold ${cor}`}>{n as number}</p>
                  <p className="text-[11px] text-gray-500">{r as string}</p>
                </div>
              ))}
            </div>

            <div>
              <p className="text-xs font-medium text-gray-600 mb-1">Mensagem (exemplo com &quot;João Silva&quot;)</p>
              <Bolha texto={montarMensagem(lote.mensagem, 'João Silva', loja)} />
            </div>

            {lote.status === 'ativo' && (proximo || auto) && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-3">
                <button onClick={() => { passo() }} disabled={enviando || auto || !whatsappAtivo}
                  className="px-4 py-2 rounded-lg bg-[#008069] text-white text-sm disabled:opacity-50">
                  {enviando && !auto ? 'Enviando…' : proximo ? `Enviar para ${proximo.nome.split(' ')[0]}` : 'Enviar próximo'}
                </button>
                {auto
                  ? <button onClick={() => setAuto(false)} className="px-4 py-2 rounded-lg border border-red-300 text-red-700 text-sm">⏸ Parar automático{falta > 0 ? ` (próximo em ${falta} s)` : ''}</button>
                  : <button onClick={() => { setAviso(''); setAuto(true) }} disabled={enviando || !whatsappAtivo}
                      className="px-4 py-2 rounded-lg border border-[#008069] text-[#008069] text-sm disabled:opacity-50"
                      title="Envia um a cada 1–2 minutos enquanto esta tela estiver aberta">▶ Envio automático</button>}
                <span className="ml-auto flex gap-2">
                  <button onClick={() => mudarStatus('pausado')} className="text-xs text-gray-600 hover:underline">Pausar</button>
                  <button onClick={() => mudarStatus('cancelado')} className="text-xs text-red-600 hover:underline">Cancelar</button>
                </span>
                {auto && <p className="w-full text-[11px] text-gray-500">Automático ligado: mantenha esta tela aberta. Para sozinho no limite do dia, fora do horário, no fim da fila ou se a Z-API não confirmar um envio.</p>}
              </div>
            )}
            {lote.status === 'pausado' && (
              <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <span className="text-amber-800">Envio pausado.</span>
                <button onClick={() => mudarStatus('ativo')} className="px-3 py-1 rounded-lg bg-[#008069] text-white text-sm">Retomar</button>
                <button onClick={() => mudarStatus('cancelado')} className="text-xs text-red-600 hover:underline">Cancelar</button>
              </div>
            )}
            {(aviso || erro) && <p className={`text-sm ${erro ? 'text-red-600' : 'text-[#008069]'}`}>{erro || aviso}</p>}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100">
                    <th className="text-left py-2 font-medium">Cliente</th>
                    <th className="text-left py-2 font-medium">WhatsApp</th>
                    <th className="text-left py-2 font-medium">Situação</th>
                    <th className="text-right py-2 font-medium">Quando</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {itens.map(i => (
                    <tr key={i.id}>
                      <td className="py-2 text-gray-900">{i.nome}</td>
                      <td className="py-2 text-gray-500">
                        <Link href={`/dashboard/integracoes/whatsapp/conversas?q=${i.telefone.slice(-8)}`} className="hover:underline" title="Abrir as conversas com este número">{formatarTelefone(i.telefone)}</Link>
                      </td>
                      <td className="py-2">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full ${SITUACAO_ITEM[i.status]?.cor ?? ''}`}>{SITUACAO_ITEM[i.status]?.rotulo ?? i.status}</span>
                        {i.motivo && <span className="block text-[11px] text-gray-400 mt-0.5">{i.motivo}</span>}
                      </td>
                      <td className="py-2 text-right text-xs text-gray-400">{i.enviado_em ? quando(i.enviado_em) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {itens.length === 0 && <p className="text-sm text-gray-400 py-3">Ninguém entrou na fila: na categoria não há cliente com celular que queira receber (ou todos receberam um envio nos últimos 7 dias).</p>}
            </div>
            <p className="text-[11px] text-gray-400">As respostas chegam na caixa de entrada (<Link href="/dashboard/integracoes/whatsapp/conversas" className="hover:underline">Conversas</Link>), com o rótulo &quot;Envio por categoria&quot;.</p>
          </>}
        </section>
      </div>
    </div>
  )
}
