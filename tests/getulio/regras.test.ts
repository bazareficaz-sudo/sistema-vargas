import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  agruparVaiFaltar, avaliarEstoqueParado, avaliarVaiFaltar, avaliarVendasCanal, corpoModelo, minutosDoDiaSP, minutosDoHorario,
  montarMensagem, normalizarErro, saudacao, selecionarParaResumo, traduzirMotivos, type SinalGuardado,
  blocoSemanal, selecionarAlertas, textoAlerta,
} from '../../src/lib/getulio/regras'
import { assinar } from '../../src/lib/getulio/vigias'

// Os limiares do Getúlio decidem entre útil e spam. Os números dos casos
// abaixo são os medidos em 07/10/2026.

describe('vendas por canal', () => {
  const linha = (ult7: number, ant28: number) => ({ canal_id: 'c1', canal: 'Shp Eficaz', plataforma: 'shopee', ult7_valor: ult7, ult7_qtd: 9, ant28_valor: ant28, ant28_qtd: 40 })

  test('queda de 69% (R$ 222 contra média de R$ 729) vira atenção', () => {
    const s = avaliarVendasCanal(linha(222, 729 * 4))
    assert.equal(s?.gravidade, 'atencao')
    assert.match(s!.titulo, /caíram 70%|caíram 69%/)
    assert.equal(s!.chave, 'vendas:queda:c1')
  })

  test('alta de 84% vira oportunidade', () => {
    const s = avaliarVendasCanal(linha(1399, 762 * 4))
    assert.equal(s?.gravidade, 'oportunidade')
  })

  test('oscilação pequena (-12%) não avisa', () => {
    assert.equal(avaliarVendasCanal(linha(11201, 12781 * 4)), null)
  })

  test('canal pequeno (média < R$ 300/semana) não avisa nem caindo a zero', () => {
    assert.equal(avaliarVendasCanal(linha(0, 200 * 4)), null)
  })

  test('PDV (sem canal) usa chave própria', () => {
    const s = avaliarVendasCanal({ ...linha(100, 1000 * 4), canal_id: null, canal: 'Loja física (PDV)' })
    assert.equal(s?.chave, 'vendas:queda:pdv')
  })
})

describe('vai faltar', () => {
  const g = (o: Partial<{ estoque: number; vend7: number; vend28ant: number; custo: number }>) => ({
    produto_id: 'p1', nome: 'Luva', sku: '1', estoque: 10, custo: 5, vend7: 0, vend28ant: 0, ultima_venda: null, ...o,
  })

  test('ritmo normal com estoque para menos de 7 dias avisa', () => {
    // 35 un. em 35 dias = 1/dia; 5 em estoque = 5 dias
    const s = avaliarVaiFaltar(g({ estoque: 5, vend7: 7, vend28ant: 28 }))
    assert.ok(s)
    assert.equal(s!.dados?.disparou, false)
  })

  test('disparou e acaba em menos de 14 dias avisa como disparou', () => {
    // semana 21 (3/dia) contra média 2/semana; 30 em estoque = 10 dias
    const s = avaliarVaiFaltar(g({ estoque: 30, vend7: 21, vend28ant: 8 }))
    assert.equal(s?.dados?.disparou, true)
    assert.match(s!.titulo, /disparou/)
  })

  test('disparou mas com estoque de sobra NÃO avisa (o caso dos parafusos)', () => {
    assert.equal(avaliarVaiFaltar(g({ estoque: 837, vend7: 92, vend28ant: 45 })), null)
  })

  test('sem estoque ou sem venda não avisa', () => {
    assert.equal(avaliarVaiFaltar(g({ estoque: 0, vend7: 10, vend28ant: 40 })), null)
    assert.equal(avaliarVaiFaltar(g({ estoque: 2, vend7: 0, vend28ant: 1 })), null)
  })

  test('acabando em menos de 3 dias é urgente', () => {
    assert.equal(avaliarVaiFaltar(g({ estoque: 2, vend7: 7, vend28ant: 28 }))?.gravidade, 'urgente')
  })
})

describe('vai faltar agrupado', () => {
  const g = (id: string, estoque: number, vend7: number, vend28ant: number) => avaliarVaiFaltar({
    produto_id: id, nome: `Produto ${id}`, sku: null, estoque, custo: 5, vend7, vend28ant, ultima_venda: null,
  })!
  test('um aviso só, com os que acabam primeiro na frente', () => {
    const s = agruparVaiFaltar([g('A', 5, 7, 28), g('B', 2, 7, 28)])
    assert.equal(s?.chave, 'produto:vai_faltar')
    assert.equal(s?.gravidade, 'urgente')
    assert.match(s!.titulo, /^2 produto/)
    assert.match(s!.detalhe, /Produto B \(2 dia\(s\)\); Produto A/)
  })
  test('assinatura muda quando entra produto novo', () => {
    const a = agruparVaiFaltar([g('A', 5, 7, 28)])!
    const b = agruparVaiFaltar([g('A', 5, 7, 28), g('B', 2, 7, 28)])!
    assert.notEqual(a.dados?.assinatura, b.dados?.assinatura)
  })
  test('lista vazia não avisa', () => {
    assert.equal(agruparVaiFaltar([]), null)
  })
})

