import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  REGRAS_PADRAO, SITUACOES, REGIMES, conferirRegra, situacaoDaOperacao, regraDoPerfil, exigeDifal,
  type RegraPerfil,
} from '../../src/lib/fiscal/perfilFiscal'

// O perfil fiscal substitui o CFOP único do produto: a mesma mercadoria sai
// com códigos diferentes conforme quem compra e de onde. Estes testes prendem
// as três decisões que, erradas, mandam nota rejeitada (ou pior, aceita com
// imposto errado) para a SEFAZ: a situação da venda, a regra escolhida e a
// conferência do par CFOP × CST/CSOSN.

describe('regras padrão', () => {
  test('cobrem as 4 situações nos 2 regimes, nos dois perfis', () => {
    for (const regras of Object.values(REGRAS_PADRAO)) {
      assert.equal(regras.length, SITUACOES.length * REGIMES.length)
      for (const s of SITUACOES) for (const r of REGIMES) {
        assert.ok(regras.some(x => x.situacao === s.chave && x.regime === r.chave), `${s.chave}/${r.chave}`)
      }
    }
  })

  test('todas passam pela própria conferência — o perfil não nasce inválido', () => {
    for (const regras of Object.values(REGRAS_PADRAO)) {
      for (const r of regras) assert.equal(conferirRegra(r), null, `${r.regime}/${r.situacao}`)
    }
  })

  test('ST para outro estado nasce vazio: é decisão da contabilidade, não do sistema', () => {
    const vazias = REGRAS_PADRAO.st.filter(r => r.situacao.startsWith('interestadual'))
    assert.equal(vazias.length, 4)
    assert.ok(vazias.every(r => r.cfop === null && r.icms_situacao === null))
  })
})

describe('situação da operação', () => {
  test('pessoa física de outro estado — o caso do marketplace', () => {
    const r = situacaoDaOperacao('RJ', { uf: 'SP' })
    assert.deepEqual(r, { ok: true, situacao: 'interestadual_consumidor_final', interestadual: true, contribuinte: false })
  })

  test('empresa com IE do mesmo estado é contribuinte', () => {
    const r = situacaoDaOperacao('rj', { uf: ' RJ ', inscricaoEstadual: '12.345.678' })
    assert.ok(r.ok && r.situacao === 'interna_contribuinte')
  })

  test('"ISENTO" não é inscrição: continua consumidor final', () => {
    const r = situacaoDaOperacao('RJ', { uf: 'MG', inscricaoEstadual: 'ISENTO' })
    assert.ok(r.ok && r.situacao === 'interestadual_consumidor_final')
  })

  test('sem UF não chuta: diz qual dado falta', () => {
    const semDestino = situacaoDaOperacao('RJ', { uf: null })
    assert.ok(!semDestino.ok && /destinatário/.test(semDestino.erro))
    const semOrigem = situacaoDaOperacao('', { uf: 'SP' })
    assert.ok(!semOrigem.ok && /emitente/.test(semOrigem.erro))
  })
})

describe('regra do perfil na emissão', () => {
  const tributada = { nome: 'Revenda tributada', regras: REGRAS_PADRAO.tributada }
  const st = { nome: 'Revenda com ST', regras: REGRAS_PADRAO.st }

  test('o mesmo produto muda de código conforme a operação e o regime de quem emite', () => {
    assert.deepEqual(regraDoPerfil(tributada, 'simples', 'interna_consumidor_final'), { ok: true, cfop: '5102', icmsSituacao: '102' })
    assert.deepEqual(regraDoPerfil(tributada, 'simples', 'interestadual_consumidor_final'), { ok: true, cfop: '6108', icmsSituacao: '102' })
    assert.deepEqual(regraDoPerfil(tributada, 'normal', 'interestadual_contribuinte'), { ok: true, cfop: '6102', icmsSituacao: '00' })
    assert.deepEqual(regraDoPerfil(st, 'normal', 'interna_consumidor_final'), { ok: true, cfop: '5405', icmsSituacao: '60' })
  })

  test('regra vazia bloqueia com o nome do perfil e onde resolver', () => {
    const r = regraDoPerfil(st, 'simples', 'interestadual_consumidor_final')
    assert.ok(!r.ok)
    assert.match(r.erro, /Revenda com ST/)
    assert.match(r.erro, /Perfis fiscais/)
  })

  test('regra gravada errada por fora da tela também não passa', () => {
    const regras: RegraPerfil[] = [{ regime: 'simples', situacao: 'interna_consumidor_final', cfop: '5405', icms_situacao: '102' }]
    const r = regraDoPerfil({ nome: 'X', regras }, 'simples', 'interna_consumidor_final')
    assert.ok(!r.ok && /substituição tributária/.test(r.erro))
  })
})

describe('conferência de uma regra', () => {
  const base = { regime: 'simples' as const, situacao: 'interestadual_consumidor_final' as const }

  test('família do CFOP tem que bater com dentro/fora do estado', () => {
    assert.match(conferirRegra({ ...base, cfop: '5102', icms_situacao: '102' })!, /família 6/)
    assert.match(conferirRegra({ ...base, situacao: 'interna_consumidor_final', cfop: '6102', icms_situacao: '102' })!, /família 5/)
  })

  test('código do regime errado é recusado — a SEFAZ recusaria igual', () => {
    assert.match(conferirRegra({ ...base, cfop: '6108', icms_situacao: '00' })!, /não é um CSOSN/)
    assert.match(conferirRegra({ ...base, regime: 'normal', cfop: '6108', icms_situacao: '102' })!, /não é um CST/)
  })

  test('6108 aceita com e sem ST: a escolha fica com a contabilidade', () => {
    assert.equal(conferirRegra({ ...base, cfop: '6108', icms_situacao: '102' }), null)
    assert.equal(conferirRegra({ ...base, cfop: '6108', icms_situacao: '500' }), null)
  })

  test('meia regra não é regra', () => {
    assert.match(conferirRegra({ ...base, cfop: '6108', icms_situacao: '' })!, /Falta o CSOSN/)
    assert.match(conferirRegra({ ...base, cfop: null, icms_situacao: '102' })!, /Falta o CFOP/)
  })
})

describe('DIFAL', () => {
  test('só regime normal vendendo a consumidor final de outro estado', () => {
    assert.equal(exigeDifal('normal', 'interestadual_consumidor_final'), true)
    assert.equal(exigeDifal('simples', 'interestadual_consumidor_final'), false)
    assert.equal(exigeDifal('normal', 'interestadual_contribuinte'), false)
    assert.equal(exigeDifal('normal', 'interna_consumidor_final'), false)
  })
})
