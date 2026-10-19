import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  vigenciaDe, degrauVigente, taxaDe, prazoDe, previsaoDeCredito, pendenciasDaForma,
  type TaxaDegrau, type FormaComTaxas,
} from '../../src/lib/financeiro/taxas'

// A ESCADA DE TAXAS, COM OS NÚMEROS REAIS DA LOJA.
//
// Lidos de `saude_config` em 18/10/2026: pix 0,49 · débito 1,11 · crédito à
// vista 3,04 · incremento por parcela 2,48. A linha foi atualizada em
// 02/08/2026, e é essa a data da primeira vigência.
//
// O crédito abaixo reproduz a escada que o sistema já praticava pela fórmula
// `vista + (n-1) * incremento`: 3,04 · 5,52 · 8,00 · 10,48 · 12,96 · 15,44.

const CREDITO_AGOSTO: TaxaDegrau[] = [
  { parcelas_min: 1, taxa_pct: 3.04,  prazo_dias: null, vigente_de: '2026-08-02' },
  { parcelas_min: 2, taxa_pct: 5.52,  prazo_dias: null, vigente_de: '2026-08-02' },
  { parcelas_min: 3, taxa_pct: 8.00,  prazo_dias: null, vigente_de: '2026-08-02' },
  { parcelas_min: 4, taxa_pct: 10.48, prazo_dias: null, vigente_de: '2026-08-02' },
  { parcelas_min: 5, taxa_pct: 12.96, prazo_dias: null, vigente_de: '2026-08-02' },
  { parcelas_min: 6, taxa_pct: 15.44, prazo_dias: null, vigente_de: '2026-08-02' },
]

const PIX: TaxaDegrau[] = [
  { parcelas_min: 1, taxa_pct: 0.49, prazo_dias: 0, vigente_de: '2026-08-02' },
]

describe('o degrau da parcela', () => {
  test('1x pega o primeiro degrau', () => {
    assert.equal(taxaDe(CREDITO_AGOSTO, 1, '2026-10-18'), 3.04)
  })

  test('3x pega o terceiro, não a soma de nada', () => {
    // É a diferença entre a escada e a fórmula antiga: aqui o valor é lido,
    // não calculado. Quando o contrato do Mercado Pago disser que 3x é 7,80,
    // muda a linha e pronto.
    assert.equal(taxaDe(CREDITO_AGOSTO, 3, '2026-10-18'), 8.00)
  })

  test('parcela acima do último degrau vale o último', () => {
    // Escada se define pelo degrau de baixo. 10x numa escada que vai até 6
    // cobra 15,44 — e não zero, que é o que um intervalo fechado daria.
    assert.equal(taxaDe(CREDITO_AGOSTO, 10, '2026-10-18'), 15.44)
  })

  test('zero e negativo contam como 1x', () => {
    // Venda à vista chega com `parcelas` 0, 1 ou vazio dependendo da tela.
    assert.equal(taxaDe(CREDITO_AGOSTO, 0, '2026-10-18'), 3.04)
    assert.equal(taxaDe(CREDITO_AGOSTO, -3, '2026-10-18'), 3.04)
  })

  test('fração arredonda para baixo', () => {
    assert.equal(taxaDe(CREDITO_AGOSTO, 3.9, '2026-10-18'), 8.00)
  })

  test('sem degrau de 1x devolve nulo, não zero', () => {
    // Taxa zero infla a margem e passa batido. Nulo obriga quem chamou a
    // tratar — e a tela de cadastro é que exige o degrau de 1x.
    const semPrimeiro: TaxaDegrau[] = [
      { parcelas_min: 3, taxa_pct: 8, prazo_dias: null, vigente_de: '2026-08-02' },
    ]
    assert.equal(taxaDe(semPrimeiro, 1, '2026-10-18'), null)
    assert.equal(taxaDe(semPrimeiro, 3, '2026-10-18'), 8)
  })

  test('escada vazia devolve nulo', () => {
    assert.equal(taxaDe([], 1, '2026-10-18'), null)
    assert.equal(vigenciaDe([], '2026-10-18'), null)
  })
})

