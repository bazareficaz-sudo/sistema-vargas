import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  aplicarModelo, variaveisDoModelo, exemploDe,
  VARIAVEIS_PRODUTO_LINK, PADRAO_PRODUTO_LINK,
} from '../../src/lib/mensagens/modelo'

// A substituição não existia. Levantado em 02/09/2026: o sistema tinha três
// mecanismos de modelo de mensagem — a tabela `whatsapp_modelos` (vazia), as
// sete colunas `texto_*` de `whatsapp_config` e a lista de variáveis na tela —
// e NENHUM código que trocasse uma chave por um valor. Dava para salvar
// "Olá {nome_cliente}" e o cliente receber exatamente isso.

describe('substituição de variáveis', () => {
  test('troca o que conhece', () => {
    const r = aplicarModelo('Olá! {produto} por {preco}: {link}', {
      produto: 'TELA MOSQUITEIRO', preco: 'R$ 8,00', link: 'https://loja/p/tela',
    })
    assert.equal(r.texto, 'Olá! TELA MOSQUITEIRO por R$ 8,00: https://loja/p/tela')
    assert.deepEqual(r.desconhecidas, [])
  })

  test('a mesma variável repetida é trocada em todas as ocorrências', () => {
    const r = aplicarModelo('{loja} — veja em {loja}', { loja: 'Bazar Eficaz' })
    assert.equal(r.texto, 'Bazar Eficaz — veja em Bazar Eficaz')
  })

  test('número vira texto sem virar vazio', () => {
    const r = aplicarModelo('SKU {sku}', { sku: 25637 })
    assert.equal(r.texto, 'SKU 25637')
    assert.deepEqual(r.desconhecidas, [])
  })

  test('maiúsculas na chave não quebram', () => {
    assert.equal(aplicarModelo('{Produto}', { produto: 'X' }).texto, 'X')
  })
})

describe('variável sem valor NÃO vira string vazia', () => {
  // Apagar em silêncio produz "Segue o link do :" — uma frase quebrada que o
  // cliente recebe e ninguém explica. A chave fica à vista, e fica à vista no
  // lugar certo: na pré-visualização de quem está escrevendo.
  test('a chave é mantida e reportada', () => {
    const r = aplicarModelo('Segue o link do {produto}: {link}', { link: 'https://loja/p/x' })
    assert.equal(r.texto, 'Segue o link do {produto}: https://loja/p/x')
    assert.deepEqual(r.desconhecidas, ['produto'])
  })

  test('valor nulo, indefinido ou só espaços conta como ausente', () => {
    const r = aplicarModelo('{a}{b}{c}', { a: null, b: undefined, c: '   ' })
    assert.deepEqual(r.desconhecidas, ['a', 'b', 'c'])
    assert.equal(r.texto, '{a}{b}{c}')
  })

  test('variável de outro contexto é acusada antes do envio', () => {
    // Modelo de cobrança usado numa mensagem de produto.
    const r = aplicarModelo('Vence em {vencimento}. Link: {link}', { link: 'https://x' })
    assert.deepEqual(r.desconhecidas, ['vencimento'])
  })

  test('a mesma desconhecida não é listada duas vezes', () => {
    assert.deepEqual(aplicarModelo('{x} e {x}', {}).desconhecidas, ['x'])
  })
})

describe('variáveis oferecidas e não usadas', () => {
  test('diz o que o contexto tem e o texto ignorou', () => {
    const r = aplicarModelo('{link}', { link: 'https://x', produto: 'Tela', preco: 'R$ 8,00' })
    assert.deepEqual(r.naoUsadas.sort(), ['preco', 'produto'])
  })

  test('lista as variáveis que um texto pede, na ordem, sem repetir', () => {
    assert.deepEqual(variaveisDoModelo('{b} {a} {b}'), ['b', 'a'])
  })

  test('texto sem variável nenhuma', () => {
    const r = aplicarModelo('Bom dia!', { produto: 'Tela' })
    assert.equal(r.texto, 'Bom dia!')
    assert.deepEqual(r.desconhecidas, [])
    assert.deepEqual(r.naoUsadas, ['produto'])
  })
})

describe('o padrão do link de produto', () => {
  test('é só o link — a prévia do WhatsApp já traz foto, nome e preço', () => {
    // Conferido em produção em 01/09/2026: a página do produto tem OpenGraph
    // completo. Repetir o nome ocuparia a primeira linha, que é onde o
    // vendedor escreve o recado dele.
    assert.equal(PADRAO_PRODUTO_LINK, '{link}')
    const r = aplicarModelo(PADRAO_PRODUTO_LINK, { link: 'https://loja/p/tela' })
    assert.equal(r.texto, 'https://loja/p/tela')
    assert.deepEqual(r.desconhecidas, [])
  })

  test('todas as variáveis oferecidas têm exemplo, para a pré-visualização', () => {
    const ex = exemploDe(VARIAVEIS_PRODUTO_LINK)
    for (const v of VARIAVEIS_PRODUTO_LINK) {
      assert.ok(String(ex[v.chave] ?? '').trim(), `${v.chave} sem exemplo`)
      assert.ok(v.descricao.trim(), `${v.chave} sem descrição`)
    }
  })

  test('um modelo escrito só com as variáveis oferecidas não deixa buraco', () => {
    const texto = VARIAVEIS_PRODUTO_LINK.map(v => `{${v.chave}}`).join(' ')
    const r = aplicarModelo(texto, exemploDe(VARIAVEIS_PRODUTO_LINK))
    assert.deepEqual(r.desconhecidas, [], 'o que a tela oferece precisa ter valor no envio')
  })
})

describe('entradas estranhas não quebram', () => {
  test('texto vazio, nulo e chaves soltas', () => {
    assert.equal(aplicarModelo('', {}).texto, '')
    assert.equal(aplicarModelo(null as unknown as string, {}).texto, '')
    assert.equal(aplicarModelo('{ } {} {-}', { a: 'x' }).texto, '{ } {} {-}')
  })
})
