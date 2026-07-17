'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CAMPOS_DISPONIVEIS, FABRICANTES, PRESETS, type CampoEtiqueta, type Fabricante, type ModeloEtiqueta, type TipoCampo } from '@/lib/etiquetas/tipos'

const INPUT = 'w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500'
const LABEL = 'block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1'

type FormState = Omit<ModeloEtiqueta, 'id' | 'empresa_id'>

const FORM_INICIAL: FormState = {
  nome: '', fabricante: 'a4_generica', tipo_pagina: 'folha',
  largura_mm: 63.5, altura_mm: 38.1, margem_topo_mm: 15.09, margem_esquerda_mm: 7,
  espaco_horizontal_mm: 2.5, espaco_vertical_mm: 0, colunas: 3, linhas: 7,
  pagina_largura_mm: 210, pagina_altura_mm: 297, orientacao: 'retrato',
  campos: [
    { campo: 'nome', fontSize: 8, bold: true, align: 'left' },
    { campo: 'codigo_barras', fontSize: 8, bold: false, align: 'center' },
    { campo: 'preco_venda', fontSize: 11, bold: true, align: 'center' },
  ],
  ativo: true,
}

export default function EtiquetaModeloModal({ modelo, empresaId, onClose, onSalvo }: {
  modelo: ModeloEtiqueta | null
  empresaId: string
  onClose: () => void
  onSalvo: () => void
}) {
  const [form, setForm] = useState<FormState>(modelo ? {
    nome: modelo.nome, fabricante: modelo.fabricante, tipo_pagina: modelo.tipo_pagina,
    largura_mm: modelo.largura_mm, altura_mm: modelo.altura_mm,
    margem_topo_mm: modelo.margem_topo_mm, margem_esquerda_mm: modelo.margem_esquerda_mm,
    espaco_horizontal_mm: modelo.espaco_horizontal_mm, espaco_vertical_mm: modelo.espaco_vertical_mm,
    colunas: modelo.colunas, linhas: modelo.linhas,
    pagina_largura_mm: modelo.pagina_largura_mm, pagina_altura_mm: modelo.pagina_altura_mm,
    orientacao: modelo.orientacao, campos: modelo.campos, ativo: modelo.ativo,
  } : FORM_INICIAL)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [novoCampo, setNovoCampo] = useState<TipoCampo>('marca')

  function set<K extends keyof FormState>(campo: K, valor: FormState[K]) {
    setForm(prev => ({ ...prev, [campo]: valor }))
  }

  function aplicarPreset(tipo: 'a4_generica' | 'termica') {
    setForm(prev => ({ ...prev, ...PRESETS[tipo], fabricante: tipo === 'a4_generica' ? 'a4_generica' : 'termica' }))
  }

  function adicionarCampo() {
    if (form.campos.some(c => c.campo === novoCampo) && novoCampo !== 'texto_livre') return
    const padrao: CampoEtiqueta = { campo: novoCampo, fontSize: 9, bold: false, align: 'left', textoLivre: novoCampo === 'texto_livre' ? '' : undefined }
    set('campos', [...form.campos, padrao])
  }

  function atualizarCampo(idx: number, patch: Partial<CampoEtiqueta>) {
    set('campos', form.campos.map((c, i) => i === idx ? { ...c, ...patch } : c))
  }

  function removerCampo(idx: number) {
    set('campos', form.campos.filter((_, i) => i !== idx))
  }

  function moverCampo(idx: number, dir: -1 | 1) {
    const alvo = idx + dir
    if (alvo < 0 || alvo >= form.campos.length) return
    const copia = [...form.campos]
    ;[copia[idx], copia[alvo]] = [copia[alvo], copia[idx]]
    set('campos', copia)
  }

  async function salvar() {
    if (!form.nome.trim()) { setErro('Informe um nome para o modelo.'); return }
    if (form.campos.length === 0) { setErro('Escolha ao menos um campo para a etiqueta.'); return }
    setSalvando(true); setErro('')

    const bobina = form.tipo_pagina === 'bobina'
    const paisagem = form.orientacao === 'paisagem'
    const paginaLargura = bobina ? form.largura_mm : (paisagem ? form.pagina_altura_mm : form.pagina_largura_mm)
    const paginaAltura = bobina ? form.altura_mm : (paisagem ? form.pagina_largura_mm : form.pagina_altura_mm)

    const payload = {
      empresa_id: empresaId,
      nome: form.nome.trim(),
      fabricante: form.fabricante,
      tipo_pagina: form.tipo_pagina,
      largura_mm: form.largura_mm,
      altura_mm: form.altura_mm,
      margem_topo_mm: bobina ? 0 : form.margem_topo_mm,
      margem_esquerda_mm: bobina ? 0 : form.margem_esquerda_mm,
      espaco_horizontal_mm: bobina ? 0 : form.espaco_horizontal_mm,
      espaco_vertical_mm: bobina ? 0 : form.espaco_vertical_mm,
      colunas: bobina ? 1 : form.colunas,
      linhas: bobina ? 1 : form.linhas,
      pagina_largura_mm: paginaLargura,
      pagina_altura_mm: paginaAltura,
      orientacao: form.orientacao,
      campos: form.campos,
      ativo: form.ativo,
      updated_at: new Date().toISOString(),
    }

    const sb = createClient()
    const { error } = modelo
      ? await sb.from('etiqueta_modelos').update(payload).eq('id', modelo.id)
      : await sb.from('etiqueta_modelos').insert(payload)

    setSalvando(false)
    if (error) { setErro(error.message); return }
    onSalvo()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-gray-900">{modelo ? 'Editar modelo de etiqueta' : 'Novo modelo de etiqueta'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Nome do modelo</label>
              <input value={form.nome} onChange={e => set('nome', e.target.value)} placeholder="Ex: Preço de prateleira" className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>Fabricante</label>
              <select value={form.fabricante} onChange={e => set('fabricante', e.target.value as Fabricante)} className={INPUT}>
                {FABRICANTES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Preencher rápido:</span>
            <button type="button" onClick={() => aplicarPreset('a4_generica')} className="px-2.5 py-1 text-xs rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50">Folha A4 (3×7)</button>
            <button type="button" onClick={() => aplicarPreset('termica')} className="px-2.5 py-1 text-xs rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50">Bobina térmica 60×40mm</button>
          </div>

          <div>
            <label className={LABEL}>Tipo de página</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => set('tipo_pagina', 'folha')}
                className={`px-3 py-1.5 text-xs rounded-lg border ${form.tipo_pagina === 'folha' ? 'border-blue-500 text-blue-600 bg-blue-50 font-medium' : 'border-gray-300 text-gray-500'}`}>
                Folha (grade em A4)
              </button>
              <button type="button" onClick={() => set('tipo_pagina', 'bobina')}
                className={`px-3 py-1.5 text-xs rounded-lg border ${form.tipo_pagina === 'bobina' ? 'border-blue-500 text-blue-600 bg-blue-50 font-medium' : 'border-gray-300 text-gray-500'}`}>
                Bobina (impressora térmica)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Largura da etiqueta (mm)</label>
              <input type="number" step="0.1" value={form.largura_mm} onChange={e => set('largura_mm', parseFloat(e.target.value) || 0)} className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>Altura da etiqueta (mm)</label>
              <input type="number" step="0.1" value={form.altura_mm} onChange={e => set('altura_mm', parseFloat(e.target.value) || 0)} className={INPUT} />
            </div>
          </div>

          {form.tipo_pagina === 'folha' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Colunas</label>
                  <input type="number" value={form.colunas} onChange={e => set('colunas', parseInt(e.target.value) || 1)} className={INPUT} />
                </div>
                <div>
                  <label className={LABEL}>Linhas por página</label>
                  <input type="number" value={form.linhas} onChange={e => set('linhas', parseInt(e.target.value) || 1)} className={INPUT} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Margem topo (mm)</label>
                  <input type="number" step="0.1" value={form.margem_topo_mm} onChange={e => set('margem_topo_mm', parseFloat(e.target.value) || 0)} className={INPUT} />
                </div>
                <div>
                  <label className={LABEL}>Margem esquerda (mm)</label>
                  <input type="number" step="0.1" value={form.margem_esquerda_mm} onChange={e => set('margem_esquerda_mm', parseFloat(e.target.value) || 0)} className={INPUT} />
                </div>
                <div>
                  <label className={LABEL}>Espaço horizontal (mm)</label>
                  <input type="number" step="0.1" value={form.espaco_horizontal_mm} onChange={e => set('espaco_horizontal_mm', parseFloat(e.target.value) || 0)} className={INPUT} />
                </div>
                <div>
                  <label className={LABEL}>Espaço vertical (mm)</label>
                  <input type="number" step="0.1" value={form.espaco_vertical_mm} onChange={e => set('espaco_vertical_mm', parseFloat(e.target.value) || 0)} className={INPUT} />
                </div>
              </div>
              <div>
                <label className={LABEL}>Orientação da página</label>
                <select value={form.orientacao} onChange={e => set('orientacao', e.target.value as 'retrato' | 'paisagem')} className={INPUT}>
                  <option value="retrato">Retrato</option>
                  <option value="paisagem">Paisagem</option>
                </select>
              </div>
            </>
          )}

          <div>
            <label className={LABEL}>Campos da etiqueta</label>
            <div className="flex items-center gap-2 mb-2">
              <select value={novoCampo} onChange={e => setNovoCampo(e.target.value as TipoCampo)} className={INPUT + ' flex-1'}>
                {CAMPOS_DISPONIVEIS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <button type="button" onClick={adicionarCampo} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium whitespace-nowrap">+ Adicionar</button>
            </div>

            {form.campos.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-lg">Nenhum campo adicionado ainda.</p>
            ) : (
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                {form.campos.map((c, i) => {
                  const info = CAMPOS_DISPONIVEIS.find(d => d.value === c.campo)
                  return (
                    <div key={i} className="px-3 py-2.5 flex items-center gap-2 flex-wrap">
                      <div className="flex flex-col gap-0.5">
                        <button type="button" onClick={() => moverCampo(i, -1)} disabled={i === 0} className="text-gray-300 hover:text-gray-600 disabled:opacity-30 text-xs leading-none">▲</button>
                        <button type="button" onClick={() => moverCampo(i, 1)} disabled={i === form.campos.length - 1} className="text-gray-300 hover:text-gray-600 disabled:opacity-30 text-xs leading-none">▼</button>
                      </div>
                      <span className="text-sm text-gray-700 font-medium min-w-[140px]">{info?.label ?? c.campo}</span>
                      {c.campo === 'texto_livre' && (
                        <input value={c.textoLivre ?? ''} onChange={e => atualizarCampo(i, { textoLivre: e.target.value })} placeholder="Texto..." className="border border-gray-300 rounded-lg px-2 py-1 text-xs flex-1 min-w-[100px]" />
                      )}
                      {c.campo !== 'codigo_barras' && c.campo !== 'qrcode' && c.campo !== 'logo_empresa' && (
                        <input type="number" value={c.fontSize} onChange={e => atualizarCampo(i, { fontSize: parseInt(e.target.value) || 8 })} className="w-14 border border-gray-300 rounded-lg px-1.5 py-1 text-xs" title="Tamanho da fonte" />
                      )}
                      {c.campo !== 'codigo_barras' && c.campo !== 'qrcode' && (
                        <label className="flex items-center gap-1 text-xs text-gray-500">
                          <input type="checkbox" checked={c.bold} onChange={e => atualizarCampo(i, { bold: e.target.checked })} className="w-3.5 h-3.5" /> Negrito
                        </label>
                      )}
                      <select value={c.align} onChange={e => atualizarCampo(i, { align: e.target.value as CampoEtiqueta['align'] })} className="border border-gray-300 rounded-lg px-1.5 py-1 text-xs">
                        <option value="left">Esquerda</option>
                        <option value="center">Centro</option>
                        <option value="right">Direita</option>
                      </select>
                      <button type="button" onClick={() => removerCampo(i)} className="ml-auto text-red-400 hover:text-red-600 text-xs">Remover</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {salvando ? 'Salvando...' : 'Salvar modelo'}
          </button>
        </div>
      </div>
    </div>
  )
}
