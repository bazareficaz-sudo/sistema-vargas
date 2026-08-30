import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { conferirCoerenciaFiscal, situacaoTributariaIcms, type ItemParaConferir } from '../../src/lib/fiscal/coerencia'

// REJEIÇÃO 806 — "Operação com ICMS-ST sem informação do CEST".
//
// A venda #301973 foi recusada com essa mensagem tendo o CEST 1007900
// corretamente cadastrado no produto. O código nunca saiu do banco:
// `EmissaoNFCeItem` não tinha campo de CEST, então nenhum dos dois provedores
// recebia o dado. Quem estava no balcão via "preencha o CEST" olhando para um
// CEST preenchido.
//
// O envio foi corrigido. Estes testes prendem a REDE embaixo: a conferência
// que roda antes de gastar uma ida à SEFAZ, para o caso que o envio não
// resolve — o produto que declara ST e de fato não tem CEST nenhum.

function item(p: Partial<ItemParaConferir> = {}): ItemParaConferir {
  return { nome: 'TORNEIRA HERC JARDIM 1/2 PRETA', sku: '3120', cfop: '5405', situacao: '500', ...p }
}

describe('CEST em operação com substituição tributária', () => {
  test('ST declarada e sem CEST: barra antes da SEFAZ, dizendo o produto e o caminho', () => {
    const { erros } = conferirCoerenciaFiscal([item({ cest: undefined })], true)
    assert.equal(erros.length, 1)
    assert.match(erros[0], /TORNEIRA HERC JARDIM/)
    assert.match(erros[0], /806/)
    assert.match(erros[0], /aba Fiscal/)
  })

  test('ST declarada COM CEST: passa — era o caso real que estava sendo recusado', () => {
    const { erros } = conferirCoerenciaFiscal([item({ cest: '1007900' })], true)
    assert.deepEqual(erros, [])
  })

  test('venda comum sem CEST: passa — a maioria do catálogo não tem ST', () => {
    const { erros } = conferirCoerenciaFiscal([item({ cfop: '5102', situacao: '102' })], true)
    assert.deepEqual(erros, [])
  })

  test('regime normal: CST 60 é ST e cobra CEST igual ao CSOSN 500', () => {
    const semCest = conferirCoerenciaFiscal([item({ situacao: '60' })], false)
    assert.equal(semCest.erros.length, 1)
    assert.match(semCest.erros[0], /806/)

    const comCest = conferirCoerenciaFiscal([item({ situacao: '60', cest: '1007900' })], false)
    assert.deepEqual(comCest.erros, [])
  })

  test('PAR INCOERENTE GANHA DO CEST: a mensagem certa é o par, não o campo que falta', () => {
    // CFOP de ST com situação de venda comum, e sem CEST. Os dois problemas
    // existem, mas mandar preencher CEST aqui seria mandar preencher um campo
    // que talvez nem devesse existir neste produto — primeiro se decide se ele
    // tem ST ou não.
    const { erros } = conferirCoerenciaFiscal([item({ cfop: '5405', situacao: '102' })], true)
    assert.equal(erros.length, 1)
    assert.match(erros[0], /substituição tributária, mas o CSOSN 102/)
    assert.doesNotMatch(erros[0], /806/)
  })

  test('o inverso também: situação com ST e CFOP comum reclama do par, não do CEST', () => {
    const { erros } = conferirCoerenciaFiscal([item({ cfop: '5102', situacao: '500' })], true)
    assert.equal(erros.length, 1)
    assert.match(erros[0], /declara substituição tributária, mas o CFOP 5102/)
    assert.doesNotMatch(erros[0], /806/)
  })

  test('CFOP recusado em NFC-e continua ganhando de tudo', () => {
    // 5403 é ST, mas não é aceito em NFC-e. Reclamar de CEST aqui mandaria o
    // operador consertar a coisa errada.
    const { erros } = conferirCoerenciaFiscal([item({ cfop: '5403', situacao: '500' })], true)
    assert.equal(erros.length, 1)
    assert.match(erros[0], /não é aceito em NFC-e/)
    assert.doesNotMatch(erros[0], /806/)
  })

  test('cada item é conferido: um sem CEST no meio de vários não passa despercebido', () => {
    const { erros } = conferirCoerenciaFiscal([
      item({ nome: 'LIXA MADEIRA G.100', sku: '15632', cfop: '5102', situacao: '102' }),
      item({ nome: 'TE SOLDÁVEL', sku: '3099', cfop: '5405', situacao: '500', cest: '1006400' }),
      item({ nome: 'REGISTRO ESFERA', sku: '2922', cfop: '5405', situacao: '500' }),
    ], true)
    assert.equal(erros.length, 1)
    assert.match(erros[0], /REGISTRO ESFERA/)
  })
})

// A SITUAÇÃO TRIBUTÁRIA QUE VAI NA NOTA — e a que parece ir.
//
// A venda #301980 travou duas vezes. Na segunda, por causa da própria tela que
// deveria destravá-la: ela lia a situação como `csosn ?? icms_cst` e chegava
// num valor diferente do que a emissão manda. Dizia "nenhuma pendência"
// enquanto a SEFAZ continuava recusando o mesmo item — o operador ficava sem
// nada para corrigir e sem poder emitir.
describe('situacaoTributariaIcms — uma conta só, para os dois lados', () => {
  test('CST 60 numa empresa do Simples NÃO vira 60: vira o padrão 102', () => {
    // '60' tem 2 dígitos, então não é CSOSN. Este é o caso exato do produto
    // BROCA: preenchido para o regime de quem vende, emitido pelo de quem
    // emite. É o valor que produz o par quebrado com o CFOP 5405.
    assert.equal(situacaoTributariaIcms({ csosn: null, icms_cst: '60' }, true), '102')
  })

  test('e é por isso que o par 5405 + CST 60 no Simples É uma pendência', () => {
    const { erros } = conferirCoerenciaFiscal([{
      nome: 'BROCA PARA CONCRETO PAREDE 8MM TRAMONTINA',
      cfop: '5405',
      situacao: situacaoTributariaIcms({ csosn: null, icms_cst: '60' }, true),
      cest: '0801300',
    }], true)
    assert.equal(erros.length, 1)
    assert.match(erros[0], /CSOSN 102 é de venda comum/)
  })

  test('depois da correção (CSOSN 500), o mesmo item passa', () => {
    const { erros } = conferirCoerenciaFiscal([{
      nome: 'BROCA PARA CONCRETO PAREDE 8MM TRAMONTINA',
      cfop: '5405',
      situacao: situacaoTributariaIcms({ csosn: '500', icms_cst: null }, true),
      cest: '0801300',
    }], true)
    assert.deepEqual(erros, [])
  })

  test('CSOSN gravado na coluna do CST ainda é aceito — tem cara de CSOSN', () => {
    assert.equal(situacaoTributariaIcms({ csosn: null, icms_cst: '500' }, true), '500')
  })

  test('regime normal: CST vale, e sem CST o padrão é 00', () => {
    assert.equal(situacaoTributariaIcms({ csosn: null, icms_cst: '60' }, false), '60')
    assert.equal(situacaoTributariaIcms({ csosn: '500', icms_cst: null }, false), '00')
  })
})
