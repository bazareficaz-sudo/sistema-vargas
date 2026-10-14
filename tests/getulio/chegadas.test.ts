import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  classificar, contarBoletim, ehIdDeGrupo, estoqueAntesDaNota, montarAlertaSemPreco, montarTextoChegada, quantidadeDaNota,
  MAX_POR_SECAO, type BoletimChegada, type ItemChegada,
} from '../../src/lib/getulio/chegadasRegras'

const agora = new Date('2026-10-14T15:00:00Z')
const diasAtras = (d: number) => new Date(agora.getTime() - d * 86_400_000).toISOString()

const item = (over: Partial<ItemChegada> = {}): ItemChegada => ({
  produtoId: over.produtoId ?? 'p1', nome: 'TRENA 5M', sku: '123', quantidade: 12, estoque: 12, unidade: 'UN',
  preco: 19.9, promo: null, localizacao: null, classe: 'reposicao', faltas: 0, clientesEsperando: 0, semPreco: false,
  ...over,
})

describe('estoque antes da nota', () => {
  test('entrada simples: o estoque_anterior da entrada', () => {
    assert.equal(estoqueAntesDaNota([{ tipo: 'entrada_compra', quantidade: 10, estoque_anterior: 3, created_at: '2026-10-14T10:00:00Z' }]), 3)
  })

  test('"zerar antes": vale o saldo do ajuste, não o 0 da entrada', () => {
    // Sem isso, todo item zerado-antes pareceria "voltou ao estoque".
    assert.equal(estoqueAntesDaNota([
      { tipo: 'entrada_nfe', quantidade: 6, estoque_anterior: 0, created_at: '2026-10-14T10:00:01Z' },
      { tipo: 'ajuste_saida', quantidade: 15, estoque_anterior: 15, created_at: '2026-10-14T10:00:00Z' },
    ]), 15)
  })

  test('remessa recebida de outra empresa conta como chegada', () => {
    assert.equal(quantidadeDaNota([
      { tipo: 'transferencia_entrada', quantidade: 12, estoque_anterior: 5, created_at: 'a' },
    ]), 12)
    assert.equal(estoqueAntesDaNota([{ tipo: 'transferencia_entrada', quantidade: 12, estoque_anterior: 5, created_at: 'a' }]), 5)
  })

  test('quantidade soma só as entradas (o mesmo item duas vezes na nota)', () => {
    assert.equal(quantidadeDaNota([
      { tipo: 'entrada_compra', quantidade: 4, estoque_anterior: 0, created_at: 'a' },
      { tipo: 'entrada_compra', quantidade: 6, estoque_anterior: 4, created_at: 'b' },
      { tipo: 'ajuste_saida', quantidade: 9, estoque_anterior: 9, created_at: 'c' },
    ]), 10)
  })
})

describe('classificar', () => {
  test('produto recente, sem entrada antes e sem estoque = novidade', () => {
    assert.equal(classificar({ antes: 0, teveEntradaAntes: false, criadoEm: diasAtras(2), faltas: 0, agora }), 'novidade')
  })

  test('produto antigo da importação (sem movimento, zerado) não é novidade: voltou', () => {
    assert.equal(classificar({ antes: 0, teveEntradaAntes: false, criadoEm: diasAtras(120), faltas: 0, agora }), 'voltou')
    // Importação em massa de 18/08, vista em 14/10: 57 dias — também não.
    assert.equal(classificar({ antes: 0, teveEntradaAntes: false, criadoEm: diasAtras(57), faltas: 0, agora }), 'voltou')
  })

  test('zerado que já teve entrada = voltou', () => {
    assert.equal(classificar({ antes: 0, teveEntradaAntes: true, criadoEm: diasAtras(5), faltas: 0, agora }), 'voltou')
  })

  test('negativo também é voltou', () => {
    assert.equal(classificar({ antes: -3, teveEntradaAntes: true, criadoEm: diasAtras(300), faltas: 0, agora }), 'voltou')
  })

  test('com estoque mas na lista de faltas = voltou', () => {
    assert.equal(classificar({ antes: 2, teveEntradaAntes: true, criadoEm: diasAtras(300), faltas: 1, agora }), 'voltou')
  })

  test('com estoque e sem falta = reposição', () => {
    assert.equal(classificar({ antes: 5, teveEntradaAntes: true, criadoEm: diasAtras(300), faltas: 0, agora }), 'reposicao')
  })
})

