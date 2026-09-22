import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  validarAbertura, validarFechamento, conferir, calcularEntrega,
  montarDemonstrativo, conferirDemonstrativo, categoriaDaNatureza,
  resumoAbertura, resumoFechamento, statusDoEstadoSessao,
  type MovimentoDaSessao,
} from '../../src/lib/caixa/sessao'

// FASE 3 — A SESSÃO.
//
// A conta que sustenta tudo é a continuidade física da gaveta: depois de um
// fechamento, o que o sistema diz que ficou lá tem de ser exatamente o
// troco, para a próxima abertura herdar sem inventar dinheiro.
//
// A autoridade é a RPC, que recalcula tudo dentro da transação. O que está
// aqui é a mesma aritmética, conferível sem banco.

const CAIXA = '11111111-1111-4111-8111-111111111111'
const ID = '22222222-2222-4222-8222-222222222222'

const abertura = (over = {}) => validarAbertura({
  id: ID, caixa_id: CAIXA, fundo_origem: 'herdado', fundo_inicial: 0, ...over,
})

describe('a conferência do fechamento', () => {
  test('contado igual ao esperado é conferido', () => {
    const r = conferir(2500, 2500)
    assert.equal(r.diferenca, 0)
    assert.equal(r.situacao, 'conferido')
  })

  test('contado menor é FALTA, e a diferença é negativa', () => {
    const r = conferir(2500, 2490)
    assert.equal(r.diferenca, -10)
    assert.equal(r.situacao, 'falta')
  })

  test('contado maior é SOBRA', () => {
    const r = conferir(2500, 2520)
    assert.equal(r.diferenca, 20)
    assert.equal(r.situacao, 'sobra')
  })

  test('a diferença é contado − esperado, nunca o contrário', () => {
    // O sinal importa: falta tem de ser negativa no registro, senão uma
    // falta de caixa viraria sobra no relatório.
    assert.ok(conferir(100, 90).diferenca < 0)
    assert.ok(conferir(90, 100).diferenca > 0)
  })

  test('centavos não acumulam erro de ponto flutuante', () => {
    assert.equal(conferir(0.1 + 0.2, 0.3).diferenca, 0)
  })
})

describe('quanto vai para a tesouraria', () => {
  test('é contado − troco', () => {
    assert.equal(calcularEntrega(2490, 300), 2190)
  })

  test('NÃO é esperado − troco', () => {
    // O exemplo do enunciado: esperado 2500, contado 2490, troco 300.
    // Usar o esperado entregaria 2200 — R$ 10 que não estão na gaveta.
    const esperado = 2500, contado = 2490, troco = 300
    assert.equal(calcularEntrega(contado, troco), 2190)
    assert.notEqual(calcularEntrega(contado, troco), esperado - troco)
  })

  test('SANGRIA DO DIA NÃO ENTRA NA CONTA', () => {
    // A armadilha da dupla transferência: durante o dia uma sangria de 1000
    // já saiu da gaveta e já entrou na tesouraria. No fechamento, o que sai
    // é só o que ainda está lá — o contado. Somar a sangria de novo
    // transferiria o mesmo dinheiro duas vezes.
    const contadoDepoisDaSangria = 500
    assert.equal(calcularEntrega(contadoDepoisDaSangria, 300), 200)
    assert.notEqual(calcularEntrega(contadoDepoisDaSangria, 300), 200 + 1000)
  })

  test('manter tudo como troco não entrega nada', () => {
    assert.equal(calcularEntrega(300, 300), 0)
  })

  test('não manter nada entrega tudo', () => {
    assert.equal(calcularEntrega(300, 0), 300)
  })

  test('A CONTINUIDADE: o que fica na gaveta é exatamente o troco', () => {
    // contado − entrega = troco, sempre. É essa identidade que a próxima
    // abertura herda.
    for (const [contado, troco] of [[2490, 300], [100, 100], [500, 0], [0, 0]]) {
      assert.equal(contado - calcularEntrega(contado, troco), troco)
    }
  })
})