describe('a vigência', () => {
  // O contrato renegociado: a partir de 01/11 o crédito à vista cai para 2,80
  // e o parcelado passa a ter tabela própria.
  const COM_NOVEMBRO: TaxaDegrau[] = [
    ...CREDITO_AGOSTO,
    { parcelas_min: 1, taxa_pct: 2.80, prazo_dias: 30, vigente_de: '2026-11-01' },
    { parcelas_min: 2, taxa_pct: 5.10, prazo_dias: 30, vigente_de: '2026-11-01' },
    { parcelas_min: 3, taxa_pct: 7.40, prazo_dias: 30, vigente_de: '2026-11-01' },
  ]

  test('em outubro vale agosto', () => {
    assert.equal(taxaDe(COM_NOVEMBRO, 1, '2026-10-31'), 3.04)
  })

  test('no dia que começa, já vale a nova', () => {
    // `vigente_de` é inclusivo. Venda do dia 1º de novembro é cobrada pela
    // taxa de novembro.
    assert.equal(taxaDe(COM_NOVEMBRO, 1, '2026-11-01'), 2.80)
  })

  test('em dezembro continua valendo novembro', () => {
    assert.equal(taxaDe(COM_NOVEMBRO, 1, '2026-12-25'), 2.80)
  })

  test('a venda antiga continua medida pela taxa antiga', () => {
    // É a razão de a vigência existir. Sem ela, a renegociação de novembro
    // mudaria a taxa de uma venda de agosto, e a conciliação acusaria
    // diferença que não existe.
    assert.equal(taxaDe(COM_NOVEMBRO, 3, '2026-09-15'), 8.00)
    assert.equal(taxaDe(COM_NOVEMBRO, 3, '2026-11-15'), 7.40)
  })

  test('não mistura degrau de vigências diferentes', () => {
    // Novembro cadastrou até 3x. Pedir 6x em novembro vale o degrau 3 de
    // NOVEMBRO (7,40), nunca o degrau 6 de agosto (15,44) — senão a taxa de
    // um contrato vazaria para dentro do outro.
    assert.equal(taxaDe(COM_NOVEMBRO, 6, '2026-11-20'), 7.40)
  })

  test('data anterior a tudo vale a vigência mais antiga', () => {
    assert.equal(vigenciaDe(COM_NOVEMBRO, '2026-01-01'), '2026-08-02')
    assert.equal(taxaDe(COM_NOVEMBRO, 1, '2026-01-01'), 3.04)
  })
})

describe('o prazo, e por que nulo não é zero', () => {
  test('pix cai no mesmo dia, e isso é informação', () => {
    assert.equal(prazoDe(PIX, 1, '2026-10-18'), 0)
    assert.equal(previsaoDeCredito(PIX, '2026-10-18', 1), '2026-10-18')
  })

  test('crédito sem prazo informado não gera previsão', () => {
    // O contrato ainda não foi informado. Responder "cai hoje" faria a
    // conciliação cobrar hoje o que só cai em trinta dias.
    assert.equal(prazoDe(CREDITO_AGOSTO, 1, '2026-10-18'), null)
    assert.equal(previsaoDeCredito(CREDITO_AGOSTO, '2026-10-18', 1), null)
  })

  test('com prazo informado, a previsão soma os dias e atravessa o mês', () => {
    const comPrazo: TaxaDegrau[] = [
      { parcelas_min: 1, taxa_pct: 3.04, prazo_dias: 30, vigente_de: '2026-08-02' },
    ]
    assert.equal(previsaoDeCredito(comPrazo, '2026-10-18', 1), '2026-11-17')
  })

  test('e atravessa a virada do ano', () => {
    const comPrazo: TaxaDegrau[] = [
      { parcelas_min: 1, taxa_pct: 3.04, prazo_dias: 30, vigente_de: '2026-08-02' },
    ]
    assert.equal(previsaoDeCredito(comPrazo, '2026-12-20', 1), '2027-01-19')
  })
})

