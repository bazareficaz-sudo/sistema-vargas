import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { montarNfeDoPedido, aliquotaInterestadual, type DadosNfePedido, type ProdutoDaNota } from '../../src/lib/fiscal/nfePedido'
import { REGRAS_PADRAO } from '../../src/lib/fiscal/perfilFiscal'
import type { DestinatarioFiscal } from '../../src/lib/fiscal/destinatario'
import { montarPayloadNFe } from '../../src/lib/fiscal/brasilnfe/emissao'

// A NF-e do pedido de marketplace junta tudo o que veio antes: o destinatário
// decide a situação, o regime de quem emite decide o código, o perfil do
// produto dá o par CFOP × CSOSN/CST. Os cenários são os do grupo: Ouro e
// Prata (Simples) e Bazar Eficaz (Lucro Presumido), as duas no RJ, vendendo
// sobretudo para pessoa física de outro estado.

const tributada = { nome: 'Revenda tributada', regras: REGRAS_PADRAO.tributada }
const comST = { nome: 'Revenda com ST', regras: REGRAS_PADRAO.st }

function produto(p: Partial<ProdutoDaNota> = {}): ProdutoDaNota {
  return {
    id: 'p1', nome: 'CANECA PORCELANA 300ML', sku: '1001', ncm: '6912.00.00', cest: null, icms_origem: 0,
    unidade: 'UN', icms_percentual: null, pis_cst: null, pis_percentual: null, cofins_cst: null, cofins_percentual: null,
    ...p,
  }
}

