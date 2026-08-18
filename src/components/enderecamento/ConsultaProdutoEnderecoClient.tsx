'use client'

import { useState, useRef, useEffect } from 'react'

type LinhaEndereco = {
  endereco_id: string; deposito_id: string; quantidade: number; quantidade_reservada: number; papel: string | null
  enderecos: { codigo_legivel: string; tipo: string; status: string } | null
}
type ResultadoProduto = {
  produto: { id: string; nome: string; sku: string | null; ean: string | null }
  estoqueTotal: number; enderecado: number; naoEnderecado: number
  enderecoPrincipal: LinhaEndereco | null
  enderecos: LinhaEndereco[]
}

export default function ConsultaProdutoEnderecoClient({ buscaInicial = '' }: { buscaInicial?: string }) {
  const [busca, setBusca] = useState(buscaInicial)
  const [resultados, setResultados] = useState<ResultadoProduto[]>([])
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function buscar(valor: string) {
    if (!valor.trim()) return
    setBuscando(true); setErro('')
    const r = await fetch(`/api/enderecamento/consulta-produto?busca=${encodeURIComponent(valor.trim())}`).then(r => r.json()).catch(() => null)
    setBuscando(false)
    if (!r?.ok) { setErro(r?.erro ?? 'Erro na busca.'); setResultados([]); return }
    setResultados(r.produtos)
  }

  useEffect(() => { if (buscaInicial) buscar(buscaInicial) }, [buscaInicial])

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-slate-900 text-xl font-bold">Onde está este produto?</h1>
        <p className="text-slate-500 text-sm mt-0.5">Busque por nome, SKU, EAN ou leia com um leitor USB.</p>
      </div>

      <form onSubmit={e => { e.preventDefault(); buscar(busca) }} className="flex gap-2">
        <input ref={inputRef} value={busca} onChange={e => setBusca(e.target.value)} autoFocus
          placeholder="Nome, SKU ou EAN..."
          className="flex-1 border border-slate-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-blue-400" />
        <button type="submit" disabled={buscando}
          className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl">
          {buscando ? 'Buscando...' : 'Buscar'}
        </button>
      </form>

      {erro && <p className="text-sm text-red-600">{erro}</p>}

      {resultados.length === 0 && !buscando && busca && !erro && (
        <p className="text-sm text-slate-400">Nenhum produto encontrado.</p>
      )}

      {resultados.map(r => (
        <div key={r.produto.id} className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="font-semibold text-slate-900">{r.produto.nome}</p>
              <p className="text-xs text-slate-400 font-mono">{r.produto.sku ?? '—'} {r.produto.ean ? `· ${r.produto.ean}` : ''}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-slate-900">{r.estoqueTotal}</p>
              <p className="text-xs text-slate-400">unidades</p>
            </div>
          </div>

          {r.enderecoPrincipal && (
            <p className="text-xs bg-blue-50 text-blue-700 inline-block px-2 py-1 rounded-full mb-2 font-medium">
              Endereço principal: {r.enderecoPrincipal.enderecos?.codigo_legivel}
            </p>
          )}

          {r.enderecos.length === 0 ? (
            <p className="text-sm text-amber-600">Sem endereço — {r.naoEnderecado} unidade(s) não endereçada(s).</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 uppercase border-b border-slate-100">
                  <th className="py-1.5">Endereço</th><th className="py-1.5">Tipo</th><th className="py-1.5 text-right">Quantidade</th><th className="py-1.5">Papel</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {r.enderecos.map(l => (
                  <tr key={l.endereco_id}>
                    <td className="py-1.5 font-mono font-medium text-slate-800">{l.enderecos?.codigo_legivel}</td>
                    <td className="py-1.5 text-slate-500">{l.enderecos?.tipo}</td>
                    <td className="py-1.5 text-right font-medium text-slate-800">{l.quantidade}</td>
                    <td className="py-1.5 text-slate-500">{l.papel ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {r.enderecado > 0 && r.naoEnderecado > 0 && (
            <p className="text-xs text-amber-600 mt-2">+ {r.naoEnderecado} unidade(s) ainda sem endereço.</p>
          )}
        </div>
      ))}
    </div>
  )
}
