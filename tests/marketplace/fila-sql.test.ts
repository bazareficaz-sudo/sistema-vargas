import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Regressão de 03/09/2026: um arquivo SQL recriou enfileirar_produto sem
// `enviado_em = NULL`, e todo produto já enviado uma vez passou a sumir da
// fila ao ser remarcado (1.181 represados até 06/10). Qualquer definição da
// função guardada no repositório precisa limpar o envio anterior — é o que
// "pendente" significa para a fila (`enviado_em IS NULL`).
test('toda definição de enfileirar_produto limpa enviado_em ao remarcar', () => {
  const raiz = join(__dirname, '..', '..')
  const arquivos = readdirSync(raiz).filter(f => f.endsWith('.sql'))
  let definicoes = 0
  for (const arquivo of arquivos) {
    const sql = readFileSync(join(raiz, arquivo), 'utf-8')
    const blocos = sql.split(/CREATE OR REPLACE FUNCTION\s+(?:public\.)?/i).slice(1)
    for (const bloco of blocos) {
      if (!/^enfileirar_produto\s*\(/i.test(bloco)) continue
      definicoes++
      const corpo = bloco.split(/\$\$ LANGUAGE|\$function\$;/)[0]
      assert.match(corpo, /enviado_em\s*=\s*NULL/i, `${arquivo}: enfileirar_produto sem "enviado_em = NULL"`)
    }
  }
  assert.ok(definicoes >= 3, `esperava achar as definições da função (achou ${definicoes})`)
})
