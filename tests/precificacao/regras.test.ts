import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resolverRegra, aplicarRegra, descreverObjetivo, type Regra } from '../../src/lib/precificacao/regras'
import type { ConfigTaxas } from '../../src/lib/precificacao/tipos'

// Testes de CARACTERIZAÇÃO da hierarquia de regras.
//
// A hierarquia é o que responde "por que este anúncio está com esse preço?".
// Qualquer evolução futura (margem alvo, margem promocional, margem piso) vai
// pendurar-se nela, então o comportamento atual precisa estar preso por teste
// antes de qualquer mexida.

const CFG: ConfigTaxas = {
  canalId: null, plataforma: 'teste', nome: 'Canal de teste',
  comissaoModo: 'simples', comissaoPercentual: 10, comissaoFixo: 0, comissaoFaixas: [],
  taxas: [], freteModo: 'nao', freteValor: 0, freteLimiteGratis: 0, freteCustoMedio: 0, freteFaixas: [],
  embalagem: null, imposto: null, custosExtras: [], diasRecebimento: null,
}

const PRODUTO = { id: 'prod-1', categoria: 'Ferramentas', marca: 'Tramontina' }
const CANAL = { id: 'canal-1', plataforma: 'mercadolivre' }

function regra(p: Partial<Regra>): Regra {
  return {
    id: p.id ?? 'r', nome: p.nome ?? 'Regra', nivel: p.nivel ?? 'empresa',
    alvoId: p.alvoId ?? null, alvoTexto: p.alvoTexto ?? null, canalId: p.canalId ?? null,
    objetivoTipo: p.objetivoTipo ?? 'margem_liquida', objetivoValor: p.objetivoValor ?? 20,
    margemMinima: p.margemMinima ?? null, margemPromocionalMinima: p.margemPromocionalMinima ?? null, arredondamento: p.arredondamento ?? 'nenhum',
    prioridade: p.prioridade ?? 0,
  }
}

describe('regras — quem vence', () => {
  test('a regra mais específica ganha, nível a nível', () => {
    const todas = [
      regra({ id: 'empresa', nivel: 'empresa' }),
      regra({ id: 'plataforma', nivel: 'plataforma', alvoTexto: 'mercadolivre' }),
      regra({ id: 'canal', nivel: 'canal', alvoId: 'canal-1' }),
      regra({ id: 'marca', nivel: 'marca', alvoTexto: 'Tramontina' }),
      regra({ id: 'categoria', nivel: 'categoria', alvoTexto: 'Ferramentas' }),
      regra({ id: 'produto', nivel: 'produto', alvoId: 'prod-1' }),
    ]
    const ordem = ['produto', 'categoria', 'marca', 'canal', 'plataforma', 'empresa']
    for (let i = 0; i < ordem.length; i++) {
      const restantes = todas.filter(r => !ordem.slice(0, i).includes(r.id))
      const res = resolverRegra(restantes, PRODUTO, CANAL)
      assert.equal(res.vencedora?.id, ordem[i], `com ${restantes.length} regras deveria vencer "${ordem[i]}"`)
    }
  })

  test('o bônus de canal desempata DENTRO do nível, não entre níveis', () => {
    // Marca com canal (50+5=55) continua perdendo para categoria (60). Se um
    // dia isso inverter, a intenção da hierarquia foi quebrada.
    const res = resolverRegra([
      regra({ id: 'marca-canal', nivel: 'marca', alvoTexto: 'Tramontina', canalId: 'canal-1' }),
      regra({ id: 'categoria', nivel: 'categoria', alvoTexto: 'Ferramentas' }),
    ], PRODUTO, CANAL)
    assert.equal(res.vencedora?.id, 'categoria')
  })

  test('entre duas do mesmo nível, a que restringe canal vence', () => {
    const res = resolverRegra([
      regra({ id: 'geral', nivel: 'categoria', alvoTexto: 'Ferramentas' }),
      regra({ id: 'do-canal', nivel: 'categoria', alvoTexto: 'Ferramentas', canalId: 'canal-1' }),
    ], PRODUTO, CANAL)
    assert.equal(res.vencedora?.id, 'do-canal')
  })

  test('prioridade desempata regras idênticas', () => {
    const res = resolverRegra([
      regra({ id: 'baixa', nivel: 'categoria', alvoTexto: 'Ferramentas', prioridade: 0 }),
      regra({ id: 'alta', nivel: 'categoria', alvoTexto: 'Ferramentas', prioridade: 3 }),
    ], PRODUTO, CANAL)
    assert.equal(res.vencedora?.id, 'alta')
  })

  test('regra de outro canal é eliminada em qualquer nível', () => {
    const res = resolverRegra([
      regra({ id: 'produto-outro-canal', nivel: 'produto', alvoId: 'prod-1', canalId: 'canal-2' }),
      regra({ id: 'empresa', nivel: 'empresa' }),
    ], PRODUTO, CANAL)
    assert.equal(res.vencedora?.id, 'empresa')
    assert.ok(res.descartadas.some(d => d.regra.id === 'produto-outro-canal' && d.motivo.includes('outro canal')))
  })

  test('sem regra nenhuma o resultado é nulo, não um padrão silencioso', () => {
    const res = resolverRegra([], PRODUTO, CANAL)
    assert.equal(res.vencedora, null)
    assert.equal(res.candidatas.length, 0)
  })

  test('categoria e marca casam sem diferenciar maiúsculas nem espaços', () => {
    const res = resolverRegra(
      [regra({ id: 'cat', nivel: 'categoria', alvoTexto: '  FERRAMENTAS ' })],
      PRODUTO, CANAL,
    )
    assert.equal(res.vencedora?.id, 'cat')
  })
})

