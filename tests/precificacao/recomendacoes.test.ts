import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { recomendar, ORDEM_PRIORIDADE, type Recomendacao } from '../../src/lib/precificacao/recomendacoes'
import { montarEstrategia } from '../../src/lib/precificacao/estrategia'
import { resolverPrecoEfetivo } from '../../src/lib/precificacao/precos'
import { sinalDeEstoque, sinalDeVendas } from '../../src/lib/precificacao/sinais'
import { capacidadesDoCanal } from '../../src/lib/precificacao/capacidades'
import type { EconomiaResolvida } from '../../src/lib/precificacao/cenarios'
import type { Regra } from '../../src/lib/precificacao/regras'

// RECOMENDAÇÕES DETERMINÍSTICAS.
//
// O que estes testes protegem, acima de tudo: o guardrail vence sempre.
// Nenhuma combinação de estoque parado, margem boa ou campanha terminando
// pode produzir "desça o preço" num item que já está abaixo do piso.

const AGORA = new Date('2026-09-15T12:00:00Z')

const ECONOMIA: EconomiaResolvida = {
  cfg: {
    canalId: null, plataforma: 'teste', nome: 'Canal de teste',
    comissaoModo: 'faixas', comissaoPercentual: 0, comissaoFixo: 0,
    comissaoFaixas: [
      { min: 0, max: 79.99, percentual: 20, fixo: 4 },
      { min: 80, max: null, percentual: 14, fixo: 16 },
    ],
    taxas: [], freteModo: 'gratis_acima', freteValor: 0, freteLimiteGratis: 79,
    freteCustoMedio: 22, freteFaixas: [],
    embalagem: null, imposto: null, custosExtras: [], diasRecebimento: 14,
    faixasSaude: { critica: 5, baixa: 10, saudavel: 20 },
  },
  custo: 30, pesoKg: 1, freteFaixas: null,
}

const regra = (p: Partial<Regra> = {}): Regra => ({
  id: 'r', nome: 'Regra', nivel: 'categoria', alvoId: null, alvoTexto: 'X', canalId: null,
  objetivoTipo: 'margem_liquida', objetivoValor: p.objetivoValor ?? 25,
  // `??` trataria null como ausente, e null é justamente o caso a testar:
  // 'sem piso' e 'sem política promocional' são valores, não omissões.
  margemMinima: p.margemMinima !== undefined ? p.margemMinima : 12,
  margemPromocionalMinima: p.margemPromocionalMinima !== undefined ? p.margemPromocionalMinima : 18,
  arredondamento: 'nenhum', prioridade: 0,
})

function montar(preco: number, r: Regra | null = regra()) {
  return montarEstrategia({
    economia: ECONOMIA,
    precos: resolverPrecoEfetivo({ anuncio: { id: 'a-1', preco_venda: preco }, agora: AGORA }),
    regra: r, agora: AGORA,
  })
}

const VENDAS_NORMAIS = { unidades: 30, dias: 30, pedidos: 12, maiorPedido: 4 }

function recs(opcoes: {
  preco: number
  estoque?: number | null
  vendas?: { unidades: number | null; dias: number; pedidos?: number | null; maiorPedido?: number | null }
  regra?: Regra | null
  atacado?: { cabe: boolean; motivo: string; economiaPorUnidade: number } | null
  sincronizadaEm?: string | null
}): Recomendacao[] {
  const estoque = sinalDeEstoque(opcoes.estoque === undefined ? 90 : opcoes.estoque)
  const vendas = sinalDeVendas(estoque, opcoes.vendas ?? VENDAS_NORMAIS)
  return recomendar({
    estrategia: montar(opcoes.preco, opcoes.regra === undefined ? regra() : opcoes.regra),
    estoque, vendas,
    atacado: opcoes.atacado ?? null,
    capacidadeAtacado: capacidadesDoCanal('mercadolivre').precoQuantidade,
    campanhaSincronizadaEm: opcoes.sincronizadaEm !== undefined ? opcoes.sincronizadaEm : AGORA.toISOString(),
    agora: AGORA,
  })
}

