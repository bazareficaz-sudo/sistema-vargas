import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decidirAcesso, type LinhaTerminalAcesso } from '../../src/lib/pdv/decidirAcesso'
import { validarCliente, validarAtualizacaoCliente } from '../../src/lib/pdv/payloadCliente'
import {
  chaveNome, soDigitos, mesmoCliente, escolherCliente, seguirMesclado,
  camposParaCompletar, type ClienteComparavel,
} from '../../src/lib/pdv/resolverCliente'

// O CONTRATO DA ROTA DE CLIENTES.
//
// A regra de "é a mesma pessoa" está saindo do terminal e vindo para o
// servidor. Se a versão de cá divergir da de lá, nada dá erro: nascem
// cadastros duplicados, que é o que aconteceu em 07/08 (8 cópias) e em 24/08
// (33 cópias), todas no mesmo minuto.
//
// Então os casos que DEFINEM a regra viram teste, com o nome do caso real.

const EMPRESA_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TERMINAL_A = '11111111-1111-1111-1111-111111111111'

const CLAIMS = {
  sub: TERMINAL_A, terminal_id: TERMINAL_A, empresa_id: EMPRESA_A,
  tenant_id: null, tipo: 'pdv_terminal' as const, iat: 0, exp: 9_999_999_999,
}

const TERMINAL: LinhaTerminalAcesso = {
  id: TERMINAL_A, empresa_id: EMPRESA_A, status: 'ativo',
  nome: 'Caixa', versao_pdv: '1.10.1', usar_rotas_novas: true,
  rotas_habilitadas: { clientes: true },
}

const acesso = (over: Partial<LinhaTerminalAcesso> = {}, operacao = 'clientes') =>
  decidirAcesso({
    claims: CLAIMS, terminal: { ...TERMINAL, ...over },
    tenantId: null, empresaAtiva: true, exigirFlag: true, operacao,
  })

describe('rollout — clientes é mais uma flag, não um pacote', () => {
  test('terminal com clientes ligada passa', () => {
    assert.equal(acesso().ok, true)
  })

  test('FALTAS LIGADA NÃO LIBERA CLIENTES', () => {
    const a = acesso({ rotas_habilitadas: { faltas: true, orcamentos: true } })
    assert.equal(a.ok, false)
    if (a.ok) return
    assert.equal(a.motivo, 'rota_desligada')
    assert.equal(a.status, 409)
  })

  test('o booleano antigo não libera clientes', () => {
    // `usar_rotas_novas` está true em todo o parque desde a 0.6A. Se ele
    // valesse aqui, a rota teria ligado sozinha em todos os terminais no
    // instante do deploy — e a primeira venda de balcão seria o teste.
    const a = acesso({ rotas_habilitadas: null })
    assert.equal(a.ok, false)
  })
})

// ── A REGRA, PELOS CASOS QUE A CRIARAM ───────────────────────────────────