function destinatario(uf: string, extra: Partial<DestinatarioFiscal> = {}): DestinatarioFiscal {
  return {
    nome: 'Maria da Silva', cpfCnpj: '12345678909', inscricaoEstadual: null, fonte: 'tiktok',
    endereco: { logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro', cep: '01001000', municipio: 'São Paulo', uf },
    ...extra,
  }
}

function dados(o: { simples: boolean; uf?: string; perfil?: typeof tributada | null; prod?: Partial<ProdutoDaNota>; dest?: DestinatarioFiscal; cnpjIntermediador?: string | null }): DadosNfePedido {
  return {
    pedido: { id: 'ped-1', numero: '5800123' },
    canal: { nome: 'ML Ouro', intermediadorCnpj: o.cnpjIntermediador === undefined ? '03.007.331/0001-41' : o.cnpjIntermediador, intermediadorId: 'VENDEDOR123' },
    emitente: { cnpj: '11222333000181', uf: 'RJ', simplesNacional: o.simples, regimeTributario: o.simples ? 'simples_nacional' : 'lucro_presumido', naturezaOperacao: null },
    destinatario: o.dest ?? destinatario(o.uf ?? 'SP'),
    itens: [{ nome: 'Caneca', quantidade: 2, precoUnitario: 25.5, produto: produto(o.prod), perfil: o.perfil === undefined ? tributada : o.perfil }],
  }
}

describe('Ouro e Prata (Simples) vendendo pelo marketplace', () => {
  test('pessoa física de SP: 6108 / CSOSN 102, consumidor final, sem DIFAL, com intermediador', () => {
    const r = montarNfeDoPedido(dados({ simples: true }))
    assert.ok(r.ok, !r.ok ? r.erros.join('\n') : '')
    const it = r.input.itens[0]
    assert.equal(it.cfop, '6108')
    assert.equal(it.icmsSituacaoTributaria, '102')
    assert.equal(it.aliquotaIcms, undefined)
    assert.equal(it.pisCst, '49')
    assert.equal(it.ncm, '69120000')
    assert.equal(r.input.consumidorFinal, true)
    assert.equal(r.input.destinatario.indicadorIe, 9)
    assert.equal(r.input.destinatario.cpf, '12345678909')
    assert.deepEqual(r.input.intermediador, { cnpj: '03007331000141', idCadastro: 'VENDEDOR123' })
    assert.equal(r.resumo.difal, false)
    assert.equal(r.resumo.total, 51)
    assert.equal(r.input.pagamentos[0].valor, 51)
  })

  test('pessoa física do RJ: 5102 / 102', () => {
    const r = montarNfeDoPedido(dados({ simples: true, uf: 'RJ' }))
    assert.ok(r.ok)
    assert.equal(r.input.itens[0].cfop, '5102')
  })

  test('produto com ST para outro estado: bloqueia até a contabilidade definir a regra', () => {
    const r = montarNfeDoPedido(dados({ simples: true, perfil: comST, prod: { cest: '1007900' } }))
    assert.ok(!r.ok)
    assert.match(r.erros.join('\n'), /Revenda com ST/)
  })

  test('produto com ST dentro do estado sem CEST: barra antes da SEFAZ (806)', () => {
    const r = montarNfeDoPedido(dados({ simples: true, uf: 'RJ', perfil: comST }))
    assert.ok(!r.ok)
    assert.match(r.erros.join('\n'), /806/)
  })
})

describe('Bazar Eficaz (Lucro Presumido) vendendo pelo marketplace', () => {
  test('pessoa física de SP: 6108 / CST 00 a 12%, PIS/COFINS cumulativo, com DIFAL', () => {
    const r = montarNfeDoPedido(dados({ simples: false }))
    assert.ok(r.ok, !r.ok ? r.erros.join('\n') : '')
    const it = r.input.itens[0]
    assert.equal(it.cfop, '6108')
    assert.equal(it.icmsSituacaoTributaria, '00')
    assert.equal(it.aliquotaIcms, 12)
    assert.equal(it.pisCst, '01')
    assert.equal(it.pisAliquota, 0.65)
    assert.equal(it.cofinsAliquota, 3)
    assert.equal(r.resumo.difal, true)
  })

  test('para o Nordeste, 7%; mercadoria importada, 4% para qualquer estado', () => {
    const ba = montarNfeDoPedido(dados({ simples: false, uf: 'BA' }))
    assert.ok(ba.ok && ba.input.itens[0].aliquotaIcms === 7)
    const importada = montarNfeDoPedido(dados({ simples: false, uf: 'BA', prod: { icms_origem: 2 } }))
    assert.ok(importada.ok && importada.input.itens[0].aliquotaIcms === 4)
  })

  test('dentro do estado com CST 00 e sem alíquota no produto: diz o campo a preencher', () => {
    const r = montarNfeDoPedido(dados({ simples: false, uf: 'RJ' }))
    assert.ok(!r.ok)
    assert.match(r.erros.join('\n'), /ICMS %/)
    const comAliquota = montarNfeDoPedido(dados({ simples: false, uf: 'RJ', prod: { icms_percentual: 20 } }))
    assert.ok(comAliquota.ok && comAliquota.input.itens[0].aliquotaIcms === 20)
  })

  test('empresa com IE de outro estado: contribuinte, 6102, sem DIFAL', () => {
    const r = montarNfeDoPedido(dados({ simples: false, dest: destinatario('MG', { cpfCnpj: '12345678000195', inscricaoEstadual: '0623079040081' }) }))
    assert.ok(r.ok)
    assert.equal(r.input.itens[0].cfop, '6102')
    assert.equal(r.input.consumidorFinal, false)
    assert.equal(r.input.destinatario.indicadorIe, 1)
    assert.equal(r.input.destinatario.cnpj, '12345678000195')
    assert.equal(r.resumo.difal, false)
  })
})

describe('bloqueios que a tela precisa mostrar antes de qualquer envio', () => {
  test('produto sem perfil fiscal', () => {
    const r = montarNfeDoPedido(dados({ simples: true, perfil: null }))
    assert.ok(!r.ok)
    assert.match(r.erros[0], /sem perfil fiscal/)
  })

  test('canal sem CNPJ do marketplace', () => {
    const r = montarNfeDoPedido(dados({ simples: true, cnpjIntermediador: null }))
    assert.ok(!r.ok)
    assert.match(r.erros.join('\n'), /intermediador/)
  })

  test('endereço mascarado da Shopee: uma frase só, explicando o porquê', () => {
    const shopee = destinatario('SP', { fonte: 'shopee', endereco: { logradouro: null, numero: null, complemento: null, bairro: null, cep: null, municipio: null, uf: null } })
    const r = montarNfeDoPedido(dados({ simples: true, dest: shopee }))
    assert.ok(!r.ok)
    assert.equal(r.erros.length, 1)
    assert.match(r.erros[0], /mascarado/)
  })

  test('mesmo bloqueado, o resumo mostra o que já se sabe', () => {
    const r = montarNfeDoPedido(dados({ simples: true, cnpjIntermediador: null }))
    assert.equal(r.resumo.situacao, 'interestadual_consumidor_final')
    assert.equal(r.resumo.linhas[0].cfop, '6108')
  })
})

describe('alíquota interestadual', () => {
  test('RJ → SP 12, RJ → ES 7, RJ → PE 7, importada 4', () => {
    assert.equal(aliquotaInterestadual('RJ', 'SP', 0), 12)
    assert.equal(aliquotaInterestadual('RJ', 'ES', 0), 7)
    assert.equal(aliquotaInterestadual('RJ', 'PE', 5), 7)
    assert.equal(aliquotaInterestadual('RJ', 'SP', 1), 4)
    assert.equal(aliquotaInterestadual('BA', 'RJ', 0), 12)
  })
})

describe('payload da Brasil NFe (modelo 55)', () => {
  test('Bazar Eficaz para SP: intermediador, endereço, internet, alíquotas', () => {
    const r = montarNfeDoPedido(dados({ simples: false }))
    assert.ok(r.ok)
    const p: any = montarPayloadNFe(r.input, 'homologacao')
    assert.equal(p.ModeloDocumento, 55)
    assert.equal(p.TipoAmbiente, 2)
    assert.equal(p.IndicadorPresenca, 2)
    assert.equal(p.ConsumidorFinal, true)
    assert.deepEqual(p.Intermediador, { Cnpj: '03007331000141', IdCadIntTran: 'VENDEDOR123' })
    assert.equal(p.Cliente.IndicadorIe, 9)
    assert.equal(p.Cliente.Endereco.Uf, 'SP')
    assert.equal(p.Cliente.Endereco.Cep, '01001000')
    const prod = p.Produtos[0]
    assert.equal(prod.CFOP, 6108)
    assert.equal(prod.OrigemProduto, 0)
    assert.deepEqual(prod.Imposto.ICMS, { CodSituacaoTributaria: '00', AliquotaICMS: 12 })
    assert.deepEqual(prod.Imposto.PIS, { CodSituacaoTributaria: '01', Aliquota: 0.65 })
    assert.equal(prod.ValorTotal, 51)
    assert.equal(p.Pagamentos[0].FormaPagamento, '99')
    assert.match(p.Pagamentos[0].Descricao, /ML Ouro/)
    assert.equal(p.Transporte.ModalidadeFrete, 0)
  })

  test('Simples: sem alíquota de ICMS nem de PIS/COFINS', () => {
    const r = montarNfeDoPedido(dados({ simples: true }))
    assert.ok(r.ok)
    const prod: any = montarPayloadNFe(r.input, 'producao').Produtos[0]
    assert.deepEqual(prod.Imposto.ICMS, { CodSituacaoTributaria: '102' })
    assert.deepEqual(prod.Imposto.PIS, { CodSituacaoTributaria: '49' })
  })
})
