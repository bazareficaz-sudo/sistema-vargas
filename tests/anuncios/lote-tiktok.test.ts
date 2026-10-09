import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { pendenciasDoRascunho, valorPeloNome } from '../../src/lib/anuncios/loteTiktokRegras'

describe('atributo pelo nome do produto', () => {
  const voltagens = [{ id: '1', nome: '110V' }, { id: '2', nome: '220V' }, { id: '3', nome: 'Bivolt' }]
  test('acha o valor que o nome traz, palavra inteira', () => {
    assert.equal(valorPeloNome('CHUVEIRO DUCHA 220V 5500W', voltagens)?.id, '2')
    assert.equal(valorPeloNome('Secador bivolt compacto', voltagens)?.id, '3')
  })
  test('sem o valor no nome, não chuta', () => {
    assert.equal(valorPeloNome('GUEPAR DISJUNTOR MONOPOLAR - 32A', voltagens), null)
  })
  test('o mais longo ganha', () => {
    assert.equal(valorPeloNome('Fita isolante preta 20m', [{ id: 'a', nome: 'Preta' }, { id: 'b', nome: 'Preta fosca' }])?.id, 'a')
    assert.equal(valorPeloNome('Tinta preta fosca 400ml', [{ id: 'a', nome: 'Preta' }, { id: 'b', nome: 'Preta fosca' }])?.id, 'b')
  })
})

describe('pendências do rascunho', () => {
  const base = { fotos: ['x'], categoria: { id: 'c', caminho: '' }, preco: 10, peso: 0.1, atributos: [], titulo: 'T', medidasObrigatorias: false, comprimento: null, largura: null, altura: null }
  test('rascunho completo não tem pendência', () => {
    assert.deepEqual(pendenciasDoRascunho(base), [])
  })
  test('lista o que falta, inclusive atributo obrigatório sem valor', () => {
    const p = pendenciasDoRascunho({
      ...base, fotos: [], peso: null, medidasObrigatorias: true,
      atributos: [{ id: '1', nome: 'Voltagem', obrigatorio: true, multiplo: false, personalizavel: false, valores: [], valorId: null, valorTexto: null }],
    })
    assert.deepEqual(p, ['sem foto', 'sem peso', 'sem medidas (a categoria exige)', 'falta "Voltagem"'])
  })
})

describe('categoria pelas palavras do nome (plano B)', () => {
  test('o caso do disco de serra: mais palavras batendo ganha de "disco" sozinho', async () => {
    const { categoriaPorPalavras } = await import('../../src/lib/anuncios/loteTiktokRegras')
    const folhas = [
      { id: '1', nome: 'Discos rígidos', caminho: 'Computadores > Armazenamento > Discos rígidos', folha: true },
      { id: '2', nome: 'Serras', caminho: 'Ferramentas e hardware > Ferramentas manuais > Serras', folha: true },
      { id: '3', nome: 'Alicates', caminho: 'Ferramentas e hardware > Ferramentas manuais > Alicates', folha: true },
    ]
    assert.equal(categoriaPorPalavras(folhas, 'Disco Serra Madeira Tipo Corrente / Motoserra WJ1814')?.id, '2')
    assert.equal(categoriaPorPalavras(folhas, 'Alicate Pressao 10 WJ1421')?.id, '3')
    assert.equal(categoriaPorPalavras(folhas, 'Bucha Trifix 6'), null)
  })
  test('título limpa os símbolos da frente', async () => {
    const { tituloLimpo } = await import('../../src/lib/anuncios/loteTiktokRegras')
    assert.ok(!tituloLimpo('**zennith Limpa Ar Condicionado 5L').startsWith('*'))
  })
})

describe('regras da Shopee no rascunho', () => {
  const base = { fotos: ['x'], categoria: { id: 'c', caminho: '' }, preco: 10, peso: 0.1, atributos: [], titulo: 'T', medidasObrigatorias: false, comprimento: null, largura: null, altura: null }
  test('título acima do limite, descrição curta e loja sem canal de envio viram pendência', () => {
    const p = pendenciasDoRascunho({
      ...base, titulo: 'x'.repeat(121), tituloMax: 120, descricao: 'curta', descricaoMinima: 60, plataforma: 'shopee', logistica: [],
    })
    assert.deepEqual(p, ['título com mais de 120 caracteres', 'descrição com menos de 60 caracteres', 'nenhum canal de envio habilitado na loja'])
  })
  test('dentro das regras, nada pendente', () => {
    assert.deepEqual(pendenciasDoRascunho({
      ...base, titulo: 'x'.repeat(120), tituloMax: 120, descricao: 'd'.repeat(60), descricaoMinima: 60, plataforma: 'shopee', logistica: [1],
    }), [])
  })
  test('"Cabos Elétricos": Não para quem não é cabo, Sim para cabo/fio', async () => {
    const { respostaCaboEletrico } = await import('../../src/lib/anuncios/loteTiktokRegras')
    const simNao = [{ id: '10', nome: 'Sim' }, { id: '20', nome: 'Não' }]
    assert.equal(respostaCaboEletrico('Cabos Elétricos', 'GUEPAR DISJUNTOR MONOPOLAR - 50A', simNao)?.id, '20')
    assert.equal(respostaCaboEletrico('Cabos Elétricos', 'Cimento CP-3 25KG', simNao)?.id, '20')
    assert.equal(respostaCaboEletrico('Cabos Elétricos', 'CABO FLEXIVEL 2,5MM 100M', simNao)?.id, '10')
    assert.equal(respostaCaboEletrico('Cabos Elétricos', 'Fio paralelo 2x1,5', simNao)?.id, '10')
    // "Cabo" dentro de outra palavra não conta.
    assert.equal(respostaCaboEletrico('Cabos Elétricos', 'Acabamento tomada 10A', simNao)?.id, '20')
    // Outros atributos não são decididos aqui.
    assert.equal(respostaCaboEletrico('Voltagem', 'Cabo 2,5mm', simNao), null)
  })
})
