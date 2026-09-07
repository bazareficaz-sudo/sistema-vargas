import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  decidirAcesso, conferirEmpresaDoCorpo, tokenDoCabecalho,
  type LinhaTerminalAcesso,
} from '../../src/lib/pdv/decidirAcesso'
import { assinarToken, verificarToken, verificarComRotacao } from '../../src/lib/pdv/terminalToken'
import { urlDeImpressaoValida } from '../../src/lib/pdv/urlImpressao'

// A cadeia que a Fase 0.6B precisa provar:
//
//   token válido → terminal identificado → empresa determinada pelo servidor
//   → operação autorizada
//
// Cada elo tem aqui um teste do que acontece quando ele FALHA, porque é a
// falha que precisa estar certa.

const EMPRESA_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const EMPRESA_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const TERMINAL_A = '11111111-1111-1111-1111-111111111111'

const CLAIMS = {
  sub: TERMINAL_A, terminal_id: TERMINAL_A, empresa_id: EMPRESA_A,
  tenant_id: null, tipo: 'pdv_terminal' as const, iat: 0, exp: 9_999_999_999,
}

const TERMINAL: LinhaTerminalAcesso = {
  id: TERMINAL_A, empresa_id: EMPRESA_A, status: 'ativo',
  nome: 'Balcão 1', versao_pdv: '1.8.24', usar_rotas_novas: true,
}

function acesso(over: {
  claims?: typeof CLAIMS | null
  terminal?: Partial<LinhaTerminalAcesso> | null
  empresaAtiva?: boolean
  exigirFlag?: boolean
} = {}) {
  return decidirAcesso({
    claims: over.claims === undefined ? CLAIMS : over.claims,
    terminal: over.terminal === null ? null : { ...TERMINAL, ...(over.terminal ?? {}) },
    tenantId: null,
    empresaAtiva: over.empresaAtiva ?? true,
    exigirFlag: over.exigirFlag ?? true,
  })
}

describe('acesso do terminal a uma operação protegida', () => {
  test('token válido de terminal liberado passa', () => {
    const a = acesso()
    assert.equal(a.ok, true)
    if (!a.ok) return
    assert.equal(a.contexto.empresa_id, EMPRESA_A)
    assert.equal(a.contexto.terminal_id, TERMINAL_A)
  })

  test('SEM TOKEN não passa', () => {
    const a = acesso({ claims: null })
    assert.equal(a.ok, false)
    if (a.ok) return
    assert.equal(a.status, 401)
  })

  test('TERMINAL REVOGADO não passa, mesmo com token ainda válido', () => {
    // O token dura 12 h. Revogar não o apaga — quem barra é esta checagem,
    // refeita a cada requisição contra o estado atual do banco.
    const a = acesso({ terminal: { status: 'revogado' } })
    assert.equal(a.ok, false)
    if (a.ok) return
    assert.equal(a.motivo, 'terminal_revogado')
    assert.equal(a.status, 403)
  })

  test('terminal que sumiu do banco não passa', () => {
    const a = acesso({ terminal: null })
    assert.equal(a.ok, false)
    if (a.ok) return
    assert.equal(a.motivo, 'terminal_desconhecido')
  })

  test('terminal ainda não ativado não passa', () => {
    const a = acesso({ terminal: { status: 'aguardando_ativacao' } })
    assert.equal(a.ok, false)
  })

  test('empresa inativa derruba o terminal junto', () => {
    const a = acesso({ empresaAtiva: false })
    assert.equal(a.ok, false)
    if (a.ok) return
    assert.equal(a.motivo, 'empresa_inativa')
  })

  test('TERMINAL DA EMPRESA A NÃO OPERA NA B', () => {
    // Token dizendo empresa A, linha do banco dizendo empresa B. Em operação
    // normal é impossível — só acontece se a assinatura vazou ou se o terminal
    // mudou de empresa depois da emissão. Nos dois casos, seguir seria
    // escrever na empresa errada.
    const a = acesso({ terminal: { empresa_id: EMPRESA_B } })
    assert.equal(a.ok, false)
    if (a.ok) return
    assert.equal(a.motivo, 'empresa_divergente')
  })

  test('a empresa devolvida vem do BANCO, não do token', () => {
    // Prova estrutural: se o contexto copiasse a claim, este teste passaria
    // com o valor errado. Ele exige que o valor venha da linha.
    const a = decidirAcesso({
      claims: { ...CLAIMS, empresa_id: EMPRESA_A },
      terminal: { ...TERMINAL, empresa_id: EMPRESA_A },
      tenantId: 'tenant-1', empresaAtiva: true, exigirFlag: true,
    })
    assert.equal(a.ok, true)
    if (!a.ok) return
    assert.equal(a.contexto.empresa_id, TERMINAL.empresa_id)
  })

  test('FEATURE FLAG DESLIGADA: recusa com 409, não com erro de credencial', () => {
    // 409 e não 403 porque não é falta de permissão — é rollout. O PDV lê o
    // motivo e volta ao caminho legado sem tratar como incidente.
    const a = acesso({ terminal: { usar_rotas_novas: false } })
    assert.equal(a.ok, false)
    if (a.ok) return
    assert.equal(a.motivo, 'rota_desligada')
    assert.equal(a.status, 409)
  })

  test('flag desligada ainda permite rota que não a exige', () => {
    const a = acesso({ terminal: { usar_rotas_novas: false }, exigirFlag: false })
    assert.equal(a.ok, true)
  })

  test('flag nula conta como desligada', () => {
    const a = acesso({ terminal: { usar_rotas_novas: null as unknown as boolean } })
    assert.equal(a.ok, false)
  })
})

