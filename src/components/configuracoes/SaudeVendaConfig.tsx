'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { FAIXAS_PADRAO, CONFIG_PADRAO, type FaixaSaude, type SaudeConfig } from '@/lib/saude-venda'

type Tab = 'taxas' | 'faixas'

const FORMAS_LABEL: Record<string, string> = {
  pix: 'PIX', dinheiro: 'Dinheiro', debito: 'Débito',
  credito: 'Crédito', carteira: 'Carteira', fiado: 'Fiado',
}
const TODAS_FORMAS = ['pix', 'dinheiro', 'debito', 'credito', 'carteira', 'fiado']

function uid() { return Math.random().toString(36).slice(2, 9) }

export default function SaudeVendaConfig({ empresaId, configInicial, faixasIniciais, role }: {
  empresaId: string
  configInicial: any | null
  faixasIniciais: any[]
  role: string
}) {
  const sb = createClient()
  const [tab, setTab] = useState<Tab>('taxas')
  const [salvando, setSalvando] = useState(false)
  const [ok, setOk] = useState('')
  const [erro, setErro] = useState('')

  // ── Taxas ──────────────────────────────────────────────────────
  const initCfg: SaudeConfig = { ...CONFIG_PADRAO, ...(configInicial ?? {}) }
  const [cfg, setCfg] = useState<SaudeConfig>(initCfg)
  function setCfgField(k: keyof SaudeConfig, v: any) { setCfg(p => ({ ...p, [k]: v })) }

  // ── Faixas ─────────────────────────────────────────────────────
  const initFaixas: FaixaSaude[] = faixasIniciais.length > 0
    ? faixasIniciais
    : FAIXAS_PADRAO.map(f => ({ ...f, id: uid() }))
  const [faixas, setFaixas] = useState<FaixaSaude[]>(initFaixas)

  function updateFaixa(id: string, patch: Partial<FaixaSaude>) {
    setFaixas(p => p.map(f => f.id === id ? { ...f, ...patch } : f))
  }
  function toggleFormaPermitida(fId: string, forma: string) {
    const f = faixas.find(x => x.id === fId)!
    const curr = f.formas_permitidas ?? TODAS_FORMAS
    const next = curr.includes(forma) ? curr.filter(x => x !== forma) : [...curr, forma]
    updateFaixa(fId, { formas_permitidas: next.length === TODAS_FORMAS.length ? null : next })
  }

  async function salvarTaxas() {
    setSalvando(true); setOk(''); setErro('')
    try {
      const payload = { empresa_id: empresaId, ...cfg, updated_at: new Date().toISOString() }
      const { error } = await sb.from('saude_config').upsert(payload, { onConflict: 'empresa_id' })
      if (error) throw error
      setOk('Taxas salvas com sucesso!')
    } catch (e: any) { setErro(e?.message ?? 'Erro ao salvar.') }
    finally { setSalvando(false) }
  }

  async function salvarFaixas() {
    setSalvando(true); setOk(''); setErro('')
    try {
      await sb.from('saude_faixas').delete().eq('empresa_id', empresaId)
      const rows = faixas.map((f, i) => ({
        empresa_id: empresaId, nome: f.nome, emoji: f.emoji, cor: f.cor, cor_fundo: f.cor_fundo,
        margem_min: f.margem_min, margem_max: f.margem_max, desconto_max_pct: f.desconto_max_pct,
        exige_autorizacao: f.exige_autorizacao, bloqueia_venda: f.bloqueia_venda,
        mensagem_vendedor: f.mensagem_vendedor, mensagem_gerente: f.mensagem_gerente,
        formas_permitidas: f.formas_permitidas, formas_bloqueadas: f.formas_bloqueadas,
        permite_parcelamento: f.permite_parcelamento, max_parcelas: f.max_parcelas,
        ordem: i + 1, ativo: true,
      }))
      const { error } = await sb.from('saude_faixas').insert(rows)
      if (error) throw error
      setOk('Faixas salvas com sucesso!')
    } catch (e: any) { setErro(e?.message ?? 'Erro ao salvar.') }
    finally { setSalvando(false) }
  }

  function numInput(val: number, onChange: (v: number) => void, suffix = '%') {
    return (
      <div className="relative">
        <input type="number" step="0.01" value={val}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-blue-400 pr-8" />
        <span className="absolute right-3 top-2 text-xs text-slate-400">{suffix}</span>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Saúde da Venda</h1>
        <p className="text-slate-500 text-sm mt-1">Configure taxas, custos e faixas de lucratividade para proteger a margem da empresa.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {([['taxas','💲 Taxas & Custos'],['faixas','📊 Faixas de Saúde']] as [Tab,string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* ── TAB TAXAS ──────────────────────────────────────────────── */}
      {tab === 'taxas' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-6">
            <h3 className="font-semibold text-slate-700 mb-4">Taxas por forma de pagamento</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {([['taxa_pix_pct','PIX'],['taxa_dinheiro_pct','Dinheiro'],['taxa_debito_pct','Débito'],
                 ['taxa_credito_vista_pct','Crédito à vista'],['taxa_credito_parc_pct','Crédito (+por parcela)'],
                 ['taxa_carteira_pct','Carteira'],['taxa_fiado_pct','Fiado']] as [keyof SaudeConfig, string][])
                .map(([k, l]) => (
                  <div key={k}>
                    <label className="block text-xs font-medium text-slate-500 mb-1">{l}</label>
                    {numInput(cfg[k] as number, v => setCfgField(k, v))}
                  </div>
                ))}
            </div>
          </div>

          <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-6">
            <h3 className="font-semibold text-slate-700 mb-4">Custos operacionais</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Imposto estimado</label>
                {numInput(cfg.imposto_pct, v => setCfgField('imposto_pct', v))}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Custo operacional</label>
                {numInput(cfg.custo_operacional_pct, v => setCfgField('custo_operacional_pct', v))}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Comissão do vendedor</label>
                {numInput(cfg.comissao_vendedor_pct, v => setCfgField('comissao_vendedor_pct', v))}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Custo de embalagem</label>
                {numInput(cfg.custo_embalagem, v => setCfgField('custo_embalagem', v), 'R$')}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Frete subsidiado</label>
                {numInput(cfg.frete_subsidiado_pct, v => setCfgField('frete_subsidiado_pct', v))}
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-6">
            <h3 className="font-semibold text-slate-700 mb-4">Metas de margem</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Margem mínima desejada</label>
                {numInput(cfg.margem_minima_desejada, v => setCfgField('margem_minima_desejada', v))}
                <p className="text-xs text-slate-400 mt-1">Meta ideal de margem líquida</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Margem mínima absoluta</label>
                {numInput(cfg.margem_minima_absoluta, v => setCfgField('margem_minima_absoluta', v))}
                <p className="text-xs text-slate-400 mt-1">Abaixo disso, venda em risco</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-6">
            <h3 className="font-semibold text-slate-700 mb-4">Visibilidade para vendedores</h3>
            <div className="space-y-3">
              {([
                ['exibir_custo_vendedor', 'Exibir custo do produto'],
                ['exibir_lucro_vendedor', 'Exibir lucro estimado'],
                ['exibir_margem_vendedor', 'Exibir margem percentual'],
              ] as [keyof SaudeConfig, string][]).map(([k, l]) => (
                <div key={k} className="flex items-center gap-3">
                  <button type="button" onClick={() => setCfgField(k, !cfg[k])}
                    className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${cfg[k] ? 'bg-blue-500' : 'bg-slate-300'}`}>
                    <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${cfg[k] ? 'left-5' : 'left-1'}`} />
                  </button>
                  <span className="text-sm text-slate-700">{l}</span>
                </div>
              ))}
            </div>
          </div>

          <button onClick={salvarTaxas} disabled={salvando}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors">
            {salvando ? 'Salvando…' : 'Salvar taxas'}
          </button>
        </div>
      )}

      {/* ── TAB FAIXAS ─────────────────────────────────────────────── */}
      {tab === 'faixas' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">Configure as faixas de saúde da venda. As margens são calculadas sobre o valor líquido após todos os custos.</p>

          {faixas.map((f, fi) => (
            <div key={f.id} className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
              {/* Cabeçalho */}
              <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-50" style={{ background: f.cor_fundo }}>
                <input value={f.emoji} onChange={e => updateFaixa(f.id, { emoji: e.target.value })}
                  className="w-10 text-2xl text-center bg-transparent border-none outline-none" />
                <input value={f.nome} onChange={e => updateFaixa(f.id, { nome: e.target.value })}
                  className="flex-1 text-sm font-bold bg-transparent border-none outline-none text-slate-800" />
                <div className="flex items-center gap-2">
                  <input type="color" value={f.cor} onChange={e => updateFaixa(f.id, { cor: e.target.value })}
                    className="w-7 h-7 rounded cursor-pointer border border-slate-200" />
                  <input type="color" value={f.cor_fundo} onChange={e => updateFaixa(f.id, { cor_fundo: e.target.value })}
                    className="w-7 h-7 rounded cursor-pointer border border-slate-200" title="Cor de fundo" />
                </div>
              </div>

              <div className="p-5 space-y-4">
                {/* Margens */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Margem mín. (%)</label>
                    <input type="number" step="0.1"
                      value={f.margem_min ?? ''}
                      placeholder="Sem limite"
                      onChange={e => updateFaixa(f.id, { margem_min: e.target.value === '' ? null : parseFloat(e.target.value) })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Margem máx. (%)</label>
                    <input type="number" step="0.1"
                      value={f.margem_max ?? ''}
                      placeholder="Sem limite"
                      onChange={e => updateFaixa(f.id, { margem_max: e.target.value === '' ? null : parseFloat(e.target.value) })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Desconto máx. (%)</label>
                    <input type="number" step="0.1" value={f.desconto_max_pct}
                      onChange={e => updateFaixa(f.id, { desconto_max_pct: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Máx. parcelas</label>
                    <input type="number" min="1" max="60" value={f.max_parcelas}
                      onChange={e => updateFaixa(f.id, { max_parcelas: parseInt(e.target.value) || 1 })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                  </div>
                </div>

                {/* Formas de pagamento permitidas */}
                <div>
                  <label className="text-xs text-slate-500 mb-2 block">Formas de pagamento permitidas <span className="text-slate-400">(todas = sem restrição)</span></label>
                  <div className="flex flex-wrap gap-2">
                    {TODAS_FORMAS.map(forma => {
                      const permitidas = f.formas_permitidas ?? TODAS_FORMAS
                      const ativa = permitidas.includes(forma)
                      return (
                        <button key={forma} type="button" onClick={() => toggleFormaPermitida(f.id, forma)}
                          className={`text-xs px-3 py-1.5 rounded-xl border transition-colors ${ativa ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                          {FORMAS_LABEL[forma]}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Controles */}
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={f.permite_parcelamento}
                      onChange={e => updateFaixa(f.id, { permite_parcelamento: e.target.checked })}
                      className="rounded" />
                    Permite parcelamento
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={f.exige_autorizacao}
                      onChange={e => updateFaixa(f.id, { exige_autorizacao: e.target.checked })}
                      className="rounded" />
                    Exige autorização
                  </label>
                  <label className="flex items-center gap-2 text-sm text-red-700 cursor-pointer">
                    <input type="checkbox" checked={f.bloqueia_venda}
                      onChange={e => updateFaixa(f.id, { bloqueia_venda: e.target.checked })}
                      className="rounded" />
                    Bloqueia venda
                  </label>
                </div>

                {/* Mensagens */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Mensagem para vendedor</label>
                    <input value={f.mensagem_vendedor ?? ''} onChange={e => updateFaixa(f.id, { mensagem_vendedor: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Mensagem para gerente</label>
                    <input value={f.mensagem_gerente ?? ''} onChange={e => updateFaixa(f.id, { mensagem_gerente: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-400" />
                  </div>
                </div>
              </div>
            </div>
          ))}

          <button onClick={salvarFaixas} disabled={salvando}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors">
            {salvando ? 'Salvando…' : 'Salvar faixas'}
          </button>
        </div>
      )}

      {ok && <div className="fixed bottom-6 right-6 bg-emerald-600 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-lg">{ok}</div>}
      {erro && <div className="fixed bottom-6 right-6 bg-red-600 text-white text-sm px-4 py-3 rounded-xl shadow-lg">{erro}</div>}
    </div>
  )
}