describe('validação do fechamento', () => {
  test('fechamento normal passa', () => {
    const r = validarFechamento({ valor_contado: 2490, valor_mantido_troco: 300 })
    assert.equal(r.ok, true)
  })

  test('sem valor contado é recusado', () => {
    assert.equal(validarFechamento({}).ok, false)
    assert.equal(validarFechamento({ valor_contado: '' }).ok, false)
  })

  test('contado zero é válido — a gaveta pode estar vazia', () => {
    const r = validarFechamento({ valor_contado: 0 })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.valor.valor_mantido_troco, 0)
  })

  test('contado negativo é recusado', () => {
    assert.equal(validarFechamento({ valor_contado: -10 }).ok, false)
  })

  test('MANTER MAIS TROCO DO QUE O CONTADO É RECUSADO', () => {
    // Senão a entrega ficaria negativa, e a tesouraria "devolveria"
    // dinheiro que ninguém entregou.
    const r = validarFechamento({ valor_contado: 100, valor_mantido_troco: 500 })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.erro, /mais troco/)
  })

  test('troco ausente vira zero', () => {
    const r = validarFechamento({ valor_contado: 100 })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.valor.valor_mantido_troco, 0)
  })
})

describe('validação da abertura', () => {
  test('o ID é obrigatório — sem ele não há idempotência', () => {
    const r = validarAbertura({ caixa_id: CAIXA, fundo_origem: 'herdado', fundo_inicial: 0 })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.erro, /dentificador/)
  })

  test('herdado com zero é válido — gaveta vazia abre', () => {
    assert.equal(abertura({ fundo_origem: 'herdado', fundo_inicial: 0 }).ok, true)
  })

  test('origem inválida é recusada', () => {
    assert.equal(abertura({ fundo_origem: 'sei_la' }).ok, false)
    assert.equal(abertura({ fundo_origem: '' }).ok, false)
  })

  test('fundo negativo é recusado', () => {
    assert.equal(abertura({ fundo_inicial: -1 }).ok, false)
  })

  test('tesouraria com zero é recusada — não se transfere nada', () => {
    assert.equal(abertura({ fundo_origem: 'tesouraria', fundo_inicial: 0 }).ok, false)
  })

  test('MANUAL SEM EXPLICAÇÃO É RECUSADO', () => {
    // É a única porta pela qual dinheiro entra sem contraparte. Sem
    // justificativa, viraria uma forma de criar dinheiro sem auditoria.
    const r = abertura({ fundo_origem: 'manual', fundo_inicial: 200 })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.erro, /explica/i)
  })

  test('manual com explicação passa', () => {
    assert.equal(abertura({
      fundo_origem: 'manual', fundo_inicial: 200, observacao: 'troco que já estava na gaveta',
    }).ok, true)
  })

  test('manual com zero não exige explicação — nada entra', () => {
    assert.equal(abertura({ fundo_origem: 'manual', fundo_inicial: 0 }).ok, true)
  })

  test('herdado NÃO exige explicação — o dinheiro já está no ledger', () => {
    assert.equal(abertura({ fundo_origem: 'herdado', fundo_inicial: 300 }).ok, true)
  })
})

