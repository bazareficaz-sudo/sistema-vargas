'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

type Deposito = { id: string; nome: string; principal: boolean }
type Produto = { id: string; nome: string; sku: string | null; ean: string | null }
type LinhaOrigem = { endereco_id: string; quantidade: number; enderecos: { codigo_legivel: string } | null }
type Endereco = { id: string; codigo_legivel: string; status: string }

export default function TransferenciaInternaClient({ depositos, depositoIdInicial }: {
  depositos: Deposito[]; depositoIdInicial: string
}) {
  const [depositoId, setDepositoId] = useState(depositoIdInicial || depositos.find(d => d.principal)?.id || depositos[0]?.id || '')

  const [buscaProduto, setBuscaProduto] = useState('')
  const [candidatosProduto, setCandidatosProduto] = useState<Produto[]>([])
  const [produto, setProduto] = useState<Produto | null>(null)

  const [origens, setOrigens] = useState<LinhaOrigem[]>([])
  const [origemId, setOrigemId] = useState('')
  const [quantidade, setQuantidade] = useState('')

  const [buscaDestino, setBuscaDestino] = useState('')
  const [candidatosDestino, setCandidatosDestino] = useState<Endereco[]>([])
  const [destinoId, setDestinoId] = useState('')

  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const buscarProdutos = useCallback(async (q: string) => {
    if (!q.trim()) { setCandidatosProduto([]); return }
    const sb = (await import('@/lib/supabase/client')).createClient()
    const { data } = await sb.from('produtos').select('id, nome, sku, ean')
      .or(`nome.ilike.%${q}%,sku.ilike.%${q}%,ean.eq.${q}`).eq('ativo', true).limit(10)
    setCandidatosProduto(data ?? [])
  }, [])

  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => buscarProdutos(buscaProduto), 300)
  }, [buscaProduto, buscarProdutos])

  async function escolherProduto(p: Produto) {
    setProduto(p); setCandidatosProduto([]); setBuscaProduto(p.nome); setOrigemId('')
    const r = await fetch(`/api/enderecamento/produtos?produtoId=${p.id}&depositoId=${depositoId}`).then(r => r.json()).catch(() => null)
    setOrigens(r?.ok ? r.linhas : [])
  }

  const buscarDestinos = useCallback(async (q: string) => {
    if (!depositoId) return
    const sp = new URLSearchParams({ depositoId, status: 'ativo' })
    if (q) sp.set('busca', q)
    const r = await fetch(`/api/enderecamento/enderecos?${sp}`).then(r => r.json()).catch(() => null)
    setCandidatosDestino(r?.ok ? r.enderecos.slice(0, 10) : [])
  }, [depositoId])

  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => buscarDestinos(buscaDestino), 300)
  }, [buscaDestino, buscarDestinos])

  function escolherDestino(e: Endereco) {
    setDestinoId(e.id); setBuscaDestino(e.codigo_legivel); setCandidatosDestino([])
  }

  const origemAtual = origens.find(o => o.endereco_id === origemId)

  async function transferir() {
    if (!produto || !origemId || !destinoId || !quantidade) return
    setEnviando(true); setMsg('')
    const r = await fetch('/api/enderecamento/transferencia', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositoId, enderecoOrigemId: origemId, enderecoDestinoId: destinoId, produtoId: produto.id, quantidade: Number(quantidade) }),
    }).then(r => r.json()).catch(() => ({ ok: false }))
    setEnviando(false)
    if (!r.ok) { setMsg(r.erro ?? 'Erro na transferência.'); return }
    setMsg('Transferência realizada.')
    setQuantidade(''); setOrigemId(''); setDestinoId(''); setBuscaDestino('')
    const r2 = await fetch(`/api/enderecamento/produtos?produtoId=${produto.id}&depositoId=${depositoId}`).then(r => r.json()).catch(() => null)
    setOrigens(r2?.ok ? r2.linhas : [])
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-slate-900 text-xl font-bold">Transferência Interna</h1>
          <p className="text-slate-500 text-sm mt-0.5">Mover estoque entre endereços do mesmo depósito.</p>
        </div>
        {depositos.length > 0 && (
          <select value={depositoId} onChange={e => { setDepositoId(e.target.value); setProduto(null); setOrigens([]) }}
            className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-sm shadow-sm">
            {depositos.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
        )}
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="relative">
          <label className="block text-xs font-medium text-slate-600 mb-1">Produto</label>
          <input value={buscaProduto} onChange={e => { setBuscaProduto(e.target.value); setProduto(null) }}
            placeholder="Nome, SKU ou EAN..." className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          {candidatosProduto.length > 0 && (
            <div className="absolute z-10 bg-white border border-slate-200 rounded-lg shadow-lg mt-1 w-full max-h-48 overflow-y-auto">
              {candidatosProduto.map(p => (
                <button key={p.id} onClick={() => escolherProduto(p)}
                  className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0">
                  {p.nome} <span className="text-xs text-slate-400 font-mono">{p.sku}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {produto && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Endereço de origem</label>
            {origens.length === 0 ? (
              <p className="text-sm text-amber-600">Este produto não tem endereço com saldo neste depósito.</p>
            ) : (
              <select value={origemId} onChange={e => setOrigemId(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                <option value="">Escolha...</option>
                {origens.map(o => <option key={o.endereco_id} value={o.endereco_id}>{o.enderecos?.codigo_legivel} — {o.quantidade} un.</option>)}
              </select>
            )}
          </div>
        )}

        {origemAtual && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Quantidade (disponível: {origemAtual.quantidade})</label>
            <input type="number" min={1} max={origemAtual.quantidade} value={quantidade} onChange={e => setQuantidade(e.target.value)}
              className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        )}

        {origemAtual && (
          <div className="relative">
            <label className="block text-xs font-medium text-slate-600 mb-1">Endereço de destino</label>
            <input value={buscaDestino} onChange={e => { setBuscaDestino(e.target.value); setDestinoId('') }}
              placeholder="Código do endereço..." className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono" />
            {candidatosDestino.length > 0 && !destinoId && (
              <div className="absolute z-10 bg-white border border-slate-200 rounded-lg shadow-lg mt-1 w-full max-h-48 overflow-y-auto">
                {candidatosDestino.filter(e => e.id !== origemId).map(e => (
                  <button key={e.id} onClick={() => escolherDestino(e)}
                    className="block w-full text-left px-3 py-2 text-sm font-mono hover:bg-slate-50 border-b border-slate-50 last:border-0">
                    {e.codigo_legivel}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {msg && <p className={`text-sm ${msg.includes('realizada') ? 'text-emerald-600' : 'text-red-600'}`}>{msg}</p>}

        <button onClick={transferir} disabled={enviando || !origemId || !destinoId || !quantidade}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
          {enviando ? 'Transferindo...' : 'Transferir'}
        </button>
      </div>
    </div>
  )
}
