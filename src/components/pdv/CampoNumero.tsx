'use client'

import { useRef, useState } from 'react'

/**
 * Campo numérico do carrinho (quantidade, preço, desconto).
 *
 * Era um input controlado direto pelo número: a cada tecla o valor voltava
 * reformatado (`3.5` virava `3.50`) e o React jogava o cursor para o fim —
 * para trocar 3,00 por 3,50 era preciso clicar depois da vírgula a cada
 * dígito. E o "0" do desconto ficava com o cursor ao lado, então digitar 5
 * dava 50.
 *
 * Agora, enquanto o campo está em foco, ele mostra exatamente o que foi
 * digitado (o total da linha continua acompanhando). Ao entrar, seleciona
 * tudo: digitar substitui o valor. Formatação só ao sair. Aceita vírgula ou
 * ponto. Campo apagado e abandonado volta ao valor anterior em vez de virar 0.
 */
export default function CampoNumero({ valor, casas, onValor, className }: {
  valor: number; casas?: number; onValor: (v: number) => void; className?: string
}) {
  const [rascunho, setRascunho] = useState<string | null>(null)
  const acabouDeFocar = useRef(false)
  const formatado = (casas !== undefined ? valor.toFixed(casas) : String(valor)).replace('.', ',')

  return (
    <input value={rascunho ?? formatado} inputMode="decimal"
      onClick={e => e.stopPropagation()}
      onFocus={e => { acabouDeFocar.current = true; setRascunho(formatado); e.target.select() }}
      // Sem isto, o mouseup do mesmo clique que deu foco desfaz a seleção
      // em alguns navegadores e o cursor cai onde se clicou.
      onMouseUp={e => { if (acabouDeFocar.current) { e.preventDefault(); acabouDeFocar.current = false } }}
      onChange={e => {
        const texto = e.target.value.replace(/[^\d.,-]/g, '')
        setRascunho(texto)
        const n = parseFloat(texto.replace(',', '.'))
        if (!Number.isNaN(n)) onValor(n)
      }}
      onBlur={() => { acabouDeFocar.current = false; setRascunho(null) }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className={className} />
  )
}