describe('o demonstrativo', () => {
  const movs: MovimentoDaSessao[] = [
    { tipo: 'entrada', natureza: 'fundo_abertura', valor: 200 },
    { tipo: 'entrada', natureza: 'suprimento', valor: 100 },
    { tipo: 'saida', natureza: 'sangria', valor: 50 },
    { tipo: 'saida', natureza: 'sangria', valor: 30 },
  ]

  test('agrupa por categoria e soma com sinal', () => {
    const d = montarDemonstrativo(movs)
    const porCat = Object.fromEntries(d.map(l => [l.categoria, l.valor]))
    assert.equal(porCat.fundo_abertura, 200)
    assert.equal(porCat.suprimento, 100)
    assert.equal(porCat.sangria, -80)
  })

  test('só mostra categorias que tiveram movimento', () => {
    const d = montarDemonstrativo(movs)
    assert.equal(d.find(l => l.categoria === 'venda_dinheiro'), undefined)
  })

  test('A CONTA FECHA com o saldo', () => {
    // 200 + 100 − 80 = 220
    const r = conferirDemonstrativo(0, movs, 220)
    assert.equal(r.ok, true)
    assert.equal(r.calculado, 220)
  })

  test('fundo herdado entra pelo saldo de abertura, não por movimento', () => {
    // Herdado não gera movimento: o dinheiro já estava no ledger.
    const r = conferirDemonstrativo(300, [{ tipo: 'saida', natureza: 'sangria', valor: 100 }], 200)
    assert.equal(r.ok, true)
  })

  test('acusa quando não fecha', () => {
    const r = conferirDemonstrativo(0, movs, 999)
    assert.equal(r.ok, false)
    assert.notEqual(r.diferenca, 0)
  })

  test('as categorias futuras já são reconhecidas', () => {
    // Nada as produz ainda, mas quando a integração vier o motor não pode
    // jogá-las em "outros" e sumir com o número.
    assert.equal(categoriaDaNatureza('venda_dinheiro'), 'venda_dinheiro')
    assert.equal(categoriaDaNatureza('recebimento_dinheiro'), 'recebimento_dinheiro')
    assert.equal(categoriaDaNatureza('devolucao_dinheiro'), 'devolucao_dinheiro')
    assert.equal(categoriaDaNatureza('pagamento_dinheiro'), 'pagamento_dinheiro')
  })

  test('natureza desconhecida cai em outros, e a conta continua fechando', () => {
    const m: MovimentoDaSessao[] = [{ tipo: 'entrada', natureza: 'algo_do_futuro', valor: 10 }]
    assert.equal(categoriaDaNatureza('algo_do_futuro'), 'outros')
    assert.equal(conferirDemonstrativo(0, m, 10).ok, true)
  })

  test('as naturezas da Fase 3 estão classificadas', () => {
    assert.equal(categoriaDaNatureza('fundo_abertura'), 'fundo_abertura')
    assert.equal(categoriaDaNatureza('diferenca_fechamento'), 'diferenca_fechamento')
  })
})

describe('as frases da tela', () => {
  test('tesouraria diz que o dinheiro sai de lá', () => {
    assert.match(resumoAbertura('tesouraria', 'R$ 300,00', 'Caixa YOGA'), /sairá da Tesouraria/)
  })

  test('herdado diz que NADA será movimentado', () => {
    assert.match(resumoAbertura('herdado', 'R$ 300,00', 'Caixa YOGA'), /Nenhum dinheiro será movimentado/)
  })

  test('manual diz que o dinheiro já estava lá', () => {
    assert.match(resumoAbertura('manual', 'R$ 200,00', 'Caixa YOGA'), /já estava fisicamente/)
  })

  test('as três frases são distintas', () => {
    const f = (['herdado', 'tesouraria', 'manual'] as const).map(o => resumoAbertura(o, 'R$ 1,00', 'X'))
    assert.equal(new Set(f).size, 3)
  })

  test('o fechamento diz os três números', () => {
    const s = resumoFechamento('Caixa YOGA', 'R$ 300,00', 'R$ 2.190,00', '− R$ 10,00')
    assert.match(s, /R\$ 300,00 permanecerá/)
    assert.match(s, /R\$ 2\.190,00 será transferido/)
    assert.match(s, /− R\$ 10,00/)
  })
})

describe('estados das RPCs viram HTTP', () => {
  test('sucesso é 200', () => {
    for (const e of ['aberta', 'ja_aberta', 'fechada', 'ja_fechada']) {
      assert.equal(statusDoEstadoSessao(e), 200, e)
    }
  })

  test('conflitos são 409', () => {
    for (const e of ['ja_existe_sessao_aberta', 'fundo_herdado_divergente', 'conflito_esperado',
                     'empresas_diferentes', 'caixa_invalido', 'falha_no_fundo', 'falha_na_entrega']) {
      assert.equal(statusDoEstadoSessao(e), 409, e)
    }
  })

  test('payload inválido é 400 e não encontrada é 404', () => {
    assert.equal(statusDoEstadoSessao('payload_invalido'), 400)
    assert.equal(statusDoEstadoSessao('nao_encontrada'), 404)
  })
})

