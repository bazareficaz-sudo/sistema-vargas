import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { proporCorrecao, camposDoCaminho, type ProdutoFiscal } from '../../src/lib/fiscal/correcao'
import type { ResolucaoCest } from '../../src/lib/fiscal/cest'

// O caso real que originou esta tela — venda #301980:
//
//   BROCA PARA CONCRETO PAREDE 8MM TRAMONTINA, NCM 82075011
//   cadastro: CFOP 5405 · CST 60 · CEST 0801300
//   emissão:  empresa do Simples (Lucro Presumido emitindo pelo Simples)
//
// A empresa do Simples ignora o CST, não acha CSOSN, cai no padrão 102 — e o
// par vira "CFOP 5405 com CSOSN 102", que a conferência barra. O produto não
// está errado por descuido: está preenchido para o regime da empresa QUE VENDE,
// e a nota sai pela empresa QUE EMITE, que é de outro regime.

const NCM_BROCA = '82075011'

function produto(p: Partial<ProdutoFiscal> = {}): ProdutoFiscal {
  return {
    id: 'p1', nome: 'BROCA PARA CONCRETO PAREDE 8MM TRAMONTINA', sku: '25364',
    ncm: NCM_BROCA, cest: '0801300', cfop: '5405', csosn: null, icms_cst: '60',
    ...p,
  }
}

const NA_TABELA: ResolucaoCest = { certeza: 'unico', cest: '0801300', descricao: 'outras ferramentas intercambiáveis' }
const FORA_DA_TABELA: ResolucaoCest = { certeza: 'nao_aplica' }
const AMBIGUO: ResolucaoCest = {
  certeza: 'ambiguo',
  candidatos: [
    { cest: '0100200', ncmPrefixo: '3917', descricao: 'tubos e acessórios, de plásticos (autopeças)' },
    { cest: '1000600', ncmPrefixo: '3917', descricao: 'tubos e acessórios, de plásticos, para uso na construção' },
  ],
}

function proposta(over: Partial<Parameters<typeof proporCorrecao>[0]> = {}) {
  return proporCorrecao({
    produto: produto(), simplesNacional: true, cfopPadraoVenda: '5102',
    resolucao: NA_TABELA, ...over,
  })
}

describe('correção fiscal — o caso da venda #301980', () => {
  test('produto do regime normal emitido pelo Simples: troca CST 60 por CSOSN 500', () => {
    const p = proposta()
    assert.equal(p.recomendado, 'com_st')

    const campos = camposDoCaminho(p, 'com_st')!
    assert.equal(campos.csosn, '500')
    // O CST tem que ser LIMPO, não só ignorado: deixar os dois preenchidos é o
    // que torna o cadastro ambíguo entre regimes.
    assert.equal(campos.icms_cst, null)
    // CFOP e CEST já estavam certos — não aparecem como mudança.
    assert.equal('cfop' in campos, false)
    assert.equal('cest' in campos, false)
  })

  test('a evidência cita a fonte, não o palpite', () => {
    assert.match(proposta().evidencia, /Convênio ICMS 142\/2018/)
    assert.match(proposta().evidencia, new RegExp(NCM_BROCA))
  })

  test('a recomendação não vira decisão: o caminho "sem ST" também é oferecido', () => {
    const p = proposta()
    assert.equal(p.caminhos.length, 2)
    const semST = camposDoCaminho(p, 'sem_st')!
    assert.equal(semST.cfop, '5102')
    assert.equal(semST.csosn, '102')
    // Declarar CEST sem ST é declarar ST — o campo é limpo junto.
    assert.equal(semST.cest, null)
  })
})

