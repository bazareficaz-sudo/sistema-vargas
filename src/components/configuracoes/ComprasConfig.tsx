'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function ComprasConfig({ empresaId, configInicial }: {
  empresaId: string
  configInicial: { alerta_aumento_custo_ativo?: boolean | null; alerta_aumento_custo_pct?: number | null } | null
}) {
  const sb = createClient()

  const [ativo, setAtivo] = useState<boolean>(configInicial?.alerta_aumento_custo_ativo ?? true)
  const [pct, setPct] = useState<string>(String(configInicial?.alerta_aumento_custo_pct ?? 5))
  const [salvando, setSalvando] = useState(false)
  const [ok, setOk] = useState('')
  const [erro, setErro] = useState('')

  const pctNum = parseFloat(pct.replace(',', '.'))
  const pctValido = !Number.isNaN(pctNum) && pctNum >= 0

  async function salvar() {
    if (!pctValido) { setErro('Informe um percentual válido (0 ou maior).'); return }
    setSalvando(true); setOk(''); setErro('')
    try {
      const { error } = await sb.from('empresa_config_comercial').upsert({
        empresa_id: empresaId,
        alerta_aumento_custo_ativo: ativo,
        alerta_aumento_custo_pct: pctNum,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'empresa_id' })
      if (error) throw error
      setOk('Configuração salva.')
    } catch (e: any) {
      setErro(e?.message ?? 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Compras e Custos</h1>
        <p className="text-slate-500 text-sm mt-1">
          Regras que valem na entrada de mercadoria — o que o sistema deve destacar quando o
          custo de um produto muda em relação ao que estava cadastrado.
        </p>
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-slate-800 font-medium">Alerta de aumento de custo</h2>
            <p className="text-slate-500 text-sm mt-1">
              Na revisão de preços da entrada, todo produto ganha uma seta indicando se o custo
              subiu ou caiu. Quando o aumento passa do limite abaixo, a linha inteira fica em
              vermelho para chamar a atenção.
            </p>
          </div>
          <button type="button" onClick={() => setAtivo(v => !v)}
            aria-pressed={ativo}
            className={`shrink-0 w-11 h-6 rounded-full transition-colors relative ${ativo ? 'bg-red-500' : 'bg-slate-300'}`}>
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${ativo ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className={ativo ? '' : 'opacity-40 pointer-events-none'}>
          <label className="block text-sm text-slate-600 mb-1">Destacar a partir de</label>
          <div className="relative w-40">
            <input type="number" step="0.5" min="0" value={pct}
              onChange={e => setPct(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-blue-400 pr-8" />
            <span className="absolute right-3 top-2 text-xs text-slate-400">%</span>
          </div>
          <p className="text-slate-400 text-xs mt-2">
            Exemplo: com <strong>5%</strong>, um produto que custava R$ 10,00 e passou a custar
            R$ 10,60 (+6%) aparece com a linha vermelha. Um que passou para R$ 10,40 (+4%)
            aparece só com a seta vermelha, sem destaque.
          </p>
          <p className="text-slate-400 text-xs mt-1">
            Usar <strong>0%</strong> destaca qualquer aumento, por menor que seja.
          </p>
        </div>

        {/* As setas continuam aparecendo mesmo com o alerta desligado — o que o
            toggle controla é só o destaque em vermelho da linha, que é o que
            interrompe a leitura de quem está revisando. */}
        {!ativo && (
          <p className="text-slate-500 text-xs bg-slate-50 border border-slate-100 rounded-lg p-3">
            Com o alerta desligado, as setas de aumento e queda continuam aparecendo — só nenhuma
            linha fica destacada em vermelho.
          </p>
        )}

        {ok && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-3 py-2 text-sm">{ok}</div>}
        {erro && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{erro}</div>}

        <div className="flex justify-end">
          <button onClick={salvar} disabled={salvando || !pctValido}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm disabled:opacity-50">
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