// ── Garantias estruturais ────────────────────────────────────────────────
describe('as rotas da Fase 3', () => {
  const raiz = path.join(__dirname, '..', '..')
  const fonte = (p: string) => fs.readFileSync(path.join(raiz, p), 'utf8')
  const ABRIR = 'src/app/api/caixa/sessoes/route.ts'
  const FECHAR = 'src/app/api/caixa/sessoes/[id]/fechar/route.ts'
  const TRANSF = 'src/app/api/caixa/transferencias/route.ts'

  test('abrir e fechar NÃO gravam — quem grava é a RPC', () => {
    for (const r of [ABRIR, FECHAR]) {
      const s = fonte(r)
      assert.equal(/from\(['"]caixa_movimento['"]\)|from\(['"]caixa_sessao['"]\)\s*\.insert/.test(s), false, r)
    }
    assert.match(fonte(ABRIR), /rpc\('abrir_caixa_sessao_v1'/)
    assert.match(fonte(FECHAR), /rpc\('fechar_caixa_sessao_v1'/)
  })

  test('a empresa vem do contexto, nunca do corpo', () => {
    for (const r of [ABRIR, FECHAR, TRANSF]) {
      const suspeitas = fonte(r).split('\n')
        .filter(l => /empresa_?[iI]d/.test(l))
        .filter(l => !l.includes('guarda.empresaId'))
      assert.deepEqual(suspeitas, [], r)
    }
  })

  test('abrir exige abrir_caixa; fechar exige fechar_caixa', () => {
    assert.match(fonte(ABRIR), /contextoCaixa\(sb, 'abrir_caixa'\)/)
    assert.match(fonte(FECHAR), /contextoCaixa\(sb, 'fechar_caixa'\)/)
  })

  test('O NAVEGADOR NÃO ESCOLHE A SESSÃO da transferência', () => {
    // O vínculo é resolvido no servidor consultando a sessão aberta daquele
    // caixa. Aceitar `sessao_id` do cliente deixaria uma sangria cair no
    // fechamento de outro turno.
    const s = fonte(TRANSF)
    assert.match(s, /sessao_id: sessaoAberta\?\.id \?\? null/)
    assert.equal(/payload\?\.sessao_id|payload\.sessao_id/.test(s), false)
  })

  test('o id da sessão vem do cliente e não é gerado na rota', () => {
    const s = fonte(ABRIR)
    assert.match(s, /id: payload\?\.id/)
    assert.equal(/randomUUID/.test(s), false)
  })

  test('o guard precede qualquer escrita', () => {
    for (const r of [ABRIR, FECHAR]) {
      const s = fonte(r)
      const g = s.indexOf('await contextoCaixa(sb')
      assert.notEqual(g, -1, r)
      assert.equal(/\.insert\(|\.rpc\(|\.update\(/.test(s.slice(0, g)), false, r)
    }
  })
})

describe('a UI gera os UUIDs ANTES do envio', () => {
  const raiz = path.join(__dirname, '..', '..')
  const modais = fs.readFileSync(path.join(raiz, 'src/components/caixa/SessaoModais.tsx'), 'utf8')

  test('o id da sessão nasce no useState, não no clique', () => {
    // `useState(() => crypto.randomUUID())` roda uma vez, ao montar. Gerar
    // no clique faria cada retry abrir uma sessão nova.
    assert.match(modais, /useState\(\(\) => crypto\.randomUUID\(\)\)/)
  })

  test('o fechamento também tem id fixo para a transferência final', () => {
    const i = modais.indexOf('export function FecharCaixaModal')
    const corpo = modais.slice(i)
    assert.match(corpo, /const \[idTransferencia\] = useState\(\(\) => crypto\.randomUUID\(\)\)/)
  })

  test('o fechamento manda o esperado que a tela mostrou', () => {
    assert.match(modais, /valor_esperado_visto: esperado/)
  })
})
