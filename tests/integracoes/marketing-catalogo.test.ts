import { test } from 'node:test'
import assert from 'node:assert/strict'
import { condicaoPagamento, exportarProduto, temTagMarketing, type ProdutoErp } from '../../src/lib/integracoes/marketing/catalogo'

const base: ProdutoErp = {
  id: '11111111-1111-4111-8111-111111111111', nome: 'SPRAY PS007', sku: 'PS007', ean: null, unidade: 'UN',
  categoria: null, marca: null, descricao_marketplace: null, ativo: true, mesclado_em: null, tags: ['DESTAQUE', 'MARKETING'],
  preco_venda: '80.00', preco_promocional: '69.90', promocao_ativa: true, promocao_inicio: null, promocao_fim: null,
  controlar_estoque: true, estoque: '5.000', foto_url: 'https://cdn.exemplo.com/capa.jpg', updated_at: '2026-09-25T19:35:39Z',
}

test('tag "marketing" em qualquer caixa e com espaços', () => {
  assert.equal(temTagMarketing(['Marketing']), true)
  assert.equal(temTagMarketing([' marketing ']), true)
  assert.equal(temTagMarketing(['marketings', 'mkt']), false)
  assert.equal(temTagMarketing(null), false)
})

test('preço em centavos, promoção vigente e sem custo nem estoque exato', () => {
  const p = exportarProduto(base, [], null, new Date('2026-09-25T20:00:00Z'))
  assert.equal(p.regular_price_minor, 8000)
  assert.equal(p.current_price_minor, 6990)
  assert.deepEqual(p.promotion, { price_minor: 6990, starts_at: null, ends_at: null, current: true })
  assert.equal(p.availability, 'in_stock')
  assert.equal(p.active, true)
  assert.equal('preco_custo' in p, false)
  assert.equal('estoque' in p, false)
})

test('promoção vencida não é preço atual; ausência nunca vira zero', () => {
  const vencida = exportarProduto({ ...base, promocao_fim: '2026-09-01T00:00:00Z' }, [], null, new Date('2026-09-25T20:00:00Z'))
  assert.equal(vencida.current_price_minor, 8000)
  assert.equal(vencida.promotion?.current, false)
  const semPreco = exportarProduto({ ...base, preco_venda: null, preco_promocional: '0' }, [], null)
  assert.equal(semPreco.regular_price_minor, null)
  assert.equal(semPreco.promotion, null)
})

test('disponibilidade: sem controle de estoque é desconhecida; zero é sem estoque', () => {
  assert.equal(exportarProduto({ ...base, controlar_estoque: false }, [], null).availability, 'unknown')
  assert.equal(exportarProduto({ ...base, estoque: '0' }, [], null).availability, 'out_of_stock')
})

test('inativo, mesclado ou sem a tag sai como inativo', () => {
  assert.equal(exportarProduto({ ...base, ativo: false }, [], null).active, false)
  assert.equal(exportarProduto({ ...base, mesclado_em: '22222222-2222-4222-8222-222222222222' }, [], null).active, false)
  assert.equal(exportarProduto({ ...base, tags: ['DESTAQUE'] }, [], null).active, false)
})

test('fotos: principal primeiro, só https; capa do produto como reserva', () => {
  const p = exportarProduto(base, [
    { id: 'a', url: 'https://cdn.exemplo.com/2.jpg', ordem: 2, principal: false },
    { id: 'b', url: 'https://cdn.exemplo.com/1.jpg', ordem: 5, principal: true },
    { id: 'c', url: 'http://inseguro/3.jpg', ordem: 1, principal: false },
  ], null)
  assert.deepEqual(p.images.map(i => [i.id, i.main]), [['b', true], ['a', false]])
  assert.deepEqual(exportarProduto(base, [], null).images.map(i => i.url), ['https://cdn.exemplo.com/capa.jpg'])
})

test('condição de pagamento só com promoção vigente e regra ligada', () => {
  const cfg = { exigirFormaPagamento: true, formasPermitidas: ['pix', 'dinheiro'] }
  assert.equal(condicaoPagamento(cfg, true), 'Preço promocional para pagamento em PIX ou Dinheiro')
  assert.equal(condicaoPagamento(cfg, false), null)
  assert.equal(condicaoPagamento({ exigirFormaPagamento: false, formasPermitidas: ['pix'] }, true), null)
})
