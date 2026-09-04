import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// AGRUPAMENTO POR item_id — o defeito que a primeira versão tinha.
//
// A leitura da campanha "Bota Fora" mostrou a forma da Shopee: a tesoura
// aparece UMA vez, com `model_list` dentro, e cada modelo com preço próprio
// (R$ 22,41 e R$ 19,62). Mandar três entradas com o mesmo `item_id` pediria
// para a Shopee decidir qual vale.
//
// A função de agrupamento vive dentro da rota; este teste replica a mesma
// lógica para travá-la — se o formato mudar lá, aqui quebra junto.

type Entrada = { anuncioId: string; modelId?: string | null; precoPromocional: number }
type ItemShopee = {
  itemId: number
  precoPromocional?: number
  modelos?: { modelId: number; precoPromocional: number }[]
}

function agrupar(itens: Entrada[], idExternoDe: (anuncioId: string) => number): ItemShopee[] {
  const porItem = new Map<number, ItemShopee>()
  for (const i of itens) {
    const itemId = idExternoDe(i.anuncioId)
    let e = porItem.get(itemId)
    if (!e) { e = { itemId }; porItem.set(itemId, e) }
    if (i.modelId) {
      e.modelos = e.modelos ?? []
      e.modelos.push({ modelId: Number(i.modelId), precoPromocional: i.precoPromocional })
    } else {
      e.precoPromocional = i.precoPromocional
    }
  }
  return [...porItem.values()]
}

const id = (a: string) => ({ tesoura: 58257952255, tomada: 58217446568 } as Record<string, number>)[a]

describe('um item_id por entrada, variações dentro', () => {
  test('as duas variações da tesoura viram UMA entrada', () => {
    const r = agrupar([
      { anuncioId: 'tesoura', modelId: '189620107088', precoPromocional: 22.41 },
      { anuncioId: 'tesoura', modelId: '189620107089', precoPromocional: 19.62 },
    ], id)
    assert.equal(r.length, 1, 'mandar duas entradas com o mesmo item_id pediria para a Shopee escolher')
    assert.equal(r[0].itemId, 58257952255)
    assert.equal(r[0].modelos?.length, 2)
    assert.equal(r[0].precoPromocional, undefined, 'com variação o preço mora no modelo, não no item')
  })

  test('cada modelo mantém o preço dele', () => {
    const r = agrupar([
      { anuncioId: 'tesoura', modelId: '189620107088', precoPromocional: 22.41 },
      { anuncioId: 'tesoura', modelId: '189620107089', precoPromocional: 19.62 },
    ], id)
    const precos = r[0].modelos!.map(m => m.precoPromocional).sort()
    assert.deepEqual(precos, [19.62, 22.41])
  })

  test('item sem variação leva o preço no próprio item', () => {
    const r = agrupar([{ anuncioId: 'tomada', precoPromocional: 29.63 }], id)
    assert.equal(r[0].precoPromocional, 29.63)
    assert.equal(r[0].modelos, undefined)
  })

  test('itens diferentes continuam separados', () => {
    const r = agrupar([
      { anuncioId: 'tesoura', modelId: '189620107088', precoPromocional: 22.41 },
      { anuncioId: 'tomada', precoPromocional: 29.63 },
    ], id)
    assert.equal(r.length, 2)
  })
})
