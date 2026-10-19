import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { blocoDoCliente, completarComCep, extrairEndereco, pareceEndereco } from '../../src/lib/whatsapp/endereco'

describe('endereço digitado na conversa', () => {
  it('reconhece endereço e ignora conversa comum', () => {
    assert.ok(pareceEndereco('Rua das Flores, 123'))
    assert.ok(pareceEndereco('meu cep é 24020-071'))
    assert.ok(pareceEndereco('cep 24020071'))
    assert.ok(pareceEndereco('Av. Brasil 1500 casa 2'))
    assert.ok(!pareceEndereco('Bom dia! Hoje funciona em horário normal?'))
    assert.ok(!pareceEndereco('Qual o valor da barrica de massa corrida?'))
    assert.ok(!pareceEndereco('meu número é 21 99999-1234'))
    assert.ok(!pareceEndereco('chego às 12h na rua'))
  })

  it('lê rua, número, complemento, bairro, cidade e CEP', () => {
    assert.deepEqual(extrairEndereco('Rua das Flores, 123 apto 201 - Centro - Niterói/RJ CEP 24020-071'), {
      cep: '24020071', logradouro: 'Rua das Flores', numero: '123', complemento: 'apto 201',
      bairro: 'Centro', cidade: 'Niterói', estado: 'RJ',
    })
    const av = extrairEndereco('av. brasil nº 1500, casa 2, bairro Jardim América')
    assert.equal(av.logradouro, 'Avenida brasil'); assert.equal(av.numero, '1500')
    assert.equal(av.complemento, 'casa 2'); assert.equal(av.bairro, 'Jardim América')
    const sn = extrairEndereco('Estrada do Mato s/n fundos')
    assert.equal(sn.logradouro, 'Estrada do Mato'); assert.equal(sn.numero, 'S/N'); assert.equal(sn.complemento, 'Fundos')
    const nomeComNumero = extrairEndereco('Rua 7 de Setembro 45, São Gonçalo - rj')
    assert.equal(nomeComNumero.logradouro, 'Rua 7 de Setembro'); assert.equal(nomeComNumero.numero, '45')
    assert.equal(nomeComNumero.cidade, 'São Gonçalo'); assert.equal(nomeComNumero.estado, 'RJ')
  })

  it('sem nada reconhecível, tudo vazio', () => {
    assert.deepEqual(extrairEndereco('ok, obrigada!'), { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '' })
  })

  it('junta as mensagens seguidas do cliente (sem a loja no meio, até 10 min)', () => {
    const m = (conteudo: string, min: number, doCliente = true) => ({ conteudo, doCliente, quando: new Date(Date.UTC(2026, 9, 19, 12, min)).toISOString() })
    const lista = [m('oi', 0), m('pode entregar?', 1, false), m('Rua A, 10', 2), m('bairro Centro', 3), m('cep 24020-071', 5), m('obrigado', 30)]
    assert.equal(blocoDoCliente(lista, 3), 'Rua A, 10\nbairro Centro\ncep 24020-071')
    const e = extrairEndereco(blocoDoCliente(lista, 2))
    assert.equal(e.logradouro, 'Rua A'); assert.equal(e.bairro, 'Centro'); assert.equal(e.cep, '24020071')
  })

  it('CEP do ViaCEP vale mais para rua, bairro e cidade; número e complemento ficam', () => {
    const e = completarComCep(extrairEndereco('R. das Flores 12 ap 3, cep 24020-071'), { logradouro: 'Rua das Flores', bairro: 'Centro', cidade: 'Niterói', estado: 'RJ' })
    assert.deepEqual(e, { cep: '24020071', logradouro: 'Rua das Flores', numero: '12', complemento: 'ap 3', bairro: 'Centro', cidade: 'Niterói', estado: 'RJ' })
  })
})
