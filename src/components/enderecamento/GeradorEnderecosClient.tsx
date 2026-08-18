'use client'

import { useState } from 'react'

type Deposito = { id: string; nome: string; principal: boolean }
type Tipo = { codigo: string; nome: string }
type ModoFaixa = 'faixa' | 'lista'
type Nivel = 'zona' | 'corredor' | 'estante' | 'modulo' | 'nivel' | 'posicao'

const NIVEIS: { chave: Nivel; label: string; exemplo: string }[] = [
  { chave: 'zona', label: 'Zona', exemplo: 'A' },
  { chave: 'corredor', label: 'Corredor', exemplo: '01' },
  { chave: 'estante', label: 'Estante', exemplo: '01' },
  { chave: 'modulo', label: 'Módulo', exemplo: '01' },
  { chave: 'nivel', label: 'Nível', exemplo: '01' },
  { chave: 'posicao', label: 'Posição', exemplo: '01' },
]

type Config = { ativo: boolean; modo: ModoFaixa; de: string; ate: string; lista: string }

export default function GeradorEnderecosClient({ depositos, tipos, depositoIdInicial }: {
  depositos: Deposito[]; tipos: Tipo[]; depositoIdInicial: string
}) {
  const [depositoId, setDepositoId] = useState(depositoIdInicial || depositos.find(d => d.principal)?.id || depositos[0]?.id || '')
  const [tipo, setTipo] = useState(tipos[0]?.codigo ?? 'ARMAZENAGEM')
  const [config, setConfig] = useState<Record<Nivel, Config>>(
    Object.fromEntries(NIVEIS.map(n => [n.chave, { ativo: false, modo: 'faixa', de: '', ate: '', lista: '' }])) as Record<Nivel, Config>
  )
  const [gerando, setGerando] = useState(false)
  const [resultado, setResultado] = useState<{ criados: number; jaExistiam: number; total: number } | null>(null)
  const [erro, setErro] = useState('')

  function atualizar(nivel: Nivel, patch: Partial<Config>) {
    setConfig(prev => ({ ...prev, [nivel]: { ...prev[nivel], ...patch } }))
  }

  async function gerar() {
    setGerando(true); setErro(''); setResultado(null)
    const faixas: Record<string, { de: string; ate: string } | { valores: string[] }> = {}
    for (const n of NIVEIS) {
      const c = config[n.chave]
      if (!c.ativo) continue
      faixas[n.chave] = c.modo === 'lista'
        ? { valores: c.lista.split(',').map(v => v.trim()).filter(Boolean) }
        : { de: c.de, ate: c.ate }
    }
    if (Object.keys(faixas).length === 0) { setGerando(false); setErro('Ative ao menos um nível.'); return }

    const r = await fetch('/api/enderecamento/enderecos/gerador', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositoId, tipo, faixas }),
    }).then(r => r.json()).catch(() => ({ ok: false }))
    setGerando(false)
    if (!r.ok) { setErro(r.erro ?? 'Erro ao gerar.'); return }
    setResultado(r)
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-slate-900 text-xl font-bold">Gerador de Endereços em Lote</h1>
        <p className="text-slate-500 text-sm mt-0.5">Informe faixas por nível — o sistema gera todas as combinações.</p>
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex gap-3 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Depósito</label>
            <select value={depositoId} onChange={e => setDepositoId(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm min-w-[180px]">
              {depositos.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tipo dos endereços gerados</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm min-w-[180px]">
              {tipos.map(t => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-3">
          {NIVEIS.map(n => {
            const c = config[n.chave]
            return (
              <div key={n.chave} className="border border-slate-100 rounded-xl p-3">
                <label className="flex items-center gap-2 cursor-pointer mb-2">
                  <input type="checkbox" checked={c.ativo} onChange={e => atualizar(n.chave, { ativo: e.target.checked })} className="accent-blue-600" />
                  <span className="text-sm font-medium text-slate-700">{n.label}</span>
                </label>
                {c.ativo && (
                  <div className="pl-6 space-y-2">
                    <div className="flex gap-3 text-xs">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input type="radio" checked={c.modo === 'faixa'} onChange={() => atualizar(n.chave, { modo: 'faixa' })} className="accent-blue-600" />
                        Faixa (de-até)
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input type="radio" checked={c.modo === 'lista'} onChange={() => atualizar(n.chave, { modo: 'lista' })} className="accent-blue-600" />
                        Lista (separada por vírgula)
                      </label>
                    </div>
                    {c.modo === 'faixa' ? (
                      <div className="flex gap-2 items-center">
                        <input value={c.de} onChange={e => atualizar(n.chave, { de: e.target.value })} placeholder={`de (ex: ${n.exemplo})`}
                          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm w-28" />
                        <span className="text-slate-400 text-xs">até</span>
                        <input value={c.ate} onChange={e => atualizar(n.chave, { ate: e.target.value })} placeholder="até"
                          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm w-28" />
                      </div>
                    ) : (
                      <input value={c.lista} onChange={e => atualizar(n.chave, { lista: e.target.value })} placeholder="A, B, C"
                        className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm w-full" />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {erro && <p className="text-sm text-red-600">{erro}</p>}
        {resultado && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-800">
            {resultado.criados} endereço(s) criado(s) de {resultado.total} combinação(ões)
            {resultado.jaExistiam > 0 ? ` — ${resultado.jaExistiam} já existiam.` : '.'}
          </div>
        )}

        <button onClick={gerar} disabled={gerando || !depositoId}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
          {gerando ? 'Gerando...' : 'Gerar Endereços'}
        </button>
      </div>
    </div>
  )
}
