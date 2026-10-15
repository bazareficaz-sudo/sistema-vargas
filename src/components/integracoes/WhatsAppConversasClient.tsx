'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatarTelefone } from '@/lib/clientes/telefone'
import { numeroOculto } from '@/lib/whatsapp/contatos'
import { doCliente, legendaDoProduto, preencherResposta, rotuloSaida, tempoDeEspera, type ProdutoParaEnviar, type RespostaRapida } from '@/lib/whatsapp/conversas'
import { precoVigente, promocaoVigente } from '@/lib/produtos/promocao'

export type Conversa = {
  id: string; telefone: string; nome_whatsapp: string | null; cliente_id: string | null; cliente_nome: string | null
  status: string; ultima_atividade: string | null; ultima_entrada_em: string | null; aguardando: boolean; nao_lida: boolean
}
export type Mensagem = {
  id: string; tipo: string; conteudo: string; status: string; erro: string | null
  created_at: string; enviado_em: string | null; operador_nome: string | null
}
export type Ficha = {
  saldo_devedor: number | null; saldo_credito: number | null; valor_vencido: number | null
  limite_credito: number | null; bloqueado_fiado: boolean | null; opt_out_whatsapp: boolean | null
  compras: { id: string; numero: number | string | null; created_at: string; total: number | null; canal: string | null }[]
  orcamentos: { id: string; numero: number | string | null; created_at: string; total: number | null; validade: string | null }[]
}
type ProdutoBusca = ProdutoParaEnviar & { id: string; controlar_estoque: boolean | null; estoque: number | null }

const nomeDe = (c: Conversa) => c.cliente_nome || c.nome_whatsapp || (numeroOculto(c.telefone) ? 'Número oculto' : formatarTelefone(c.telefone))
const hora = (s: string) => new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
const dia = (s: string) => new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Sao_Paulo' })
const brl = (v: number | null | undefined) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const FILTROS: Record<string, string> = { todas: 'Todas', aguardando: 'Aguardando resposta', nao_lidas: 'Não lidas' }

