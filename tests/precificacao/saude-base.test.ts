import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { calcular, saudeDoResultado, medidaDeSaude } from '../../src/lib/precificacao/motor'
import type { ConfigTaxas } from '../../src/lib/precificacao/tipos'

// Faixas de saúde medidas em LUCRO SOBRE O CUSTO (lucro ÷ custo) em vez de
// margem (lucro ÷ preço). O lucro é o mesmo; muda só o divisor — e por isso o
// mesmo item pode ser "baixa" numa base e "saudável" na outra.

const cfg: ConfigTaxas = {
  plataforma: 'outro', nome: 'Teste', canalId: null,
  comissaoModo: 'simples', comissaoPercentual: 0, comissaoFixo: 0, comissaoFaixas: [],
  taxas: [], freteModo: 'nenhum', freteValor: 0, freteLimiteGratis: 0, freteCustoMedio: 0,
  freteFaixas: [], embalagem: null, imposto: null, custosExtras: [], diasRecebimento: null,
} as unknown as ConfigTaxas

describe('saúde por base', () => {
  // custo 10, preço 12 → lucro 2 → margem 16,7% / lucro s/ custo 20%
  const r = calcular({ cfg, custoProduto: 10, objetivo: { tipo: 'preco', valor: 12 } })
  const faixas = { critica: 5, baixa: 10, saudavel: 20 }

  test('base preço (padrão) mede a margem', () => {
    assert.equal(medidaDeSaude(r, faixas).base, 'preco')
    assert.equal(Math.round(medidaDeSaude(r, faixas).valor), 17)
    assert.equal(saudeDoResultado(r, faixas), 'saudavel')
  })

  test('base custo mede lucro ÷ custo', () => {
    const f = { ...faixas, base: 'custo' as const }
    assert.equal(medidaDeSaude(r, f).base, 'custo')
    assert.equal(Math.round(medidaDeSaude(r, f).valor), 20)
    // 20% não é "abaixo de 20" → passa para excelente
    assert.equal(saudeDoResultado(r, f), 'excelente')
  })

  test('prejuízo é prejuízo nas duas bases', () => {
    const p = calcular({ cfg, custoProduto: 10, objetivo: { tipo: 'preco', valor: 8 } })
    assert.equal(saudeDoResultado(p, faixas), 'prejuizo')
    assert.equal(saudeDoResultado(p, { ...faixas, base: 'custo' }), 'prejuizo')
  })
})