describe('correção fiscal — regime de quem EMITE', () => {
  test('mesmo produto, empresa em regime normal: CST 60 e CSOSN limpo', () => {
    const p = proposta({ simplesNacional: false, produto: produto({ csosn: '500', icms_cst: null }) })
    const campos = camposDoCaminho(p, 'com_st')!
    assert.equal(campos.icms_cst, '60')
    assert.equal(campos.csosn, null)
  })

  test('sem ST no regime normal é CST 00, não CSOSN 102', () => {
    const p = proposta({ simplesNacional: false, resolucao: FORA_DA_TABELA })
    const campos = camposDoCaminho(p, 'sem_st')!
    assert.equal(campos.icms_cst, '00')
    // `csosn` NÃO aparece: já era nulo, e o motor só devolve o que muda de
    // fato. A tela mostra essa lista ao operador — encher de "de nulo para
    // nulo" faria uma correção de um campo parecer uma de quatro.
    assert.equal('csosn' in campos, false)
  })

  test('quando o CSOSN existe e o regime é normal, ele é LIMPO de verdade', () => {
    const p = proposta({
      simplesNacional: false,
      resolucao: FORA_DA_TABELA,
      produto: produto({ csosn: '102', icms_cst: null }),
    })
    const campos = camposDoCaminho(p, 'sem_st')!
    assert.equal(campos.csosn, null, 'o código do outro regime precisa sair')
    assert.equal(campos.icms_cst, '00')
  })
})

describe('correção fiscal — o que a tabela oficial decide', () => {
  test('NCM fora da tabela: recomenda SEM ST, e diz por quê', () => {
    const p = proposta({ resolucao: FORA_DA_TABELA })
    assert.equal(p.recomendado, 'sem_st')
    assert.match(p.evidencia, /não consta na tabela/)
  })

  test('NCM com dois CESTs: nada é aplicado até alguém escolher', () => {
    const p = proposta({ resolucao: AMBIGUO, produto: produto({ cest: null }) })
    assert.equal(p.candidatosCest.length, 2)
    assert.equal(camposDoCaminho(p, 'com_st'), null, 'com ST ambíguo não pode ser aplicado sozinho')
    // O caminho SEM ST não depende do CEST, então continua disponível.
    assert.notEqual(camposDoCaminho(p, 'sem_st'), null)
  })

  test('escolha do operador vale — mas só se estiver na lista da tabela', () => {
    const valida = proposta({ resolucao: AMBIGUO, produto: produto({ cest: null }), cestEscolhido: '1000600' })
    assert.equal(camposDoCaminho(valida, 'com_st')!.cest, '1000600')

    // Código fora da lista é digitação, não escolha. CEST errado em produto com
    // ST vira recusa na SEFAZ ou recolhimento errado.
    const invalida = proposta({ resolucao: AMBIGUO, produto: produto({ cest: null }), cestEscolhido: '9999999' })
    assert.equal(camposDoCaminho(invalida, 'com_st'), null)
  })

  test('sem NCM não há proposta — e o impedimento diz o caminho', () => {
    const p = proposta({ produto: produto({ ncm: null }), resolucao: FORA_DA_TABELA })
    assert.equal(p.recomendado, null)
    assert.match(p.impedimento!, /NCM/)
  })
})

describe('correção fiscal — o CFOP 5403 nunca é proposto', () => {
  test('produto com 5403 (substituto) vira 5405 (substituído)', () => {
    // 5403 é de quem RETÉM o imposto da cadeia seguinte. Vendendo a consumidor
    // final não há cadeia seguinte, e a NFC-e recusa o código.
    const p = proposta({ produto: produto({ cfop: '5403' }) })
    assert.equal(camposDoCaminho(p, 'com_st')!.cfop, '5405')
    for (const caminho of p.caminhos) {
      assert.equal(caminho.mudancas.some(m => m.campo === 'cfop' && m.para === '5403'), false)
    }
  })
})

describe('correção fiscal — não mexer no que já está certo', () => {
  test('produto coerente não gera nenhuma mudança', () => {
    const jaCerto = produto({ cfop: '5405', csosn: '500', icms_cst: null, cest: '0801300' })
    const campos = camposDoCaminho(proposta({ produto: jaCerto }), 'com_st')!
    assert.deepEqual(campos, {}, 'nada a gravar')
  })

  test('CEST com máscara conta como preenchido? NÃO — o campo é comparado como está', () => {
    // O cadastro aceita "08.013.00" digitado. A comparação aqui é textual, então
    // a proposta troca pelo valor limpo — que é o que a emissão manda. Preso em
    // teste para a troca não parecer ruído quando o operador vir "de 08.013.00
    // para 0801300".
    const comMascara = produto({ cest: '08.013.00', csosn: '500', icms_cst: null })
    const campos = camposDoCaminho(proposta({ produto: comMascara }), 'com_st')!
    assert.equal(campos.cest, '0801300')
  })
})
