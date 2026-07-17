'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import EtiquetaModeloModal from './EtiquetaModeloModal'
import { FABRICANTES, type ModeloEtiqueta } from '@/lib/etiquetas/tipos'

export default function EtiquetaModelosClient({ modelos: inicial, empresaId }: {
  modelos: ModeloEtiqueta[]
  empresaId: string
}) {
  const router = useRouter()
  const [modelos, setModelos] = useState(inicial)
  const [criando, setCriando] = useState(false)
  const [editando, setEditando] = useState<ModeloEtiqueta | null>(null)

  function onSalvo() {
    setCriando(false); setEditando(null)
    router.refresh()
  }

  async function alternarAtivo(modelo: ModeloEtiqueta) {
    const sb = createClient()
    await sb.from('etiqueta_modelos').update({ ativo: !modelo.ativo }).eq('id', modelo.id)
    setModelos(prev => prev.map(m => m.id === modelo.id ? { ...m, ativo: !m.ativo } : m))
  }

  async function excluir(modelo: ModeloEtiqueta) {
    if (!confirm(`Excluir o modelo "${modelo.nome}"?`)) return
    const sb = createClient()
    await sb.from('etiqueta_modelos').delete().eq('id', modelo.id)
    setModelos(prev => prev.filter(m => m.id !== modelo.id))
  }

  return (
    <>
      {criando && <EtiquetaModeloModal modelo={null} empresaId={empresaId} onClose={() => setCriando(false)} onSalvo={onSalvo} />}
      {editando && <EtiquetaModeloModal modelo={editando} empresaId={empresaId} onClose={() => setEditando(null)} onSalvo={onSalvo} />}

      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <span>estoque</span><span>›</span>
        <span className="text-gray-600 font-medium">etiquetas</span>
      </div>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Modelos de Etiqueta</h1>
          <p className="text-gray-500 text-sm mt-0.5">Configure os modelos usados para imprimir etiquetas de produtos</p>
        </div>
        <button onClick={() => setCriando(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
          + Novo modelo
        </button>
      </div>

      {modelos.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl py-20 flex flex-col items-center justify-center text-gray-400">
          <span className="text-4xl mb-3">🏷️</span>
          <p className="text-sm">Nenhum modelo de etiqueta cadastrado ainda.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {modelos.map(m => (
            <div key={m.id} className={`bg-white border rounded-xl p-4 ${m.ativo ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{m.nome}</p>
                  <p className="text-xs text-gray-400">{FABRICANTES.find(f => f.value === m.fabricante)?.label ?? m.fabricante}</p>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${m.ativo ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
                  {m.ativo ? 'Ativo' : 'Inativo'}
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-1">
                {m.tipo_pagina === 'folha' ? `Folha ${m.colunas}×${m.linhas} · ${m.largura_mm}×${m.altura_mm}mm` : `Bobina · ${m.largura_mm}×${m.altura_mm}mm`}
              </p>
              <p className="text-xs text-gray-400 mb-3">{m.campos.length} campo(s) configurado(s)</p>
              <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                <button onClick={() => setEditando(m)} className="text-xs px-2.5 py-1 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">Editar</button>
                <button onClick={() => alternarAtivo(m)} className="text-xs px-2.5 py-1 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
                  {m.ativo ? 'Desativar' : 'Ativar'}
                </button>
                <button onClick={() => excluir(m)} className="text-xs px-2.5 py-1 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 ml-auto">Excluir</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
