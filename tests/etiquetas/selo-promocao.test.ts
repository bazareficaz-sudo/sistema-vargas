import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { seloDasFormas, seloCurtoDaForma, FORMAS_PAGAMENTO } from '../../src/lib/pdv/formasPagamento'
import { linhaDoCampo } from '../../src/lib/etiquetas/conteudoCampo'
import type { CampoEtiqueta, ProdutoParaEtiqueta } from '../../src/lib/etiquetas/tipos'

// O SELO DA ETIQUETA ("Pix / Din" ao lado do preço promocional).
//
// Duas afirmações precisam continuar verdadeiras:
//
//  1. o selo diz as formas que a EMPRESA configurou, abreviadas para caber
//     numa etiqueta de 63 mm;
//  2. o selo NUNCA sobrevive sozinho — quando a promoção não está valendo, a
//     linha inteira some. Uma etiqueta com "Pix / Din" ao lado de nada
//     prometeria um desconto que o caixa não dá, e quem descobre isso é o
//     operador com o cliente na frente.
//
// `linhaDoCampo` é a mesma função que gerarPdf.tsx chama para cada campo.

const AGORA = new Date('2026-09-10T12:00:00Z')

// O Intl pt-BR separa "R$" do numero com espaco NAO SEPARAVEL (U+00A0) — e
// deve mesmo, para o simbolo nao cair sozinho no fim da linha da etiqueta.
// Normalizar aqui evita que o teste passe a depender desse detalhe: o que se
// afirma abaixo e sobre o SELO, nao sobre formatacao de moeda.
const normal = (l: { texto: string; selo: string } | null) =>
  l && { texto: l.texto.replace(/\s/g, ' '), selo: l.selo }

const produto = (p: Partial<ProdutoParaEtiqueta> = {}): ProdutoParaEtiqueta => ({
  id: 'p1', nome: 'TINTA ESMALTE 900ML', sku: '19678', ean: null,
  preco_venda: 100, preco_promocional: 80, promocao_ativa: true,
  promocao_inicio: null, promocao_fim: null,
  marca: null, unidade: 'UN', categoria: null, ...p,
})

const campoPromo = (selo?: string): CampoEtiqueta =>
  ({ campo: 'preco_promocional', fontSize: 11, bold: true, align: 'center', selo })

describe('selo das formas de pagamento', () => {
  test('o caso pedido: pix + dinheiro vira "Pix / Din"', () => {
    assert.equal(seloDasFormas(['pix', 'dinheiro']), 'Pix / Din')
  })

  test('a ordem é a que a empresa configurou', () => {
    assert.equal(seloDasFormas(['dinheiro', 'pix']), 'Din / Pix')
  })

  test('forma única não ganha barra', () => {
    assert.equal(seloDasFormas(['pix']), 'Pix')
  })

  test('lista vazia não vira selo — etiqueta sem condição não anuncia condição', () => {
    assert.equal(seloDasFormas([]), '')
    assert.equal(seloDasFormas(['', null as unknown as string]), '')
  })

  test('TODA forma do PDV tem selo curto: uma forma nova não pode sair sem abreviação', () => {
    for (const f of FORMAS_PAGAMENTO) {
      const selo = seloCurtoDaForma(f.id)
      assert.ok(selo.length > 0, `${f.id} sem selo`)
      assert.ok(selo.length <= 8, `${f.id}: "${selo}" não cabe na etiqueta`)
    }
  })

  test('forma desconhecida cai no rótulo em vez de sumir', () => {
    assert.equal(seloCurtoDaForma('vale_refeicao'), 'vale_refeicao')
  })
})

describe('o que a etiqueta imprime no campo de promoção', () => {
  test('promoção valendo: preço e selo saem juntos', () => {
    const linha = linhaDoCampo(campoPromo('Pix / Din'), produto(), AGORA)
    assert.deepEqual(normal(linha), { texto: 'R$ 80,00', selo: 'Pix / Din' })
  })

  test('sem selo configurado, o preço promocional sai como sempre saiu', () => {
    assert.deepEqual(normal(linhaDoCampo(campoPromo(), produto(), AGORA)), { texto: 'R$ 80,00', selo: '' })
  })

  test('O SELO NÃO SOBREVIVE SOZINHO — promoção desligada apaga a linha inteira', () => {
    assert.equal(linhaDoCampo(campoPromo('Pix / Din'), produto({ promocao_ativa: false }), AGORA), null)
  })

  test('promoção vencida: linha apagada, selo junto', () => {
    assert.equal(linhaDoCampo(campoPromo('Pix / Din'), produto({ promocao_fim: '2026-09-01' }), AGORA), null)
  })

  test('promoção que ainda não começou: linha apagada', () => {
    assert.equal(linhaDoCampo(campoPromo('Pix / Din'), produto({ promocao_inicio: '2026-10-01' }), AGORA), null)
  })

  test('promocional mais caro que o preço normal: linha apagada', () => {
    assert.equal(linhaDoCampo(campoPromo('Pix / Din'), produto({ preco_promocional: 120 }), AGORA), null)
  })

  test('espaço em branco não vira selo', () => {
    assert.deepEqual(normal(linhaDoCampo(campoPromo('   '), produto(), AGORA)), { texto: 'R$ 80,00', selo: '' })
  })

  test('o selo só existe no campo de promoção — nunca ao lado do preço cheio', () => {
    const cheio = { campo: 'preco_venda', fontSize: 11, bold: true, align: 'center', selo: 'Pix / Din' } as CampoEtiqueta
    assert.deepEqual(normal(linhaDoCampo(cheio, produto(), AGORA)), { texto: 'R$ 100,00', selo: '' })
  })

  test('os demais campos continuam como estavam', () => {
    const nome: CampoEtiqueta = { campo: 'nome', fontSize: 8, bold: true, align: 'left' }
    assert.deepEqual(normal(linhaDoCampo(nome, produto(), AGORA)), { texto: 'TINTA ESMALTE 900ML', selo: '' })

    const livre: CampoEtiqueta = { campo: 'texto_livre', fontSize: 8, bold: false, align: 'left', textoLivre: 'OFERTA' }
    assert.deepEqual(normal(linhaDoCampo(livre, produto(), AGORA)), { texto: 'OFERTA', selo: '' })

    const vazio: CampoEtiqueta = { campo: 'marca', fontSize: 8, bold: false, align: 'left' }
    assert.equal(linhaDoCampo(vazio, produto({ marca: null }), AGORA), null)
  })
})
