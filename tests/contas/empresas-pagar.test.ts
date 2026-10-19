import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { nomeCurto, empresasEscolhidas, valorDoCookie, chaveDoFornecedor, montarEmpresas } from '../../src/lib/contas/empresasPagar'
import { grupoDaConta } from '../../src/lib/contas/agendaPagar'

describe('empresas no contas a pagar', () => {
  test('nome curto', () => {
    assert.equal(nomeCurto('Bazar Eficaz'), 'Eficaz')
    assert.equal(nomeCurto('BAZAR OURO E PRATA'), 'Ouro e Prata')
    assert.equal(nomeCurto('Loja Centro'), 'Loja Centro')
  })

  test('cores diferentes por empresa', () => {
    const e = montarEmpresas([{ id: 'a', nome: 'A' }, { id: 'b', nome: 'B' }])
    assert.notEqual(e[0].cor, e[1].cor)
  })

  test('escolha vem do cookie, só com empresas permitidas', () => {
    const perm = ['a', 'b', 'c']
    assert.deepEqual(empresasEscolhidas('todas', perm, 'a'), perm)
    assert.deepEqual(empresasEscolhidas('b,c', perm, 'a'), ['b', 'c'])
    // id de empresa sem vínculo é ignorado
    assert.deepEqual(empresasEscolhidas('b,zzz', perm, 'a'), ['b'])
    // sem escolha válida: a empresa em que a sessão está
    assert.deepEqual(empresasEscolhidas('zzz', perm, 'c'), ['c'])
    assert.deepEqual(empresasEscolhidas(undefined, perm, 'a'), ['a'])
  })

  test('cookie guarda "todas" quando são todas', () => {
    assert.equal(valorDoCookie(['a', 'b'], ['a', 'b']), 'todas')
    assert.equal(valorDoCookie(['b'], ['a', 'b']), 'b')
  })

  test('mesmo fornecedor nas duas empresas pelo CNPJ', () => {
    assert.equal(chaveDoFornecedor('f1', '12.345.678/0001-90'), chaveDoFornecedor('f2', '12345678000190'))
    assert.equal(chaveDoFornecedor('f1', null), 'f1')
    assert.equal(chaveDoFornecedor(null, null), '__sem__')
  })

  test('agrupar por empresa', () => {
    const g = grupoDaConta({ vencimento: '2026-10-20', valor: 1, status: 'pendente', empresaNome: 'Bazar Eficaz' }, 'empresa', '2026-10-19')
    assert.equal(g.rotulo, 'Bazar Eficaz')
  })
})
