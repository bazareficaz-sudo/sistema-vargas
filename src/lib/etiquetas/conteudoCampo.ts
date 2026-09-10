import { promocaoVigente } from '@/lib/produtos/promocao'
import type { CampoEtiqueta, ProdutoParaEtiqueta, TipoCampo } from './tipos'

// O QUE CADA CAMPO DE TEXTO IMPRIME.
//
// Vive fora de `gerarPdf.tsx` de propósito: aquele arquivo carrega
// @react-pdf/renderer, jsbarcode e qrcode, e dois deles só funcionam com DOM.
// A regra de "o que sai na etiqueta" não deveria precisar de um navegador
// para ser conferida — e é a regra que decide se a gôndola anuncia um
// desconto que o caixa não dá.

function fmtPreco(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * `agora` vem de fora, uma vez por impressão: um lote grande demora, e a
 * etiqueta da prateleira não pode mudar de preço no meio da fila só porque a
 * promoção venceu entre a primeira folha e a última.
 */
export function valorCampo(campo: TipoCampo, produto: ProdutoParaEtiqueta, agora: Date): string {
  switch (campo) {
    case 'nome': return produto.nome
    case 'sku': return produto.sku ?? ''
    case 'ean': return produto.ean ?? ''
    case 'preco_venda': return fmtPreco(produto.preco_venda)
    // Promoção vencida, desligada ou mais cara que o preço normal não
    // imprime: a gôndola anunciaria um desconto que o caixa não dá.
    case 'preco_promocional':
      return promocaoVigente(produto, agora) ? fmtPreco(produto.preco_promocional!) : ''
    case 'marca': return produto.marca ?? ''
    case 'unidade': return produto.unidade ?? ''
    case 'categoria': return produto.categoria ?? ''
    case 'localizacao': return produto.localizacao ?? ''
    case 'data_impressao': return agora.toLocaleDateString('pt-BR')
    default: return ''
  }
}

export type LinhaEtiqueta = {
  texto: string
  /** Palavra ao lado do texto ("Pix / Din"). Vazia quando não há. */
  selo: string
}

/**
 * A linha de texto que este campo produz — ou `null` quando não produz nada.
 *
 * O SELO NUNCA SOBREVIVE SOZINHO. Ele acompanha o preço promocional, e o
 * preço promocional só é impresso enquanto a promoção está vigente. Quando
 * ela não está, esta função devolve `null` e a linha inteira desaparece —
 * selo junto. Uma etiqueta com "Pix / Din" ao lado de nada prometeria um
 * desconto que não existe mais, e quem descobre isso é o operador, com o
 * cliente na frente.
 */
export function linhaDoCampo(
  c: CampoEtiqueta,
  produto: ProdutoParaEtiqueta,
  agora: Date,
): LinhaEtiqueta | null {
  const texto = c.campo === 'texto_livre'
    ? (c.textoLivre ?? '')
    : valorCampo(c.campo, produto, agora)

  if (!texto) return null

  // Só o preço promocional carrega selo. Colocá-lo em qualquer campo faria a
  // palavra "Pix" aparecer ao lado do preço cheio, que é o oposto do recado.
  const selo = c.campo === 'preco_promocional' ? (c.selo ?? '').trim() : ''

  return { texto, selo }
}
