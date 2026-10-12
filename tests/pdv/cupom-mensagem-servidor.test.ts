import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// A MENSAGEM DO RODAPE DO CUPOM VEM DO SERVIDOR.
//
// Antes: o cupom termico era montado pela maquina que imprime, lendo o store
// dela. Seis terminais, seis lugares para digitar a mesma frase. O comprovante
// em PDF ja lia de `empresa_config_impressao` desde que a tela existe — eram
// duas verdades para a mesma coisa.
//
// Agora o terminal le a mesma linha, pela rota que ele ja consulta.
//
// POR QUE NAO LER DIRETO DO BANCO: `empresa_config_impressao` nao esta aberta
// ao `anon` (conferido em producao). Abrir devolveria um privilegio que foi
// retirado de proposito.

const raiz = path.resolve(__dirname, '..', '..')
const ROTA = fs.readFileSync(
  path.join(raiz, 'src/app/api/pdv/impressao/route.ts'), 'utf8')
// Comentarios fora: ancorar em texto de comentario ja produziu assercao vazia
// neste projeto. O que se afirma aqui tem de estar no codigo.
const CODIGO = ROTA.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

describe('a leitura do cupom esta na rota do terminal', () => {
  test('o recorte de codigo nao é vazio', () => {
    assert.ok(CODIGO.length > 800, `codigo=${CODIGO.length}`)
  })

  test('le empresa_config_impressao', () => {
    assert.match(CODIGO, /from\('empresa_config_impressao'\)/)
    assert.match(CODIGO, /select\('mensagem_rodape'\)/)
  })

  test('filtra pela empresa do TOKEN, nunca do corpo ou da query', () => {
    // A empresa sai de `acesso.contexto`. Aceitar empresa_id de fora deixaria
    // um terminal ler a configuracao de outra empresa — foi exatamente o
    // defeito que a escrita desta rota corrigiu.
    assert.match(CODIGO, /const empresaId = acesso\.contexto\.empresa_id/)
    assert.doesNotMatch(CODIGO, /searchParams/)
    assert.doesNotMatch(CODIGO, /req\.json\(\)[\s\S]{0,400}empresa_id/)
  })

  test('exige credencial de terminal antes de responder', () => {
    assert.match(CODIGO, /autenticarTerminalPdv\(req, \{ exigirFlag: false \}\)/)
    assert.match(CODIGO, /if \(!acesso\.ok\) return respostaDeRecusa\(acesso\)/)
  })

  test('nao exige flag de rollout — todo terminal ativado le', () => {
    // Diferente de venda: aqui nao ha escrita, nao ha dinheiro e nao ha
    // duplicata possivel. Exigir flag so atrasaria a leitura sem proteger nada.
    assert.doesNotMatch(CODIGO, /exigirFlag: true/)
  })
})

describe('empresa sem configuracao é diferente de configuracao vazia', () => {
  test('sem linha devolve null, nao string vazia', () => {
    // `null` significa "nada a dizer" e o terminal mantem o que imprimia.
    // String vazia significa "a empresa escolheu nao ter rodape". Trocar uma
    // pela outra apagaria o rodape de quem nunca abriu a tela.
    assert.match(CODIGO, /mensagem_rodape: cupom\?\.mensagem_rodape \?\? null/)
    assert.doesNotMatch(CODIGO, /mensagem_rodape:[^\n]*\|\|\s*''/)
  })
})

describe('o que a rota continua NAO fazendo', () => {
  test('nao escreve nada na leitura', () => {
    const get = CODIGO.slice(CODIGO.indexOf('export async function GET'))
    assert.ok(get.length > 300, `get=${get.length}`)
    for (const proibido of [/\.upsert\(/, /\.insert\(/, /\.update\(/, /\.delete\(/]) {
      assert.doesNotMatch(get, proibido)
    }
  })

  test('a publicacao da URL continua intacta', () => {
    assert.match(CODIGO, /operacao: 'impressao\.publicar_url'/)
    assert.match(CODIGO, /empresa_id: ctx\.empresa_id/)
    assert.match(CODIGO, /onConflict: 'empresa_id'/)
  })

  test('a resposta antiga continua no mesmo lugar', () => {
    // O terminal 1.10.6 em diante le `impressao`. Mover ou renomear esse campo
    // quebraria quem ja consulta a rota.
    assert.match(CODIGO, /impressao: impressao \?\? null/)
    assert.match(CODIGO, /print_server_url, terminal_id, updated_at/)
  })
})
