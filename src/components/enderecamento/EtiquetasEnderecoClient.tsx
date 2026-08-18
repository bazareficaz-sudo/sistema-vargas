'use client'

import { useState, useEffect, useCallback } from 'react'
import { LAYOUTS_ENDERECO, type LayoutEtiquetaEndereco } from '@/lib/etiquetas/tiposEndereco'

type Deposito = { id: string; nome: string; principal: boolean }
type Endereco = { id: string; codigo_interno: string; codigo_legivel: string; descricao: string | null; tipo: string; status: string; zona: string | null; corredor: string | null; estante: string | null; modulo: string | null; nivel: string | null; posicao: string | null }

export default function EtiquetasEnderecoClient({ depositos, depositoIdInicial }: {
  depositos: Deposito[]; depositoIdInicial: string
}) {
  const [depositoId, setDepositoId] = useState(depositoIdInicial || depositos.find(d => d.principal)?.id || depositos[0]?.id || '')
  const [enderecos, setEnderecos] = useState<Endereco[]>([])
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [layout, setLayout] = useState<LayoutEtiquetaEndereco>('termica')
  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    if (!depositoId) return
    const r = await fetch(`/api/enderecamento/enderecos?depositoId=${depositoId}&status=ativo`).then(r => r.json()).catch(() => null)
    setEnderecos(r?.ok ? r.enderecos : [])
    setSelecionados(new Set())
  }, [depositoId])

  useEffect(() => { carregar() }, [carregar])

  function toggleAll(checked: boolean) { setSelecionados(checked ? new Set(enderecos.map(e => e.id)) : new Set()) }
  function toggleOne(id: string) { setSelecionados(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }

  async function imprimir() {
    if (selecionados.size === 0) return
    setGerando(true); setErro('')
    try {
      const deposito = depositos.find(d => d.id === depositoId)
      const { gerarEtiquetasEnderecoPdfBlob, abrirPdfEnderecoEmNovaAba } = await import('@/lib/etiquetas/gerarPdfEndereco')
      const lista = enderecos.filter(e => selecionados.has(e.id)).map(e => ({
        id: e.id, codigoInterno: e.codigo_interno, codigoLegivel: e.codigo_legivel, descricao: e.descricao,
        depositoNome: deposito?.nome ?? '', tipo: e.tipo,
        zona: e.zona, corredor: e.corredor, estante: e.estante, modulo: e.modulo, nivel: e.nivel, posicao: e.posicao,
      }))
      const blob = await gerarEtiquetasEnderecoPdfBlob(lista, layout)
      abrirPdfEnderecoEmNovaAba(blob)
    } catch {
      setErro('Erro ao gerar o PDF das etiquetas.')
    }
    setGerando(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-slate-900 text-xl font-bold">Etiquetas de Endereço</h1>
          <p className="text-slate-500 text-sm mt-0.5">Selecione os endereços e gere o PDF com QR Code.</p>
        </div>
        <div className="flex gap-2 items-center">
          {depositos.length > 0 && (
            <select value={depositoId} onChange={e => setDepositoId(e.target.value)}
              className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-sm shadow-sm">
              {depositos.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
            </select>
          )}
          <select value={layout} onChange={e => setLayout(e.target.value as LayoutEtiquetaEndereco)}
            className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-sm shadow-sm">
            {LAYOUTS_ENDERECO.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <button onClick={imprimir} disabled={gerando || selecionados.size === 0}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
            {gerando ? 'Gerando...' : `Imprimir ${selecionados.size} etiqueta(s)`}
          </button>
        </div>
      </div>

      {erro && <p className="text-sm text-red-600">{erro}</p>}

      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="w-10 px-4 py-2.5">
                <input type="checkbox" checked={selecionados.size === enderecos.length && enderecos.length > 0}
                  onChange={e => toggleAll(e.target.checked)} className="accent-blue-600" />
              </th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase">Código</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase">Descrição</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase">Tipo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {enderecos.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-slate-400">Nenhum endereço ativo neste depósito.</td></tr>}
            {enderecos.map(e => (
              <tr key={e.id} className="hover:bg-slate-50/50">
                <td className="px-4 py-2"><input type="checkbox" checked={selecionados.has(e.id)} onChange={() => toggleOne(e.id)} className="accent-blue-600" /></td>
                <td className="px-3 py-2 font-mono font-medium text-slate-800">{e.codigo_legivel}</td>
                <td className="px-3 py-2 text-slate-600">{e.descricao ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">{e.tipo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