describe('empresa no corpo da requisição', () => {
  const ctx = {
    terminal_id: TERMINAL_A, empresa_id: EMPRESA_A, tenant_id: null,
    nome: 'Balcão 1', status: 'ativo' as const, versao_pdv: null,
    usar_rotas_novas: true, claims: CLAIMS,
  }

  test('TOKEN EMPRESA A + BODY EMPRESA B = 403', () => {
    const r = conferirEmpresaDoCorpo(ctx, EMPRESA_B)
    assert.notEqual(r, null)
    if (!r || r.ok) return
    assert.equal(r.status, 403)
    assert.equal(r.motivo, 'empresa_divergente')
  })

  test('corpo sem empresa é o caminho normal', () => {
    for (const v of [undefined, null, '']) {
      assert.equal(conferirEmpresaDoCorpo(ctx, v), null)
    }
  })

  test('corpo com a mesma empresa passa', () => {
    assert.equal(conferirEmpresaDoCorpo(ctx, EMPRESA_A), null)
  })
})

describe('de onde o token pode vir', () => {
  const req = (h: Record<string, string>) => new Request('https://x/api', { headers: h })

  test('lê do cabeçalho Authorization', () => {
    assert.equal(tokenDoCabecalho(req({ authorization: 'Bearer abc.def.ghi' })), 'abc.def.ghi')
    assert.equal(tokenDoCabecalho(req({ authorization: 'bearer abc.def.ghi' })), 'abc.def.ghi')
  })

  test('NÃO lê de query string', () => {
    // Token em URL vaza por log de acesso, histórico, Referer e relatório de
    // proxy. Não há como usar com cuidado.
    const r = new Request('https://x/api?token=abc.def.ghi&access_token=abc')
    assert.equal(tokenDoCabecalho(r), null)
  })

  test('cabeçalho sem Bearer não vale', () => {
    assert.equal(tokenDoCabecalho(req({ authorization: 'abc.def.ghi' })), null)
    assert.equal(tokenDoCabecalho(req({ authorization: 'Basic dXNlcjpwYXNz' })), null)
  })

  test('sem cabeçalho, nada', () => {
    assert.equal(tokenDoCabecalho(req({})), null)
  })
})

