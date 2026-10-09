import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { conversaoAceita, mensagemConversao, podeCarregarNoPdv } from '../../src/lib/orcamentos/conversaoPdv'

// "Converter em venda (PDV)" no PDV web. A venda só pode seguir quando a RPC
// entrega o orçamento a ESTA venda — e o retry da mesma venda também segue.

describe('conversão de orçamento no PDV web', () => {
  test('segue só com convertido ou retry da mesma venda', () => {
    assert.equal(conversaoAceita('convertido'), true)
    assert.equal(conversaoAceita('ja_convertido'), true)
    for (const e of ['conflito_conversao', 'conflito_versao', 'recusado_cancelado', 'nao_encontrado', undefined]) {
      assert.equal(conversaoAceita(e), false, String(e))
    }
  })

  test('mensagem diz o que houve, com o número do orçamento', () => {
    assert.match(mensagemConversao('conflito_conversao', 64), /#64 já foi convertido em outra venda/)
    assert.match(mensagemConversao('conflito_versao', 64), /alterado depois/)
  })

  test('só aberto e aprovado entram no PDV', () => {
    assert.equal(podeCarregarNoPdv('aberto'), true)
    assert.equal(podeCarregarNoPdv('aprovado'), true)
    assert.equal(podeCarregarNoPdv('convertido'), false)
    assert.equal(podeCarregarNoPdv('cancelado'), false)
  })

  test('a rota tira a empresa da sessão e exige permissão de vender', () => {
    const fonte = readFileSync(resolve(import.meta.dirname, '../../src/app/api/orcamentos/[id]/converter/route.ts'), 'utf8')
    assert.match(fonte, /exigirPermissao\(sb, 'realizar_vendas'\)/)
    assert.match(fonte, /p_empresa_id: empresaId/)
    assert.doesNotMatch(fonte, /corpo\??\.empresa_id/)
  })
})