describe('dinheiro parado', () => {
  const agora = new Date('2026-10-07T12:00:00Z')
  test('soma só o que não vende há 60+ dias e mostra os maiores', () => {
    const s = avaliarEstoqueParado([
      { produto_id: 'a', nome: 'A', sku: null, estoque: 100, custo: 20, vend7: 0, vend28ant: 0, ultima_venda: null },
      { produto_id: 'b', nome: 'B', sku: null, estoque: 10, custo: 50, vend7: 0, vend28ant: 0, ultima_venda: '2026-06-01T00:00:00Z' },
      { produto_id: 'c', nome: 'C', sku: null, estoque: 10, custo: 50, vend7: 1, vend28ant: 0, ultima_venda: '2026-10-05T00:00:00Z' },
    ], agora)
    assert.equal(s?.valor, 2500)
    assert.match(s!.titulo, /2 produtos/)
    assert.match(s!.detalhe, /^Os maiores: A/)
  })
  test('pouco dinheiro parado (< R$ 1.000) não avisa', () => {
    assert.equal(avaliarEstoqueParado([{ produto_id: 'a', nome: 'A', sku: null, estoque: 1, custo: 10, vend7: 0, vend28ant: 0, ultima_venda: null }], agora), null)
  })
})

describe('integrações e motivos', () => {
  test('erros do mesmo problema em anúncios diferentes viram o mesmo motivo', () => {
    assert.equal(
      normalizarErro('Nuvemshop em /products/297878427: App disabled for store until payment'),
      normalizarErro('Nuvemshop em /products/355827443: App disabled for store until payment'))
  })
  test('motivos da TikTok em português, sem repetir', () => {
    assert.equal(traduzirMotivos(['Prohibited Product', 'Prohibited Product']), 'produto proibido na TikTok')
    assert.equal(traduzirMotivos(['Abnormally Low Pricing']), 'preço muito abaixo de produtos parecidos')
  })
  test('assinatura muda quando entra item novo e não depende da ordem', () => {
    assert.equal(assinar(['a', 'b']), assinar(['b', 'a']))
    assert.notEqual(assinar(['a', 'b']), assinar(['a', 'b', 'c']))
  })
})

describe('o que entra no resumo', () => {
  const agora = new Date('2026-10-07T10:30:00Z')
  const s = (o: Partial<SinalGuardado>): SinalGuardado => ({
    id: Math.random().toString(), vigia: 'financeiro', chave: 'k', gravidade: 'atencao', titulo: 't', detalhe: 'd',
    valor: 0, link: null, detectado_em: agora.toISOString(), avisado_em: null, dispensado_em: null, ...o,
  })

  test('novo entra; já avisado não; dispensado não', () => {
    const { itens } = selecionarParaResumo([
      s({ titulo: 'novo' }),
      s({ titulo: 'avisado', avisado_em: '2026-10-06T10:30:00Z' }),
      s({ titulo: 'dispensado', dispensado_em: '2026-10-06T10:30:00Z' }),
    ], agora)
    assert.deepEqual(itens.map(i => i.titulo), ['novo'])
  })

  test('urgente aberto é lembrado depois de 48h, não antes', () => {
    const { itens } = selecionarParaResumo([
      s({ titulo: 'lembrar', gravidade: 'urgente', avisado_em: '2026-10-04T10:30:00Z' }),
      s({ titulo: 'cedo', gravidade: 'urgente', avisado_em: '2026-10-06T10:30:00Z' }),
    ], agora)
    assert.deepEqual(itens.map(i => i.titulo), ['lembrar'])
  })

  test('ordem: gravidade, depois dinheiro; no máximo 6 e conta o resto', () => {
    const lista = [
      s({ titulo: 'info', gravidade: 'info', valor: 99999 }),
      s({ titulo: 'atencao-pequeno', valor: 10 }),
      s({ titulo: 'atencao-grande', valor: 5000 }),
      s({ titulo: 'urgente', gravidade: 'urgente' }),
      ...Array.from({ length: 5 }, (_, i) => s({ titulo: `x${i}`, gravidade: 'oportunidade' })),
    ]
    const { itens, restantes } = selecionarParaResumo(lista, agora)
    assert.deepEqual(itens.slice(0, 3).map(i => i.titulo), ['urgente', 'atencao-grande', 'atencao-pequeno'])
    assert.equal(itens.length, 6)
    assert.equal(restantes, 3)
  })
})