describe('é a mesma pessoa?', () => {
  test('THAINÁ = THAINA — um til não abre cadastro', () => {
    // Foi por isto que a busca NÃO usa `ilike` no banco: `ilike 'Thainá%'`
    // não encontra a linha gravada como "THAINA".
    assert.equal(chaveNome('Thainá'), chaveNome('THAINA'))
    assert.equal(mesmoCliente({ nome: 'Thainá' }, { nome: 'THAINA' }), true)
  })

  test('espaço a mais não abre cadastro', () => {
    assert.equal(chaveNome('  JOAO   DA  SILVA '), 'JOAO DA SILVA')
  })

  test('SILVANO e SILVANO VARGAS são pessoas diferentes', () => {
    // Mesmo telefone, nomes diferentes: gente de casa dividindo o número.
    // O nome é que separa — não o telefone.
    assert.equal(
      mesmoCliente(
        { nome: 'SILVANO', telefone: '(11) 99999-0000' },
        { nome: 'SILVANO VARGAS', telefone: '11999990000' },
      ),
      false,
    )
  })

  test('TELEFONE VAZIO DE UM LADO NÃO SEPARA', () => {
    // Este é o caso que encheu o sistema web de cópias: o cadastro remoto
    // veio sem telefone, o local tinha, e o par parecia gente diferente a
    // cada rodada da fila.
    assert.equal(
      mesmoCliente({ nome: 'MARIA', telefone: '11988887777' }, { nome: 'MARIA', telefone: null }),
      true,
    )
  })

  test('telefone diferente com nome igual separa', () => {
    assert.equal(
      mesmoCliente({ nome: 'MARIA', telefone: '11988887777' }, { nome: 'MARIA', telefone: '11911112222' }),
      false,
    )
  })

  test('CPF diferente separa mesmo com nome e telefone iguais', () => {
    assert.equal(
      mesmoCliente(
        { nome: 'MARIA', telefone: '11988887777', cpf_cnpj: '111.111.111-11' },
        { nome: 'MARIA', telefone: '11988887777', cpf_cnpj: '222.222.222-22' },
      ),
      false,
    )
  })

  test('máscara não é dado: 123.456.789-00 é 12345678900', () => {
    assert.equal(soDigitos('123.456.789-00'), '12345678900')
    assert.equal(
      mesmoCliente({ nome: 'ANA', cpf_cnpj: '123.456.789-00' }, { nome: 'ANA', cpf_cnpj: '12345678900' }),
      true,
    )
  })
})

describe('quem escolher na lista da empresa', () => {
  const lista: ClienteComparavel[] = [
    { id: 'c1', nome: 'ANA PAULA', telefone: '11911110000', cpf_cnpj: null },
    { id: 'c2', nome: 'ANNA PAULA SOUZA', telefone: null, cpf_cnpj: '12345678900' },
    { id: 'c3', nome: 'JOSE', telefone: null, cpf_cnpj: null },
  ]

  test('O CPF GANHA DO NOME', () => {
    // "Anna Paula Souza" no sistema, "Ana Paula S." no balcão: nomes que não
    // batem, mesma pessoa. O documento é identidade; o nome é digitação.
    const achado = escolherCliente({ nome: 'Ana Paula S.', cpf_cnpj: '123.456.789-00' }, lista)
    assert.equal(achado?.id, 'c2')
  })

  test('sem CPF, cai no nome + compatibilidade', () => {
    assert.equal(escolherCliente({ nome: 'ana paula', telefone: '11911110000' }, lista)?.id, 'c1')
  })

  test('ninguém compatível devolve nulo — aí sim nasce cadastro', () => {
    assert.equal(escolherCliente({ nome: 'CLIENTE NOVO' }, lista), null)
  })

  test('cadastro sem nome não pode casar com quem também não tem', () => {
    // `chaveNome(null) === chaveNome(undefined) === ''`, e sem esta guarda
    // duas linhas sem nome seriam "a mesma pessoa". A rota recusa antes: o
    // payload exige nome.
    assert.equal(validarCliente({}).ok, false)
  })
})

describe('seguir a unificação até o sobrevivente', () => {
  const porId = new Map<string, ClienteComparavel>([
    ['a', { id: 'a', nome: 'ANA', mesclado_em: 'b' }],
    ['b', { id: 'b', nome: 'ANA', mesclado_em: 'c' }],
    ['c', { id: 'c', nome: 'ANA', mesclado_em: null }],
  ])

  test('devolve o vivo, não o mesclado', () => {
    // Devolver `a` faria a venda nascer pendurada num cliente morto — e como
    // o snapshot só traz ativos, o terminal nunca mais saberia daquela linha.
    assert.equal(seguirMesclado(porId.get('a')!, porId).id, 'c')
  })

  test('CICLO NÃO TRAVA A REQUISIÇÃO', () => {
    // A→B→A existe quando duas unificações são feitas em sentidos opostos.
    // Sem a proteção, é laço infinito dentro do request.
    const ciclo = new Map<string, ClienteComparavel>([
      ['x', { id: 'x', mesclado_em: 'y' }],
      ['y', { id: 'y', mesclado_em: 'x' }],
    ])
    assert.equal(seguirMesclado(ciclo.get('x')!, ciclo).id, 'y')
  })

  test('salto para fora do mapa para onde está, não explode', () => {
    const solto = new Map<string, ClienteComparavel>([['z', { id: 'z', mesclado_em: 'fora' }]])
    assert.equal(seguirMesclado(solto.get('z')!, solto).id, 'z')
  })
})

