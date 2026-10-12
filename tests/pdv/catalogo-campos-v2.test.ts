import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// `grupo_similar` NO CATALOGO DO PDV, SO A PEDIDO.
//
// O rotulo que junta o mesmo item de marcas diferentes ja existe em
// `produtos` e e usado pelo PDV web. O desktop precisa dele para oferecer as
// outras marcas antes de lancar o item.
//
// POR QUE NAO ENTRA NA LISTA FIXA: o PDV desktop hoje cai no caminho legado
// (`select('*')` pelo `anon`), porque nenhum terminal tem a flag `produtos`.
// La o campo ja desce. No dia em que a flag for ligada para um terminal que
// JA usa o grupo, a coluna sumiria do payload e os similares parariam de
// aparecer — sem erro, sem log, sem nada a investigar. O parametro deixa o
// terminal declarar o que sabe ler, em vez de o servidor adivinhar pela
// versao.

const raiz = path.resolve(__dirname, '..', '..')
const ROTA = fs.readFileSync(
  path.join(raiz, 'src/app/api/pdv/produtos/route.ts'), 'utf8')
// Comentarios fora: ancorar em texto de comentario ja produziu assercao vazia
// neste projeto mais de uma vez.
const CODIGO = ROTA
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')

describe('o catalogo responde ao parametro campos', () => {
  test('o recorte de codigo nao é vazio', () => {
    assert.ok(CODIGO.length > 1200, `codigo=${CODIGO.length}`)
  })

  test('sem o parametro, a lista é EXATAMENTE a de antes', () => {
    // A compatibilidade e o ponto todo: cinco terminais em producao pedem
    // sem `campos` e nao podem receber coluna nova.
    assert.match(CODIGO, /return campos === 'v2' \? `\$\{CAMPOS_SNAPSHOT\}, \$\{CAMPOS_V2\}` : CAMPOS_SNAPSHOT/)
  })

  test('so o valor exato "v2" liga o campo novo', () => {
    // Nao `startsWith`, nao `includes`: um `?campos=` vazio ou `?campos=V2`
    // de um terminal futuro tem que cair no comportamento antigo, que é o
    // seguro, em vez de mandar coluna que ninguem pediu.
    assert.match(CODIGO, /campos === 'v2'/)
    assert.doesNotMatch(CODIGO, /campos\?\.includes\('v2'\)/)
    assert.doesNotMatch(CODIGO, /startsWith\('v2'\)/)
  })

  test('o select usa o resultado, nao a constante fixa', () => {
    assert.match(CODIGO, /sb\.from\('produtos'\)\.select\(campos\)/)
    assert.doesNotMatch(CODIGO, /\.select\(CAMPOS_SNAPSHOT\)/)
  })

  test('grupo_similar é o unico campo do v2', () => {
    assert.match(CODIGO, /const CAMPOS_V2 = 'grupo_similar'/)
  })

  test('CAMPOS_SNAPSHOT nao ganhou o campo por engano', () => {
    const lista = CODIGO.slice(CODIGO.indexOf('const CAMPOS_SNAPSHOT'),
                               CODIGO.indexOf("].join(', ')"))
    assert.ok(lista.length > 300, `lista=${lista.length}`)
    assert.doesNotMatch(lista, /grupo_similar/)
  })
})

describe('o resto da rota nao mudou', () => {
  test('continua exigindo a flag produtos', () => {
    // Esta rota SUBSTITUI um caminho legado que funciona. Diferente da do
    // compre junto, aqui a flag protege o rollout.
    assert.match(CODIGO, /flagDaOperacao: 'produtos'/)
  })

  test('continua sem filtro de ativo', () => {
    // Produto inativado precisa descer para o terminal parar de vende-lo.
    const get = CODIGO.slice(CODIGO.indexOf('export async function GET'),
                             CODIGO.indexOf('export async function PATCH'))
    assert.ok(get.length > 400, `get=${get.length}`)
    assert.doesNotMatch(get, /\.eq\('ativo'/)
  })

  test('paginacao e filtro incremental intactos', () => {
    assert.match(CODIGO, /\.range\(pagina \* PAGINA, pagina \* PAGINA \+ PAGINA - 1\)/)
    assert.match(CODIGO, /if \(desde\) q = q\.gte\('updated_at', desde\)/)
  })
})
