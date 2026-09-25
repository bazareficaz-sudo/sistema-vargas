'use client'

import { useEffect, useState } from 'react'

// Conexão com o Vargas Marketing (sistema separado de divulgação).
// O token dá ao Marketing leitura dos produtos com a tag "marketing" desta
// empresa — mais nada. Pode ser cancelado a qualquer momento.

type Token = {
  id: string; nome: string; token_prefixo: string; expira_em: string
  ultimo_uso_em: string | null; total_chamadas: number; revogado_em: string | null
}
const dataBr = (d: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—')

export default function VargasMarketingCard() {
  const [tokens, setTokens] = useState<Token[]>([])
  const [tokenNovo, setTokenNovo] = useState('')
  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState('')
  // Momento de referência para "expirado", fixado na montagem (render puro).
  const [agora] = useState(() => Date.now())

  async function buscar(): Promise<{ tokens?: Token[]; erro?: string }> {
    const res = await fetch('/api/integracoes/marketing/tokens')
    const d = await res.json().catch(() => ({}))
    return d.ok ? { tokens: d.tokens } : { erro: d.erro ?? 'Erro ao carregar' }
  }
  async function carregar() {
    const r = await buscar()
    if (r.tokens) setTokens(r.tokens)
    else setErro(r.erro ?? '')
  }
  useEffect(() => {
    let vivo = true
    buscar().then(r => {
      if (!vivo) return
      if (r.tokens) setTokens(r.tokens)
      else setErro(r.erro ?? '')
    })
    return () => { vivo = false }
  }, [])

  async function gerar() {
    setGerando(true); setErro('')
    try {
      const res = await fetch('/api/integracoes/marketing/tokens', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: 'Vargas Marketing' }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.erro)
      setTokenNovo(d.token)
      carregar()
    } catch (e: unknown) { setErro(e instanceof Error ? e.message : 'Erro ao gerar') } finally { setGerando(false) }
  }

  async function revogar(id: string) {
    if (!confirm('Cancelar este código? O Vargas Marketing para de receber o catálogo até um novo código ser colado lá.')) return
    await fetch(`/api/integracoes/marketing/tokens?id=${id}`, { method: 'DELETE' })
    carregar()
  }

  return (
    <div className="mb-5 bg-white border border-emerald-200 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-slate-800 mb-1">Vargas Marketing</h2>
      <p className="text-xs text-slate-500 mb-3">
        Envia para o Vargas Marketing os produtos marcados com a tag <b>marketing</b>: nome, preço, promoção,
        disponibilidade e fotos. Não envia custo, fornecedor, clientes, vendas nem dados fiscais.
        Gere o código e cole em <b>Vargas Marketing → Conexões</b>.
      </p>

      {tokenNovo && (
        <div className="mb-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
          <p className="text-xs font-semibold text-emerald-800 mb-1.5">Copie agora — este código não será mostrado de novo:</p>
          <div className="flex gap-2">
            <input readOnly value={tokenNovo} onFocus={e => e.target.select()}
              className="flex-1 px-2 py-1.5 text-xs font-mono border border-emerald-300 rounded bg-white" />
            <button onClick={() => navigator.clipboard.writeText(tokenNovo)}
              className="px-3 py-1.5 text-xs font-medium rounded bg-emerald-600 text-white">Copiar</button>
            <button onClick={() => setTokenNovo('')} className="px-3 py-1.5 text-xs text-emerald-700">Já copiei</button>
          </div>
        </div>
      )}

      <button onClick={gerar} disabled={gerando}
        className="mb-3 px-4 py-1.5 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white">
        {gerando ? 'Gerando...' : 'Gerar código de conexão'}
      </button>

      {erro && <p className="text-xs text-red-600 mb-2">{erro}</p>}

      {tokens.length > 0 && (
        <div className="border border-slate-100 rounded-lg divide-y divide-slate-100">
          {tokens.map(t => {
            const expirado = new Date(t.expira_em).getTime() < agora
            const inativo = !!t.revogado_em || expirado
            return (
              <div key={t.id} className={`px-3 py-2 flex items-center gap-3 ${inativo ? 'opacity-50' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-700">{t.nome}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{t.token_prefixo}… · válido até {dataBr(t.expira_em)}</p>
                </div>
                <div className="text-[10px] text-slate-500 text-right">
                  <p>{t.total_chamadas} consulta(s)</p>
                  <p>{t.ultimo_uso_em ? `último uso ${dataBr(t.ultimo_uso_em)}` : 'nunca usado'}</p>
                </div>
                {t.revogado_em ? <span className="text-[10px] text-red-600 font-medium">cancelado</span>
                  : expirado ? <span className="text-[10px] text-amber-600 font-medium">expirado</span>
                  : <button onClick={() => revogar(t.id)} className="text-xs text-red-600 underline">cancelar</button>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
