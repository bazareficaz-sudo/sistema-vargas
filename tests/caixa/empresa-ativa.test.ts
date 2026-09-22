import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { podeOperarEmpresa, contextoCaixa } from '../../src/lib/caixa/contextoCaixa'

// FASE 1.1 — O CAIXA OPERA A EMPRESA ATIVA, NÃO A DO CADASTRO.
//
// A Fase 1 usou `exigirPermissao`, que lê `profiles.empresa_id` direto e
// ignora o seletor de empresa. O operador trocava para a segunda empresa,
// abria o Caixa e lançava dinheiro na primeira — num ledger append-only,
// onde a correção é estorno e o erro fica no histórico para sempre.
//
// Estes testes fixam as duas metades da correção: a regra de qual empresa
// vale, e a garantia de que o navegador não escolhe empresa nenhuma.

const A = 'a1000000-0000-0000-0000-000000000001'   // Bazar Eficaz
const B = '681ab72f-fd5b-4de9-8623-59eeb32e6d18'   // BAZAR OURO E PRATA
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'   // empresa sem vínculo

describe('a regra de qual empresa o Caixa pode operar', () => {
  test('1. usuário na Empresa A opera o Caixa A', () => {
    assert.equal(podeOperarEmpresa(A, A, [A, B]), true)
  })

  test('2. trocou para a Empresa B: opera o Caixa B', () => {
    assert.equal(podeOperarEmpresa(B, A, [A, B]), true)
  })

  test('3. voltou para A: opera o Caixa A de novo', () => {
    assert.equal(podeOperarEmpresa(A, A, [A, B]), true)
  })

  test('5. empresa sem vínculo é recusada', () => {
    assert.equal(podeOperarEmpresa(C, A, [A, B]), false)
  })

  test('7. quem tem acesso às duas opera as duas, uma de cada vez', () => {
    assert.equal(podeOperarEmpresa(A, A, [A, B]), true)
    assert.equal(podeOperarEmpresa(B, A, [A, B]), true)
    assert.equal(podeOperarEmpresa(C, A, [A, B]), false)
  })

  test('A EMPRESA DO CADASTRO VALE MESMO SEM LINHA EM usuario_empresas', () => {
    // Não é frouxidão: `usuario_empresas` só é preenchida para quem opera
    // mais de uma empresa. Há um gerente ativo hoje com zero vínculos.
    // Exigir vínculo sempre o expulsaria do Caixa da própria empresa.
    assert.equal(podeOperarEmpresa(A, A, []), true)
  })

  test('mas uma OUTRA empresa exige vínculo, mesmo sem vínculo nenhum', () => {
    assert.equal(podeOperarEmpresa(B, A, []), false)
  })

  test('sem empresa alguma resolvida, recusa — nunca "qualquer uma"', () => {
    assert.equal(podeOperarEmpresa(null, A, [A]), false)
    assert.equal(podeOperarEmpresa(undefined, A, [A]), false)
    assert.equal(podeOperarEmpresa('', A, [A]), false)
  })

  test('cadastro nulo não vira curinga', () => {
    // Se `profiles.empresa_id` fosse nulo e o alvo também, `alvo ===
    // doCadastro` seria true por acidente. O guard de `!alvo` fecha isso.
    assert.equal(podeOperarEmpresa(null, null, []), false)
  })
})