const tipos = (rs: Recomendacao[]) => rs.map(r => r.tipo)

describe('recomendações — prioridade e ordem', () => {
  test('vêm ordenadas da mais grave para a menos', () => {
    const rs = recs({ preco: 45 })
    for (let i = 1; i < rs.length; i++) {
      assert.ok(
        ORDEM_PRIORIDADE[rs[i].prioridade] >= ORDEM_PRIORIDADE[rs[i - 1].prioridade],
        `fora de ordem: ${rs[i - 1].prioridade} antes de ${rs[i].prioridade}`,
      )
    }
  })

  test('abaixo do piso é crítica', () => {
    const rs = recs({ preco: 45 })
    const piso = rs.find(r => r.tipo === 'abaixo_do_piso')
    assert.equal(piso?.prioridade, 'critica')
  })

  test('sem regra é crítica', () => {
    const rs = recs({ preco: 120, regra: null })
    assert.equal(rs.find(r => r.tipo === 'sem_regra')?.prioridade, 'critica')
  })

  test('margem no alvo é informativa, não some', () => {
    const rs = recs({ preco: 120, regra: regra({ margemPromocionalMinima: null, margemMinima: null }) })
    const alvo = rs.find(r => r.tipo === 'margem_no_alvo')
    assert.ok(alvo)
    assert.equal(alvo!.prioridade, 'informativa')
    assert.equal(alvo!.acaoSugerida, null, 'nada a fazer é uma resposta legítima')
  })
})

describe('recomendações — diagnóstico, recomendação e ação são coisas diferentes', () => {
  test('toda recomendação separa as três', () => {
    for (const r of recs({ preco: 200 })) {
      assert.ok(r.diagnostico.length > 0, `${r.tipo} sem diagnóstico`)
      assert.ok(r.recomendacao.length > 0, `${r.tipo} sem recomendação`)
      // acaoSugerida pode ser null — "nada a fazer" é resposta.
      assert.ok(r.acaoSugerida === null || r.acaoSugerida.length > 0)
    }
  })

  test('nenhuma ação sugerida executa nada — todas são frases para uma pessoa', () => {
    for (const r of recs({ preco: 200 })) {
      if (!r.acaoSugerida) continue
      assert.doesNotMatch(r.acaoSugerida, /^(aplicar|publicar|enviar|criar campanha)/i)
    }
  })
})

describe('recomendações — evidências, nunca caixa-preta', () => {
  test('toda recomendação traz os números que a sustentam', () => {
    for (const r of recs({ preco: 200 })) {
      assert.ok(r.evidencias.length >= 3, `${r.tipo} veio com ${r.evidencias.length} evidências`)
      for (const e of r.evidencias) {
        assert.ok(e.rotulo.length > 0 && e.valor.length > 0)
      }
    }
  })

  test('as evidências incluem preço, margem, alvo, estoque e cobertura', () => {
    const [r] = recs({ preco: 200 })
    const rotulos = r.evidencias.map(e => e.rotulo)
    assert.ok(rotulos.includes('Preço efetivo'))
    assert.ok(rotulos.includes('Margem efetiva'))
    assert.ok(rotulos.includes('Margem alvo'))
    assert.ok(rotulos.includes('Estoque disponível'))
    assert.ok(rotulos.some(x => x.startsWith('Vendas')))
    assert.ok(rotulos.includes('Cobertura'))
  })

  test('cobertura não confiável não vira evidência', () => {
    const rs = recs({ preco: 200, vendas: { unidades: 20, dias: 30, pedidos: 1, maiorPedido: 20 } })
    const rotulos = rs[0].evidencias.map(e => e.rotulo)
    assert.ok(!rotulos.includes('Cobertura'), 'média dominada por um pedido não vira número na tela')
  })
})

