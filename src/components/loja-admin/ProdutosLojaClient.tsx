'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { botao } from '@/components/ui/botao'

type Linha = {
  id: string; nome: string; sku: string | null; marca: string | null; categoria: string | null
  preco: number; estoqueCadastro: number; temFoto: boolean
  status: string; slug: string | null; estoqueLoja: number | null
}

const ROTULO: Record<string, { texto: string; cor: string }> = {
  nao_publicado: { texto: 'Não publicado', cor: 'bg-gray-100 text-gray-600' },
  rascunho:      { texto: 'Rascunho',      cor: 'bg-amber-100 text-amber-800' },
  publicado:     { texto: 'Publicado',     cor: 'bg-green-100 text-green-700' },
  pausado:       { texto: 'Pausado',       cor: 'bg-orange-100 text-orange-700' },
}

const real = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function ProdutosLojaClient({
  lojaId, linhas, total, pagina, porPagina, filtros,
}: {
  lojaId: string
  linhas: Linha[]
  total: number
  pagina: number
  porPagina: number
  filtros: { q: string; status: string; foto: string; estoque: string }
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [busca, setBusca] = useState(filtros.q)

  const paginas = Math.max(Math.ceil(total / porPagina), 1)

  function irPara(mudanca: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(mudanca)) {
      if (v === null || v === '') p.delete(k)
      else p.set(k, v)
    }
    if (!('pagina' in mudanca)) p.delete('pagina')
    router.push(`/dashboard/loja-online/produtos?${p.toString()}`)
  }

  function alternar(id: string) {
    setMarcados(s => {
      const novo = new Set(s)
      novo.has(id) ? novo.delete(id) : novo.add(id)
      return novo
    })
  }

  async function aplicar(status: string) {
    if (marcados.size === 0) return
    setSalvando(true)
    setAviso(null)
    try {
      const r = await fetch('/api/loja-admin/publicar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lojaId, produtoIds: [...marcados], status }),
      })
      const dados = await r.json()
      if (!r.ok) throw new Error(dados.erro ?? 'falhou')
      setAviso(`${dados.afetados} ${dados.afetados === 1 ? 'produto atualizado' : 'produtos atualizados'}.`)
      setMarcados(new Set())
      router.refresh()
    } catch (e) {
      setAviso(e instanceof Error ? `Não deu certo: ${e.message}` : 'Não deu certo.')
    } finally {
      setSalvando(false)
    }
  }

  const todosMarcados = linhas.length > 0 && linhas.every(l => marcados.has(l.id))

  return (
    <div className="space-y-4">
      {/* ── Filtros ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={e => { e.preventDefault(); irPara({ q: busca }) }}
          className="flex min-w-[220px] flex-1 gap-2"
        >
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, código ou EAN"
            className="h-10 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-blue-500"
          />
          <button type="submit" className={botao('secundario')}>Buscar</button>
        </form>

        <select
          value={filtros.status}
          onChange={e => irPara({ status: e.target.value })}
          className="h-10 rounded-lg border border-gray-300 px-2 text-sm"
        >
          <option value="">Todos os estados</option>
          <option value="nao_publicado">Não publicados</option>
          <option value="rascunho">Rascunhos</option>
          <option value="publicado">Publicados</option>
          <option value="pausado">Pausados</option>
        </select>

        <select
          value={filtros.foto}
          onChange={e => irPara({ foto: e.target.value })}
          className="h-10 rounded-lg border border-gray-300 px-2 text-sm"
        >
          <option value="">Com e sem foto</option>
          <option value="com">Só com foto</option>
          <option value="sem">Só sem foto</option>
        </select>

        <select
          value={filtros.estoque}
          onChange={e => irPara({ estoque: e.target.value })}
          className="h-10 rounded-lg border border-gray-300 px-2 text-sm"
        >
          <option value="">Com e sem estoque</option>
          <option value="com">Só com estoque</option>
          <option value="sem">Só sem estoque</option>
        </select>
      </div>

      {/* ── Barra de ação em massa ──────────────────────── */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={todosMarcados}
            onChange={() => setMarcados(todosMarcados ? new Set() : new Set(linhas.map(l => l.id)))}
            className="h-4 w-4"
          />
          Selecionar esta página
        </label>

        <span className="text-sm text-gray-500">
          {marcados.size > 0 ? `${marcados.size} selecionado(s)` : `${total.toLocaleString('pt-BR')} produtos`}
        </span>

        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={() => aplicar('publicado')} disabled={salvando || marcados.size === 0} className={botao('primario')}>
            Publicar
          </button>
          <button onClick={() => aplicar('pausado')} disabled={salvando || marcados.size === 0} className={botao('secundario')}>
            Pausar
          </button>
          <button onClick={() => aplicar('nao_publicado')} disabled={salvando || marcados.size === 0} className={botao('perigo')}>
            Tirar da loja
          </button>
        </div>
      </div>

      {aviso && (
        <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">{aviso}</p>
      )}

      {/* Publicar sem foto é permitido de propósito — mas o operador precisa
          saber que está fazendo isso. Aviso, nunca bloqueio. */}
      {marcados.size > 0 && (() => {
        const semFoto = linhas.filter(l => marcados.has(l.id) && !l.temFoto).length
        const semPreco = linhas.filter(l => marcados.has(l.id) && l.preco <= 0).length
        if (semFoto === 0 && semPreco === 0) return null
        return (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Na seleção:{' '}
            {semFoto > 0 && <><strong>{semFoto}</strong> sem foto</>}
            {semFoto > 0 && semPreco > 0 && ' e '}
            {semPreco > 0 && <><strong>{semPreco}</strong> sem preço</>}
            . Podem ser publicados assim mesmo — a vitrine trata os dois casos.
          </p>
        )
      })()}

      {/* ── Lista ───────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-10 p-3"></th>
              <th className="p-3">Produto</th>
              <th className="p-3">Preço</th>
              <th className="p-3">Estoque</th>
              <th className="p-3">Falta</th>
              <th className="p-3">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhas.map(l => (
              <tr key={l.id} className={marcados.has(l.id) ? 'bg-blue-50/50' : ''}>
                <td className="p-3">
                  <input type="checkbox" checked={marcados.has(l.id)} onChange={() => alternar(l.id)} className="h-4 w-4" />
                </td>
                <td className="p-3">
                  <div className="font-medium text-gray-900">{l.nome}</div>
                  <div className="text-xs text-gray-500">
                    {[l.sku && `Cód. ${l.sku}`, l.marca, l.categoria].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td className="p-3 whitespace-nowrap">
                  {l.preco > 0 ? real(l.preco) : <span className="text-amber-700">sem preço</span>}
                </td>
                <td className="p-3 whitespace-nowrap">
                  <span className={l.estoqueCadastro > 0 ? 'text-gray-900' : 'text-gray-400'}>
                    {l.estoqueCadastro}
                  </span>
                  {/* Diferença entre o cadastro e o que a loja vê: é o efeito
                      da política de estoque, e o operador precisa enxergar. */}
                  {l.estoqueLoja != null && l.estoqueLoja !== l.estoqueCadastro && (
                    <span className="ml-1 text-xs text-amber-700">(loja: {l.estoqueLoja})</span>
                  )}
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {!l.temFoto && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">foto</span>}
                    {l.preco <= 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">preço</span>}
                    {!l.categoria && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">categoria</span>}
                  </div>
                </td>
                <td className="p-3">
                  <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${ROTULO[l.status]?.cor}`}>
                    {ROTULO[l.status]?.texto ?? l.status}
                  </span>
                </td>
              </tr>
            ))}
            {linhas.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-sm text-gray-500">
                Nenhum produto com esses filtros.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {paginas > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => irPara({ pagina: String(pagina - 1) })} disabled={pagina <= 1} className={botao('secundario')}>
            Anterior
          </button>
          <span className="px-2 text-sm text-gray-600">{pagina} de {paginas}</span>
          <button onClick={() => irPara({ pagina: String(pagina + 1) })} disabled={pagina >= paginas} className={botao('secundario')}>
            Próxima
          </button>
        </div>
      )}
    </div>
  )
}