export default function WhatsAppConversasClient({ conversas, aberta, mensagens, contagem, filtros, indisponivel, ficha, respostas, loja, empresaId }: {
  conversas: Conversa[]; aberta: Conversa | null; mensagens: Mensagem[]
  ficha: Ficha | null; respostas: RespostaRapida[]; loja: string; empresaId: string
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
  const [verFicha, setVerFicha] = useState(false)
  const [painel, setPainel] = useState<'' | 'nova' | 'produto'>('')
  const [nova, setNova] = useState({ nome: '', conteudo: '' })
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<ProdutoBusca[]>([])
  const [escolhido, setEscolhido] = useState<ProdutoBusca | null>(null)
  const [aviso, setAviso] = useState('')

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

  // Resposta rápida: entra na caixa de texto para ajustar antes de enviar.
  function usarResposta(r: RespostaRapida) {
    const pronto = preencherResposta(r.conteudo, { nome: aberta?.cliente_nome || aberta?.nome_whatsapp, loja })
    setTexto(t => (t.trim() ? `${t.trimEnd()}\n${pronto}` : pronto))
  }

  async function salvarResposta() {
    if (!nova.nome.trim() || !nova.conteudo.trim()) return
    const { error } = await createClient().from('whatsapp_modelos').insert({
      empresa_id: empresaId, nome: nova.nome.trim().slice(0, 40), tipo: 'resposta_rapida', conteudo: nova.conteudo.trim(), ativo: true,
    })
    if (error) { setErro('Não foi possível salvar a resposta.'); return }
    setNova({ nome: '', conteudo: '' }); setPainel(''); router.refresh()
  }

  async function buscarProdutos() {
    const termo = busca.trim().replace(/[,()%]/g, ' ')
    if (termo.length < 2) return
    const { data } = await createClient().from('produtos')
      .select('id, nome, sku, unidade, preco_venda, preco_promocional, promocao_ativa, promocao_inicio, promocao_fim, controlar_estoque, estoque')
      .eq('empresa_id', empresaId).eq('ativo', true)
      .or(`nome.ilike.%${termo}%,sku.ilike.%${termo}%`)
      .order('nome').limit(10)
    setAchados((data ?? []) as ProdutoBusca[]); setEscolhido(null)
  }

  async function enviarProduto() {
    if (!aberta || !escolhido) return
    setEnviando(true); setErro(''); setAviso('')
    try {
      const res = await fetch('/api/whatsapp/conversas/produto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contatoId: aberta.id, produtoId: escolhido.id }),
      })
      const r = await res.json().catch(() => ({}))
      if (!res.ok) setErro(r.error ?? 'Não foi possível enviar o produto.')
      else { setAviso(r.comFoto ? 'Produto enviado com foto.' : 'Produto sem foto cadastrada: foi só o texto.'); setPainel(''); setEscolhido(null); setAchados([]); setBusca('') }
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

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] xl:grid-cols-[320px_1fr_270px] gap-4 h-[calc(100vh-150px)] min-h-[520px]">
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
                <button onClick={() => setVerFicha(v => !v)} className="xl:hidden text-blue-600 hover:underline">{verFicha ? 'Fechar ficha' : 'Ficha'}</button>
                {aberta.cliente_id
                  ? <a href={`/dashboard/clientes/${aberta.cliente_id}`} className="text-blue-600 hover:underline">Ver cliente</a>
                  : <a href={`/dashboard/integracoes/whatsapp/contatos?q=${encodeURIComponent(aberta.nome_whatsapp ?? aberta.telefone)}`} className="text-blue-600 hover:underline">Cadastrar cliente</a>}
                {!oculto && <a href={`https://wa.me/${aberta.telefone}`} target="_blank" rel="noreferrer" className="text-green-700 hover:underline">Abrir no WhatsApp</a>}
              </div>
            </div>

            {verFicha && <div className="xl:hidden border-b border-gray-100 max-h-[45%] overflow-y-auto"><FichaCliente aberta={aberta} ficha={ficha} /></div>}

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
                <div className="flex gap-1.5 flex-wrap mb-2 items-center">
                  {respostas.map(r => (
                    <button key={r.id ?? r.nome} onClick={() => usarResposta(r)} title={r.conteudo}
                      className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700 hover:bg-teal-50 hover:text-teal-800">{r.nome}</button>
                  ))}
                  <button onClick={() => setPainel(p => p === 'nova' ? '' : 'nova')} className="text-xs px-2 py-1 rounded-full border border-dashed border-gray-300 text-gray-500 hover:text-gray-700">+ Nova</button>
                  <button onClick={() => setPainel(p => p === 'produto' ? '' : 'produto')}
                    className="ml-auto text-xs px-2.5 py-1 rounded-lg bg-white border border-teal-600 text-teal-700 hover:bg-teal-50">Enviar produto</button>
                </div>

                {painel === 'nova' && (
                  <div className="mb-2 p-2 rounded-lg bg-gray-50 border border-gray-200 space-y-1.5">
                    <input value={nova.nome} onChange={e => setNova(n => ({ ...n, nome: e.target.value }))} maxLength={40}
                      placeholder="Nome do botão (ex.: Entrega)" className="w-full border border-gray-300 rounded px-2 py-1 text-xs" />
                    <textarea value={nova.conteudo} onChange={e => setNova(n => ({ ...n, conteudo: e.target.value }))} rows={2} maxLength={1000}
                      placeholder="Texto. Use {nome} para o primeiro nome e {loja} para o nome da loja." className="w-full border border-gray-300 rounded px-2 py-1 text-xs resize-none" />
                    <div className="flex justify-between items-center">
                      <a href="/dashboard/integracoes/whatsapp" className="text-[11px] text-gray-500 hover:underline">Editar ou apagar em Modelos</a>
                      <button onClick={salvarResposta} disabled={!nova.nome.trim() || !nova.conteudo.trim()}
                        className="text-xs px-3 py-1 rounded bg-teal-600 text-white disabled:opacity-50">Salvar resposta</button>
                    </div>
                  </div>
                )}

                {painel === 'produto' && (
                  <div className="mb-2 p-2 rounded-lg bg-gray-50 border border-gray-200">
                    <div className="flex gap-1.5">
                      <input value={busca} onChange={e => setBusca(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscarProdutos()} autoFocus
                        placeholder="Nome ou código do produto" className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs" />
                      <button onClick={buscarProdutos} className="text-xs px-3 py-1 rounded bg-gray-200 hover:bg-gray-300">Buscar</button>
                    </div>
                    {achados.length > 0 && !escolhido && (
                      <div className="mt-1.5 max-h-40 overflow-y-auto divide-y divide-gray-100 bg-white rounded border border-gray-200">
                        {achados.map(p => (
                          <button key={p.id} onClick={() => setEscolhido(p)} className="w-full text-left px-2 py-1.5 text-xs hover:bg-teal-50 flex justify-between gap-2">
                            <span className="truncate">{p.nome}{p.sku ? <span className="text-gray-400"> · {p.sku}</span> : null}</span>
                            <span className="whitespace-nowrap">
                              {promocaoVigente(p) && <span className="text-orange-600 mr-1">promo</span>}
                              {brl(precoVigente(p))}
                              {p.controlar_estoque && <span className={`ml-1.5 ${Number(p.estoque ?? 0) > 0 ? 'text-gray-400' : 'text-red-600'}`}>est. {Number(p.estoque ?? 0)}</span>}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {escolhido && (
                      <div className="mt-1.5 bg-white rounded border border-gray-200 p-2">
                        <p className="text-[11px] text-gray-500 mb-1">Vai com a foto principal do produto (se houver) e esta legenda:</p>
                        <p className="text-xs whitespace-pre-wrap">{legendaDoProduto(escolhido)}</p>
                        {escolhido.controlar_estoque && Number(escolhido.estoque ?? 0) <= 0 && <p className="text-[11px] text-red-600 mt-1">Sem estoque no sistema.</p>}
                        <div className="flex justify-end gap-2 mt-2">
                          <button onClick={() => setEscolhido(null)} className="text-xs px-2 py-1 text-gray-600">Voltar</button>
                          <button onClick={enviarProduto} disabled={enviando} className="text-xs px-3 py-1 rounded bg-teal-600 text-white disabled:opacity-50">{enviando ? 'Enviando…' : 'Enviar ao cliente'}</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

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
                {aviso && <p className="text-xs text-teal-700 mt-1">{aviso}</p>}
                <p className="text-[11px] text-gray-400 mt-1">Sai pelo WhatsApp da loja (Z-API) e fica no histórico. O que for respondido direto no celular aparece aqui só se a Z-API estiver avisando as mensagens enviadas.</p>
              </>}
            </div>
          </>}
        </div>

        {/* Ficha */}
        <div className="hidden xl:block bg-white border border-gray-200 rounded-xl overflow-y-auto">
          {aberta ? <FichaCliente aberta={aberta} ficha={ficha} /> : <p className="p-4 text-xs text-gray-400">A ficha do cliente aparece aqui.</p>}
        </div>
      </div>
    </div>
  )
}

function FichaCliente({ aberta, ficha }: { aberta: Conversa; ficha: Ficha | null }) {
  if (!aberta.cliente_id || !ficha) return (
    <div className="p-4 text-sm space-y-2">
      <p className="font-medium text-gray-800">Ainda não é cliente</p>
      <p className="text-xs text-gray-500">Cadastre para ver compras, orçamentos e saldo aqui, e para o WhatsApp ligar a conversa ao cadastro.</p>
      <a href={`/dashboard/integracoes/whatsapp/contatos?q=${encodeURIComponent(aberta.nome_whatsapp ?? aberta.telefone)}`}
        className="inline-block text-xs px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700">Cadastrar cliente</a>
    </div>
  )
  const devedor = Number(ficha.saldo_devedor ?? 0), vencido = Number(ficha.valor_vencido ?? 0), credito = Number(ficha.saldo_credito ?? 0)
  const hoje = new Date()
  return (
    <div className="p-4 text-sm space-y-4">
      <div>
        <a href={`/dashboard/clientes/${aberta.cliente_id}`} className="font-medium text-gray-900 hover:underline">{aberta.cliente_nome}</a>
        <div className="flex gap-1 flex-wrap mt-1">
          {ficha.bloqueado_fiado && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 rounded">fiado bloqueado</span>}
          {ficha.opt_out_whatsapp && <span className="text-[10px] bg-gray-200 text-gray-700 px-1.5 rounded">não quer receber WhatsApp</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-gray-50 p-2"><p className="text-gray-500">Em aberto</p><p className={`font-semibold ${devedor > 0 ? 'text-red-700' : 'text-gray-800'}`}>{brl(devedor)}</p></div>
        <div className="rounded-lg bg-gray-50 p-2"><p className="text-gray-500">Vencido</p><p className={`font-semibold ${vencido > 0 ? 'text-red-700' : 'text-gray-800'}`}>{brl(vencido)}</p></div>
        <div className="rounded-lg bg-gray-50 p-2"><p className="text-gray-500">Crédito</p><p className={`font-semibold ${credito > 0 ? 'text-green-700' : 'text-gray-800'}`}>{brl(credito)}</p></div>
        <div className="rounded-lg bg-gray-50 p-2"><p className="text-gray-500">Limite</p><p className="font-semibold text-gray-800">{brl(ficha.limite_credito)}</p></div>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-700 mb-1">Últimas compras</p>
        {ficha.compras.length === 0 ? <p className="text-xs text-gray-400">Nenhuma compra registrada.</p> : (
          <ul className="text-xs divide-y divide-gray-100">
            {ficha.compras.map(v => (
              <li key={v.id} className="py-1 flex justify-between gap-2">
                <span className="text-gray-600">{dia(v.created_at)}{v.numero ? ` · nº ${v.numero}` : ''}{v.canal && v.canal !== 'pdv' ? ` · ${v.canal}` : ''}</span>
                <span className="font-medium">{brl(v.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="text-xs font-medium text-gray-700 mb-1">Orçamentos em aberto</p>
        {ficha.orcamentos.length === 0 ? <p className="text-xs text-gray-400">Nenhum.</p> : (
          <ul className="text-xs divide-y divide-gray-100">
            {ficha.orcamentos.map(o => {
              const venceu = o.validade && new Date(o.validade) < hoje
              return (
                <li key={o.id} className="py-1 flex justify-between gap-2">
                  <span className="text-gray-600">{o.numero ? `nº ${o.numero}` : dia(o.created_at)}
                    {o.validade && <span className={venceu ? 'text-red-600' : 'text-gray-400'}> · {venceu ? 'venceu' : 'vale até'} {dia(o.validade)}</span>}
                  </span>
                  <span className="font-medium">{brl(o.total)}</span>
                </li>
              )
            })}
          </ul>
        )}
        <a href="/dashboard/orcamentos" className="text-[11px] text-blue-600 hover:underline">Ver orçamentos</a>
      </div>
    </div>
  )
}
