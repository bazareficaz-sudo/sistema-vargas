'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Empresa = { empresa_id: string; empresa_nome: string; cnpj: string | null; provider: string | null; configurado: boolean }

const PROVIDERS = [
  { value: 'focusnfe', label: 'Focus NFe' },
  { value: 'brasilnfe', label: 'Brasil NFe' },
]

export default function FiscalAdminClient({ providerPadraoInicial, configId, empresas }: {
  providerPadraoInicial: string; configId: string | null; empresas: Empresa[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [providerPadrao, setProviderPadrao] = useState(providerPadraoInicial)
  const [salvandoPadrao, setSalvandoPadrao] = useState(false)
  const [busca, setBusca] = useState('')
  const [salvandoEmpresa, setSalvandoEmpresa] = useState<string | null>(null)

  async function salvarPadrao() {
    setSalvandoPadrao(true)
    try {
      if (configId) {
        await supabase.from('sistema_config_fiscal').update({ provider_padrao: providerPadrao, updated_at: new Date().toISOString() }).eq('id', configId)
      } else {
        await supabase.from('sistema_config_fiscal').insert({ provider_padrao: providerPadrao })
      }
      router.refresh()
    } finally {
      setSalvandoPadrao(false)
    }
  }

  async function trocarProviderEmpresa(empresaId: string, novoProvider: string) {
    setSalvandoEmpresa(empresaId)
    try {
      await supabase.from('nfe_config').upsert({
        empresa_id: empresaId,
        provider: novoProvider,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'empresa_id' })
      router.refresh()
    } finally {
      setSalvandoEmpresa(null)
    }
  }

  const filtradas = empresas.filter(e => !busca || e.empresa_nome.toLowerCase().includes(busca.toLowerCase()))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Fiscal</h1>
        <p className="text-slate-400 text-sm">Provedor de emissão fiscal — decisão do admin, os assinantes não veem nem trocam isso</p>
      </div>

      <div className="bg-amber-900/30 border border-amber-800 rounded-2xl p-4 text-xs text-amber-200 max-w-2xl">
        <p className="font-semibold mb-1">⚠ Brasil NFe — confiança moderada, sem distribuição DFe</p>
        <p>Emissão/cancelamento de NFC-e validados contra o SDK oficial deles, mas ainda não testados contra a API real — valide em homologação antes de trocar uma empresa em produção. Além disso, a Brasil NFe não tem endpoint de distribuição DFe/manifesto do destinatário: uma empresa nessa configuração perde a tela de entrada (XML de fornecedor), que continua exclusiva da Focus NFe.</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 max-w-md">
        <h2 className="text-sm font-semibold text-white mb-1">Provedor padrão para novos cadastros</h2>
        <p className="text-xs text-slate-400 mb-3">Toda empresa criada a partir de agora recebe este provedor automaticamente.</p>
        <div className="flex gap-2">
          <select value={providerPadrao} onChange={e => setProviderPadrao(e.target.value)}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
            {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <button onClick={salvarPadrao} disabled={salvandoPadrao || providerPadrao === providerPadraoInicial}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium">
            {salvandoPadrao ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Provedor por empresa</h2>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar empresa..."
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 w-56" />
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-800 border-b border-slate-700">
            <tr>
              {['Empresa', 'CNPJ', 'Config. fiscal', 'Provedor', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-400">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filtradas.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-slate-500">Nenhuma empresa encontrada</td></tr>
            ) : filtradas.map(e => (
              <tr key={e.empresa_id} className="hover:bg-slate-800/50 transition-colors">
                <td className="px-4 py-3 font-medium text-white">{e.empresa_nome}</td>
                <td className="px-4 py-3 text-xs text-slate-400 font-mono">{e.cnpj ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                    e.configurado ? 'bg-emerald-900/60 text-emerald-300' : 'bg-amber-900/60 text-amber-300'
                  }`}>
                    {e.configurado ? 'Configurada' : 'Pendente'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={e.provider ?? providerPadrao}
                    disabled={salvandoEmpresa === e.empresa_id}
                    onChange={ev => trocarProviderEmpresa(e.empresa_id, ev.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white disabled:opacity-50">
                    {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {salvandoEmpresa === e.empresa_id ? 'Salvando...' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
