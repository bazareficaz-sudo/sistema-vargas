'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  anuncioAceitaResposta, avisoDeContato, horasAte, LIMITE_MENSAGEM_POS_VENDA, LIMITE_RESPOSTA_PERGUNTA, ROTULO_ACAO, ROTULO_ETAPA, ROTULO_STATUS_ANUNCIO, tempoDesde,
  type ConversaML, type PerguntaML, type ReclamacaoML,
} from '@/lib/mercadolivre/atendimentoRegras'

// ATENDIMENTO DO MERCADO LIVRE — perguntas, reclamações e mensagens numa tela.
// Cada resposta: a pessoa escreve (ou pede uma sugestão à IA, que só usa o
// cadastro do produto), revisa e envia. Nada sai sozinho.

type Aba = 'perguntas' | 'reclamacoes' | 'conversas'
type Envio = { tipo: 'pergunta' | 'reclamacao' | 'conversa'; canalId: string; id: string | number; compradorId?: string | null }

const quando = (iso: string) => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : ''
const brl = (v: number | null) => v == null ? '' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Cada conta com a sua cor — a etiqueta diz de qual conta é a pergunta.
const CORES_CONTA = ['bg-yellow-100 text-yellow-900 border-yellow-300', 'bg-sky-100 text-sky-900 border-sky-300', 'bg-violet-100 text-violet-900 border-violet-300', 'bg-emerald-100 text-emerald-900 border-emerald-300']
function Conta({ nome, contas }: { nome: string; contas: string[] }) {
  const cor = CORES_CONTA[Math.max(0, contas.indexOf(nome)) % CORES_CONTA.length]
  return <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${cor}`}>{nome}</span>
}

function Resposta({ envio, limite, sugestao, onEnviado }: {
  envio: Envio; limite: number
  /** Dados para a IA sugerir; sem eles, não aparece o botão. */
  sugestao?: Record<string, unknown>
  onEnviado: () => void
}) {
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState<'' | 'sugerindo' | 'enviando'>('')
  const [erro, setErro] = useState('')
  const [enviado, setEnviado] = useState(false)
  const aviso = texto ? avisoDeContato(texto) : null

  async function sugerir() {
    setOcupado('sugerindo'); setErro('')
    const r = await fetch('/api/atendimento/ml/sugerir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: envio.tipo, ...sugestao }) })
      .then(x => x.json()).catch(() => ({ ok: false, erro: 'Falha de conexão' }))
    setOcupado('')
    if (r.ok) setTexto(r.resposta); else setErro(r.erro ?? 'Não foi possível sugerir')
  }

  async function enviar(forcar = false) {
    if (!texto.trim()) return
    if (!forcar && !confirm('Enviar esta resposta no Mercado Livre? O comprador vê na hora.')) return
    setOcupado('enviando'); setErro('')
    const r = await fetch('/api/atendimento/ml/responder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...envio, texto, forcar }),
    }).then(x => x.json()).catch(() => ({ ok: false, erro: 'Falha de conexão' }))
    setOcupado('')
    if (r.ok) { setEnviado(true); onEnviado(); return }
    if (r.aviso) { if (confirm(`${r.aviso}\n\nEnviar mesmo assim?`)) return enviar(true); return }
    setErro(r.erro ?? 'O Mercado Livre recusou')
  }

  if (enviado) return <p className="text-xs text-emerald-700">✅ Enviado no Mercado Livre.</p>
  return (
    <div className="space-y-1.5">
      <textarea value={texto} onChange={e => setTexto(e.target.value.slice(0, limite))} rows={3}
        placeholder="Escreva a resposta…" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
      <div className="flex flex-wrap items-center gap-2">
        {sugestao && (
          <button onClick={sugerir} disabled={!!ocupado} className="px-2.5 py-1 text-xs rounded-lg border border-violet-300 text-violet-700 hover:bg-violet-50 disabled:opacity-50">
            {ocupado === 'sugerindo' ? 'Pensando…' : '✨ Sugerir resposta'}
          </button>
        )}
        <button onClick={() => enviar()} disabled={!!ocupado || !texto.trim()} className="px-3 py-1 text-xs font-medium rounded-lg bg-[#2d3277] text-white hover:opacity-90 disabled:opacity-50">
          {ocupado === 'enviando' ? 'Enviando…' : 'Responder no Mercado Livre'}
        </button>
        <span className="text-[10px] text-gray-400 ml-auto">{texto.length}/{limite}</span>
      </div>
      {texto.includes('[') && <p className="text-[11px] text-amber-700">Complete o que está entre [colchetes] antes de enviar.</p>}
      {aviso && <p className="text-[11px] text-amber-700">⚠ A resposta {aviso} — o Mercado Livre proíbe dado de contato fora da plataforma.</p>}
      {erro && <p className="text-[11px] text-red-600">{erro}</p>}
    </div>
  )
}

export default function AtendimentoMLClient({ contas, perguntas, reclamacoes, conversas, erros }: {
  contas: string[]; perguntas: PerguntaML[]; reclamacoes: ReclamacaoML[]; conversas: ConversaML[]; erros: string[]
}) {
  const router = useRouter()
  const urgentes = reclamacoes.filter(r => r.prazo && horasAte(r.prazo) < 24)
  const [aba, setAba] = useState<Aba>(urgentes.length ? 'reclamacoes' : perguntas.length ? 'perguntas' : 'conversas')
  const recarregar = () => setTimeout(() => router.refresh(), 1500)

  const abas: [Aba, string, number][] = [
    ['perguntas', 'Perguntas sem resposta', perguntas.length],
    ['reclamacoes', 'Reclamações abertas', reclamacoes.length],
    ['conversas', 'Mensagens não lidas', conversas.length],
  ]

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Atendimento — Mercado Livre</h1>
          <p className="text-sm text-gray-500">{contas.length ? `Contas: ${contas.join(', ')}.` : 'Nenhuma conta do Mercado Livre conectada.'} Responder rápido conta na reputação.</p>
        </div>
        <button onClick={() => router.refresh()} className="text-sm text-blue-600 hover:underline">↻ Atualizar</button>
      </div>

      {erros.map(e => <p key={e} className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{e}</p>)}

      {urgentes.length > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 text-sm text-red-800">
          ⏰ <strong>{urgentes.length} reclamação(ões) com prazo em menos de 24 h.</strong> Sem resposta no prazo, o Mercado Livre decide a favor do comprador e a reputação cai.
        </div>
      )}

      <div className="flex gap-2 border-b border-gray-200">
        {abas.map(([id, rotulo, n]) => (
          <button key={id} onClick={() => setAba(id)}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${aba === id ? 'border-[#2d3277] text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {rotulo} <span className={`ml-1 text-xs px-1.5 rounded-full ${n ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500'}`}>{n}</span>
          </button>
        ))}
      </div>

      {aba === 'perguntas' && (
        <div className="space-y-3">
          {perguntas.length === 0 && <p className="text-sm text-gray-500 py-6 text-center">Nenhuma pergunta esperando resposta. 👏</p>}
          {perguntas.map(p => (
            <div key={p.id} className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
              <div className="flex gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.item?.foto ? <img src={p.item.foto} alt="" className="w-14 h-14 rounded-lg object-cover border border-gray-100 shrink-0" />
                  : <div className="w-14 h-14 rounded-lg border-2 border-dashed border-gray-200 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Conta nome={p.canalNome} contas={contas} />
                    {!anuncioAceitaResposta(p.item?.status) && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">anúncio {ROTULO_STATUS_ANUNCIO[p.item!.status!] ?? p.item!.status}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate">
                    {p.item?.link ? <a href={p.item.link} target="_blank" rel="noreferrer" className="hover:underline">{p.item.titulo}</a> : (p.item?.titulo ?? p.itemId)}
                    {p.item?.preco != null && ` · ${brl(p.item.preco)}`}
                    {p.item?.estoque != null && ` · ${p.item.estoque > 0 ? 'com estoque' : 'sem estoque'}`}
                  </p>
                  <p className="text-sm text-gray-900 mt-0.5">“{p.texto}”</p>
                  <p className={`text-[11px] mt-0.5 ${horasAte(p.criadaEm) < -24 ? 'text-red-600' : 'text-gray-400'}`}>perguntou há {tempoDesde(p.criadaEm)} · {quando(p.criadaEm)}</p>
                </div>
              </div>
              {anuncioAceitaResposta(p.item?.status) ? (
                <Resposta envio={{ tipo: 'pergunta', canalId: p.canalId, id: p.id }} limite={LIMITE_RESPOSTA_PERGUNTA} onEnviado={recarregar}
                  sugestao={{ pergunta: p.texto, produtoId: p.produtoId, canalId: p.canalId, itemId: p.itemId, anuncio: p.item ? { titulo: p.item.titulo, preco: p.item.preco, estoque: p.item.estoque } : null }} />
              ) : (
                <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  O Mercado Livre só aceita resposta com o anúncio <strong>ativo</strong>. Este está {ROTULO_STATUS_ANUNCIO[p.item!.status!] ?? p.item!.status}
                  {p.item?.estoque === 0 ? ' (sem estoque)' : ''}: reponha o estoque ou reative o anúncio e a pergunta volta a poder ser respondida.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {aba === 'reclamacoes' && (
        <div className="space-y-3">
          {reclamacoes.length === 0 && <p className="text-sm text-gray-500 py-6 text-center">Nenhuma reclamação aberta. 👏</p>}
          {reclamacoes.map(r => {
            const faltam = r.prazo ? horasAte(r.prazo) : null
            const podeResponder = r.acoes.includes('send_message_to_complainant')
            return (
              <div key={r.id} className={`bg-white border rounded-xl p-3 space-y-2 ${faltam != null && faltam < 24 ? 'border-red-300' : 'border-gray-200'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2"><Conta nome={r.canalNome} contas={contas} /><p className="text-sm font-medium text-gray-900">{r.motivo}</p></div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {ROTULO_ETAPA[r.etapa] ?? r.etapa} · aberta em {quando(r.criadaEm)}
                      {r.pedidoExterno && <> · pedido {r.pedidoId
                        ? <Link href={`/dashboard/pedidos-ecommerce?q=${r.pedidoExterno}`} className="text-blue-600 hover:underline">{r.pedidoExterno}</Link>
                        : r.pedidoExterno}</>}
                    </p>
                  </div>
                  {r.prazo && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${faltam! < 0 ? 'bg-red-600 text-white' : faltam! < 24 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                      {faltam! < 0 ? 'prazo vencido' : `prazo: ${quando(r.prazo)}`}
                    </span>
                  )}
                </div>
                {r.acoes.length > 0
                  ? <p className="text-xs text-gray-600">O que você pode fazer: {r.acoes.map(a => ROTULO_ACAO[a] ?? a).join(' · ')}.{r.acoes.some(a => a !== 'send_message_to_complainant') && ' Devolver dinheiro, aceitar devolução ou pedir mediação: no painel do Mercado Livre.'}</p>
                  : <p className="text-xs text-gray-500">Nada a fazer agora — esperando o comprador ou o Mercado Livre.</p>}
                {r.mensagens.length > 0 && (
                  <div className="bg-gray-50 rounded-lg p-2 space-y-1.5 max-h-60 overflow-y-auto">
                    {r.mensagens.map((m, i) => (
                      <div key={i} className={`text-xs ${m.de === 'vendedor' ? 'text-right' : ''}`}>
                        <span className={`inline-block max-w-[85%] rounded-lg px-2 py-1 text-left ${m.de === 'vendedor' ? 'bg-[#d9fdd3]' : m.de === 'mediador' ? 'bg-amber-50 border border-amber-200' : 'bg-white border border-gray-200'}`}>
                          <span className="block text-[10px] text-gray-500">{m.de === 'vendedor' ? 'Loja' : m.de === 'mediador' ? 'Mercado Livre' : 'Comprador'} · {quando(m.em)}</span>
                          <span className="whitespace-pre-wrap">{m.texto}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {podeResponder && (
                  <Resposta envio={{ tipo: 'reclamacao', canalId: r.canalId, id: r.id }} limite={LIMITE_RESPOSTA_PERGUNTA} onEnviado={recarregar}
                    sugestao={{ motivo: r.motivo, historico: r.mensagens.map(m => ({ de: m.de, texto: m.texto })) }} />
                )}
              </div>
            )
          })}
        </div>
      )}

      {aba === 'conversas' && (
        <div className="space-y-3">
          {conversas.length === 0 && <p className="text-sm text-gray-500 py-6 text-center">Nenhuma mensagem não lida. 👏</p>}
          {conversas.map(c => (
            <div key={c.packId} className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
              <p className="text-xs text-gray-500"><Conta nome={c.canalNome} contas={contas} /> venda {c.packId} · {c.naoLidas} não lida(s){c.temReclamacao && ' · tem reclamação (responda pela aba Reclamações)'}</p>
              <div className="bg-gray-50 rounded-lg p-2 space-y-1.5 max-h-60 overflow-y-auto">
                {c.mensagens.map((m, i) => (
                  <div key={i} className={`text-xs ${m.daLoja ? 'text-right' : ''}`}>
                    <span className={`inline-block max-w-[85%] rounded-lg px-2 py-1 text-left ${m.daLoja ? 'bg-[#d9fdd3]' : 'bg-white border border-gray-200'}`}>
                      <span className="block text-[10px] text-gray-500">{m.daLoja ? 'Loja' : 'Comprador'} · {quando(m.em)}</span>
                      <span className="whitespace-pre-wrap">{m.texto}</span>
                    </span>
                  </div>
                ))}
              </div>
              {c.compradorId && !c.temReclamacao && (
                <Resposta envio={{ tipo: 'conversa', canalId: c.canalId, id: c.packId, compradorId: c.compradorId }} limite={LIMITE_MENSAGEM_POS_VENDA} onEnviado={recarregar}
                  sugestao={{ historico: c.mensagens.map(m => ({ de: m.daLoja ? 'loja' : 'comprador', texto: m.texto })) }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
