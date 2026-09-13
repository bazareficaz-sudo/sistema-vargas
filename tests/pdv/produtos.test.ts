import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { decidirAcesso, type LinhaTerminalAcesso } from '../../src/lib/pdv/decidirAcesso'
import { validarAtualizacaoProduto, CAMPOS_PROIBIDOS } from '../../src/lib/pdv/payloadProduto'

// O CATÁLOGO ATRÁS DA IDENTIDADE DO TERMINAL.
//
// Medido em 13/09/2026: 28.676 produtos legíveis com a chave `anon`, sem
// login, COM `preco_custo`. É a maior exposição das três tabelas auditadas.
//
// O que estes testes travam não é o conteúdo da resposta — é o que a rota
// NÃO pode aceitar nem devolver.

const EMPRESA_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TERMINAL_A = '11111111-1111-1111-1111-111111111111'

const CLAIMS = {
  sub: TERMINAL_A, terminal_id: TERMINAL_A, empresa_id: EMPRESA_A,
  tenant_id: null, tipo: 'pdv_terminal' as const, iat: 0, exp: 9_999_999_999,
}

const TERMINAL: LinhaTerminalAcesso = {
  id: TERMINAL_A, empresa_id: EMPRESA_A, status: 'ativo',
  nome: 'Caixa', versao_pdv: '1.10.1', usar_rotas_novas: true,
  rotas_habilitadas: { produtos: true },
}

const acesso = (over: Partial<LinhaTerminalAcesso> = {}, operacao = 'produtos') =>
  decidirAcesso({
    claims: CLAIMS, terminal: { ...TERMINAL, ...over },
    tenantId: null, empresaAtiva: true, exigirFlag: true, operacao,
  })

describe('rollout — produtos é mais uma flag', () => {
  test('terminal com produtos ligada passa', () => {
    assert.equal(acesso().ok, true)
  })

  test('CLIENTES LIGADA NÃO LIBERA PRODUTOS', () => {
    const a = acesso({ rotas_habilitadas: { clientes: true, faltas: true } })
    assert.equal(a.ok, false)
    if (a.ok) return
    assert.equal(a.motivo, 'rota_desligada')
  })
})

// ── A COLUNA QUE NÃO PODE PASSAR ─────────────────────────────────────────

describe('o saldo de estoque tem um escritor só', () => {
  test('ESTOQUE NÃO É EDITÁVEL PELA ROTA DE CADASTRO', () => {
    // `produtos.estoque` é movida pelo CAS de `_ajustarEstoqueCAS`, junto com
    // `produto_estoque.quantidade` e `estoque_movimentacoes`. Um segundo
    // caminho gravando a mesma coluna sem CAS, sem movimentação e sem espelho
    // no depósito é literalmente como a divergência de 13/09/2026 nasceu — a
    // que custou a reconciliação de 472 produtos.
    const v = validarAtualizacaoProduto({ estoque: 999, nome: 'CAFE' })
    assert.equal(v.ok, true)
    if (!v.ok) return
    assert.deepEqual(Object.keys(v.dados), ['nome'])
    assert.equal('estoque' in v.dados, false)
  })

  test('nenhum campo proibido atravessa', () => {
    const corpo: Record<string, unknown> = { nome: 'CAFE' }
    for (const c of CAMPOS_PROIBIDOS) corpo[c] = 'x'
    const v = validarAtualizacaoProduto(corpo)
    assert.equal(v.ok, true)
    if (!v.ok) return
    for (const c of CAMPOS_PROIBIDOS) assert.equal(c in v.dados, false, c + ' passou')
  })

  test('só campos proibidos = nada para atualizar, não UPDATE vazio', () => {
    assert.equal(validarAtualizacaoProduto({ estoque: 10, ativo: false }).ok, false)
  })
})

