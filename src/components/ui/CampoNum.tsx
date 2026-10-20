'use client'

import { useRef, useState } from 'react'
import { paraNumeroBr, formatarNumeroBr, paraEdicaoBr } from '@/lib/entradas/numeroBr'

// Campo numérico de tabela, sempre aberto para digitar: parado mostra
// 1.234,50; ao entrar, 1234,50 já selecionado; Enter ou sair do campo grava,
// Esc desiste. TAB passa para o próximo — é o que deixa revisar dezenas de
// preços sem tirar a mão do teclado. Nasceu na revisão de preços da entrada
// manual e é o mesmo na Gestão de Preços.

export default function CampoNum({ value, onCommit, decimais = 2, sufixo = '', forte = false, placeholder = '', compacto = true }: {
  value: number
  onCommit: (v: number) => void
  decimais?: number
  sufixo?: string
  forte?: boolean
  placeholder?: string
  /**
   * true = celula de tabela; false = campo de formulario.
   *
   * Duas variantes explicitas em vez de sobrepor classe por fora: o Tailwind
   * v4 mudou o modificador `!` de prefixo para sufixo, e um override que
   * silenciosamente nao aplica deixa o campo minusculo sem erro nenhum.
   */
  compacto?: boolean
}) {
  // null = ninguém digitou desde que o campo ganhou foco.
  const [rascunho, setRascunho] = useState<string | null>(null)
  const [focado, setFocado] = useState(false)
  // Esc desiste do que foi digitado — inclusive no blur que ele mesmo causa.
  const desistiuRef = useRef(false)
  // Parado: 1.234,50. Em edição: 1234,50 — sem o separador de milhar que a
  // própria tela escreveria e depois teria de reinterpretar.
  //
  // Focado e ainda sem digitar, o campo mostra o valor ATUAL, e não uma
  // cópia tirada na hora do foco: na Gestão de Preços o campo anterior grava
  // no banco e o valor deste chega um instante depois — a cópia ficava vazia
  // e, ao passar com TAB, gravava o vazio por cima (apagando a promoção que
  // acabara de ser calculada).
  const texto = rascunho ?? (focado ? (value ? paraEdicaoBr(value, decimais) : '') : (value ? formatarNumeroBr(value, decimais) : ''))

  function confirmar(t: string) {
    const digitou = rascunho !== null && !desistiuRef.current
    desistiuRef.current = false
    setRascunho(null); setFocado(false)
    // Só passou pelo campo (TAB, clique fora): não grava nada.
    if (!digitou) return
    const limpo = Math.round(paraNumeroBr(t) * 10000) / 10000
    if (limpo !== value) onCommit(limpo)
  }

  return (
    <div className="relative">
      <input
        value={texto}
        inputMode="decimal"
        placeholder={placeholder}
        onChange={e => setRascunho(e.target.value)}
        onFocus={e => {
          // Já no formato de edição e selecionado na hora: quem digita logo
          // depois de clicar substitui o número, não escreve no meio dele.
          e.target.value = value ? paraEdicaoBr(value, decimais) : ''
          e.target.select()
          setFocado(true); setRascunho(null)
        }}
        onBlur={e => confirmar(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
          if (e.key === 'Escape') { desistiuRef.current = true; setRascunho(null); (e.target as HTMLInputElement).blur() }
        }}
        className={`w-full border bg-white text-right font-mono
          hover:border-gray-300 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200
          ${compacto
            ? 'rounded border-gray-200 px-1.5 py-1 text-xs'
            : 'rounded-lg border-gray-300 px-2.5 py-1.5 text-sm'}
          ${forte ? 'font-semibold text-gray-900' : 'text-gray-700'} ${sufixo ? 'pr-4' : ''}`}
      />
      {sufixo && (
        <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">
          {sufixo}
        </span>
      )}
    </div>
  )
}
