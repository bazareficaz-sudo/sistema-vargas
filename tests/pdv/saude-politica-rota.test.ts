import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// A POLITICA COMERCIAL CHEGA AO PDV EXTERNO.
//
// Hoje existem duas reguas de saude da venda que nao se falam: o web usa
// `saude_faixas` (70/50/30/5%, desconto 10/5/2%) e o terminal usa numeros
// fixos no codigo (30/15/8%, desconto 12%). A tabela que o PDV leria para
// saber a politica, `config_desconto`, esta VAZIA em producao.
//
// O resultado medido: o vendedor no balcao e guiado por numeros que ninguem
// configurou, enquanto a politica real nunca chega nele.
//
// POR QUE ROTA E NAO ANON: `saude_config` esta aberta ao `anon`, mas
// `saude_faixas` NAO — conferido em producao. Abrir devolveria um privilegio
// retirado de proposito, e as faixas carregam a politica de margem da loja.

const raiz = path.resolve(__dirname, '..', '..')
const ROTA = fs.readFileSync(
  path.join(raiz, 'src/app/api/pdv/saude/route.ts'), 'utf8')
// Comentarios fora: ancorar em comentario ja produziu assercao vazia aqui.
const CODIGO = ROTA
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')

describe('a rota entrega config e faixas', () => {
  test('o recorte de codigo nao é vazio', () => {
    assert.ok(CODIGO.length > 400, `codigo=${CODIGO.length}`)
  })

  test('le as duas tabelas', () => {
    assert.match(CODIGO, /from\('saude_config'\)/)
    assert.match(CODIGO, /from\('saude_faixas'\)/)
  })

  test('as faixas saem na ordem configurada', () => {
    // A ordem é a politica: a primeira faixa cuja margem bate é a que vale.
    // Sem ordenar, qual faixa pega passaria a depender do banco.
    assert.match(CODIGO, /\.order\('ordem'\)/)
  })

  test('filtra pela empresa do TOKEN', () => {
    // Duas ocorrencias: config e faixas. Nenhuma pode vir do pedido.
    const ocorrencias = CODIGO.split('ctx.empresa_id').length - 1
    assert.equal(ocorrencias, 2, `esperava 2 filtros por empresa, achei ${ocorrencias}`)
    assert.doesNotMatch(CODIGO, /searchParams/)
  })

  test('nao exige flag de rollout', () => {
    // Leitura de politica. Nao substitui caminho nenhum, e o pior que uma
    // resposta ausente faz é o terminal seguir com o que ja tinha.
    assert.match(CODIGO, /exigirFlag: false/)
  })

  test('nao escreve nada', () => {
    for (const proibido of [/\.upsert\(/, /\.insert\(/, /\.update\(/, /\.delete\(/]) {
      assert.doesNotMatch(CODIGO, proibido)
    }
  })

  test('config ausente e faixas vazias sao respostas DIFERENTES', () => {
    // Sem config, o terminal mantem o que tinha. Sem faixas, usa as de
    // fabrica. Achatar as duas em `{}` apagaria a distincao.
    assert.match(CODIGO, /config: config \?\? null/)
    assert.match(CODIGO, /faixas: faixas \?\? \[\]/)
  })
})

// NAO ha teste aqui do lado do PDV externo: ele vive em outro repositorio, e
// um teste que alcanca ../../vargasnexus-pdv quebra para quem clonar so este.
// O contrato do terminal esta coberto na suite de la.
