'use client'

import { useState, useEffect } from 'react'
import { LAYOUT_MENU_KEY, LAYOUT_MENU_EVENT, type LayoutMenu } from '@/components/DashboardShell'

const OPCOES: { valor: LayoutMenu; titulo: string; descricao: string }[] = [
  { valor: 'sidebar', titulo: 'Menu lateral', descricao: 'O menu fica fixo na lateral esquerda da tela. Ideal para monitores largos.' },
  { valor: 'topbar', titulo: 'Menu superior', descricao: 'O menu fica em uma barra horizontal no topo. Ideal quando o menu lateral corta informações ou não cabe na tela.' },
]

function aplicar(valor: LayoutMenu) {
  try { localStorage.setItem(LAYOUT_MENU_KEY, valor) } catch {}
  document.documentElement.dataset.layoutMenu = valor
  window.dispatchEvent(new Event(LAYOUT_MENU_EVENT))
}

export default function AparenciaClient() {
  const [selecionado, setSelecionado] = useState<LayoutMenu>('sidebar')

  useEffect(() => {
    const atual = document.documentElement.dataset.layoutMenu === 'topbar' ? 'topbar' : 'sidebar'
    setSelecionado(atual)
  }, [])

  function escolher(valor: LayoutMenu) {
    setSelecionado(valor)
    aplicar(valor)
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Aparência</h1>
      <p className="text-sm text-gray-500 mb-6">Escolha como o menu de navegação aparece no sistema. A mudança é aplicada imediatamente.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {OPCOES.map(op => {
          const ativo = selecionado === op.valor
          return (
            <button
              key={op.valor}
              onClick={() => escolher(op.valor)}
              className={`text-left border-2 rounded-2xl p-4 transition-all ${
                ativo ? 'border-blue-500 bg-blue-50/50 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              {/* Preview visual */}
              <div className="rounded-lg border border-gray-200 bg-gray-50 mb-3 overflow-hidden" style={{ height: 90 }}>
                {op.valor === 'sidebar' ? (
                  <div className="flex h-full">
                    <div className="w-6 h-full" style={{ background: 'linear-gradient(180deg,#0f172a,#1e293b)' }} />
                    <div className="flex-1 p-2 space-y-1">
                      <div className="h-2 w-3/4 bg-gray-300 rounded" />
                      <div className="h-2 w-1/2 bg-gray-200 rounded" />
                      <div className="h-2 w-2/3 bg-gray-200 rounded" />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col h-full">
                    <div className="h-5 w-full flex items-center gap-1 px-2" style={{ background: 'linear-gradient(90deg,#0f172a,#1e293b)' }}>
                      <div className="w-6 h-1.5 bg-white/30 rounded" />
                      <div className="w-6 h-1.5 bg-white/30 rounded" />
                      <div className="w-6 h-1.5 bg-white/30 rounded" />
                    </div>
                    <div className="flex-1 p-2 space-y-1">
                      <div className="h-2 w-3/4 bg-gray-300 rounded" />
                      <div className="h-2 w-1/2 bg-gray-200 rounded" />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">{op.titulo}</p>
                {ativo && <span className="text-blue-600 text-xs font-medium">✓ Selecionado</span>}
              </div>
              <p className="text-xs text-gray-500 mt-1">{op.descricao}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
