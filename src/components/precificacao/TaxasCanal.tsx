'use client'

import { useState } from 'react'
import type { ConfigTaxas, ItemCusto } from '@/lib/precificacao/tipos'
import CampoNumero from './CampoNumero'

// Editor das taxas de um canal. Tudo que o motor usa pra calcular está aqui —
// nenhuma alíquota fica escrita em código, então uma mudança da Shopee ou do
// Mercado Livre se resolve nesta tela, sem depender de nova versão do sistema.

const inputCls = 'border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500'

export default function TaxasCanal({ canal, configInicial, origem, onSalvo }: {
  canal: { id: string; nome: string; plataforma: string }
  configInicial: ConfigTaxas & { faixasSaude?: { critica: number; baixa: number; saudavel: number } }
  origem: 'canal' | 'plataforma' | 'preset'
  onSalvo: () => void
}) {
  const [aberto, setAberto] = useState(origem === 'preset')
  const [cfg, setCfg] = useState({ ...configInicial, canalId: canal.id })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState(false)

  function set<K extends keyof typeof cfg>(campo: K, valor: (typeof cfg)[K]) {
    setCfg(c => ({ ...c, [campo]: valor })); setOk(false)
  }

  async function salvar() {
    setSalvando(true); setErro(''); setOk(false)
    try {
      const resp = await fetch('/api/precificacao/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { ...cfg, canalId: canal.id, plataforma: canal.plataforma } }),
      })
      const d = await resp.json()
      if (!d.ok) { setErro(d.erro ?? 'Erro ao salvar'); return }
      setOk(true); onSalvo()
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button onClick={() => setAberto(a => !a)} className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-gray-50">
        <div className="text-left">
          <p className="text-sm font-medium text-gray-900">{canal.nome}</p>
          <p className="text-xs text-gray-400 capitalize">
            {canal.plataforma}
            {origem === 'preset' && <span className="text-amber-700"> · ainda não configurado (usando valores de partida)</span>}
            {origem === 'plataforma' && <span> · herdando a configuração padrão da plataforma</span>}
          </p>
        </div>
        <span className="text-gray-400 text-sm">{aberto ? '▲' : '▼'}</span>
      </button>

      {aberto && (
        <div className="px-5 pb-5 space-y-5 border-t border-gray-100 pt-4">
          {/* ── Comissão ── */}
          <Secao titulo="Comissão do marketplace">
            <div className="flex flex-wrap gap-1.5 mb-3">
              {([
                ['faixas', 'Tabela por faixa de preço'],
                ['simples', 'Percentual único'],
                ...(canal.plataforma === 'mercadolivre' ? [['api_ml', 'Buscar do Mercado Livre']] : []),
              ] as [string, string][]).map(([v, label]) => (
                <button key={v} onClick={() => set('comissaoModo', v as any)}
                  className={`px-3 py-1.5 text-xs rounded-lg border ${cfg.comissaoModo === v ? 'border-blue-400 bg-blue-50 text-blue-800 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {label}
                </button>
              ))}
            </div>

            {cfg.comissaoModo === 'api_ml' && (
              <p className="text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-3">
                A alíquota é consultada no Mercado Livre por categoria e faixa de preço, e guardada por 12 horas.
                Medido na sua conta: a mesma categoria cobra 11,5% num item de R$ 25 e 10,5% num de R$ 250 —
                por isso um percentual único erraria. A tabela abaixo continua valendo como reserva, quando a
                categoria não é conhecida.
              </p>
            )}

            {cfg.comissaoModo === 'simples' ? (
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-600">Percentual
                  <CampoNumero valor={cfg.comissaoPercentual} onChange={v => set('comissaoPercentual', v ?? 0)}
                    className={`${inputCls} w-24 ml-2`} />
                </label>
                <label className="text-xs text-gray-600">+ valor fixo R$
                  <CampoNumero valor={cfg.comissaoFixo} onChange={v => set('comissaoFixo', v ?? 0)}
                    className={`${inputCls} w-24 ml-2`} />
                </label>
              </div>
            ) : (
              <FaixasEditor faixas={cfg.comissaoFaixas} onChange={f => set('comissaoFaixas', f)} />
            )}
          </Secao>

          {/* ── Frete ── */}
          <Secao titulo="Frete pago pelo vendedor">
            <div className="flex flex-wrap gap-1.5 mb-3">
              {([
                ['nao', 'Não pago frete'],
                ['gratis_acima', 'Grátis acima de um valor'],
                ['fixo', 'Valor fixo'],
                ['faixa_peso', 'Tabela por peso'],
              ] as [string, string][]).map(([v, label]) => (
                <button key={v} onClick={() => set('freteModo', v as any)}
                  className={`px-3 py-1.5 text-xs rounded-lg border ${cfg.freteModo === v ? 'border-blue-400 bg-blue-50 text-blue-800 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {label}
                </button>
              ))}
            </div>

            {cfg.freteModo === 'gratis_acima' && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs text-gray-600">Frete grátis a partir de R$
                  <CampoNumero valor={cfg.freteLimiteGratis} onChange={v => set('freteLimiteGratis', v ?? 0)}
                    className={`${inputCls} w-24 ml-2`} />
                </label>
                <label className="text-xs text-gray-600">Custo médio que sobra pra mim R$
                  <CampoNumero valor={cfg.freteCustoMedio} onChange={v => set('freteCustoMedio', v ?? 0)}
                    className={`${inputCls} w-24 ml-2`} />
                </label>
              </div>
            )}
            {cfg.freteModo === 'fixo' && (
              <label className="text-xs text-gray-600">Valor por venda R$
                <CampoNumero valor={cfg.freteValor} onChange={v => set('freteValor', v ?? 0)}
                  className={`${inputCls} w-24 ml-2`} />
              </label>
            )}
            {cfg.freteModo === 'faixa_peso' && (
              <PesoEditor faixas={cfg.freteFaixas} onChange={f => set('freteFaixas', f)} />
            )}
            {cfg.freteModo === 'gratis_acima' && (
              <p className="text-xs text-gray-400 mt-2">
                O Mercado Livre descontinuou a consulta automática do custo de frete grátis, então esse valor
                precisa vir de você — tire a média dos seus últimos envios.
              </p>
            )}
          </Secao>

          {/* ── Custos ── */}
          <Secao titulo="Embalagem e imposto">
            <div className="space-y-2">
              <ItemUnico rotulo="Embalagem" item={cfg.embalagem} onChange={i => set('embalagem', i)}
                dica="Caixa, fita, plástico bolha, etiqueta. Costuma ser um valor fixo por pedido." />
              <ItemUnico rotulo="Imposto" item={cfg.imposto} onChange={i => set('imposto', i)}
                dica="No Simples, o percentual da sua faixa do DAS. Incide sobre o preço de venda." />
            </div>
          </Secao>

          <Secao titulo="Outras taxas do marketplace">
            <ListaItens itens={cfg.taxas} onChange={t => set('taxas', t)}
              sugestoes={['Taxa por pedido', 'Taxa financeira', 'Antecipação', 'Tarifa Pix', 'Fulfillment']} />
          </Secao>

          <Secao titulo="Custos adicionais">
            <ListaItens itens={cfg.custosExtras} onChange={c => set('custosExtras', c)}
              sugestoes={['Marketing / Ads', 'Comissão do vendedor', 'Cupom / cashback', 'Devoluções médias', 'Perdas médias', 'Armazenagem']} />
          </Secao>

          {/* ── Saúde e prazo ── */}
          <Secao titulo="Prazo e faixas de saúde">
            <div className="flex flex-wrap items-center gap-4">
              <label className="text-xs text-gray-600">Recebo em
                <CampoNumero valor={cfg.diasRecebimento} onChange={v => set('diasRecebimento', v)}
                  className={`${inputCls} w-16 mx-2`} />dias
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <span className="text-xs text-gray-500">Margem líquida:</span>
              {([
                ['critica', '🟠 crítica abaixo de'],
                ['baixa', '🟡 baixa abaixo de'],
                ['saudavel', '🟢 saudável abaixo de'],
              ] as const).map(([k, label]) => (
                <label key={k} className="text-xs text-gray-600">{label}
                  <CampoNumero valor={(cfg.faixasSaude as any)?.[k]}
                    onChange={v => set('faixasSaude' as any, { ...(cfg.faixasSaude ?? { critica: 5, baixa: 10, saudavel: 20 }), [k]: v ?? 0 } as any)}
                    className={`${inputCls} w-16 mx-1.5`} />%
                </label>
              ))}
              <span className="text-xs text-gray-400">acima disso, 💎</span>
            </div>
          </Secao>

          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}

          <div className="flex items-center justify-end gap-3">
            {ok && <span className="text-xs text-green-700">Salvo.</span>}
            <button onClick={salvar} disabled={salvando}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {salvando ? 'Salvando...' : 'Salvar taxas deste canal'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">{titulo}</p>
      {children}
    </div>
  )
}

function FaixasEditor({ faixas, onChange }: { faixas: any[]; onChange: (f: any[]) => void }) {
  function editar(i: number, campo: string, valor: any) {
    const nova = faixas.map((f, idx) => idx === i ? { ...f, [campo]: valor } : f)
    onChange(nova)
  }
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 text-[11px] text-gray-500 px-1">
        <span>De R$</span><span>Até R$</span><span>Percentual</span><span>+ fixo R$</span><span />
      </div>
      {faixas.map((f, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-center">
          <CampoNumero valor={f.min} onChange={v => editar(i, 'min', v ?? 0)} className={inputCls} />
          <CampoNumero valor={f.max} placeholder="sem teto" onChange={v => editar(i, 'max', v)} className={inputCls} />
          <CampoNumero valor={f.percentual} onChange={v => editar(i, 'percentual', v ?? 0)} className={inputCls} />
          <CampoNumero valor={f.fixo} onChange={v => editar(i, 'fixo', v ?? 0)} className={inputCls} />
          <button onClick={() => onChange(faixas.filter((_, idx) => idx !== i))}
            className="text-gray-300 hover:text-red-500 px-1">×</button>
        </div>
      ))}
      <button onClick={() => onChange([...faixas, { min: 0, max: null, percentual: 0, fixo: 0 }])}
        className="text-xs text-blue-600 hover:text-blue-800">+ adicionar faixa</button>
    </div>
  )
}

function PesoEditor({ faixas, onChange }: { faixas: any[]; onChange: (f: any[]) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-[11px] text-gray-500 px-1">
        <span>Até (kg)</span><span>Custo R$</span><span />
      </div>
      {faixas.map((f, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
          <CampoNumero valor={f.pesoAte} onChange={v => onChange(faixas.map((x, idx) => idx === i ? { ...x, pesoAte: v ?? 0 } : x))} className={inputCls} />
          <CampoNumero valor={f.valor} onChange={v => onChange(faixas.map((x, idx) => idx === i ? { ...x, valor: v ?? 0 } : x))} className={inputCls} />
          <button onClick={() => onChange(faixas.filter((_, idx) => idx !== i))} className="text-gray-300 hover:text-red-500 px-1">×</button>
        </div>
      ))}
      <button onClick={() => onChange([...faixas, { pesoAte: 1, valor: 0 }])}
        className="text-xs text-blue-600 hover:text-blue-800">+ adicionar faixa de peso</button>
    </div>
  )
}

function ItemUnico({ rotulo, item, onChange, dica }: {
  rotulo: string; item: ItemCusto | null; onChange: (i: ItemCusto | null) => void; dica: string
}) {
  if (!item) {
    return (
      <button onClick={() => onChange({ nome: rotulo, tipo: 'fixo', valor: 0 })}
        className="text-xs text-blue-600 hover:text-blue-800 block">+ configurar {rotulo.toLowerCase()}</button>
    )
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-700 w-24">{rotulo}</span>
        <select value={item.tipo} onChange={e => onChange({ ...item, tipo: e.target.value as any })} className={inputCls}>
          <option value="fixo">R$ fixo</option>
          <option value="percentual">%</option>
        </select>
        <CampoNumero valor={item.valor} onChange={v => onChange({ ...item, valor: v ?? 0 })}
          className={`${inputCls} w-24`} />
        {item.tipo === 'percentual' && (
          <select value={item.base ?? 'preco'} onChange={e => onChange({ ...item, base: e.target.value as any })} className={inputCls}>
            <option value="preco">do preço</option>
            <option value="custo">do custo</option>
          </select>
        )}
        <button onClick={() => onChange(null)} className="text-gray-300 hover:text-red-500 px-1">×</button>
      </div>
      <p className="text-[11px] text-gray-400 mt-0.5 ml-24 pl-2">{dica}</p>
    </div>
  )
}

function ListaItens({ itens, onChange, sugestoes }: {
  itens: ItemCusto[]; onChange: (i: ItemCusto[]) => void; sugestoes: string[]
}) {
  function editar(i: number, campo: string, valor: any) {
    onChange(itens.map((x, idx) => idx === i ? { ...x, [campo]: valor } : x))
  }
  return (
    <div className="space-y-1.5">
      {itens.map((item, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <input value={item.nome} onChange={e => editar(i, 'nome', e.target.value)}
            placeholder="Nome" className={`${inputCls} flex-1 min-w-[10rem]`} />
          <select value={item.tipo} onChange={e => editar(i, 'tipo', e.target.value)} className={inputCls}>
            <option value="fixo">R$ fixo</option>
            <option value="percentual">%</option>
          </select>
          <CampoNumero valor={item.valor} onChange={v => editar(i, 'valor', v ?? 0)}
            className={`${inputCls} w-24`} />
          {item.tipo === 'percentual' && (
            <select value={item.base ?? 'preco'} onChange={e => editar(i, 'base', e.target.value)} className={inputCls}>
              <option value="preco">do preço</option>
              <option value="custo">do custo</option>
            </select>
          )}
          <button onClick={() => onChange(itens.filter((_, idx) => idx !== i))} className="text-gray-300 hover:text-red-500 px-1">×</button>
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {sugestoes.filter(s => !itens.some(i => i.nome === s)).map(s => (
          <button key={s} onClick={() => onChange([...itens, { nome: s, tipo: 'percentual', valor: 0, base: 'preco' }])}
            className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">+ {s}</button>
        ))}
      </div>
    </div>
  )
}