describe('texto do boletim', () => {
  const boletim = (itens: ItemChegada[]): BoletimChegada => ({ rotulo: 'NF 1234', fornecedor: 'FORTLEV', itens })

  test('novidade com preço, estoque e endereço; voltou com clientes esperando', () => {
    const t = montarTextoChegada(boletim([
      item({ produtoId: 'a', nome: 'ADAPTADOR 50MM', classe: 'novidade', preco: 22, estoque: 12, localizacao: 'A3-02' }),
      item({ produtoId: 'b', nome: 'TRENA 5M', classe: 'voltou', clientesEsperando: 2, faltas: 2 }),
    ]), { incluirReposicao: true })!
    assert.match(t, /Chegou mercadoria/)
    assert.match(t, /NF 1234 · FORTLEV/)
    assert.match(t, /🆕 \*Novidades\* \(1\)/)
    assert.match(t, /ADAPTADOR 50MM — R\$\s?22,00 · 12 un · 📍 A3-02/)
    assert.match(t, /🔄 \*Voltaram ao estoque\* \(1\)/)
    assert.match(t, /👥 2 clientes esperando/)
    assert.doesNotMatch(t, /Reposição/)
  })

  test('produto sem preço nunca vai para o grupo', () => {
    const t = montarTextoChegada(boletim([
      item({ produtoId: 'a', nome: 'SEM PRECO', classe: 'novidade', preco: 0, semPreco: true }),
      item({ produtoId: 'b', nome: 'COM PRECO', classe: 'novidade' }),
    ]), { incluirReposicao: true })!
    assert.doesNotMatch(t, /SEM PRECO/)
    assert.match(t, /COM PRECO/)
  })

  test('só sem preço = nada para o grupo; o alerta vai para o dono', () => {
    const b = boletim([item({ nome: 'HIDROSAN 10KG', sku: '25839', preco: 0, semPreco: true, classe: 'novidade' })])
    assert.equal(montarTextoChegada(b, { incluirReposicao: true }), null)
    assert.match(montarAlertaSemPreco(b)!, /HIDROSAN 10KG \(SKU 25839\)/)
  })

  test('só reposição com reposição desligada = sem mensagem', () => {
    const b = boletim([item({ classe: 'reposicao' })])
    assert.equal(montarTextoChegada(b, { incluirReposicao: false }), null)
    assert.match(montarTextoChegada(b, { incluirReposicao: true })!, /📦 \*Reposição\* \(1\)/)
  })

  test('reposição só pelos nomes, com "e mais N"', () => {
    const itens = Array.from({ length: 11 }, (_, i) => item({ produtoId: `r${i}`, nome: `ITEM ${i}`, classe: 'reposicao' }))
    const t = montarTextoChegada(boletim(itens), { incluirReposicao: true })!
    assert.match(t, /ITEM 0, ITEM 1/)
    assert.match(t, /e mais 3\./)
    assert.doesNotMatch(t, /• ITEM/)
  })

  test('seção longa corta e avisa quantos faltam', () => {
    const itens = Array.from({ length: MAX_POR_SECAO + 5 }, (_, i) => item({ produtoId: `n${i}`, nome: `NOVO ${i}`, classe: 'novidade' }))
    const t = montarTextoChegada(boletim(itens), { incluirReposicao: true })!
    assert.equal((t.match(/^• /gm) ?? []).length, MAX_POR_SECAO)
    assert.match(t, /_e mais 5_/)
  })

  test('promoção vigente aparece com o preço de antes', () => {
    const t = montarTextoChegada(boletim([item({ classe: 'novidade', preco: 25, promo: 19.9 })]), { incluirReposicao: true })!
    assert.match(t, /🔥 R\$\s?19,90 \(de R\$\s?25,00\)/)
  })

  test('contagens não contam o que está sem preço', () => {
    const c = contarBoletim(boletim([
      item({ produtoId: 'a', classe: 'novidade' }), item({ produtoId: 'b', classe: 'voltou' }),
      item({ produtoId: 'c', classe: 'reposicao' }), item({ produtoId: 'd', classe: 'novidade', semPreco: true }),
    ]))
    assert.deepEqual(c, { novidades: 1, voltaram: 1, repostos: 1, sem_preco: 1 })
  })
})

describe('id de grupo', () => {
  test('formato atual e antigo da Z-API são grupo; telefone formatado não', () => {
    assert.equal(ehIdDeGrupo('120363019502650977-group'), true)
    assert.equal(ehIdDeGrupo('5585999991234-1623281429'), true)
    assert.equal(ehIdDeGrupo('85 99999-1234'), false)
    assert.equal(ehIdDeGrupo('5585999991234'), false)
  })
})