describe('regras — rastreabilidade', () => {
  test('candidatas vêm ordenadas da mais forte para a mais fraca, com motivo', () => {
    const res = resolverRegra([
      regra({ id: 'empresa', nivel: 'empresa' }),
      regra({ id: 'categoria', nivel: 'categoria', alvoTexto: 'Ferramentas' }),
      regra({ id: 'produto', nivel: 'produto', alvoId: 'prod-1' }),
    ], PRODUTO, CANAL)
    assert.deepEqual(res.candidatas.map(c => c.regra.id), ['produto', 'categoria', 'empresa'])
    for (const c of res.candidatas) assert.ok(c.motivo.length > 0, 'toda candidata precisa dizer por que casou')
  })

  test('descartadas explicam por que não serviram', () => {
    const res = resolverRegra([
      regra({ id: 'outra-marca', nivel: 'marca', alvoTexto: 'Vonder' }),
      regra({ id: 'outro-produto', nivel: 'produto', alvoId: 'prod-9' }),
      regra({ id: 'empresa', nivel: 'empresa' }),
    ], PRODUTO, CANAL)
    assert.equal(res.descartadas.length, 2)
    assert.ok(res.descartadas.every(d => d.motivo.length > 0))
    assert.ok(res.descartadas.find(d => d.regra.id === 'outra-marca')!.motivo.includes('Vonder'))
  })
})

describe('regras — margem mínima é piso, não alvo', () => {
  test('não interfere quando o objetivo já entrega margem suficiente', () => {
    const r = aplicarRegra({
      cfg: CFG, custoProduto: 30,
      regra: regra({ objetivoTipo: 'margem_liquida', objetivoValor: 25, margemMinima: 10 }),
    })
    assert.equal(r.margemMinimaAplicada, false)
    assert.ok(Math.abs(r.margemLiquida - 25) < 0.05)
  })

  test('sobe o preço quando o objetivo ficaria abaixo do piso — e AVISA', () => {
    // Markup 1,2 sobre custo 30 dá R$ 36 e margem de ~6,7%; o piso de 15%
    // empurra o preço para cima.
    const semPiso = aplicarRegra({
      cfg: CFG, custoProduto: 30,
      regra: regra({ objetivoTipo: 'markup', objetivoValor: 1.2 }),
    })
    const comPiso = aplicarRegra({
      cfg: CFG, custoProduto: 30,
      regra: regra({ objetivoTipo: 'markup', objetivoValor: 1.2, margemMinima: 15 }),
    })
    assert.equal(semPiso.margemMinimaAplicada, false)
    assert.equal(comPiso.margemMinimaAplicada, true)
    assert.ok(comPiso.preco > semPiso.preco, 'o piso só pode subir o preço')
    assert.ok(Math.abs(comPiso.margemLiquida - 15) < 0.05)
    assert.ok(
      comPiso.avisos.some(a => a.includes('abaixo do mínimo')),
      'a intervenção do piso precisa aparecer nos avisos, nunca em silêncio',
    )
  })

  test('o arredondamento da regra chega ao preço', () => {
    const r = aplicarRegra({
      cfg: CFG, custoProduto: 30,
      regra: regra({ objetivoTipo: 'margem_liquida', objetivoValor: 20, arredondamento: 'terminar_90' }),
    })
    assert.ok(String(r.preco).endsWith('.9'), `esperava preço terminando em ,90 — veio ${r.preco}`)
  })
})

describe('regras — descrição legível', () => {
  test('cada objetivo diz sobre qual base incide', () => {
    assert.match(descreverObjetivo('margem_liquida', 20), /sobre o preço/)
    assert.match(descreverObjetivo('sobre_custo', 20), /sobre o custo/)
    assert.match(descreverObjetivo('markup', 2.3), /markup/)
    assert.match(descreverObjetivo('lucro_fixo', 25), /R\$/)
  })
})
