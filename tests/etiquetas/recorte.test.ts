import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { areasDeConteudo } from '../../src/lib/etiquetas/recorte'
import { montarFolha } from '../../src/lib/etiquetas/folha'

// Imita o PDF do Mercado Livre: folha A4, etiqueta 10x15 num pedaço dela e
// uma 2ª página com a lista de conteúdo.
async function folhaML(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const f = await doc.embedFont(StandardFonts.HelveticaBold)
  const p = doc.addPage([595, 842])
  p.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(1, 1, 1) }) // fundo branco (deve ser ignorado)
  const x0 = 40, y0 = 380 // canto inferior esquerdo da etiqueta
  p.drawRectangle({ x: x0, y: y0, width: 283, height: 425, borderColor: rgb(0, 0, 0), borderWidth: 1.5 })
  for (let b = 0; b < 40; b++) p.drawRectangle({ x: x0 + 20 + b * 6, y: y0 + 330, width: b % 3 ? 2 : 3.5, height: 70, color: rgb(0, 0, 0) })
  p.drawText('MERCADO ENVIOS', { x: x0 + 20, y: y0 + 300, size: 16, font: f })
  p.drawText('Destinatário: Antonio Carlos', { x: x0 + 20, y: y0 + 270, size: 11, font: f })
  const p2 = doc.addPage([595, 842])
  p2.drawText('Despacho - lista de conteúdo', { x: 40, y: 780, size: 12, font: f })
  return doc.save()
}

describe('recorte da etiqueta dentro da folha', () => {
  test('acha a área da etiqueta e ignora o fundo da página', async () => {
    const [c1] = await areasDeConteudo(await folhaML())
    assert.ok(c1)
    assert.ok(Math.abs(c1!.left - 40) < 3, `left ${c1!.left}`)
    assert.ok(Math.abs(c1!.bottom - 380) < 3, `bottom ${c1!.bottom}`)
    assert.ok(Math.abs(c1!.right - 323) < 4, `right ${c1!.right}`)
    assert.ok(Math.abs(c1!.top - 805) < 4, `top ${c1!.top}`)
  })
  test('folha do ML: só a 1ª página, recortada', async () => {
    const r = await montarFolha([{ pdf: await folhaML(), paginas: 'primeira', pedido: {
      pv: 'PV-002301', canal: 'ML Ouro', numeroMarketplace: '2000018753509092', comprador: 'Antonio Carlos Reis Quintela Junior',
      cidade: 'Jaboticatubas, MG', prazo: '02/10, 14:00', nf: null, observacao: null,
      itens: [{ nome: '**RALO ONCA 100 X 100 X 50MM 3 UND', sku: '25251', quantidade: 1 }],
    } }], 'paisagem')
    assert.equal(r.falhas.length, 0)
    const doc = await PDFDocument.load(r.pdf)
    assert.equal(doc.getPageCount(), 1)
    if (process.env.SALVAR_EXEMPLO) writeFileSync(process.env.SALVAR_EXEMPLO, r.pdf)
  })
})
