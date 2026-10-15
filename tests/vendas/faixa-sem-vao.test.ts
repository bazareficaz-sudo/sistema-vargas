import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { calcSaude, CONFIG_PADRAO, type FaixaSaude, type SaudeConfig } from '../../src/lib/saude-venda'

// OS VAOS ENTRE AS FAIXAS DE SAUDE.
//
// As faixas do Bazar Eficaz em producao:
//
//     Excelente  min 70            Boa       min 50, max 69
//     Atencao    min 30, max 49    Critica   min  5, max 29
//     Prejuizo             max 4.99  (bloqueia_venda)
//
// Entre 69 e 70 nao existe faixa. A regra antiga procurava a JANELA que
// contem a margem (`>= min && < max`), entao 69,5% nao casava com nenhuma e
// caia no fallback — a ultima faixa, Prejuizo, que BLOQUEIA a venda.
//
// A melhor venda do dia aparecia como prejuizo. Os quatro vaos: 4,99-5,
// 29-30, 49-50 e 69-70.
//
// A regra passou a ser escada: a primeira faixa, da maior para a menor, cujo
// piso a margem alcanca.

const FAIXAS_REAIS: FaixaSaude[] = [
  { id: '1', nome: 'Excelente', emoji: '🟢', cor: '#16a34a', cor_fundo: '#f0fdf4', margem_min: 70, margem_max: null, desconto_max_pct: 10, exige_autorizacao: false, bloqueia_venda: false, mensagem_vendedor: null, mensagem_gerente: null, formas_permitidas: null, formas_bloqueadas: null, permite_parcelamento: true, max_parcelas: 6, ordem: 1 },
  { id: '2', nome: 'Boa', emoji: '🟡', cor: '#ca8a04', cor_fundo: '#fefce8', margem_min: 50, margem_max: 69, desconto_max_pct: 5, exige_autorizacao: false, bloqueia_venda: false, mensagem_vendedor: null, mensagem_gerente: null, formas_permitidas: null, formas_bloqueadas: null, permite_parcelamento: true, max_parcelas: 3, ordem: 2 },
  { id: '3', nome: 'Atenção', emoji: '🟠', cor: '#ea580c', cor_fundo: '#fff7ed', margem_min: 30, margem_max: 49, desconto_max_pct: 2, exige_autorizacao: false, bloqueia_venda: false, mensagem_vendedor: null, mensagem_gerente: null, formas_permitidas: null, formas_bloqueadas: null, permite_parcelamento: false, max_parcelas: 1, ordem: 3 },
  { id: '4', nome: 'Crítica', emoji: '🔴', cor: '#dc2626', cor_fundo: '#fef2f2', margem_min: 5, margem_max: 29, desconto_max_pct: 0, exige_autorizacao: true, bloqueia_venda: false, mensagem_vendedor: null, mensagem_gerente: null, formas_permitidas: null, formas_bloqueadas: null, permite_parcelamento: false, max_parcelas: 1, ordem: 4 },
  { id: '5', nome: 'Prejuízo', emoji: '⚫', cor: '#1c1917', cor_fundo: '#f5f5f4', margem_min: null, margem_max: 4.99, desconto_max_pct: 0, exige_autorizacao: true, bloqueia_venda: true, mensagem_vendedor: null, mensagem_gerente: null, formas_permitidas: null, formas_bloqueadas: null, permite_parcelamento: false, max_parcelas: 1, ordem: 5 },
]

// Sem taxa, sem imposto: a margem sai limpa do preco e do custo, e cada
// teste pede a margem que quer sem contas intermediarias atrapalhando.
const CFG: SaudeConfig = {
  ...CONFIG_PADRAO,
  taxa_pix_pct: 0, taxa_dinheiro_pct: 0, taxa_debito_pct: 0,
  taxa_credito_vista_pct: 0, taxa_credito_parc_pct: 0,
  imposto_pct: 0, custo_operacional_pct: 0, comissao_vendedor_pct: 0,
  custo_embalagem: 0, frete_subsidiado_pct: 0,
}

/** Monta uma venda de R$ 100 cuja margem liquida é exatamente `pct`. */
function vendaComMargem(pct: number) {
  return calcSaude(
    [{ custo: 100 - pct, preco_unitario: 100, quantidade: 1, tipo: 'venda' }],
    0, 'dinheiro', 1, CFG, FAIXAS_REAIS)
}

describe('nenhuma margem boa cai no Prejuizo', () => {
  for (const m of [69.5, 69, 60, 49.5, 49, 35, 29.5]) {
    test(`margem de ${m}% nao é Prejuizo`, () => {
      const r = vendaComMargem(m)
      assert.ok(Math.abs(r.margem - m) < 0.01, `margem calculada ${r.margem}`)
      assert.notEqual(r.faixa?.nome, 'Prejuízo')
      assert.notEqual(r.faixa?.bloqueia_venda, true)
    })
  }
})

describe('cada margem cai no degrau certo', () => {
  const casos: [number, string][] = [
    [95, 'Excelente'], [70, 'Excelente'],
    [69.5, 'Boa'], [69, 'Boa'], [50, 'Boa'],
    [49.5, 'Atenção'], [30, 'Atenção'],
    [29.5, 'Crítica'], [5, 'Crítica'],
    [4, 'Prejuízo'], [0, 'Prejuízo'],
  ]
  for (const [m, esperado] of casos) {
    test(`${m}% → ${esperado}`, () => {
      assert.equal(vendaComMargem(m).faixa?.nome, esperado)
    })
  }
})

describe('o que o conserto NAO mudou', () => {
  test('margem negativa continua bloqueando', () => {
    const r = calcSaude(
      [{ custo: 150, preco_unitario: 100, quantidade: 1, tipo: 'venda' }],
      0, 'dinheiro', 1, CFG, FAIXAS_REAIS)
    assert.ok(r.margem < 0)
    assert.equal(r.faixa?.nome, 'Prejuízo')
    assert.equal(r.faixa?.bloqueia_venda, true)
  })

  test('a faixa continua trazendo o limite de desconto', () => {
    assert.equal(vendaComMargem(75).descontoMaxPct, 10)
    assert.equal(vendaComMargem(60).descontoMaxPct, 5)
    assert.equal(vendaComMargem(35).descontoMaxPct, 2)
  })

  test('faixas sem vao continuam funcionando igual', () => {
    // O conserto nao depende de haver vao: com faixas coladas, o resultado é
    // o mesmo de antes.
    const coladas = FAIXAS_REAIS.map(f => ({ ...f, margem_max: f.margem_max == null ? null : f.margem_max + 1 }))
    const r = calcSaude(
      [{ custo: 40, preco_unitario: 100, quantidade: 1, tipo: 'venda' }],
      0, 'dinheiro', 1, CFG, coladas)
    assert.equal(r.faixa?.nome, 'Boa')
  })
})
