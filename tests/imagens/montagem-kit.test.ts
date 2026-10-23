import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { layoutDaMontagem, montarImagemKit, textoDoSelo } from '../../src/lib/imagens/montagemKit'

const cor = (r: number, g: number, b: number, w = 300, h = 200) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer()

async function pixel(img: Buffer, x: number, y: number) {
  const { data, info } = await sharp(img).raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * info.channels
  return [data[i], data[i + 1], data[i + 2]]
}

describe('layout da imagem do kit', () => {
  test('2 componentes: lado a lado, mesmo tamanho, centrados na altura', () => {
    const [a, b] = layoutDaMontagem(2, 1200)
    assert.equal(a.y, b.y)
    assert.equal(a.lado, b.lado)
    assert.ok(b.x > a.x + a.lado)
    assert.equal(a.y, Math.round((1200 - a.lado) / 2))
  })

  test('3 componentes: 2 em cima, 1 embaixo centrado', () => {
    const [a, b, c] = layoutDaMontagem(3, 1200)
    assert.equal(a.y, b.y)
    assert.ok(c.y > a.y)
    assert.equal(c.x, Math.round((1200 - c.lado) / 2))
  })

  test('nada sai do quadrado, até 9 componentes', () => {
    for (let n = 1; n <= 9; n++) {
      for (const c of layoutDaMontagem(n, 1200)) {
        assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.lado <= 1200 && c.y + c.lado <= 1200, `n=${n}`)
      }
    }
  })

  test('selo só com quantidade maior que 1', () => {
    assert.equal(textoDoSelo(1), null)
    assert.equal(textoDoSelo(2), '2x')
    assert.equal(textoDoSelo(1.5), '1,5x')
  })
})

describe('montagem da imagem do kit', () => {
  test('junta as fotos num quadrado 1200 com fundo branco', async () => {
    const img = await montarImagemKit([
      { imagem: await cor(255, 0, 0), quantidade: 1 },
      { imagem: await cor(0, 0, 255, 200, 300), quantidade: 1 },
    ], { selo: false })
    const meta = await sharp(img).metadata()
    assert.equal(meta.width, 1200)
    assert.equal(meta.height, 1200)
    assert.equal(meta.format, 'jpeg')
    const [a, b] = layoutDaMontagem(2, 1200)
    const vermelho = await pixel(img, a.x + a.lado / 2, a.y + a.lado / 2)
    const azul = await pixel(img, b.x + b.lado / 2, b.y + b.lado / 2)
    assert.ok(vermelho[0] > 200 && vermelho[2] < 60, `vermelho ${vermelho}`)
    assert.ok(azul[2] > 200 && azul[0] < 60, `azul ${azul}`)
    const canto = await pixel(img, 5, 5)
    assert.ok(canto.every(v => v > 245), `fundo ${canto}`)
  })

  test('com selo, o canto da foto com 2 unidades ganha o selo azul', async () => {
    const partes = [{ imagem: await cor(255, 255, 255), quantidade: 2 }, { imagem: await cor(255, 255, 255), quantidade: 1 }]
    const [a, b] = layoutDaMontagem(2, 1200)
    const ponto = (c: typeof a) => [c.x + c.lado - Math.round(c.lado * 0.03) - 30, Math.round(c.lado * 0.03) + c.y + 30] as const
    const com = await montarImagemKit(partes, { selo: true })
    const [r, , bl] = await pixel(com, ...ponto(a))
    assert.ok(bl > 150 && r < 100, 'selo na foto de 2 un')
    assert.ok((await pixel(com, ...ponto(b))).every(v => v > 240), 'sem selo na foto de 1 un')
  })
})

describe('sobra branca em volta da foto', () => {
  test('o produto pequeno no meio de uma margem branca é ampliado para a célula', async () => {
    const pequeno = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .composite([{ input: await cor(255, 0, 0, 100, 100), left: 450, top: 450 }]).png().toBuffer()
    const img = await montarImagemKit([{ imagem: pequeno, quantidade: 1 }], { selo: false })
    const [c] = layoutDaMontagem(1, 1200)
    // Sem o corte, o quadrado vermelho teria ~10% da célula; com ele, a ocupa.
    const quaseNaBorda = await pixel(img, c.x + 20, c.y + 20)
    assert.ok(quaseNaBorda[0] > 200 && quaseNaBorda[1] < 60, `pixel ${quaseNaBorda}`)
  })
})
