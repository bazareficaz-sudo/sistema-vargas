import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { HORARIO_SUGERIDO, descreverHorario, horarioValido, lojaAberta, mensagemForaHorario } from '../../src/lib/whatsapp/foraHorario'

// Horário de São Paulo = UTC − 3.
const sp = (iso: string) => new Date(`${iso}-03:00`)

describe('resposta fora do horário', () => {
  test('aberta/fechada no fuso da loja', () => {
    const s = horarioValido(HORARIO_SUGERIDO)!
    assert.equal(lojaAberta(s, sp('2026-10-15T10:00:00')), true)   // quinta 10h
    assert.equal(lojaAberta(s, sp('2026-10-15T07:59:00')), false)  // antes de abrir
    assert.equal(lojaAberta(s, sp('2026-10-15T08:00:00')), true)   // abre incluído
    assert.equal(lojaAberta(s, sp('2026-10-15T18:00:00')), false)  // fecha não
    assert.equal(lojaAberta(s, sp('2026-10-15T23:30:00')), false)  // noite (já é sexta em UTC)
    assert.equal(lojaAberta(s, sp('2026-10-17T11:00:00')), true)   // sábado manhã
    assert.equal(lojaAberta(s, sp('2026-10-17T13:00:00')), false)  // sábado tarde
    assert.equal(lojaAberta(s, sp('2026-10-18T10:00:00')), false)  // domingo
  })
  test('horário inválido não liga nada', () => {
    assert.equal(horarioValido(null), null)
    assert.equal(horarioValido({}), null)
    assert.equal(horarioValido({ 1: { abre: '18:00', fecha: '08:00' } }), null)
    assert.equal(horarioValido({ 1: { abre: '8h', fecha: '18h' } }), null)
    const so = horarioValido({ 1: { abre: '08:00', fecha: '12:00' }, 2: { abre: 'x', fecha: '12:00' } })!
    assert.deepEqual(so[1], { abre: '08:00', fecha: '12:00' })
    assert.equal(so[2], null)
  })
  test('descrição agrupa dias seguidos com o mesmo turno', () => {
    assert.equal(descreverHorario(horarioValido(HORARIO_SUGERIDO)!), 'seg a sex, 8h às 18h; sáb, 8h às 12h')
    assert.equal(descreverHorario(horarioValido({ 1: { abre: '07:30', fecha: '17:30' }, 3: { abre: '07:30', fecha: '17:30' } })!), 'seg, 7h30 às 17h30; qua, 7h30 às 17h30')
    assert.equal(descreverHorario(horarioValido({ 6: { abre: '08:00', fecha: '12:00' }, 0: { abre: '08:00', fecha: '12:00' } })!), 'sáb e dom, 8h às 12h')
  })
  test('mensagem: padrão ou da loja, com nome, loja e horário', () => {
    const d = { nome: 'MARIA SILVA', loja: 'Bazar Eficaz', horario: 'seg a sex, 8h às 18h' }
    assert.equal(mensagemForaHorario(null, d), 'Olá, Maria! Aqui é da Bazar Eficaz. Recebemos sua mensagem 😊\nNosso horário de atendimento é seg a sex, 8h às 18h. Respondemos assim que abrirmos!')
    assert.equal(mensagemForaHorario('  ', { ...d, nome: null }).startsWith('Olá! Aqui é da Bazar Eficaz.'), true)
    assert.equal(mensagemForaHorario('Oi {nome}, abrimos {horario}.', d), 'Oi Maria, abrimos seg a sex, 8h às 18h.')
  })
})
