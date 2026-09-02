import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { limitesDoContexto, montarCapacidades, type ContextoAnuncios } from '../../src/lib/marketplace/contextoPergunta'

// O QUE A IA NÃO PODE AFIRMAR.
//
// Duas lições de 01/09/2026, as duas pagas caro:
//
//   o painel de rascunho mostrou "markup 225,3%" num preço que dava prejuízo
//   de R$ 0,89, porque o frete zero não estava marcado como não medido;
//
//   o "Pergunte ao Vargas" do dashboard recebeu `faturamentoMes: 1336.17` sem
//   data e respondeu "Agosto apresenta R$ 1.336,17" — agosto teve R$ 51.498,04.
//
// Uma frase em português some com a incerteza melhor que um painel: ninguém
// desconfia de um parágrafo bem escrito. Estes testes travam os avisos que
// impedem a IA de transformar suposição em afirmação.

const base = (): ContextoAnuncios => ({
  canal: { nome: 'ML Eficaz', plataforma: 'mercadolivre' },
  sincronizacao: { maisRecente: '2026-09-01T10:00:00Z', maisAntiga: '2026-08-30T10:00:00Z', nuncaSincronizados: 0 },
  anuncios: { total: 100, ativos: 90, pausados: 10, comErro: 0, semProdutoVinculado: 0, semPreco: 0 },
  economia: { comissao: 'medida_na_api', frete: 'medido_na_api', ressalva: null },
  campanhas: { total: 0, itensParticipando: 0, itensConvite: 0, sincronizadoEm: '2026-09-01T10:00:00Z' },
  capacidades: { campanhasLeitura: { estado: 'suportado' } },
  naoRespondivel: [],
})

describe('o contexto declara o que não alcança', () => {
  test('margem de anúncio individual nunca é respondível por contagens', () => {
    // O contexto tem quantos anúncios existem, não quanto cada um lucra.
    // Sem este aviso, "quais anúncios dão prejuízo?" seria respondido com
    // qualquer número que estivesse por perto.
    const limites = limitesDoContexto(base())
    assert.ok(limites.some(l => /margem de anúncio individual/i.test(l)))
  })

  test('comissão ou frete não medidos aparecem como limite', () => {
    const ctx = base()
    ctx.economia = { comissao: 'tabela_configurada', frete: 'modo_configurado', ressalva: 'x' }
    const limites = limitesDoContexto(ctx)
    assert.ok(
      limites.some(l => /NÃO vêm de medição/i.test(l)),
      'afirmar lucratividade sobre valor digitado à mão é o defeito do R$ 13,01',
    )
  })

  test('tudo medido: o aviso de medição some, o de margem fica', () => {
    const limites = limitesDoContexto(base())
    assert.ok(!limites.some(l => /NÃO vêm de medição/i.test(l)))
    assert.equal(limites.length, 1, 'só o limite estrutural de margem por anúncio')
  })
})

describe('não verificado não é não suportado', () => {
  test('capacidade nunca conferida vira aviso explícito', () => {
    const ctx = base()
    ctx.capacidades = {
      campanhasEscrita: { estado: 'nao_verificado', motivo: 'ninguém sondou' },
      campanhasLeitura: { estado: 'suportado' },
    }
    const limites = limitesDoContexto(ctx)
    const aviso = limites.find(l => /NUNCA foram verificadas/i.test(l))
    assert.ok(aviso, 'a distinção existe para impedir que "não sei" vire "não dá"')
    assert.match(aviso!, /campanhasEscrita/)
    assert.doesNotMatch(aviso!, /campanhasLeitura/, 'o que foi conferido não entra na lista')
  })

  test('o Mercado Livre chega com capacidades não verificadas de verdade', () => {
    // Não é hipótese de teste: a sonda da Fase 4 ainda não rodou.
    const caps = montarCapacidades('mercadolivre', true)
    const naoVerificadas = Object.values(caps).filter(c => c.estado === 'nao_verificado')
    assert.ok(naoVerificadas.length > 0)
    assert.ok(naoVerificadas.every(c => c.motivo), 'estado diferente de suportado exige motivo')
  })
})

describe('anúncios sem produto vinculado', () => {
  test('viram limite, porque sem custo não há margem', () => {
    const ctx = base()
    ctx.anuncios.semProdutoVinculado = 12
    const limites = limitesDoContexto(ctx)
    const aviso = limites.find(l => /não têm produto do catálogo/i.test(l))
    assert.ok(aviso)
    assert.match(aviso!, /12 anúncio/)
  })

  test('zero não vira aviso — ruído por caso que não existe', () => {
    assert.ok(!limitesDoContexto(base()).some(l => /não têm produto do catálogo/i.test(l)))
  })
})

describe('idade do espelho de campanhas', () => {
  test('campanha nunca sincronizada é declarada', () => {
    const ctx = base()
    ctx.campanhas = { total: 3, itensParticipando: 5, itensConvite: 2, sincronizadoEm: null }
    assert.ok(limitesDoContexto(ctx).some(l => /nunca foram sincronizadas/i.test(l)))
  })

  test('sem campanha nenhuma, não há o que avisar', () => {
    const ctx = base()
    ctx.campanhas = { total: 0, itensParticipando: 0, itensConvite: 0, sincronizadoEm: null }
    assert.ok(!limitesDoContexto(ctx).some(l => /nunca foram sincronizadas/i.test(l)))
  })
})