describe('recomendações — O GUARDRAIL VENCE', () => {
  test('abaixo do piso elimina toda sugestão de descer preço', () => {
    const rs = recs({
      preco: 45,
      atacado: { cabe: true, motivo: 'o frete dilui', economiaPorUnidade: 5 },
      vendas: { unidades: 2, dias: 60, pedidos: 2, maiorPedido: 1 },
    })
    assert.ok(tipos(rs).includes('abaixo_do_piso'))
    for (const proibida of ['espaco_para_promocao', 'atacado_possivel', 'margem_alta_estoque_parado'] as const) {
      assert.ok(!tipos(rs).includes(proibida), `${proibida} não pode aparecer num item abaixo do piso`)
    }
  })

  test('sem estoque elimina oportunidade comercial', () => {
    const rs = recs({
      preco: 200, estoque: 0,
      atacado: { cabe: true, motivo: 'o frete dilui', economiaPorUnidade: 5 },
    })
    assert.ok(tipos(rs).includes('sem_estoque'))
    assert.ok(!tipos(rs).includes('espaco_para_promocao'))
    assert.ok(!tipos(rs).includes('atacado_possivel'))
  })

  test('sem regra elimina sugestão de preço', () => {
    const rs = recs({
      preco: 200, regra: null,
      atacado: { cabe: true, motivo: 'o frete dilui', economiaPorUnidade: 5 },
    })
    assert.ok(tipos(rs).includes('sem_regra'))
    assert.ok(!tipos(rs).includes('atacado_possivel'))
  })

  test('estoque curto NÃO apaga a promoção, mas rebaixa e avisa', () => {
    const rs = recs({
      preco: 200, estoque: 10,
      vendas: { unidades: 60, dias: 30, pedidos: 20, maiorPedido: 5 },
    })
    assert.ok(tipos(rs).includes('estoque_curto_evitar_desconto'))
    const promo = rs.find(r => r.tipo === 'espaco_para_promocao')
    if (promo) {
      assert.equal(promo.prioridade, 'baixa')
      assert.match(promo.recomendacao, /poucos dias/)
    }
  })
})

describe('recomendações — sinais combinados', () => {
  test('margem alta com estoque parado vira oportunidade própria', () => {
    const rs = recs({
      preco: 200, estoque: 300,
      vendas: { unidades: 30, dias: 30, pedidos: 15, maiorPedido: 3 },
    })
    const op = rs.find(r => r.tipo === 'margem_alta_estoque_parado')
    assert.ok(op, 'cobertura longa com folga de preço precisa se distinguir da promoção comum')
    assert.equal(op!.prioridade, 'media')
    assert.match(op!.diagnostico, /parada/)
  })

  test('atacado possível informa que o canal ainda não publica', () => {
    const rs = recs({
      preco: 200,
      atacado: { cabe: true, motivo: 'o frete do pedido dilui', economiaPorUnidade: 4.5 },
    })
    const at = rs.find(r => r.tipo === 'atacado_possivel')
    assert.ok(at)
    assert.match(at!.recomendacao, /ainda não está disponível/)
    assert.ok(at!.evidencias.some(e => e.rotulo === 'Publicação no canal'))
  })
})

describe('recomendações — espelho de campanha', () => {
  test('nunca sincronizado é dito com todas as letras', () => {
    const rs = recs({ preco: 200, sincronizadaEm: null })
    const r = rs.find(x => x.tipo === 'dados_de_campanha_desatualizados')
    assert.ok(r)
    assert.match(r!.diagnostico, /nunca foram sincronizadas/)
  })

  test('espelho velho vira atenção com a idade', () => {
    const rs = recs({ preco: 200, sincronizadaEm: '2026-09-01T12:00:00Z' })
    const r = rs.find(x => x.tipo === 'dados_de_campanha_desatualizados')
    assert.ok(r)
    assert.match(r!.diagnostico, /14 dias/)
  })

  test('espelho recente não incomoda', () => {
    const rs = recs({ preco: 200, sincronizadaEm: '2026-09-14T12:00:00Z' })
    assert.ok(!tipos(rs).includes('dados_de_campanha_desatualizados'))
  })
})
