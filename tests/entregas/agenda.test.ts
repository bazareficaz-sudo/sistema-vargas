import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarAgenda, contagemPorDia, somarDias, enderecoLimpo, linkWhatsApp, linkMapa } from '../../src/lib/entregas/agenda'

const e = (id: string, data: string | null, periodo: string | null = null, feita: string | null = null) =>
  ({ id, entrega_agendada_para: data, entrega_periodo: periodo, entrega_realizada_em: feita })

test('separa do dia por período, atrasadas, sem data e realizadas', () => {
  const lista = [
    e('a', '2026-10-09', 'tarde'), e('b', '2026-10-09', 'manha'), e('c', '2026-10-09', null),
    e('d', '2026-10-07', 'noite'), e('e', null), e('f', '2026-10-12'),
    e('g', '2026-10-09', 'manha', '2026-10-09T13:00:00Z'),
  ]
  const ag = montarAgenda(lista, '2026-10-09', '2026-10-09')
  assert.deepEqual(ag.doDia.map(g => [g.periodo, g.itens.map(i => i.id)]), [['manha', ['b']], ['tarde', ['a']], ['qualquer', ['c']]])
  assert.deepEqual(ag.atrasadas.map(i => i.id), ['d'])
  assert.deepEqual(ag.semData.map(i => i.id), ['e'])
  assert.deepEqual(ag.realizadas.map(i => i.id), ['g'])
  assert.equal(ag.totalDoDia, 3)
})

test('olhando um dia passado, as entregas dele não aparecem duas vezes como atrasadas', () => {
  const ag = montarAgenda([e('d', '2026-10-07')], '2026-10-07', '2026-10-09')
  assert.equal(ag.totalDoDia, 1)
  assert.equal(ag.atrasadas.length, 0)
})

test('contagem por dia ignora feitas e sem data', () => {
  const m = contagemPorDia([e('a', '2026-10-10'), e('b', '2026-10-10'), e('c', null), e('d', '2026-10-10', null, 'x')])
  assert.equal(m.get('2026-10-10'), 2)
  assert.equal(m.size, 1)
})

test('somarDias atravessa mês', () => {
  assert.equal(somarDias('2026-10-31', 1), '2026-11-01')
  assert.equal(somarDias('2026-03-01', -1), '2026-02-28')
})

test('endereço, WhatsApp e mapa', () => {
  const t = 'Rua A, 10 — Centro — Rio | Obs: portão azul | Agendado: 09/10/2026 (tarde) | Tel: (21) 99120-3602'
  assert.equal(enderecoLimpo(t), 'Rua A, 10 — Centro — Rio | Obs: portão azul')
  assert.equal(linkWhatsApp('21991203602'), 'https://wa.me/5521991203602')
  assert.equal(linkWhatsApp('123'), null)
  assert.ok(linkMapa(enderecoLimpo(t))!.includes(encodeURIComponent('Rua A, 10 — Centro — Rio')))
})