describe('texto e relógio', () => {
  test('relógio de São Paulo (UTC−3)', () => {
    assert.equal(minutosDoDiaSP(new Date('2026-10-07T10:30:00Z')), 7 * 60 + 30)
    assert.equal(minutosDoHorario('07:30'), 450)
    assert.equal(minutosDoHorario('lixo'), 450)
  })
  test('saudação pelo horário e com o nome', () => {
    assert.equal(saudacao(new Date('2026-10-07T10:30:00Z'), 'Silvano'), '☀️ *Bom dia, Silvano. Getúlio aqui.*')
    assert.match(saudacao(new Date('2026-10-07T17:00:00Z'), ''), /Boa tarde\. Getúlio/)
  })
  test('mensagem com itens numerados, resto e link', () => {
    const corpo = corpoModelo([{
      id: '1', vigia: 'financeiro', chave: 'k', gravidade: 'urgente', titulo: 'Conta vencida', detalhe: 'R$ 100',
      valor: 100, link: null, detectado_em: '', avisado_em: null, dispensado_em: null,
    }])
    const msg = montarMensagem('Oi', corpo, 2, 'https://x/getulio')
    assert.match(msg, /1\. 🔴 \*Conta vencida\*/)
    assert.match(msg, /E mais 2 assunto/)
    assert.match(msg, /👉 https:\/\/x\/getulio$/)
  })
})

describe('alertas imediatos', () => {
  const agora = new Date('2026-10-08T13:00:00Z') // 10h em São Paulo
  const s = (o: Partial<SinalGuardado>): SinalGuardado => ({
    id: Math.random().toString(), vigia: 'zerado_a_venda', chave: 'k', gravidade: 'urgente', titulo: 't', detalhe: 'd',
    valor: 0, link: null, detectado_em: '2026-10-01T00:00:00Z', novidade_em: '2026-10-08T12:30:00Z',
    avisado_em: null, dispensado_em: null, ...o,
  })

  test('urgente de vigia imediato que acabou de virar novidade sai na hora', () => {
    assert.equal(selecionarAlertas([s({})], agora, 0).length, 1)
  })
  test('passivo antigo não dispara alerta (fica para o resumo)', () => {
    assert.equal(selecionarAlertas([s({ novidade_em: '2026-10-08T05:00:00Z' })], agora, 0).length, 0)
  })
  test('só urgente e só dos vigias de alerta; avisado ou dispensado não', () => {
    assert.equal(selecionarAlertas([
      s({ gravidade: 'atencao' }), s({ vigia: 'financeiro' }), s({ avisado_em: '2026-10-08T12:40:00Z' }), s({ dispensado_em: '2026-10-08T12:40:00Z' }),
    ], agora, 0).length, 0)
  })
  test('madrugada não manda e o limite do dia é respeitado', () => {
    assert.equal(selecionarAlertas([s({ novidade_em: '2026-10-08T04:30:00Z' })], new Date('2026-10-08T05:00:00Z'), 0).length, 0)
    assert.equal(selecionarAlertas([s({}), s({})], agora, 3).length, 1)
    assert.equal(selecionarAlertas([s({})], agora, 4).length, 0)
  })
  test('texto do alerta tem o assunto, o link e como parar', () => {
    const t = textoAlerta(s({ titulo: 'Canal X recusando' }), 'https://x/y')
    assert.match(t, /\*Canal X recusando\*/)
    assert.match(t, /👉 https:\/\/x\/y/)
    assert.match(t, /não me avise disso/)
  })
})

describe('semana que passou', () => {
  test('total e canais com variação contra a semana anterior', () => {
    const b = blocoSemanal(
      [{ canal: 'Loja física (PDV)', faturamento: 11000 }, { canal: 'ML Ouro', faturamento: 2900 }],
      [{ canal: 'Loja física (PDV)', faturamento: 12500 }, { canal: 'ML Ouro', faturamento: 1700 }],
      '29/09 a 05/10')
    assert.match(b, /Semana passada \(29\/09 a 05\/10\)/)
    assert.match(b, /▼2%/) // 13.900 contra 14.200
    assert.match(b, /Loja física \(PDV\): R\$\s?11\.000 \(▼12%\)/)
    assert.match(b, /ML Ouro: R\$\s?2\.900 \(▲71%\)/)
  })
})
