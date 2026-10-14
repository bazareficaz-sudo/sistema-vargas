'use client'

import { useEffect, useMemo, useState } from 'react'
import { inicioDoDia } from '@/lib/datas'
import { promocaoVigente } from '@/lib/produtos/promocao'
import type { ItemChegada } from '@/lib/getulio/chegadasRegras'

// PDV › "Chegou hoje": o que entrou nas notas de hoje, para o vendedor que
// não viu o grupo. Mesma lista do boletim da Betina (getulio_chegadas) —
// novidades e o que voltou ao estoque em destaque, reposição recolhida.
// Clicar em "Adicionar" põe o produto no carrinho.

type Linha = ItemChegada & { rotulo: string | null }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const ATUALIZAR_MS = 5 * 60_000

/* eslint-disable @typescript-eslint/no-explicit-any -- cliente Supabase sem tipos gerados, como no resto do PDV */

export default function ChegouHoje({ sb, empresaId, onAdicionar }: {
  sb: any
  empresaId: string
  onAdicionar: (produtoId: string) => void
}) {
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [ultimaChegada, setUltimaChegada] = useState<string | null>(null)
  const [aberto, setAberto] = useState(false)
  const [verReposicao, setVerReposicao] = useState(false)
  const chaveVisto = `pdv-chegou-hoje-visto:${empresaId}`
  const [visto, setVisto] = useState<string | null>(() => {
    try { return typeof window === 'undefined' ? null : localStorage.getItem(chaveVisto) } catch { return null }
  })

  useEffect(() => {
    let vivo = true
    async function carregar() {
      const { data, error } = await sb.from('getulio_chegadas')
        .select('rotulo, itens, created_at')
        .eq('empresa_id', empresaId).gte('created_at', inicioDoDia().toISOString())
        .order('created_at', { ascending: true })
      // Tabela ainda não criada ou sem acesso: o PDV segue sem o aviso.
      if (!vivo || error) return
      const porProduto = new Map<string, Linha>()
      for (const b of (data ?? []) as { rotulo: string | null; itens: ItemChegada[] | null }[]) {
        for (const i of b.itens ?? []) {
          if (i.semPreco) continue
          const anterior = porProduto.get(i.produtoId)
          // Duas notas no dia com o mesmo produto: vale a classe mais
          // importante e o dado mais novo.
          const peso = (c: string) => (c === 'novidade' ? 0 : c === 'voltou' ? 1 : 2)
          const classe = anterior && peso(anterior.classe) < peso(i.classe) ? anterior.classe : i.classe
          porProduto.set(i.produtoId, { ...i, classe, clientesEsperando: Math.max(i.clientesEsperando, anterior?.clientesEsperando ?? 0), rotulo: b.rotulo })
        }
      }
      // Estoque e preço de AGORA, não os do momento da nota: o item pode já
      // ter vendido ou ter tido o preço corrigido.
      const ids = [...porProduto.keys()]
      for (let i = 0; i < ids.length; i += 150) {
        const { data: atuais } = await sb.from('produtos')
          .select('id, estoque, preco_venda, preco_promocional, promocao_ativa, promocao_inicio, promocao_fim, ativo')
          .in('id', ids.slice(i, i + 150))
        for (const p of (atuais ?? []) as any[]) {
          const l = porProduto.get(p.id)
          if (!l) continue
          if (p.ativo === false || !(Number(p.preco_venda) > 0)) { porProduto.delete(p.id); continue }
          porProduto.set(p.id, {
            ...l, estoque: Number(p.estoque ?? 0), preco: Number(p.preco_venda),
            promo: promocaoVigente(p) ? Number(p.preco_promocional) : null,
          })
        }
      }
      if (!vivo) return
      setLinhas([...porProduto.values()])
      const ult = (data ?? []).at(-1) as { created_at: string } | undefined
      setUltimaChegada(ult?.created_at ?? null)
    }
    carregar()
    const t = setInterval(carregar, ATUALIZAR_MS)
    return () => { vivo = false; clearInterval(t) }
  }, [sb, empresaId])

  useEffect(() => {
    if (!aberto) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.stopPropagation(); setAberto(false) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [aberto])

  const novidades = useMemo(() => linhas.filter(l => l.classe === 'novidade').sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [linhas])
  const voltaram = useMemo(() => linhas.filter(l => l.classe === 'voltou').sort((a, b) => b.clientesEsperando - a.clientesEsperando || a.nome.localeCompare(b.nome, 'pt-BR')), [linhas])
  const repostos = useMemo(() => linhas.filter(l => l.classe === 'reposicao').sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [linhas])

  if (linhas.length === 0) return null

  const destaque = novidades.length + voltaram.length
  const novo = !!ultimaChegada && (!visto || ultimaChegada > visto)

  function abrir() {
    setAberto(true)
    if (ultimaChegada) {
      setVisto(ultimaChegada)
      try { localStorage.setItem(chaveVisto, ultimaChegada) } catch { /* ok */ }
    }
  }

  function adicionar(id: string) {
    setAberto(false)
    onAdicionar(id)
  }

  const linhaItem = (l: Linha) => (
    <li key={l.produtoId} className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-900 truncate">{l.nome}</p>
        <p className="text-[11px] text-gray-500">
          {l.sku && <span className="font-mono mr-2">{l.sku}</span>}
          {l.promo != null
            ? <><span className="text-orange-600 font-semibold">🔥 {brl(l.promo)}</span> <span className="line-through">{brl(l.preco)}</span></>
            : <span className="text-gray-700 font-medium">{brl(l.preco)}</span>}
          {' · '}{l.estoque} {l.unidade.toLowerCase()}
          {l.localizacao && <> · 📍 {l.localizacao}</>}
          {l.clientesEsperando > 0 && <span className="text-emerald-700 font-medium"> · 👥 {l.clientesEsperando} cliente{l.clientesEsperando > 1 ? 's' : ''} esperando</span>}
        </p>
      </div>
      <button onClick={() => adicionar(l.produtoId)} className="shrink-0 px-2.5 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700">+ Adicionar</button>
    </li>
  )

  return (
    <>
      <button onClick={abrir} title="Mercadoria que chegou hoje"
        className={`flex items-center gap-1 px-2.5 py-1.5 rounded whitespace-nowrap border transition-colors ${
          novo ? 'bg-emerald-600 text-white border-emerald-700 animate-pulse' : 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50'}`}>
        🆕 Chegou hoje
        <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${novo ? 'bg-white text-emerald-700' : 'bg-emerald-100 text-emerald-800'}`}>
          {destaque || linhas.length}
        </span>
      </button>

      {aberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setAberto(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">🆕 Chegou hoje na loja</h3>
              <button onClick={() => setAberto(false)} className="text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
            </div>
            <div className="overflow-y-auto">
              {novidades.length > 0 && (
                <section>
                  <p className="px-4 pt-3 pb-1 text-xs font-semibold text-emerald-700 uppercase tracking-wide">Novidades ({novidades.length})</p>
                  <ul className="divide-y divide-gray-100">{novidades.map(linhaItem)}</ul>
                </section>
              )}
              {voltaram.length > 0 && (
                <section>
                  <p className="px-4 pt-3 pb-1 text-xs font-semibold text-blue-700 uppercase tracking-wide">Voltaram ao estoque ({voltaram.length})</p>
                  <ul className="divide-y divide-gray-100">{voltaram.map(linhaItem)}</ul>
                </section>
              )}
              {repostos.length > 0 && (
                <section className="pb-2">
                  <button onClick={() => setVerReposicao(v => !v)} className="w-full text-left px-4 pt-3 pb-1 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:text-gray-700">
                    {verReposicao ? '▾' : '▸'} Reposição ({repostos.length})
                  </button>
                  {verReposicao && <ul className="divide-y divide-gray-100">{repostos.map(linhaItem)}</ul>}
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
