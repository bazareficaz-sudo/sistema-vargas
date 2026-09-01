import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { origemDaConta, pedidoDaConta } from '../../src/lib/contas/origemDaConta'

// Os dois caminhos existem de verdade neste banco. Medido em 01/09/2026, nas
// 139 contas: 73 gravam `entrada_id`, 66 gravam `origem='entrada_xml'` +
// `origem_id`. Nenhuma usa as duas.

describe('conta vinda de NF-e importada por XML', () => {
  test('abre a NF-e e mostra número e série', () => {
    const o = origemDaConta(
      { origem: 'entrada_xml', origem_id: 'nfe-1' },
      null,
      { id: 'nfe-1', numero: '1890482', serie: '1' },
    )
    assert.equal(o?.href, '/dashboard/entradas-xml/nfe-1')
    assert.equal(o?.rotulo, 'NF-e 1890482/1')
    assert.equal(o?.tipo, 'nf')
  })

  test('sem o número em mãos, o link continua existindo', () => {
    // O destino não depende do rótulo: o id já basta para abrir.
    const o = origemDaConta({ origem: 'entrada_xml', origem_id: 'nfe-2' }, null, null)
    assert.equal(o?.href, '/dashboard/entradas-xml/nfe-2')
    assert.equal(o?.rotulo, 'NF-e importada')
  })
})

describe('conta vinda de entrada manual', () => {
  test('com número de nota, mostra a nota', () => {
    const o = origemDaConta(
      { entrada_id: 'ent-1' },
      { id: 'ent-1', numero_nf: '12345', numero_entrada: 'ENT-000051' },
      null,
    )
    assert.equal(o?.href, '/dashboard/entradas/ent-1')
    assert.equal(o?.rotulo, 'NF 12345')
  })

  test('SEM número de nota, mostra o número da ENTRADA — não um pedaço de UUID', () => {
    // Este é o defeito que o recurso não pode repetir. A descrição gravada
    // nessas contas diz "NF a5f2d2ee — FORNECEDOR", e `a5f2d2ee` são os 8
    // primeiros caracteres do UUID da entrada, não um número de documento.
    // 67 das 73 contas com entrada estão assim.
    const o = origemDaConta(
      { entrada_id: 'a5f2d2ee-0000-0000-0000-000000000000' },
      { id: 'a5f2d2ee-0000-0000-0000-000000000000', numero_nf: null, numero_entrada: 'ENT-000051' },
      null,
    )
    assert.equal(o?.rotulo, 'ENT-000051')
    assert.equal(o?.tipo, 'entrada', 'não é documento fiscal, e o tipo diz isso')
    assert.ok(
      !o?.rotulo.startsWith('NF'),
      'chamar de NF um identificador interno é o engano que estamos corrigindo',
    )
    assert.match(o?.descricao ?? '', /não tem número de nota/)
  })

  test('nota em branco conta como ausente', () => {
    const o = origemDaConta(
      { entrada_id: 'ent-3' },
      { id: 'ent-3', numero_nf: '   ', numero_entrada: 'ENT-000060' },
      null,
    )
    assert.equal(o?.rotulo, 'ENT-000060')
  })
})

describe('conta sem documento de origem', () => {
  test('despesa avulsa não inventa link', () => {
    assert.equal(origemDaConta({}, null, null), null)
    assert.equal(origemDaConta({ entrada_id: null, origem: null, origem_id: null }, null, null), null)
  })

  test('entrada_id apontando para entrada que não veio na consulta', () => {
    // Sem os dados da entrada não dá para rotular, e um link com rótulo
    // inventado seria pior que nenhum.
    assert.equal(origemDaConta({ entrada_id: 'sumiu' }, null, null), null)
  })
})

describe('pedido de compra', () => {
  test('quando existe, vira link', () => {
    const p = pedidoDaConta({ id: 'e1', pedido_compra_id: 'ped-9' })
    assert.equal(p?.href, '/dashboard/pedidos-compra?pedido=ped-9')
    assert.equal(p?.tipo, 'pedido')
  })

  test('HOJE não existe nenhum, e a ausência não vira link vazio', () => {
    // Medido: `pedido_compra_id` é nulo em todas as entradas ligadas a conta.
    // A coluna fica sem a linha do pedido em vez de mostrar "Pedido —".
    assert.equal(pedidoDaConta({ id: 'e1', pedido_compra_id: null }), null)
    assert.equal(pedidoDaConta(null), null)
  })
})
