'use client'

import { useState } from 'react'
import { SEM_GTIN, type AnuncioGtin } from '@/lib/shopee/gtinRegras'

// GTIN NA SHOPEE — sem ele, a Shopee recusa alterar o anúncio (até o
// estoque). A tela varre os anúncios ativos e propõe:
//   • EAN do produto mapeado (marcado para enviar);
//   • "sem GTIN" para produto sem código — o que a própria Shopee oferece
//     (não marcado: a pessoa escolhe). Código inventado não é opção.

type Grupo = 'ean' | 'sem' | 'pendente'
type Estado = { ok: boolean; erro?: string }
const POR_LOTE = 20

const grupoDe = (a: AnuncioGtin): Grupo => !a.proposta ? 'pendente' : a.proposta.origem === 'ean_do_produto' ? 'ean' : 'sem'
const chave = (a: AnuncioGtin) => `${a.canalId}:${a.itemId}`

export default function GtinShopeeClient() {
  const [varrendo, setVarrendo] = useState(false)
  const [dados, setDados] = useState<{ lojas: string[]; anuncios: AnuncioGtin[]; erros: string[] } | null>(null)
  const [erro, setErro] = useState('')
  const [aba, setAba] = useState<Grupo>('ean')
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<Record<string, Estado>>({})

  async function varrer() {
    setVarrendo(true); setErro(''); setResultado({})
    const r = await fetch('/api/marketplace/shopee/gtin/varrer', { method: 'POST' }).then(x => x.json()).catch(() => ({ ok: false, erro: 'Falha de conexão' }))
    setVarrendo(false)
    if (!r.ok) { setErro(r.erro ?? 'Não foi possível varrer'); return }
    setDados(r)
    // Só o EAN do cadastro vem marcado; "sem GTIN" a pessoa escolhe.
    setMarcados(new Set((r.anuncios as AnuncioGtin[]).filter(a => grupoDe(a) === 'ean').map(chave)))
  }

  const anuncios = dados?.anuncios ?? []
  const doGrupo = (g: Grupo) => anuncios.filter(a => grupoDe(a) === g)
  const lista = doGrupo(aba)
  const escolhidos = anuncios.filter(a => a.proposta && marcados.has(chave(a)) && !resultado[chave(a)]?.ok)

  async function enviar() {
    if (!escolhidos.length) return
    const comSem = escolhidos.filter(a => a.proposta?.origem === 'sem_gtin').length
    if (!confirm(`Enviar o GTIN de ${escolhidos.length} anúncio(s) para a Shopee?${comSem ? `\n\n${comSem} vão (no todo ou em alguma variação) como "produto sem GTIN".` : ''}`)) return
    setEnviando(true)
    const porLoja = new Map<string, AnuncioGtin[]>()
    for (const a of escolhidos) porLoja.set(a.canalId, [...(porLoja.get(a.canalId) ?? []), a])
    for (const [canalId, itens] of porLoja) {
      for (let i = 0; i < itens.length; i += POR_LOTE) {
        const lote = itens.slice(i, i + POR_LOTE)
        const r = await fetch('/api/marketplace/shopee/gtin/aplicar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId, itemIds: lote.map(a => a.itemId) }),
        }).then(x => x.json()).catch(() => ({ ok: false, erro: 'Falha de conexão' }))
        setResultado(prev => {
          const n = { ...prev }
          if (!r.ok) for (const a of lote) n[chave(a)] = { ok: false, erro: r.erro ?? 'falhou' }
          else for (const x of r.resultados as { itemId: string; ok: boolean; erro?: string }[]) n[`${canalId}:${x.itemId}`] = { ok: x.ok, erro: x.erro }
          return n
        })
      }
    }
    setEnviando(false)
  }

  const feitos = Object.values(resultado).filter(r => r.ok).length
  const falhas = Object.values(resultado).filter(r => !r.ok).length
  const abas: [Grupo, string, number][] = [
    ['ean', 'Usar o EAN do produto', doGrupo('ean').length],
    ['sem', 'Produto sem EAN', doGrupo('sem').length],
    ['pendente', 'Resolver antes', doGrupo('pendente').length],
  ]

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">GTIN dos anúncios — Shopee</h1>
        <p className="text-sm text-gray-500 max-w-3xl">
          Sem GTIN (código de barras), a Shopee recusa alterar o anúncio — inclusive o estoque, que ela finge aceitar e não aplica.
          Esta tela procura os anúncios ativos sem GTIN e manda o EAN do produto do cadastro.
        </p>
      </div>

      {!dados && (
        <button onClick={varrer} disabled={varrendo} className="px-4 py-2 rounded-lg bg-[#ee4d2d] text-white text-sm font-medium disabled:opacity-60">
          {varrendo ? 'Varrendo os anúncios na Shopee… (até 1 minuto)' : '🔎 Varrer anúncios sem GTIN'}
        </button>
      )}
      {erro && <p className="text-sm text-red-600">{erro}</p>}

      {dados && (
        <>
          {dados.erros.map(e => <p key={e} className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{e}</p>)}
          <div className="flex flex-wrap items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm">
            <span className="text-gray-700">{anuncios.length} anúncio(s) ativo(s) sem GTIN em {dados.lojas.join(', ')}</span>
            {feitos > 0 && <span className="text-emerald-700">✅ {feitos} corrigido(s)</span>}
            {falhas > 0 && <span className="text-red-600">❌ {falhas} recusado(s)</span>}
            <button onClick={varrer} disabled={varrendo || enviando} className="text-blue-600 hover:underline disabled:opacity-50">{varrendo ? 'varrendo…' : '↻ varrer de novo'}</button>
            <button onClick={enviar} disabled={enviando || escolhidos.length === 0}
              className="ml-auto px-4 py-1.5 font-medium rounded-lg bg-gray-900 text-white disabled:opacity-50">
              {enviando ? 'Enviando…' : `Enviar GTIN (${escolhidos.length})`}
            </button>
          </div>

          <div className="flex gap-2 border-b border-gray-200">
            {abas.map(([id, rotulo, n]) => (
              <button key={id} onClick={() => setAba(id)}
                className={`px-3 py-2 text-sm -mb-px border-b-2 ${aba === id ? 'border-[#ee4d2d] text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                {rotulo} <span className="ml-1 text-xs px-1.5 rounded-full bg-gray-100 text-gray-600">{n}</span>
              </button>
            ))}
          </div>

          {aba === 'sem' && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2 space-y-1">
              <p>O produto não tem EAN no cadastro (ou tem só o código interno da loja, que não vale fora dela). O caminho da Shopee para isso é marcar <strong>&quot;produto sem GTIN&quot;</strong> — é o que vai, se você marcar.</p>
              <p>Não geramos código aleatório: GTIN é registrado na GS1 e a Shopee confere; um número inventado pode ser de outro produto e derrubar o anúncio. Se o produto tem código de barras na embalagem, cadastre o EAN no produto e varra de novo.</p>
            </div>
          )}

          {lista.length > 0 && aba !== 'pendente' && (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={lista.every(a => marcados.has(chave(a)))}
                onChange={e => setMarcados(s => { const n = new Set(s); for (const a of lista) e.target.checked ? n.add(chave(a)) : n.delete(chave(a)); return n })} />
              marcar todos desta aba
            </label>
          )}

          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            {lista.length === 0 && <p className="p-6 text-sm text-gray-500 text-center">Nada aqui. 👏</p>}
            {lista.map(a => {
              const r = resultado[chave(a)]
              return (
                <div key={chave(a)} className={`flex items-start gap-3 px-3 py-2 ${r?.ok ? 'bg-emerald-50/50' : r ? 'bg-red-50/40' : ''}`}>
                  <input type="checkbox" className="w-4 h-4" disabled={!a.proposta || enviando || r?.ok}
                    checked={marcados.has(chave(a)) && !!a.proposta}
                    onChange={e => setMarcados(s => { const n = new Set(s); e.target.checked ? n.add(chave(a)) : n.delete(chave(a)); return n })} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {a.foto ? <img src={a.foto} alt="" className="w-10 h-10 rounded object-cover border border-gray-100 shrink-0" /> : <div className="w-10 h-10 rounded border border-dashed border-gray-200 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900 truncate">{a.titulo}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {a.canalNome} · item {a.itemId}{a.produto ? ` · ${a.produto.nome}` : ''}
                      {a.situacao === 'invalido' && a.gtinAtual ? ` · GTIN atual inválido: ${a.gtinAtual}` : ''}
                    </p>
                    {r?.ok && <p className="text-xs text-emerald-700">✅ GTIN aplicado na Shopee</p>}
                    {r && !r.ok && <p className="text-xs text-red-600">❌ {r.erro}</p>}
                    {!a.proposta && <p className="text-xs text-amber-700">{a.pendencia}</p>}
                    {a.temVariacao && a.modelos.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {a.modelos.map(m => (
                          <span key={m.modelId} className={`text-[10px] px-1.5 py-0.5 rounded border ${!m.produto ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-gray-200 bg-gray-50 text-gray-600'}`}
                            title={m.produto ? m.produto.nome : 'variação sem produto mapeado'}>
                            {m.nome}: {!m.proposta ? 'sem produto' : m.proposta.gtin === SEM_GTIN ? 'sem GTIN' : m.proposta.gtin}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {a.proposta && (
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-700 shrink-0">
                      {a.temVariacao ? `${a.modelos.length} variação(ões)` : a.proposta.gtin === SEM_GTIN ? 'sem GTIN' : a.proposta.gtin}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
