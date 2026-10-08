import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { produtosDaEntrada } from '../../src/lib/produtos/filtroEntrada'

// "Produtos da entrada" com os kits que usam algum item da nota — pedido para
// a tela de Produtos. As telas de preço chamam sem a opção e não podem mudar.

type Linhas = Record<string, Record<string, unknown>[]>

/** Supabase de mentira: cada tabela devolve as linhas dadas, filtradas por `.in()`. */
function sbFalso(tabelas: Linhas) {
  return {
    from(tabela: string) {
      let linhas = tabelas[tabela] ?? []
      const qb: any = {
        select: () => qb, eq: () => qb, or: () => qb, ilike: () => qb,
        gte: () => qb, lte: () => qb, limit: () => qb,
        in: (col: string, vals: unknown[]) => { linhas = linhas.filter(l => vals.includes(l[col])); return qb },
        then: (ok: (r: { data: unknown[] }) => unknown) => Promise.resolve({ data: linhas }).then(ok),
      }
      return qb
    },
  }
}

const BASE: Linhas = {
  entradas: [{ id: 'e1', numero_entrada: 'ENT-000001', numero_nf: '123' }],
  nfe_entradas: [],
  entrada_itens: [{ entrada_id: 'e1', produto_id: 'parafuso' }, { entrada_id: 'e1', produto_id: 'bucha' }],
  nfe_itens: [],
  kit_itens: [
    { kit_id: 'kit-fixacao', produto_id: 'parafuso' },
    { kit_id: 'kit-fixacao', produto_id: 'bucha' },     // mesmo kit por dois itens: aparece uma vez
    { kit_id: 'kit-bucha-10', produto_id: 'bucha' },
    { kit_id: 'kit-outro', produto_id: 'cimento' },    // não usa item da nota
  ],
}

describe('produtosDaEntrada com kits', () => {
  test('inclui os kits que usam algum item da entrada, sem repetir', async () => {
    const r = await produtosDaEntrada(sbFalso(BASE), 'emp', { numero: 'ENT-000001', incluirKits: true })
    assert.deepEqual([...r!.kitIds].sort(), ['kit-bucha-10', 'kit-fixacao'])
    assert.deepEqual([...r!.produtoIds].sort(), ['bucha', 'kit-bucha-10', 'kit-fixacao', 'parafuso'])
  })

  test('sem a opção (telas de preço), nada muda', async () => {
    const r = await produtosDaEntrada(sbFalso(BASE), 'emp', { numero: 'ENT-000001' })
    assert.deepEqual(r!.kitIds, [])
    assert.deepEqual([...r!.produtoIds].sort(), ['bucha', 'parafuso'])
  })

  test('kit que já entrou como item da nota não conta como kit extra', async () => {
    const comKitNaNota: Linhas = {
      ...BASE,
      entrada_itens: [...BASE.entrada_itens, { entrada_id: 'e1', produto_id: 'kit-fixacao' }],
    }
    const r = await produtosDaEntrada(sbFalso(comKitNaNota), 'emp', { numero: 'ENT-000001', incluirKits: true })
    assert.deepEqual(r!.kitIds, ['kit-bucha-10'])
  })
})
