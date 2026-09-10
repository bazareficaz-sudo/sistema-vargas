// AS FORMAS DE PAGAMENTO DO BALCÃO, em um lugar só.
//
// Estavam declaradas dentro de `PDVClient.tsx`. Passaram a ser necessárias em
// três lugares — o PDV, a tela de configuração e a rota que valida o que foi
// salvo — e uma lista copiada é uma lista que diverge: bastaria a tela de
// configuração oferecer uma forma que o PDV não tem para o gestor criar uma
// condição que nenhuma venda cumpre, e o desconto sumiria sem explicação.

export type FormaPagamento = {
  id: string
  label: string
  /** Tecla de atalho no PDV. */
  tecla: string
  icon: string
}

export const FORMAS_PAGAMENTO: FormaPagamento[] = [
  { id: 'dinheiro', label: 'Dinheiro', tecla: '1', icon: '💵' },
  { id: 'debito',   label: 'Débito',   tecla: '2', icon: '💳' },
  { id: 'credito',  label: 'Crédito',  tecla: '3', icon: '💳' },
  { id: 'pix',      label: 'PIX',      tecla: '4', icon: '📱' },
  { id: 'carteira', label: 'Carteira', tecla: '5', icon: '👛' },
  { id: 'fiado',    label: 'Fiado',    tecla: '6', icon: '📒' },
]

export const FORMAS_PAGAMENTO_VALIDAS: string[] = FORMAS_PAGAMENTO.map(f => f.id)

export function rotuloDaForma(tipo: string): string {
  return FORMAS_PAGAMENTO.find(f => f.id === tipo)?.label ?? tipo
}

// SELO CURTO — o rótulo cabe na tela, mas não numa etiqueta de 63 mm.
//
// "Dinheiro" ao lado de um preço em corpo 11 empurra o preço para fora da
// etiqueta. A abreviação vive aqui, e não no módulo de etiquetas, pelo mesmo
// motivo que a lista acima vive aqui: uma forma nova precisa aparecer inteira
// num lugar só.
const SELO_CURTO: Record<string, string> = {
  dinheiro: 'Din',
  debito: 'Débito',
  credito: 'Crédito',
  pix: 'Pix',
  carteira: 'Carteira',
  fiado: 'Fiado',
}

export function seloCurtoDaForma(tipo: string): string {
  return SELO_CURTO[tipo] ?? rotuloDaForma(tipo)
}

/** Ex.: ['pix','dinheiro'] → "Pix / Din". Lista vazia devolve string vazia. */
export function seloDasFormas(formas: string[]): string {
  return (formas ?? [])
    .filter(Boolean)
    .map(seloCurtoDaForma)
    .join(' / ')
}
