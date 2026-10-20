'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { avisoDeContato, horasAte, tempoDesde } from '@/lib/mercadolivre/atendimentoRegras'
import { DEVOLUCAO_LOJA_RESPONDE, LIMITE_RESPOSTA_AVALIACAO, STATUS_DEVOLUCAO, type AvaliacaoShopee, type DevolucaoShopee } from '@/lib/shopee/atendimentoRegras'

// ATENDIMENTO DA SHOPEE — devoluções e avaliações numa tela. O chat com o
// comprador a Shopee não libera para o app: segue no Seller Centre.

type Aba = 'devolucoes' | 'avaliacoes'

const quando = (iso: string) => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : ''
const brl = (v: number | null) => v == null ? '' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const estrelas = (n: number) => '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(Math.max(0, 5 - n))

const CORES_LOJA = ['bg-orange-100 text-orange-900 border-orange-300', 'bg-sky-100 text-sky-900 border-sky-300', 'bg-violet-100 text-violet-900 border-violet-300']
function Loja({ nome, lojas }: { nome: string; lojas: string[] }) {
  const cor = CORES_LOJA[Math.max(0, lojas.indexOf(nome)) % CORES_LOJA.length]
  return <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${cor}`}>{nome}</span>
}

function Fotos({ urls }: { urls: string[] }) {
  if (!urls.length) return null
  return (
    <div className="flex gap-1.5 flex-wrap">
      {urls.slice(0, 6).map(u => (
        <a key={u} href={u} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u} alt="" loading="lazy" className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
        </a>
      ))}
    </div>
  )
}

function RespostaAvaliacao({ a, onEnviado }: { a: AvaliacaoShopee; onEnviado: () => void }) {
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState<'' | 'sugerindo' | 'enviando'>('')
  const [erro, setErro] = useState('')
  const [enviado, setEnviado] = useState(false)
  const aviso = texto ? avisoDeContato(texto) : null

  async function sugerir() {
    setOcupado('sugerindo'); setErro('')
    const r = await fetch('/api/atendimento/shopee/sugerir', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nota: a.nota, texto: a.texto, produto: a.produto?.titulo }),
    }).then(x => x.json()).catch(() => ({ ok: false, erro: 'Falha de conexão' }))
    setOcupado('')
    if (r.ok) setTexto(r.resposta); else setErro(r.erro ?? 'Não foi possível sugerir')
  }

  async function enviar(forcar = false) {
    if (!texto.trim()) return
    if (!forcar && !confirm('Publicar esta resposta na avaliação? Ela fica visível para todos no anúncio.')) return
    setOcupado('enviando'); setErro('')
    const r = await fetch('/api/atendimento/shopee/responder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canalId: a.canalId, commentId: a.commentId, texto, forcar }),
    }).then(x => x.json()).catch(() => ({ ok: false, erro: 'Falha de conexão' }))
    setOcupado('')
    if (r.ok) { setEnviado(true); onEnviado(); return }
    if (r.aviso) { if (confirm(`${r.aviso}\n\nEnviar mesmo assim?`)) return enviar(true); return }
    setErro(r.erro ?? 'A Shopee recusou')
  }

  if (enviado) return <p className="text-xs text-emerald-700">✅ Resposta publicada na Shopee.</p>
  return (
    <div className="space-y-1.5">
      <textarea value={texto} onChange={e => setTexto(e.target.value.slice(0, LIMITE_RESPOSTA_AVALIACAO))} rows={2}
        placeholder="Resposta pública da loja…" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={sugerir} disabled={!!ocupado} className="px-2.5 py-1 text-xs rounded-lg border border-violet-300 text-violet-700 hover:bg-violet-50 disabled:opacity-50">
          {ocupado === 'sugerindo' ? 'Pensando…' : '✨ Sugerir resposta'}
        </button>
        <button onClick={() => enviar()} disabled={!!ocupado || !texto.trim()} className="px-3 py-1 text-xs font-medium rounded-lg bg-[#ee4d2d] text-white hover:opacity-90 disabled:opacity-50">
          {ocupado === 'enviando' ? 'Publicando…' : 'Responder na Shopee'}
        </button>
        <span className="text-[10px] text-gray-400 ml-auto">{texto.length}/{LIMITE_RESPOSTA_AVALIACAO}</span>
      </div>
      {texto.includes('[') && <p className="text-[11px] text-amber-700">Complete ou apague o que está entre [colchetes] antes de publicar.</p>}
      {aviso && <p className="text-[11px] text-amber-700">⚠ A resposta {aviso} — a Shopee proíbe dado de contato fora da plataforma.</p>}
      {erro && <p className="text-[11px] text-red-600">{erro}</p>}
    </div>
  )
}

export default function AtendimentoShopeeClient({ lojas, devolucoes, avaliacoes, erros }: {
  lojas: string[]; devolucoes: DevolucaoShopee[]; avaliacoes: AvaliacaoShopee[]; erros: string[]
}) {
  const router = useRouter()
  const urgentes = devolucoes.filter(d => d.prazoLoja && horasAte(d.prazoLoja) < 24)
  const [aba, setAba] = useState<Aba>(devolucoes.length ? 'devolucoes' : 'avaliacoes')
  const recarregar = () => setTimeout(() => router.refresh(), 1500)
  const baixas = avaliacoes.filter(a => a.nota <= 3).length

  const abas: [Aba, string, number][] = [
    ['devolucoes', 'Devoluções em andamento', devolucoes.length],
    ['avaliacoes', 'Avaliações sem resposta', avaliacoes.length],
  ]

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Atendimento — Shopee</h1>
          <p className="text-sm text-gray-500">{lojas.length ? `Lojas: ${lojas.join(', ')}.` : 'Nenhuma loja Shopee conectada.'}</p>
        </div>
        <button onClick={() => router.refresh()} className="text-sm text-blue-600 hover:underline">↻ Atualizar</button>
      </div>

      <p className="text-xs bg-gray-50 border border-gray-200 text-gray-600 rounded-lg px-3 py-2">
        💬 O <strong>chat com o comprador</strong> a Shopee não libera para sistemas como este — continue respondendo pelo Seller Centre ou pelo app da Shopee.
      </p>
      {erros.map(e => <p key={e} className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{e}</p>)}
      {urgentes.length > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 text-sm text-red-800">
          ⏰ <strong>{urgentes.length} devolução(ões) com prazo da loja em menos de 24 h.</strong> Sem resposta, a Shopee costuma decidir a favor do comprador.
        </div>
      )}

      <div className="flex gap-2 border-b border-gray-200">
        {abas.map(([id, rotulo, n]) => (
          <button key={id} onClick={() => setAba(id)}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${aba === id ? 'border-[#ee4d2d] text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {rotulo} <span className={`ml-1 text-xs px-1.5 rounded-full ${n ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500'}`}>{n}</span>
          </button>
        ))}
      </div>

      {aba === 'devolucoes' && (
        <div className="space-y-3">
          {devolucoes.length === 0 && <p className="text-sm text-gray-500 py-6 text-center">Nenhuma devolução em andamento. 👏</p>}
          {devolucoes.map(d => {
            const faltam = d.prazoLoja ? horasAte(d.prazoLoja) : null
            return (
              <div key={d.returnSn} className={`bg-white border rounded-xl p-3 space-y-2 ${faltam != null && faltam < 24 ? 'border-red-300' : 'border-gray-200'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2"><Loja nome={d.canalNome} lojas={lojas} /><p className="text-sm font-medium text-gray-900 first-letter:uppercase">{d.motivo}</p></div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {STATUS_DEVOLUCAO[d.status] ?? d.status}{d.negociacao ? ` · ${d.negociacao}` : ''} · aberta em {quando(d.criadaEm)}
                      {' · pedido '}{d.pedidoId ? <Link href={`/dashboard/pedidos-ecommerce?q=${d.pedido}`} className="text-blue-600 hover:underline">{d.pedido}</Link> : d.pedido}
                      {d.valor != null && ` · reembolso ${brl(d.valor)}`}
                    </p>
                  </div>
                  {d.prazoLoja && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${faltam! < 0 ? 'bg-red-600 text-white' : faltam! < 24 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                      {faltam! < 0 ? 'prazo vencido' : `prazo da loja: ${quando(d.prazoLoja)}`}
                    </span>
                  )}
                </div>
                {d.itens.length > 0 && <p className="text-xs text-gray-700">{d.itens.map(i => `${i.quantidade}× ${i.nome}`).join(' · ')}</p>}
                {d.textoComprador && <p className="text-sm text-gray-900 bg-gray-50 rounded-lg px-2.5 py-1.5">“{d.textoComprador}”</p>}
                <Fotos urls={d.fotos} />
                <p className="text-xs text-gray-500">
                  {DEVOLUCAO_LOJA_RESPONDE.has(d.status)
                    ? 'Aceitar, contestar (com fotos/vídeo do envio) ou propor reembolso parcial: no Seller Centre da Shopee, em Devoluções.'
                    : 'Nada a fazer agora pela loja.'}
                  {d.rastreio ? ` Rastreio da devolução: ${d.rastreio}.` : ''}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {aba === 'avaliacoes' && (
        <div className="space-y-3">
          {avaliacoes.length === 0 && <p className="text-sm text-gray-500 py-6 text-center">Todas as avaliações recentes já têm resposta. 👏</p>}
          {baixas > 0 && <p className="text-xs text-gray-500">{baixas} com nota 3 ou menos aparecem primeiro — são as que os próximos compradores mais leem.</p>}
          {avaliacoes.map(a => (
            <div key={a.commentId} className={`bg-white border rounded-xl p-3 space-y-2 ${a.nota <= 3 ? 'border-amber-300' : 'border-gray-200'}`}>
              <div className="flex gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {a.produto?.foto ? <img src={a.produto.foto} alt="" className="w-14 h-14 rounded-lg object-cover border border-gray-100 shrink-0" />
                  : <div className="w-14 h-14 rounded-lg border-2 border-dashed border-gray-200 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Loja nome={a.canalNome} lojas={lojas} />
                    <span className={`text-sm tracking-tight ${a.nota <= 3 ? 'text-amber-600' : 'text-yellow-500'}`} title={`${a.nota} de 5`}>{estrelas(a.nota)}</span>
                    <span className="text-[11px] text-gray-400">@{a.comprador} · há {tempoDesde(a.criadaEm)}</span>
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{a.produto?.titulo ?? `item ${a.itemId}`}</p>
                  <p className="text-sm text-gray-900 mt-0.5">{a.texto ? `“${a.texto}”` : <span className="text-gray-400 italic">só a nota, sem texto</span>}</p>
                </div>
              </div>
              <Fotos urls={a.fotos} />
              <RespostaAvaliacao a={a} onEnviado={recarregar} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
