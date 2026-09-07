import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// O SEGREDO DE ASSINATURA NÃO PODE SAIR DO SERVIDOR.
//
// Não é uma preocupação teórica: no Next, basta um componente com 'use client'
// importar — direta ou indiretamente — um módulo que lê `process.env.SEGREDO`
// para o valor ir junto no bundle que o navegador baixa. O erro não aparece em
// lugar nenhum; a página funciona, e o segredo está publicado.
//
// Este teste é a barreira que grita quando alguém encostar. É lento e feio de
// propósito: ele lê o repositório inteiro, porque o custo de um falso negativo
// aqui é a capacidade de forjar a identidade de qualquer terminal.

const RAIZ = join(import.meta.dirname, '..', '..')
const MODULOS_DE_SERVIDOR = ['pdv/segredo', 'supabase/admin']

function arquivos(dir: string, ext: string[], achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome === '.next' || nome === '.git') continue
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) arquivos(caminho, ext, achados)
    else if (ext.some(e => nome.endsWith(e))) achados.push(caminho)
  }
  return achados
}

describe('o segredo não vaza para o cliente', () => {
  const fontes = arquivos(join(RAIZ, 'src'), ['.ts', '.tsx'])

  test('NENHUM COMPONENTE CLIENTE IMPORTA MÓDULO DE SERVIDOR', () => {
    const culpados: string[] = []
    for (const f of fontes) {
      const conteudo = readFileSync(f, 'utf8')
      const ehCliente = /^\s*['"]use client['"]/m.test(conteudo.slice(0, 400))
      if (!ehCliente) continue
      for (const mod of MODULOS_DE_SERVIDOR) {
        if (conteudo.includes(mod)) culpados.push(`${f.replace(RAIZ, '')} → ${mod}`)
      }
    }
    assert.deepEqual(culpados, [], `componente cliente tocando módulo de servidor:\n${culpados.join('\n')}`)
  })

  test('PDV_TOKEN_SECRET só é LIDO em um lugar', () => {
    // Um único ponto de leitura é o que torna a regra acima verificável. Se a
    // variável passar a ser lida em três arquivos, esta lista precisa ser
    // revista junto — e é isso que o teste força.
    //
    // O que conta é `process.env.PDV_TOKEN_SECRET`, não a menção ao nome: os
    // comentários que explicam a decisão de assinatura citam a variável, e
    // proibir isso empurraria a explicação para longe do código.
    const leitores = fontes
      .filter(f => /process\.env\.PDV_TOKEN_SECRET/.test(readFileSync(f, 'utf8')))
      .map(f => f.replace(RAIZ, '').replace(/\\/g, '/'))
    assert.deepEqual(leitores, ['/src/lib/pdv/segredo.ts'])
  })

  test('nenhum segredo literal foi commitado no lugar da variável', () => {
    // O erro clássico da pressa: colar o valor "só para testar" e esquecer.
    const suspeitos = fontes.filter(f => {
      const c = readFileSync(f, 'utf8')
      return /PDV_TOKEN_SECRET\s*(=|\|\|)\s*['"][^'"]{16,}['"]/.test(c)
    })
    assert.deepEqual(suspeitos, [])
  })

  test('o Electron não conhece a variável', () => {
    // O PDV externo vive noutro repositório e não é lido daqui. O que dá para
    // garantir deste lado é que nada em `src` a exponha numa rota que o PDV
    // chame — e a rota de token devolve JWT assinado, nunca o segredo.
    const rotasPdv = fontes.filter(f => f.replace(/\\/g, '/').includes('/api/pdv/'))
    assert.ok(rotasPdv.length > 0, 'esperava encontrar as rotas do PDV')
    for (const f of rotasPdv) {
      const c = readFileSync(f, 'utf8')
      assert.ok(!c.includes('PDV_TOKEN_SECRET'), `${f} lê a variável direto em vez de usar segredo.ts`)
      // O segredo só aparece como ARGUMENTO de `assinarToken`. Se ele
      // aparecer solto num objeto de resposta, é porque alguém o colocou lá.
      const foraDaAssinatura = c.split('assinarToken(').slice(1)
        .map(p => p.slice(p.indexOf(')') + 1)).join('')
      assert.ok(!foraDaAssinatura.includes('segredoDeAssinatura'),
        `${f} usa o segredo fora da chamada de assinatura`)
    }
  })
})