// ── O navegador não escolhe empresa ──────────────────────────────────────
//
// A prova aqui é estrutural, não de execução: as rotas não têm por onde
// receber uma empresa. Se um dia alguém acrescentar `empresa_id` ao corpo,
// estes testes quebram.
describe('4. forçar outra empresa pela requisição não tem por onde entrar', () => {
  const raiz = path.join(__dirname, '..', '..')
  const rotas = [
    'src/app/api/caixa/tesouraria/route.ts',
    'src/app/api/caixa/tesouraria/movimentos/route.ts',
    'src/app/api/caixa/tesouraria/movimentos/[id]/estornar/route.ts',
  ]
  const fonte = (p: string) => fs.readFileSync(path.join(raiz, p), 'utf8')

  for (const r of rotas) {
    test(`${r.split('/').slice(-2).join('/')} — toda empresa citada vem do guard`, () => {
      // Cada linha que fala de empresa tem de falar de `guarda.empresaId`.
      // É a asserção que pega o caso perigoso — `empresa_id: payload.empresa_id`
      // — sem depender de contar ocorrências, que o próprio
      // `guarda.empresaId` faz casar duas vezes.
      const suspeitas = fonte(r).split('\n')
        .filter(l => /empresa_?[iI]d/.test(l))
        .filter(l => !l.includes('guarda.empresaId'))
      assert.deepEqual(suspeitas, [],
        'linha que menciona empresa sem ser a do contexto validado')
    })

    test(`${r.split('/').slice(-2).join('/')} — o corpo da requisição não carrega empresa`, () => {
      const s = fonte(r)
      assert.equal(/payload\.empresa|body\.empresa|searchParams\.get\(['"]empresa/.test(s), false,
        'empresa escolhida pelo navegador é exatamente o que esta fase removeu')
    })

    test(`${r.split('/').slice(-2).join('/')} — não usa mais exigirPermissao`, () => {
      assert.equal(/exigirPermissao/.test(fonte(r)), false,
        'exigirPermissao lê profiles.empresa_id direto e ignora o seletor de empresa')
    })

    test(`${r.split('/').slice(-2).join('/')} — o guard é a PRIMEIRA coisa depois do client`, () => {
      const s = fonte(r)
      const g = s.indexOf('await contextoCaixa(sb)')
      assert.notEqual(g, -1)
      const antes = s.slice(0, g)
      assert.equal(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(antes), false,
        'nenhuma escrita pode acontecer antes de a empresa estar validada')
    })
  }

  test('o Caixa lê a empresa por perfilDaSessao, não de profiles direto', () => {
    // É esta linha que liga o Caixa ao seletor de empresa: `perfilDaSessao`
    // é quem lê o cookie httpOnly e o confere contra `usuario_empresas`.
    // Trocar isto por um SELECT em `profiles` reintroduz exatamente o
    // defeito que a Fase 1.1 corrigiu — daí o teste ser sobre a chamada.
    const ctx = fs.readFileSync(path.join(raiz, 'src/lib/caixa/contextoCaixa.ts'), 'utf8')
    assert.match(ctx, /await perfilDaSessao\(sb, user\.id/)
    const i = ctx.indexOf('await perfilDaSessao(sb, user.id')
    const j = ctx.indexOf('podeOperarEmpresa(perfil.empresa_id')
    assert.ok(i !== -1 && j !== -1 && i < j,
      'a empresa é resolvida primeiro e reconferida depois')
  })

  test('contextoCaixa não aceita empresa por parâmetro', () => {
    // A assinatura é a garantia estrutural: não há por onde uma rota passar
    // uma empresa escolhida pelo cliente.
    const ctx = fs.readFileSync(path.join(raiz, 'src/lib/caixa/contextoCaixa.ts'), 'utf8')
    const assinatura = ctx.slice(ctx.indexOf('export async function contextoCaixa('))
      .slice(0, ctx.slice(ctx.indexOf('export async function contextoCaixa(')).indexOf('{'))
    assert.equal(/empresa/i.test(assinatura), false, assinatura)
  })

  test('o estorno só alcança movimento da empresa ativa', () => {
    const s = fonte('src/app/api/caixa/tesouraria/movimentos/[id]/estornar/route.ts')
    assert.match(s, /\.eq\('id', id\)\.eq\('empresa_id', guarda\.empresaId\)/,
      'sem o filtro de empresa, um id de outra empresa do grupo seria estornável')
  })
})

describe('6 e 8. quem não passa pelo portão', () => {
  // Dublê mínimo do cliente Supabase: só o que `contextoCaixa` chama.
  function sbFalso(opts: {
    user?: { id: string } | null
    profile?: { empresa_id: string | null; role: string; status?: string } | null
    vinculos?: string[]
    excecoes?: { codigo: string; permitido: boolean }[]
  }) {
    const { user = null, profile = null, vinculos = [], excecoes = [] } = opts
    return {
      auth: { getUser: async () => ({ data: { user } }) },
      from(tabela: string) {
        const api: any = {
          select: () => api, eq: () => api, order: () => api, limit: () => api,
          single: async () => ({ data: tabela === 'profiles' ? profile : null }),
          maybeSingle: async () => ({ data: null }),
          then: undefined,
        }
        if (tabela === 'usuario_empresas') {
          api.eq = () => ({ ...api, eq: async () => ({ data: vinculos.map(e => ({ empresa_id: e })) }) })
        }
        if (tabela === 'usuario_permissoes') {
          api.eq = async () => ({ data: excecoes })
        }
        return api
      },
    }
  }

  test('8. anon — sem sessão, 401 antes de qualquer consulta', async () => {
    const r = await contextoCaixa(sbFalso({ user: null }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.status, 401)
  })

  test('6. usuário sem gerenciar_financeiro recebe 403', async () => {
    // `vendas` é o papel mais restrito que ainda entra no sistema.
    const r = await contextoCaixa(sbFalso({
      user: { id: 'u1' },
      profile: { empresa_id: A, role: 'vendas', status: 'ativo' },
      vinculos: [A],
    }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.status, 403)
    assert.match(r.erro, /permissão/i)
  })

  test('usuário inativo é barrado mesmo tendo o papel certo', async () => {
    const r = await contextoCaixa(sbFalso({
      user: { id: 'u1' },
      profile: { empresa_id: A, role: 'admin', status: 'bloqueado' },
      vinculos: [A],
    }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.status, 403)
  })

  test('sem empresa no cadastro, 403 — nunca "segue sem empresa"', async () => {
    const r = await contextoCaixa(sbFalso({
      user: { id: 'u1' },
      profile: { empresa_id: null, role: 'admin', status: 'ativo' },
    }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.status, 403)
  })

  test('o financeiro passa, e a empresa que sai é a validada', async () => {
    const r = await contextoCaixa(sbFalso({
      user: { id: 'u1' },
      profile: { empresa_id: A, role: 'financeiro', status: 'ativo' },
      vinculos: [A],
    }))
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.empresaId, A)
    assert.equal(r.userId, 'u1')
  })

  test('a exceção por usuário derruba a permissão do papel também no servidor', async () => {
    const r = await contextoCaixa(sbFalso({
      user: { id: 'u1' },
      profile: { empresa_id: A, role: 'admin', status: 'ativo' },
      vinculos: [A],
      excecoes: [{ codigo: 'gerenciar_financeiro', permitido: false }],
    }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.status, 403)
  })
})
