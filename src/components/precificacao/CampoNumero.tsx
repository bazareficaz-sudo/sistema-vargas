'use client'

import { useEffect, useState } from 'react'

// Campo numérico que aceita como o brasileiro digita.
//
// O jeito ingênuo — `value={numero}` com `onChange={e => set(Number(e.target.value))}` —
// quebra de duas formas, as duas observadas na tela de taxas:
//
//   digitar "0,8"  → Number("0,8") é NaN, e o campo mostra NaN
//   digitar "0."   → Number("0.") é 0, o campo volta pra "0" e o ponto some
//                    antes de você conseguir digitar o decimal
//
// A causa é a mesma: converter a cada tecla joga fora o texto em construção.
// Aqui o texto digitado vive em estado próprio e só o número já convertido
// sobe para quem usa o campo.

function paraTexto(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return ''
  return String(v).replace('.', ',')
}

export function paraNumero(t: string): number | null {
  const s = (t ?? '').trim().replace(/\s/g, '')
  if (s === '') return null
  // Com vírgula, ela é o separador decimal e o ponto é milhar ("1.234,56").
  // Sem vírgula, o ponto é o decimal ("1234.56") — que é como quem está
  // acostumado com o teclado numérico digita.
  const normalizado = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

export default function CampoNumero({ valor, onChange, className, placeholder, disabled }: {
  valor: number | null | undefined
  onChange: (v: number | null) => void
  className?: string
  placeholder?: string
  disabled?: boolean
}) {
  const [texto, setTexto] = useState(() => paraTexto(valor))

  // Ressincroniza quando o valor muda por fora (carregou do banco, outro
  // campo recalculou). Nunca quando o texto em edição já representa esse
  // mesmo número — senão apagaria a vírgula no meio da digitação.
  useEffect(() => {
    if (paraNumero(texto) !== (valor ?? null)) setTexto(paraTexto(valor))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor])

  return (
    <input
      type="text"
      inputMode="decimal"
      value={texto}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => { setTexto(e.target.value); onChange(paraNumero(e.target.value)) }}
      className={className}
    />
  )
}
