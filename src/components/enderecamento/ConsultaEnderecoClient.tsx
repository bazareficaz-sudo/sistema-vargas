'use client'

import { useState, useEffect, useCallback } from 'react'

type Produto = { produto_id: string; quantidade: number; papel: string | null; produtos: { nome: string; sku: string | null; ean: string | null } | null }
type Historico = { id: string; tipo: string; quantidade: number; created_at: string; usuario: string | null; motivo: string | null; endereco_origem_id: string | null; endereco_destino_id: string | null }
type Endereco = {
  id: string; codigo_legivel: string; codigo_interno: string; descricao: string | null; tipo: string; status: string
  depositos: { nome: string } | null
}

export default function ConsultaEnderecoClient({ codigoInicial }: { codigoInicial: string }) {
  const [codigo, setCodigo] = useState(codigoInicial)
  const [endereco, setEndereco] = useState<Endereco | null>(null)
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [historico, setHistorico] = useState<Historico[]>([])
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState('')

  const buscar = useCallback(async (valor: string) => {
    if (!valor.trim()) return
    setBuscando(true); setErro('')
    const r = await fetch(`/api/enderecamento/consulta-endereco?codigo=${encodeURIComponent(valor.trim())}`).then(r => r.json()).catch(() => null)
    setBuscando(false)
    if (!r?.ok) { setErro(r?.erro ?? 'Endereço não encontrado.'); setEndereco(null); setProdutos([]); setHistorico([]); return }
    setEndereco(r.endereco); setProdutos(r.produtos); setHistorico(r.historico)
  }, [])

  useEffect(() => { if (codigoInicial) buscar(codigoInicial) }, [codigoInicial, buscar])

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-slate-900 text-xl font-bold">O que existe neste endereço?</h1>
        <p className="text-slate-500 text-sm mt-0.5">Digite ou leia o código do endereço.</p>
      </div>

      <form onSubmit={e => { e.preventDefault(); buscar(codigo) }} className="flex gap-2">
        <input value={codigo} onChange={e => setCodigo(e.target.value)} autoFocus
          placeholder="Ex: A-01-03"
          className="flex-1 border border-slate-300 rounded-xl px-4 py-3 text-base font-mono focus:outline-none focus:border-blue-400" />
        <button type="submit" disabled={buscando}
          className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl">
          {buscando ? 'Buscando...' : 'Buscar'}
        </button>
      </form>

      {erro && <p className="text-sm text-red-600">{erro}</p>}

      {endereco && (
        <>
          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xl font-mono font-bold text-slate-900">{endereco.codigo_legivel}</p>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">{endereco.status}</span>
            </div>
            <p className="text-sm text-slate-500">{endereco.depositos?.nome} · {endereco.tipo}{endereco.descricao ? ` · ${endereco.descricao}` : ''}</p>
          </div>

          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-700 mb-2">Produtos neste endereço</p>
            {produtos.length === 0 ? (
              <p className="text-sm text-slate-400">Vazio.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 uppercase border-b border-slate-100">
                    <th className="py-1.5">Produto</th><th className="py-1.5 text-right">Quantidade</th><th className="py-1.5">Papel</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {produtos.map(p => (
                    <tr key={p.produto_id}>
                      <td className="py-1.5 text-slate-800">{p.produtos?.nome}<span className="text-xs text-slate-400 font-mono ml-1">{p.produtos?.sku}</span></td>
                      <td className="py-1.5 text-right font-medium text-slate-800">{p.quantidade}</td>
                      <td className="py-1.5 text-slate-500">{p.papel ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-700 mb-2">Histórico recente</p>
            {historico.length === 0 ? (
              <p className="text-sm text-slate-400">Sem movimentações registradas.</p>
            ) : (
              <ul className="space-y-1.5">
                {historico.map(h => (
                  <li key={h.id} className="text-xs text-slate-500 flex justify-between">
                    <span>
                      {h.tipo} — {h.quantidade} un.
                      {h.endereco_origem_id === endereco.id ? ' (saída)' : h.endereco_destino_id === endereco.id ? ' (entrada)' : ''}
                      {h.motivo ? ` · ${h.motivo}` : ''}
                    </span>
                    <span>{new Date(h.created_at).toLocaleString('pt-BR')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