describe('editar de verdade continua possível', () => {
  test('fiscal e comercial passam', () => {
    const v = validarAtualizacaoProduto({
      nome: 'CAFE 500G', ncm: '09011110', preco_venda: 19.9,
      preco_custo: 12, disponivel_pdv: false, icms_origem: 0,
    })
    assert.equal(v.ok, true)
    if (!v.ok) return
    assert.equal(v.dados.preco_venda, 19.9)
    assert.equal(v.dados.disponivel_pdv, false)
    assert.equal(v.dados.icms_origem, 0)
  })

  test('NULO É DIFERENTE DE AUSENTE — é assim que se limpa um NCM errado', () => {
    // O legado distingue com `if (dados.x !== undefined)`. Tratar null como
    // "não falou" tornaria impossível apagar um campo fiscal digitado errado.
    const v = validarAtualizacaoProduto({ ncm: null })
    assert.equal(v.ok, true)
    if (!v.ok) return
    assert.deepEqual(v.dados, { ncm: null })
  })

  test('campo ausente não vira null', () => {
    const v = validarAtualizacaoProduto({ nome: 'CAFE' })
    assert.equal(v.ok, true)
    if (!v.ok) return
    assert.deepEqual(Object.keys(v.dados), ['nome'])
  })

  test('nome em branco é recusa, não apagar o produto da busca', () => {
    assert.equal(validarAtualizacaoProduto({ nome: '   ' }).ok, false)
  })

  test('número inválido é recusa, não NaN no banco', () => {
    assert.equal(validarAtualizacaoProduto({ preco_venda: 'quase vinte' }).ok, false)
  })
})

// ── O SNAPSHOT ───────────────────────────────────────────────────────────

describe('o snapshot não é select(*)', () => {
  const rota = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/pdv/produtos/route.ts'), 'utf8',
  )

  test('a lista de colunas é explícita', () => {
    assert.ok(!/\.select\('\*'\)/.test(rota), 'voltou a usar select(*)')
    assert.match(rota, /const CAMPOS_SNAPSHOT = \[/)
  })

  test('TODA COLUNA QUE O PDV CONSOME ESTÁ NA LISTA', () => {
    // Se `mapProduto` no PDV ler um campo que não sai daqui, o terminal
    // recebe `undefined` e o default do map entra no lugar — sem erro. Um
    // preço que vira 0, um `ativo` que vira true. É por isso que a lista é
    // comparada campo a campo em vez de "confiar que está tudo lá".
    const consumidos = [
      'id', 'nome', 'sku', 'ean', 'preco_venda', 'preco_custo', 'unidade',
      'categoria', 'marca', 'foto_url', 'ativo', 'disponivel_pdv',
      'permite_fracao', 'updated_at', 'estoque', 'estoque_minimo',
      'ncm', 'cfop', 'icms_cst', 'icms_origem', 'pis_cst', 'cofins_cst',
      'tags', 'preco_promocional', 'promocao_ativa', 'promocao_inicio',
      'promocao_fim',
    ]
    const lista = rota.slice(rota.indexOf('const CAMPOS_SNAPSHOT'), rota.indexOf('].join'))
    for (const campo of consumidos) {
      assert.match(lista, new RegExp("'" + campo + "'"), 'falta ' + campo + ' no snapshot')
    }
  })

  test('O SNAPSHOT NÃO FILTRA POR ATIVO', () => {
    // Um produto inativado no ERP precisa continuar chegando (o `updated_at`
    // mudou) para o terminal receber a baixa e parar de vender. Filtrar aqui
    // deixaria o produto inativado vendável para sempre em todo terminal que
    // já o tinha.
    const get = rota.slice(rota.indexOf('export async function GET'), rota.indexOf('export async function PATCH'))
    assert.ok(!/eq\('ativo'/.test(get), 'o snapshot passou a filtrar por ativo')
  })

  test('a contagem, essa sim, só conta os ativos', () => {
    const contagem = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/pdv/produtos/contagem/route.ts'), 'utf8',
    )
    assert.match(contagem, /eq\('ativo', true\)/)
    assert.match(contagem, /head: true/)
  })
})
