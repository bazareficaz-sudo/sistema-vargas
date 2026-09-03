'use client'

import { useState } from 'react'
import { explicarRegraEstoque } from '@/lib/marketplace/regraEstoque'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const ARREDONDAMENTO_LABEL: Record<string, string> = {
  nenhum: 'sem arredondamento',
  terminar_90: 'terminar em ,90',
  terminar_99: 'terminar em ,99',
  cima_inteiro: 'arredondar para cima (inteiro)',
}

type Regra = {
  id: string
  nome: string
  modo_preco: 'nao' | 'fixo' | 'percentual' | 'formula' | 'shopee_liquido' | 'produto'
  valor_preco: number | null
  arredondamento: 'nenhum' | 'terminar_90' | 'terminar_99' | 'cima_inteiro'
  valor_embalagem: number | null
  percentual_imposto: number | null
  modo_estoque: 'nao' | 'fixo' | 'produto' | 'deposito'
  valor_estoque: number | null
  deposito_id: string | null
  estoque_complementar: number | null
  estoque_risco: number | null
  considerar_subsidio_pix: boolean
  ativo: boolean
}

type Deposito = { id: string; nome: string }

const FORM_VAZIO = {
  nome: '',
  modo_preco: 'nao' as Regra['modo_preco'],
  valor_preco: '',
  arredondamento: 'nenhum' as Regra['arredondamento'],
  valor_embalagem: '',
  percentual_imposto: '',
  modo_estoque: 'nao' as Regra['modo_estoque'],
  valor_estoque: '',
  deposito_id: '',
  estoque_complementar: '',
  estoque_risco: '',
  considerar_subsidio_pix: false,
  ativo: true,
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

export default function RegrasPrecoClient({ canal, regras: regrasIniciais, depositos, empresaId }: {
  canal: any; regras: Regra[]; depositos: Deposito[]; empresaId: string
}) {
  const router = useRouter()
  const [regras, setRegras] = useState(regrasIniciais)
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<Regra | null>(null)
  const [form, setForm] = useState(FORM_VAZIO)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  function f(k: string, v: any) { setForm(p => ({ ...p, [k]: v })) }

  function nomeDeposito(id: string | null) {
    if (!id) return ''
    return depositos.find(d => d.id === id)?.nome ?? '—'
  }

  function resumoRegra(r: Regra) {
    const partes: string[] = []
    if (r.modo_preco === 'fixo') partes.push(`Preço fixo: ${fmt(Number(r.valor_preco ?? 0))}`)
    else if (r.modo_preco === 'percentual') partes.push(`Ajuste sobre o atual: ${Number(r.valor_preco ?? 0) > 0 ? '+' : ''}${r.valor_preco}%`)
    else if (r.modo_preco === 'formula') partes.push(`Fórmula: custo × markup ${r.valor_preco}%`)
    else if (r.modo_preco === 'shopee_liquido') partes.push(`Margem líquida ${r.valor_preco}% sobre custo (Shopee${r.considerar_subsidio_pix ? ' + Pix' : ''})`)
    else if (r.modo_preco === 'produto') partes.push('Preço do produto vinculado')
    if (r.modo_preco !== 'nao' && r.modo_preco !== 'fixo' && r.arredondamento !== 'nenhum') {
      partes.push(ARREDONDAMENTO_LABEL[r.arredondamento])
    }
    if ((r.modo_preco === 'formula' || r.modo_preco === 'shopee_liquido') && Number(r.valor_embalagem ?? 0) > 0) {
      partes.push(`+ embalagem ${fmt(Number(r.valor_embalagem))}`)
    }
    if (r.modo_preco === 'shopee_liquido' && Number(r.percentual_imposto ?? 0) > 0) {
      partes.push(`+ imposto ${r.percentual_imposto}%`)
    }
    if (r.modo_estoque === 'fixo') partes.push(`Estoque fixo: ${r.valor_estoque}`)
    else if (r.modo_estoque === 'produto') partes.push('Estoque do produto vinculado')
    else if (r.modo_estoque === 'deposito') partes.push(`Estoque do depósito "${nomeDeposito(r.deposito_id)}"`)
    if (r.modo_estoque !== 'nao' && Number(r.estoque_complementar ?? 0) !== 0) {
      partes.push(`+ complementar ${r.estoque_complementar}`)
    }
    if (r.modo_estoque !== 'nao' && r.estoque_risco != null) {
      // O RISCO É COMPARADO DEPOIS DO COMPLEMENTO. Dizer "pausa se estoque ≤
      // 1000" fala do valor ENVIADO, não do que existe na prateleira — e com
      // complemento 1000 o anúncio na verdade só pausa quando o saldo real
      // zera. O resumo passa a falar do saldo real.
      const e = explicarRegraEstoque({
        complementar: r.estoque_complementar, risco: r.estoque_risco,
      })
      partes.push(e.nuncaPausa
        ? `NUNCA pausa (risco ${r.estoque_risco} < complemento ${r.estoque_complementar})`
        : `pausa com estoque real ≤ ${e.pausaComSaldoReal}`)
    }
    return partes.length > 0 ? partes.join(' · ') : 'Nenhuma alteração configurada'
  }

  function abrirNova() {
    setEditando(null)
    setForm(FORM_VAZIO)
    setErro('')
    setModal(true)
  }

  function abrirEditar(r: Regra) {
    setEditando(r)
    setForm({
      nome: r.nome,
      modo_preco: r.modo_preco,
      valor_preco: r.valor_preco != null ? String(r.valor_preco) : '',
      arredondamento: r.arredondamento,
      valor_embalagem: r.valor_embalagem != null && r.valor_embalagem !== 0 ? String(r.valor_embalagem) : '',
      percentual_imposto: r.percentual_imposto != null && r.percentual_imposto !== 0 ? String(r.percentual_imposto) : '',
      modo_estoque: r.modo_estoque,
      valor_estoque: r.valor_estoque != null ? String(r.valor_estoque) : '',
      deposito_id: r.deposito_id ?? '',
      estoque_complementar: r.estoque_complementar != null && r.estoque_complementar !== 0 ? String(r.estoque_complementar) : '',
      estoque_risco: r.estoque_risco != null ? String(r.estoque_risco) : '',
      considerar_subsidio_pix: r.considerar_subsidio_pix,
      ativo: r.ativo,
    })
    setErro('')
    setModal(true)
  }

  async function salvar() {
    if (!form.nome.trim()) { setErro('Nome é obrigatório.'); return }
    setSalvando(true); setErro('')
    const sb = createClient()

    const payload = {
      empresa_id: empresaId,
      canal_id: canal.id,
      nome: form.nome.trim(),
      modo_preco: form.modo_preco,
      valor_preco: form.valor_preco !== '' ? parseFloat(form.valor_preco) : null,
      arredondamento: form.arredondamento,
      valor_embalagem: form.valor_embalagem !== '' ? parseFloat(form.valor_embalagem) : 0,
      percentual_imposto: form.percentual_imposto !== '' ? parseFloat(form.percentual_imposto) : 0,
      modo_estoque: form.modo_estoque,
      valor_estoque: form.valor_estoque !== '' ? parseFloat(form.valor_estoque) : null,
      deposito_id: form.deposito_id || null,
      estoque_complementar: form.estoque_complementar !== '' ? parseInt(form.estoque_complementar, 10) : 0,
      estoque_risco: form.estoque_risco !== '' ? parseInt(form.estoque_risco, 10) : null,
      considerar_subsidio_pix: form.considerar_subsidio_pix,
      ativo: form.ativo,
      updated_at: new Date().toISOString(),
    }

    if (editando) {
      const { error } = await sb.from('marketplace_regras_preco').update(payload).eq('id', editando.id)
      if (error) { setErro(error.message); setSalvando(false); return }
      setRegras(prev => prev.map(r => r.id === editando.id ? { ...r, ...payload } : r))
    } else {
      const { data, error } = await sb.from('marketplace_regras_preco').insert(payload).select().single()
      if (error) { setErro(error.message); setSalvando(false); return }
      setRegras(prev => [data, ...prev])
    }

    setSalvando(false)
    setModal(false)
    router.refresh()
  }

  async function excluir(r: Regra) {
    if (!confirm(`Excluir a regra "${r.nome}"?`)) return
    const sb = createClient()
    await sb.from('marketplace_regras_preco').delete().eq('id', r.id)
    setRegras(prev => prev.filter(x => x.id !== r.id))
  }

  async function alternarAtivo(r: Regra) {
    const sb = createClient()
    await sb.from('marketplace_regras_preco').update({ ativo: !r.ativo }).eq('id', r.id)
    setRegras(prev => prev.map(x => x.id === r.id ? { ...x, ativo: !x.ativo } : x))
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <a href="/dashboard/marketplaces" className="hover:text-gray-600">marketplaces</a><span>›</span>
        <a href={`/dashboard/marketplaces/${canal.id}`} className="hover:text-gray-600">{canal.nome}</a><span>›</span>
        <span className="text-gray-600 font-medium">regras de preço/estoque</span>
      </div>

      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Regras de preço/estoque — {canal.nome}</h1>
          <p className="text-gray-500 text-sm mt-0.5">Regras salvas para reaplicar no envio em massa, sem reconfigurar toda vez.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a href={`/dashboard/marketplaces/${canal.id}/anuncios`}
            className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium rounded-lg transition-colors">
            ← Voltar para anúncios
          </a>
          <button onClick={abrirNova}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
            + Nova regra
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {regras.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">Nenhuma regra cadastrada ainda.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {regras.map(r => (
              <div key={r.id} className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900 text-sm">{r.nome}</p>
                    {!r.ativo && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">inativa</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{resumoRegra(r)}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => alternarAtivo(r)}
                    className={`w-9 h-5 rounded-full transition-colors relative ${r.ativo ? 'bg-green-500' : 'bg-gray-300'}`}
                    title={r.ativo ? 'Desativar' : 'Ativar'}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${r.ativo ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                  <button onClick={() => abrirEditar(r)} className="text-gray-400 hover:text-gray-600 text-xs px-2 py-1">Editar</button>
                  <button onClick={() => excluir(r)} className="text-red-400 hover:text-red-600 text-xs px-2 py-1">Excluir</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
              <h2 className="text-lg font-semibold text-gray-900">{editando ? 'Editar regra' : 'Nova regra'}</h2>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="px-6 py-5 space-y-5">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nome da regra *</label>
                <input value={form.nome} onChange={e => f('nome', e.target.value)}
                  placeholder='Ex: "Markup 40% + terminar em ,90"'
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-700 mb-2">Preço</p>
                <div className="space-y-1.5">
                  {[
                    ['nao', 'Não alterar'],
                    ['fixo', 'Valor fixo (R$)'],
                    ['percentual', 'Ajuste percentual sobre o preço atual (%)'],
                    ['formula', 'Fórmula: custo do produto vinculado × markup (%)'],
                    ['shopee_liquido', 'Margem líquida sobre custo (considera comissão + taxas da Shopee)'],
                    ['produto', 'Usar preço do produto vinculado'],
                  ].map(([v, l]) => (
                    <label key={v} className="flex items-center gap-2 text-xs text-gray-700">
                      <input type="radio" name="modo_preco" checked={form.modo_preco === v}
                        onChange={() => f('modo_preco', v)} className="accent-blue-600" />
                      {l}
                    </label>
                  ))}
                </div>
                {(form.modo_preco === 'fixo' || form.modo_preco === 'percentual' || form.modo_preco === 'formula' || form.modo_preco === 'shopee_liquido') && (
                  <input type="number" step="0.01" value={form.valor_preco} onChange={e => f('valor_preco', e.target.value)}
                    placeholder={form.modo_preco === 'fixo' ? 'Ex: 49.90' : form.modo_preco === 'formula' ? 'Markup, ex: 40' : form.modo_preco === 'shopee_liquido' ? 'Margem desejada, ex: 30' : 'Ex: 10 ou -5'}
                    className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                )}
                {form.modo_preco === 'shopee_liquido' && (
                  <label className="mt-2 flex items-center gap-2 text-xs text-gray-700">
                    <input type="checkbox" checked={form.considerar_subsidio_pix}
                      onChange={e => f('considerar_subsidio_pix', e.target.checked)} className="w-4 h-4 accent-blue-600" />
                    Considerar subsídio Pix (5% a 8% adicional)
                  </label>
                )}
                {(form.modo_preco === 'formula' || form.modo_preco === 'shopee_liquido') && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Valor da embalagem (R$)</label>
                      <input type="number" step="0.01" value={form.valor_embalagem} onChange={e => f('valor_embalagem', e.target.value)}
                        placeholder="Ex: 2.50"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                      <p className="text-[10px] text-gray-400 mt-0.5">Somado ao custo do produto antes de calcular o preço.</p>
                    </div>
                    {form.modo_preco === 'shopee_liquido' && (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Imposto (%)</label>
                        <input type="number" step="0.01" value={form.percentual_imposto} onChange={e => f('percentual_imposto', e.target.value)}
                          placeholder="Ex: 6"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                        <p className="text-[10px] text-gray-400 mt-0.5">Descontado do preço junto com a comissão, pra manter a margem líquida real.</p>
                      </div>
                    )}
                  </div>
                )}
                {(form.modo_preco === 'percentual' || form.modo_preco === 'formula' || form.modo_preco === 'shopee_liquido' || form.modo_preco === 'produto') && (
                  <div className="mt-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Arredondamento</label>
                    <select value={form.arredondamento} onChange={e => f('arredondamento', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                      <option value="nenhum">Sem arredondamento</option>
                      <option value="terminar_90">Terminar em ,90</option>
                      <option value="terminar_99">Terminar em ,99</option>
                      <option value="cima_inteiro">Arredondar para cima (inteiro)</option>
                    </select>
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-700 mb-2">Estoque</p>
                <div className="space-y-1.5">
                  {[
                    ['nao', 'Não alterar'],
                    ['fixo', 'Valor fixo'],
                    ['produto', 'Usar estoque do produto vinculado'],
                    ['deposito', 'Usar estoque de um depósito específico'],
                  ].map(([v, l]) => (
                    <label key={v} className="flex items-center gap-2 text-xs text-gray-700">
                      <input type="radio" name="modo_estoque" checked={form.modo_estoque === v}
                        onChange={() => f('modo_estoque', v)} className="accent-blue-600" />
                      {l}
                    </label>
                  ))}
                </div>
                {form.modo_estoque === 'fixo' && (
                  <input type="number" value={form.valor_estoque} onChange={e => f('valor_estoque', e.target.value)}
                    placeholder="Ex: 50"
                    className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                )}
                {form.modo_estoque === 'deposito' && (
                  <select value={form.deposito_id} onChange={e => f('deposito_id', e.target.value)}
                    className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                    <option value="">Selecione um depósito</option>
                    {depositos.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
                  </select>
                )}
                {form.modo_estoque !== 'nao' && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Estoque complementar</label>
                      <input type="number" value={form.estoque_complementar} onChange={e => f('estoque_complementar', e.target.value)}
                        placeholder="Ex: 5"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                      <p className="text-[10px] text-gray-400 mt-0.5">Somado ao estoque calculado antes de enviar.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Estoque de risco</label>
                      <input type="number" value={form.estoque_risco} onChange={e => f('estoque_risco', e.target.value)}
                        placeholder="Ex: 2"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                      <p className="text-[10px] text-gray-400 mt-0.5">Comparado com o estoque JÁ somado ao complemento.</p>
                    </div>
                  </div>
                )}

                {/* A CONTA, AO VIVO. A ordem das duas operações é o que engana:
                    `enviado = saldo + complemento` e só depois
                    `pausa se enviado ≤ risco`. Quem lê os dois campos
                    separados conclui outra coisa. */}
                {form.modo_estoque !== 'nao' && (() => {
                  const e = explicarRegraEstoque({
                    complementar: form.estoque_complementar === '' ? 0 : parseInt(form.estoque_complementar, 10),
                    risco: form.estoque_risco === '' ? null : parseInt(form.estoque_risco, 10),
                    saldoExemplo: 10,
                  })
                  return (
                    <p className={`mt-2 rounded-lg border px-2.5 py-1.5 text-[11px] leading-5 ${
                      e.nuncaPausa
                        ? 'border-amber-300 bg-amber-50 text-amber-900'
                        : 'border-blue-200 bg-blue-50 text-blue-800'
                    }`}>
                      {e.frase}
                    </p>
                  )
                })()}
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={form.ativo} onChange={e => f('ativo', e.target.checked)} className="w-4 h-4 accent-blue-600" />
                Regra ativa (aparece pra usar no envio em massa)
              </label>

              {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setModal(false)} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={salvar} disabled={salvando}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {salvando ? 'Salvando...' : 'Salvar regra'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
