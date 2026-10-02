import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { montarFolha, type PedidoNaFolha } from '../../src/lib/etiquetas/folha'

// Etiqueta falsa 4x6 pol. no lugar da do marketplace.
async function etiquetaFalsa(paginas = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const f = await doc.embedFont(StandardFonts.HelveticaBold)
  for (let i = 0; i < paginas; i++) {
    const p = doc.addPage([288, 432])
    p.drawRectangle({ x: 10, y: 10, width: 268, height: 412, borderColor: rgb(0, 0, 0), borderWidth: 2 })
    for (let b = 0; b < 40; b++) p.drawRectangle({ x: 30 + b * 5.5, y: 330, width: b % 3 === 0 ? 3 : 1.5, height: 70, color: rgb(0, 0, 0) })
    p.drawText('ETIQUETA DO MARKETPLACE', { x: 30, y: 300, size: 14, font: f })
    p.drawText('Destinatário: Luiz Carlos Nogueira', { x: 30, y: 270, size: 10, font: f })
    p.drawText('Fortaleza - CE · CEP 60000-000', { x: 30, y: 255, size: 10, font: f })
  }
  return doc.save()
}

const pedido: PedidoNaFolha = {
  pv: 'PV-002282', canal: 'ML Ouro', numeroMarketplace: '2000018742738486',
  comprador: 'Thiago dos Santos Araújo', cidade: 'Guarujá, SP', prazo: '02/10 23:59', nf: 'NF-e 1240',
  observacao: 'Entregar na portaria — “frágil”',
  itens: [
    { nome: 'LUMINARIA LED PARA DOBRADICA MGJ271 - Kit 2un', sku: '25595', quantidade: 4 },
    { nome: 'FITA DUPLA FACE TRANSPARENTE IMP 5 METROS', sku: '25380', quantidade: 1 },
  ],
}

describe('folha de etiquetas', () => {
  test('paisagem: uma folha 6x4 por etiqueta, com mini pedido', async () => {
    const { pdf } = await montarFolha([{ pdf: await etiquetaFalsa(), pedido }, { pdf: await etiquetaFalsa(2), pedido }], 'paisagem')
    const doc = await PDFDocument.load(pdf)
    assert.equal(doc.getPageCount(), 3)
    const { width, height } = doc.getPage(0).getSize()
    assert.equal(Math.round(width), 432); assert.equal(Math.round(height), 288)
    if (process.env.SALVAR_EXEMPLO) writeFileSync(process.env.SALVAR_EXEMPLO, pdf)
  })
  test('original: folha 4x6 em pé', async () => {
    const { pdf } = await montarFolha([{ pdf: await etiquetaFalsa(), pedido }], 'original')
    const doc = await PDFDocument.load(pdf)
    const { width, height } = doc.getPage(0).getSize()
    assert.equal(Math.round(width), 288); assert.equal(Math.round(height), 432)
  })
  test('caracteres fora do Latin-1 não derrubam a montagem', async () => {
    const { pdf } = await montarFolha([{ pdf: await etiquetaFalsa(), pedido: { ...pedido, comprador: 'José 😀 ✓', itens: [{ nome: 'Item → teste', sku: null, quantidade: 1 }] } }], 'paisagem')
    assert.ok(pdf.length > 1000)
  })
  test('PDF inválido vira falha daquele pedido, sem derrubar o lote', async () => {
    const r = await montarFolha([{ pdf: new Uint8Array([1, 2, 3]), pedido }, { pdf: await etiquetaFalsa(), pedido }], 'paisagem')
    assert.equal(r.falhas.length, 1); assert.equal(r.falhas[0].indice, 0)
    const doc = await PDFDocument.load(r.pdf)
    assert.equal(doc.getPageCount(), 1)
  })
})