describe('completar o que falta, nunca sobrescrever', () => {
  test('preenche o vazio do remoto com o que o balcão digitou', () => {
    const c = camposParaCompletar(
      { id: 'c1', nome: 'ANA', telefone: null, cpf_cnpj: null },
      { nome: 'ANA', telefone: '11911110000', cpf_cnpj: '12345678900' },
    )
    assert.deepEqual(c, { telefone: '11911110000', cpf_cnpj: '12345678900' })
  })

  test('NÃO DESFAZ CORREÇÃO FEITA NO ERP', () => {
    // O terminal pode estar com cache velho. Se ele pudesse sobrescrever, uma
    // correção de CPF feita no sistema web voltaria ao valor errado na próxima
    // vez que o cliente comprasse.
    const c = camposParaCompletar(
      { id: 'c1', nome: 'ANA', telefone: '11922223333', cpf_cnpj: '99999999999' },
      { nome: 'ANA', telefone: '11911110000', cpf_cnpj: '12345678900' },
    )
    assert.deepEqual(c, {})
  })
})

// ── O QUE O PDV PODE DIZER ───────────────────────────────────────────────

describe('payload de cadastro', () => {
  test('nome é obrigatório', () => {
    assert.equal(validarCliente({ nome: '   ' }).ok, false)
  })

  test('vazio vira nulo, não string vazia', () => {
    const v = validarCliente({ nome: 'ANA', telefone: '', email: '  ' })
    assert.equal(v.ok, true)
    if (!v.ok) return
    assert.equal(v.cliente.telefone, null)
    assert.equal(v.cliente.email, null)
  })

  test('CAMPO FORA DA LISTA NÃO CHEGA NO BANCO', () => {
    // `mesclado_em`, `empresa_id`, `ativo`, `saldo_devedor`: o legado mandava
    // o objeto inteiro num `.update(dados)`. Aqui a lista é fechada.
    const v = validarCliente({ nome: 'ANA', mesclado_em: 'outro', ativo: false, saldo_devedor: 999 })
    assert.equal(v.ok, true)
    if (!v.ok) return
    assert.deepEqual(Object.keys(v.cliente).sort(), [
      'cpf_cnpj', 'email', 'limite_credito', 'nome', 'saldo_credito', 'telefone',
    ])
  })
})

describe('payload de edição — só contato e entrega', () => {
  test('NOME E CPF NÃO SÃO EDITÁVEIS PELO PDV', () => {
    // Mudar o nome mudaria a chave que `mesmoCliente` usa para reconhecer a
    // pessoa, e o cadastro seguinte nasceria como gente diferente.
    const v = validarAtualizacaoCliente({ nome: 'OUTRO NOME', cpf_cnpj: '11111111111', cidade: 'Bauru' })
    assert.equal(v.ok, true)
    if (!v.ok) return
    assert.deepEqual(Object.keys(v.dados), ['cidade'])
  })

  test('campo vazio não apaga endereço', () => {
    // O legado usava `if (dados[c])`. Passar a aceitar vazio agora seria
    // mudança de comportamento escondida dentro de uma troca de transporte.
    const v = validarAtualizacaoCliente({ cidade: 'Bauru', bairro: '' })
    assert.equal(v.ok, true)
    if (!v.ok) return
    assert.deepEqual(Object.keys(v.dados), ['cidade'])
  })

  test('nada para atualizar é recusa, não UPDATE vazio', () => {
    assert.equal(validarAtualizacaoCliente({ nome: 'X' }).ok, false)
  })
})