describe('revisão do JWT da 0.6A', () => {
  const SEGREDO = 'a'.repeat(48)
  const AGORA = 1_800_000_000
  const BASE = { sub: TERMINAL_A, terminal_id: TERMINAL_A, empresa_id: EMPRESA_A, tenant_id: null, tipo: 'pdv_terminal' as const }

  test('ALG: NONE é rejeitado', () => {
    // O ataque clássico: trocar o header por {"alg":"none"} e apagar a
    // assinatura. Aqui ele morre na comparação do HMAC, antes mesmo da
    // checagem explícita de `alg` — as duas barreiras são independentes.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ ...BASE, iat: AGORA, exp: AGORA + 999 })).toString('base64url')
    const v = verificarToken(`${header}.${payload}.`, SEGREDO, AGORA)
    assert.equal(v.ok, false)
  })

  test('header dizendo RS256 não muda a verificação', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ ...BASE, iat: AGORA, exp: AGORA + 999 })).toString('base64url')
    const v = verificarToken(`${header}.${payload}.qualquercoisa`, SEGREDO, AGORA)
    assert.equal(v.ok, false)
  })

  test('CLAIMS OBRIGATÓRIAS: token nosso, mas sem terminal_id, é recusado', () => {
    // Assinado por nós, então a assinatura confere. Sem esta checagem, quem
    // chama sairia consultando o banco por `undefined`.
    const semTerminal = assinarToken(
      { ...BASE, terminal_id: '' } as Parameters<typeof assinarToken>[0], SEGREDO, AGORA)
    const v = verificarToken(semTerminal, SEGREDO, AGORA + 1)
    assert.equal(v.ok, false)
    if (v.ok) return
    assert.equal(v.erro, 'claims')
  })

  test('sem empresa_id também é recusado', () => {
    const semEmpresa = assinarToken(
      { ...BASE, empresa_id: '' } as Parameters<typeof assinarToken>[0], SEGREDO, AGORA)
    assert.equal(verificarToken(semEmpresa, SEGREDO, AGORA + 1).ok, false)
  })

  test('ROTAÇÃO: token do segredo anterior continua valendo na janela', () => {
    const antigo = 'b'.repeat(48)
    const t = assinarToken(BASE, antigo, AGORA)
    // Só com o novo: não vale.
    assert.equal(verificarComRotacao(t, [SEGREDO], AGORA + 1).ok, false)
    // Com novo + anterior: vale.
    assert.equal(verificarComRotacao(t, [SEGREDO, antigo], AGORA + 1).ok, true)
  })

  test('rotação não ressuscita token expirado', () => {
    const antigo = 'b'.repeat(48)
    const t = assinarToken(BASE, antigo, AGORA)
    const v = verificarComRotacao(t, [SEGREDO, antigo], AGORA + 60 * 60 * 24)
    assert.equal(v.ok, false)
    if (v.ok) return
    assert.equal(v.erro, 'expirado')
  })

  test('rotação com lista vazia recusa', () => {
    assert.equal(verificarComRotacao(assinarToken(BASE, SEGREDO, AGORA), [], AGORA + 1).ok, false)
  })
})

describe('URL do servidor de impressão', () => {
  // Quem escreve aqui está dizendo aos OUTROS terminais para onde falar.
  test('aceita http e https', () => {
    assert.equal(urlDeImpressaoValida('https://algo.trycloudflare.com'), true)
    assert.equal(urlDeImpressaoValida('http://192.168.0.10:3001'), true)
  })

  test('recusa esquema que não seja http(s)', () => {
    for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'ftp://x.com']) {
      assert.equal(urlDeImpressaoValida(u), false, `aceitou ${u}`)
    }
  })

  test('recusa credencial embutida na URL', () => {
    assert.equal(urlDeImpressaoValida('https://user:senha@malicioso.com'), false)
  })

  test('recusa vazio, lixo e tamanho absurdo', () => {
    for (const u of ['', '   ', 'nao-e-url', 'https://' + 'a'.repeat(600), null, 42]) {
      assert.equal(urlDeImpressaoValida(u), false)
    }
  })
})
