import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { verificarNcm, vizinhosDoNcm, explicarNcm, apenasDigitos } from '../../src/lib/fiscal/ncm'

// Rejeição 778 — "Informado NCM fora do período de vigência ou inexistente".
//
// A venda #201722 morreu aqui. O NCM 32100090 foi preenchido pela IA: oito
// dígitos, formato impecável, e inexistente. A posição 3210.00 tem .10
// (Tintas), .20 (Vernizes) e .30 (Pigmentos) — nenhum .90. O ".90" é o "outros"
// de muitas posições da nomenclatura, e o modelo o aplicou onde não cabe.
//
// Toda a validação que existia era estrutural (8 dígitos). Formato certo não é
// código certo.

/** Banco de mentira, com o recorte real da posição 3210.00. */
function bancoFake(linhas: Record<string, { descricao: string; data_fim?: string | null }>) {
  return {
    from() {
      const estado: { codigo?: string; prefixo?: string } = {}
      const api = {
        select: () => api,
        eq: (_col: string, v: string) => { estado.codigo = v; return api },
        like: (_col: string, v: string) => { estado.prefixo = v.replace('%', ''); return api },
        order: () => api,
        limit: () => Promise.resolve({
          data: Object.entries(linhas)
            .filter(([c]) => c.startsWith(estado.prefixo ?? ''))
            .map(([codigo, l]) => ({ codigo, descricao: l.descricao, data_fim: l.data_fim ?? null })),
          error: null,
        }),
        maybeSingle: () => {
          const l = linhas[estado.codigo ?? '']
          return Promise.resolve({
            data: l ? { codigo: estado.codigo, descricao: l.descricao, data_inicio: '2022-04-01', data_fim: l.data_fim ?? '9999-12-31' } : null,
            error: null,
          })
        },
      }
      return api
    },
  }
}

const NOMENCLATURA = bancoFake({
  '32100010': { descricao: 'Tintas' },
  '32100020': { descricao: 'Vernizes' },
  '32100030': { descricao: 'Pigmentos a água preparados' },
  '82075011': { descricao: 'Brocas' },
  '84818099': { descricao: 'Outros', data_fim: '2021-12-31' }, // extinto, para o teste
})

const HOJE = new Date('2026-08-30T12:00:00Z')

describe('NCM — o caso da venda #201722', () => {
  test('32100090 tem 8 dígitos e NÃO existe', async () => {
    const s = await verificarNcm(NOMENCLATURA, '32100090', HOJE)
    assert.equal(s.situacao, 'inexistente')
    assert.match(explicarNcm(s)!, /Rejeição 778/)
  })

  test('os vizinhos vigentes da mesma posição são oferecidos', async () => {
    const vizinhos = await vizinhosDoNcm(NOMENCLATURA, '32100090', HOJE)
    assert.deepEqual(vizinhos.map(v => v.codigo), ['32100010', '32100020', '32100030'])
    // A descrição vem junto porque é ela que permite escolher: "Tintas" para um
    // produto chamado GUEPARCOLOR SUPER METALICO CROMADO.
    assert.equal(vizinhos[0].descricao, 'Tintas')
  })

  test('o código correto passa', async () => {
    const s = await verificarNcm(NOMENCLATURA, '32100010', HOJE)
    assert.equal(s.situacao, 'vigente')
    assert.equal(explicarNcm(s), null)
  })
})

describe('NCM — "inexistente" e "extinto" não são a mesma coisa', () => {
  test('código revogado é extinto, e a frase diz a data', async () => {
    const s = await verificarNcm(NOMENCLATURA, '84818099', HOJE)
    assert.equal(s.situacao, 'extinto')
    assert.match(explicarNcm(s)!, /extinto em 31\/12\/2021/)
  })

  test('o mesmo código era válido antes de ser revogado', async () => {
    // Importa porque uma nota antiga continua correta com ele — o erro é
    // classificar assim HOJE, não ter classificado assim em 2021.
    const s = await verificarNcm(NOMENCLATURA, '84818099', new Date('2021-06-01T12:00:00Z'))
    assert.equal(s.situacao, 'vigente')
  })
})

describe('NCM — não conseguir conferir não é reprovar', () => {
  test('erro de consulta vira nao_verificavel, nunca inexistente', async () => {
    const bancoQuebrado = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: 'relation "ncm_tabela" does not exist' } }) }) }),
      }),
    }
    const s = await verificarNcm(bancoQuebrado, '32100010', HOJE)
    assert.equal(s.situacao, 'nao_verificavel')
    // A frase precisa desfazer a leitura errada, não só relatar a falha: sem
    // isso, "não deu para conferir" vira "está errado" na cabeça de quem lê.
    assert.match(explicarNcm(s)!, /NÃO quer dizer que ele esteja errado/)
  })
})

describe('NCM — formato', () => {
  test('vazio e curto são malformados, com frases diferentes', async () => {
    assert.match(explicarNcm(await verificarNcm(NOMENCLATURA, null, HOJE))!, /sem NCM cadastrado/)
    assert.match(explicarNcm(await verificarNcm(NOMENCLATURA, '3210', HOJE))!, /não tem 8 dígitos/)
  })

  test('máscara não atrapalha — "3210.00.10" é o mesmo código', async () => {
    const s = await verificarNcm(NOMENCLATURA, '3210.00.10', HOJE)
    assert.equal(s.situacao, 'vigente')
    assert.equal(apenasDigitos('3210.00.10'), '32100010')
  })

  test('prefixo curto demais não sugere nada', async () => {
    // "tudo que começa com 32" são centenas de códigos; oferecer isso não
    // ajuda ninguém a escolher.
    assert.deepEqual(await vizinhosDoNcm(NOMENCLATURA, '32', HOJE), [])
  })
})
