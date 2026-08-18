'use client'

import { useState } from 'react'
import RevisarVinculosClient from './RevisarVinculosClient'
import DuplicarCatalogoClient from './DuplicarCatalogoClient'

// Duas ações bem diferentes sobre a mesma parceria, por isso em abas
// separadas em vez de uma tela só: VINCULAR presume que os dois produtos já
// existem, cada um cadastrado à sua maneira nas duas empresas — é o que
// RevisarVinculosClient já fazia. DUPLICAR é o caminho pra quando o produto
// só existe de um lado: cria o cadastro que falta na empresa parceira e já
// vincula os dois, com os campos fiscais recalculados pro regime dela.

type Categoria = { id: string; nome: string; pai_id: string | null }

export default function ParceriaDetalheTabsClient({ parceriaId, empresaId, empresaParceiraId, empresaParceiraNome, minhaEmpresaEhA, categorias }: {
  parceriaId: string
  empresaId: string
  empresaParceiraId: string
  empresaParceiraNome: string
  minhaEmpresaEhA: boolean
  categorias: Categoria[]
}) {
  const [aba, setAba] = useState<'vincular' | 'duplicar'>('vincular')

  return (
    <div>
      <div className="px-6 pt-6 max-w-5xl mx-auto">
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden mb-1">
          <button onClick={() => setAba('vincular')}
            className={`px-3 py-1.5 text-xs font-medium ${aba === 'vincular' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
            Vincular produtos existentes
          </button>
          <button onClick={() => setAba('duplicar')}
            className={`px-3 py-1.5 text-xs font-medium ${aba === 'duplicar' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
            Duplicar catálogo
          </button>
        </div>
      </div>

      {aba === 'vincular' ? (
        <RevisarVinculosClient
          parceriaId={parceriaId} empresaId={empresaId} empresaParceiraId={empresaParceiraId}
          empresaParceiraNome={empresaParceiraNome} minhaEmpresaEhA={minhaEmpresaEhA}
        />
      ) : (
        <DuplicarCatalogoClient
          parceriaId={parceriaId} empresaId={empresaId} empresaParceiraNome={empresaParceiraNome} categorias={categorias}
        />
      )}
    </div>
  )
}