describe('o que falta para a forma lançar no caixa', () => {
  const base: FormaComTaxas = {
    id: 'f1', codigo: 'credito', nome: 'Crédito', icone: '💳', tecla: '3', ordem: 3,
    ativo: true, liquidacao: 'adquirente', caixa_destino_id: null,
    adquirente_caixa_id: 'caixa-mp', aceita_parcelamento: true, parcelas_max: 6,
    taxas: CREDITO_AGOSTO,
  }

  test('crédito de hoje: falta o prazo de cada parcela', () => {
    // Estado real em 18/10/2026: taxa cadastrada, prazo nenhum.
    const faltas = pendenciasDaForma(base, '2026-10-18')
    assert.equal(faltas.length, 6)
    assert.ok(faltas.every(f => f.includes('prazo')))
    assert.ok(faltas.includes('sem prazo de recebimento em 3x'))
  })

  test('com prazo em tudo, nada falta', () => {
    const completo: FormaComTaxas = {
      ...base,
      taxas: CREDITO_AGOSTO.map(d => ({ ...d, prazo_dias: 30 })),
    }
    assert.deepEqual(pendenciasDaForma(completo, '2026-10-18'), [])
  })

  test('adquirente sem dizer qual maquininha é pendência', () => {
    const solto: FormaComTaxas = { ...base, adquirente_caixa_id: null }
    assert.ok(pendenciasDaForma(solto, '2026-10-18').includes('não diz em qual adquirente passa'))
  })

  test('pix não precisa de adquirente nem reclama de prazo', () => {
    const pix: FormaComTaxas = {
      id: 'f2', codigo: 'pix', nome: 'PIX', icone: '📱', tecla: '4', ordem: 4,
      ativo: true, liquidacao: 'imediata', caixa_destino_id: 'caixa-mp-ouro',
      adquirente_caixa_id: null, aceita_parcelamento: false, parcelas_max: 1,
      taxas: PIX,
    }
    assert.deepEqual(pendenciasDaForma(pix, '2026-10-18'), [])
  })

  test('fiado sem taxa nenhuma: só a taxa de 1x é cobrada', () => {
    // Fiado não passa em adquirente e não tem prazo de maquininha — o título
    // vive em `contas_receber`. Mas precisa de uma linha de taxa, ainda que
    // zero, senão o cálculo de margem fica sem resposta.
    const fiado: FormaComTaxas = {
      id: 'f3', codigo: 'fiado', nome: 'Fiado', icone: '📒', tecla: '6', ordem: 6,
      ativo: true, liquidacao: 'fiado', caixa_destino_id: null,
      adquirente_caixa_id: null, aceita_parcelamento: false, parcelas_max: 1,
      taxas: [],
    }
    assert.deepEqual(pendenciasDaForma(fiado, '2026-10-18'), ['sem taxa cadastrada para 1x'])
  })
})

describe('o acordo com a função do banco', () => {
  // `taxa_vigente_v1` no Postgres e `degrauVigente` aqui têm de responder
  // igual, porque uma projeta as colunas que o PDV lê e a outra desenha a
  // margem na tela. Estes casos são os que a migração cita por escrito; a
  // conferência contra o banco de verdade vai no teste de integração, depois
  // de a migração ser aplicada.
  test('a ordem é vigência primeiro, degrau depois', () => {
    const d: TaxaDegrau[] = [
      { parcelas_min: 1, taxa_pct: 1, prazo_dias: null, vigente_de: '2026-01-01' },
      { parcelas_min: 6, taxa_pct: 9, prazo_dias: null, vigente_de: '2026-01-01' },
      { parcelas_min: 1, taxa_pct: 2, prazo_dias: null, vigente_de: '2026-06-01' },
    ]
    // Em julho vale a vigência de junho, que só tem o degrau 1 — o degrau 6
    // de janeiro não é alcançável, e é isso que se quer.
    assert.equal(taxaDe(d, 6, '2026-07-01'), 2)
    // Em maio vale janeiro, e aí o degrau 6 existe.
    assert.equal(taxaDe(d, 6, '2026-05-01'), 9)
  })

  test('o degrau devolvido traz o prazo junto, da mesma linha', () => {
    // Taxa e prazo vêm sempre do MESMO degrau. Buscar um de cada lugar
    // permitiria taxa de novembro com prazo de agosto.
    const d: TaxaDegrau[] = [
      { parcelas_min: 1, taxa_pct: 3.04, prazo_dias: 1,  vigente_de: '2026-08-02' },
      { parcelas_min: 2, taxa_pct: 5.52, prazo_dias: 30, vigente_de: '2026-08-02' },
    ]
    const degrau = degrauVigente(d, 2, '2026-10-18')!
    assert.equal(degrau.taxa_pct, 5.52)
    assert.equal(degrau.prazo_dias, 30)
  })
})
