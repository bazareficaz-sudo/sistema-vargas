'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { COOKIE_EMPRESAS_PAGAR, valorDoCookie, type EmpresaPagar } from '@/lib/contas/empresasPagar'

// Escolha das empresas do contas a pagar: "Todas" ou qualquer combinação.
// Só aparece para quem tem mais de uma empresa.

export function gravarEscolha(ids: string[], permitidas: string[]) {
  document.cookie = `${COOKIE_EMPRESAS_PAGAR}=${valorDoCookie(ids, permitidas)}; path=/; max-age=31536000; samesite=lax`
}

export default function SeletorEmpresasPagar({ empresas, valor, onChange }: {
  empresas: EmpresaPagar[]
  valor: string[]
  onChange: (ids: string[]) => void
}) {
  if (empresas.length < 2) return null
  const todas = empresas.every(e => valor.includes(e.id))

  function alternar(id: string) {
    const novo = valor.includes(id) ? valor.filter(x => x !== id) : [...valor, id]
    // Nenhuma empresa não é uma escolha: desmarcar a última não faz nada.
    if (novo.length) onChange(empresas.map(e => e.id).filter(x => novo.includes(x)))
  }

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
      <span className="text-xs text-gray-500 shrink-0 mr-0.5">Empresas:</span>
      <button onClick={() => onChange(empresas.map(e => e.id))}
        className={`shrink-0 px-3 py-1.5 text-xs rounded-full border ${todas ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
        Todas
      </button>
      {empresas.map(e => {
        const on = valor.includes(e.id)
        return (
          <button key={e.id} onClick={() => alternar(e.id)} title={e.nome}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border ${on ? 'bg-white text-gray-900 font-medium' : 'bg-white text-gray-400 border-gray-200 hover:text-gray-600'}`}
            style={on ? { borderColor: e.cor, boxShadow: `inset 0 0 0 1px ${e.cor}` } : undefined}>
            <span className="w-3.5 h-3.5 rounded border flex items-center justify-center text-[10px] text-white"
              style={on ? { background: e.cor, borderColor: e.cor } : { borderColor: '#d1d5db' }}>{on ? '✓' : ''}</span>
            {e.curto}
          </button>
        )
      })}
    </div>
  )
}

/** Versão para as telas que recarregam do servidor (relatórios). */
export function SeletorEmpresasRecarregar({ empresas, escolhidas }: { empresas: EmpresaPagar[]; escolhidas: string[] }) {
  const router = useRouter()
  const [valor, setValor] = useState(escolhidas)
  return (
    <SeletorEmpresasPagar empresas={empresas} valor={valor} onChange={ids => {
      setValor(ids)
      gravarEscolha(ids, empresas.map(e => e.id))
      router.refresh()
    }} />
  )
}

/** Etiqueta da empresa numa linha. */
export function EtiquetaEmpresa({ empresa }: { empresa: EmpresaPagar | undefined }) {
  if (!empresa) return null
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
      style={{ color: empresa.cor, background: `${empresa.cor}14` }} title={empresa.nome}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: empresa.cor }} />{empresa.curto}
    </span>
  )
}
