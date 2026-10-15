import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { atalhosDeRetorno, doCliente, etapaDe, hojeNaLoja, rotuloRetorno, rotuloSaida, somarDias, tempoDeEspera } from '../../src/lib/whatsapp/conversas'

describe('caixa de entrada do WhatsApp', () => {
  test('só a recebida é do cliente; o resto a loja mandou', () => {
    assert.equal(doCliente('recebida'), true)
    for (const t of ['atendimento', 'enviada_celular', 'orcamento', 'cupom', 'automacao_alerta_pedido']) assert.equal(doCliente(t), false)
  })
  test('rótulo do que a loja mandou; conversa comum sem rótulo', () => {
    assert.equal(rotuloSaida('atendimento'), null)
    assert.equal(rotuloSaida('recebida'), null)
    assert.equal(rotuloSaida('orcamento'), 'Orçamento')
    assert.equal(rotuloSaida('enviada_celular'), 'Pelo celular')
    assert.equal(rotuloSaida('automacao_qualquer_coisa'), 'Automação')
    assert.equal(rotuloSaida('tipo_novo'), 'tipo_novo')
  })
  test('tempo de espera legível', () => {
    const agora = new Date('2026-10-15T12:00:00Z')
    assert.equal(tempoDeEspera('2026-10-15T11:59:40Z', agora), 'agora')
    assert.equal(tempoDeEspera('2026-10-15T11:48:00Z', agora), '12 min')
    assert.equal(tempoDeEspera('2026-10-15T09:00:00Z', agora), '3 h')
    assert.equal(tempoDeEspera('2026-10-14T11:00:00Z', agora), '1 dia')
    assert.equal(tempoDeEspera('2026-10-12T11:00:00Z', agora), '3 dias')
    assert.equal(tempoDeEspera('2026-10-15T12:05:00Z', agora), 'agora')
  })
})

import { legendaDoProduto, preencherResposta, respostasPadrao } from '../../src/lib/whatsapp/conversas'

describe('produto na conversa', () => {
  const agora = new Date('2026-10-15T12:00:00Z')
  test('preço normal, com unidade quando não é UN, e código', () => {
    assert.equal(legendaDoProduto({ nome: 'CIMENTO CP II 50KG ', preco_venda: 39.9, sku: 123, unidade: 'SC' }, agora), '*CIMENTO CP II 50KG*\n*R$ 39,90* / SC\nCód. 123')
    assert.equal(legendaDoProduto({ nome: 'Torneira', preco_venda: 49.9, unidade: 'UN' }, agora), '*Torneira*\n*R$ 49,90*')
  })
  test('promoção vigente: de/por e validade; vencida: preço normal', () => {
    const p = { nome: 'Tinta 18L', preco_venda: 300, preco_promocional: 249.9, promocao_ativa: true, promocao_fim: '2026-10-20T23:59:00-03:00' }
    assert.equal(legendaDoProduto(p, agora), '*Tinta 18L*\nDe ~R$ 300,00~ por *R$ 249,90* (promoção até 20/10)')
    assert.equal(legendaDoProduto({ ...p, promocao_fim: '2026-10-10T23:59:00-03:00' }, agora), '*Tinta 18L*\n*R$ 300,00*')
  })
  test('sem preço cadastrado: só o nome (nunca R$ 0,00)', () => {
    assert.equal(legendaDoProduto({ nome: 'Brinde', preco_venda: 0 }, agora), '*Brinde*')
  })
})

describe('respostas rápidas', () => {
  test('padrão só com o que a loja cadastrou', () => {
    assert.deepEqual(respostasPadrao({}).map(r => r.nome), ['Saudação', 'Obrigado'])
    const r = respostasPadrao({ horario: 'Seg a sáb, 8h às 18h', endereco: { logradouro: 'Rua Rio da Prata', numero: '1801', bairro: 'Bangu', cidade: 'Rio de Janeiro', uf: 'RJ' } })
    assert.deepEqual(r.map(x => x.nome), ['Saudação', 'Horário', 'Endereço', 'Obrigado'])
    assert.equal(r[2].conteudo, 'Estamos na Rua Rio da Prata, 1801 — Bangu, Rio de Janeiro - RJ. Te esperamos!')
  })
  test('nome e loja preenchidos; sem nome não sobra vírgula', () => {
    assert.equal(preencherResposta('Olá{, nome}! Aqui é da {loja}.', { nome: 'LEILANE souza', loja: 'Bazar Eficaz' }), 'Olá, Leilane! Aqui é da Bazar Eficaz.')
    assert.equal(preencherResposta('Olá{, nome}! Aqui é da {loja}.', { nome: null, loja: 'Bazar Eficaz' }), 'Olá! Aqui é da Bazar Eficaz.')
    assert.equal(preencherResposta('Oi {nome_cliente}, tudo bem?', { nome: '' }), 'Oi , tudo bem?')
  })
})

describe('etapas e lembrete de retorno', () => {
  // 15/10/2026 é quinta-feira; 23h50 em São Paulo já é dia 16 em UTC.
  const quinta = new Date('2026-10-16T02:50:00Z')
  test('hoje é o dia da loja, não o UTC', () => {
    assert.equal(hojeNaLoja(quinta), '2026-10-15')
  })
  test('atalhos: amanhã, 3 dias e próxima segunda', () => {
    assert.deepEqual(atalhosDeRetorno(quinta).map(a => a.dia), ['2026-10-16', '2026-10-18', '2026-10-19'])
    // Numa segunda, "próxima segunda" é a da semana seguinte.
    assert.equal(atalhosDeRetorno(new Date('2026-10-19T15:00:00Z'))[2].dia, '2026-10-26')
  })
  test('somarDias atravessa mês', () => {
    assert.equal(somarDias('2026-10-30', 3), '2026-11-02')
  })
  test('rótulo do retorno', () => {
    assert.equal(rotuloRetorno('2026-10-15', quinta), 'hoje')
    assert.equal(rotuloRetorno('2026-10-16', quinta), 'amanhã')
    assert.equal(rotuloRetorno('2026-10-14', quinta), 'atrasado 1 dia')
    assert.equal(rotuloRetorno('2026-10-12', quinta), 'atrasado 3 dias')
    assert.equal(rotuloRetorno('2026-10-20', quinta), '20/10')
  })
  test('etapa desconhecida cai em Novo', () => {
    assert.equal(etapaDe('orcamento').rotulo, 'Orçamento enviado')
    assert.equal(etapaDe('xyz').id, 'novo')
  })
})
