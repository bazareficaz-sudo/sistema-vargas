import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  DIRECAO, validarNovaTransferencia, validarCombinacao, efeitosDaTransferencia,
  especieDoEstorno, resumoDaOperacao, statusDoEstado, rotuloContraparte,
  ROTULO_NATUREZA, type CaixaParaTransferencia,
} from '../../src/lib/caixa/transferencia'

// FASE 2 — A DIREÇÃO DO DINHEIRO.
//
// Sangria e suprimento são a mesma operação em sentidos opostos, e é
// justamente por isso que trocar os lados é o erro fácil: o valor bate, os
// dois caixas são os mesmos, e o saldo só acusa na conferência física.
//
// Estes testes fixam a direção. A RPC revalida tudo dentro da transação —
// ela é a autoridade — mas o que está aqui é a mesma regra, conferível sem
// banco.

const EMP_A = 'a1000000-0000-0000-0000-000000000001'
const EMP_B = '681ab72f-fd5b-4de9-8623-59eeb32e6d18'
const PDV = '11111111-1111-4111-8111-111111111111'
const TES = '22222222-2222-4222-8222-222222222222'
const PDV2 = '33333333-3333-4333-8333-333333333333'
const ID = '44444444-4444-4444-8444-444444444444'

const caixaPdv = (over: Partial<CaixaParaTransferencia> = {}): CaixaParaTransferencia =>
  ({ id: PDV, tipo: 'pdv', empresa_id: EMP_A, ativo: true, ...over })
const caixaTes = (over: Partial<CaixaParaTransferencia> = {}): CaixaParaTransferencia =>
  ({ id: TES, tipo: 'tesouraria', empresa_id: EMP_A, ativo: true, ...over })

const nova = (over = {}) => validarNovaTransferencia({
  id: ID, especie: 'sangria', caixa_origem_id: PDV, caixa_destino_id: TES,
  valor: 1000, ...over,
})

describe('a direção econômica de cada espécie', () => {
  test('sangria: sai do PDV, entra na tesouraria', () => {
    assert.equal(DIRECAO.sangria.tipoOrigem, 'pdv')
    assert.equal(DIRECAO.sangria.tipoDestino, 'tesouraria')
  })

  test('suprimento: sai da tesouraria, entra no PDV', () => {
    assert.equal(DIRECAO.suprimento.tipoOrigem, 'tesouraria')
    assert.equal(DIRECAO.suprimento.tipoDestino, 'pdv')
  })

  test('cada lado tem natureza própria — quatro, não duas', () => {
    // O extrato da tesouraria precisa dizer "Sangria recebida (+)", e o do
    // PDV "Sangria enviada (−)". Uma natureza só para os dois lados obrigaria
    // a tela a inferir o sinal.
    assert.equal(DIRECAO.sangria.naturezaSaida, 'sangria')
    assert.equal(DIRECAO.sangria.naturezaEntrada, 'sangria_recebida')
    assert.equal(DIRECAO.suprimento.naturezaSaida, 'suprimento_entregue')
    assert.equal(DIRECAO.suprimento.naturezaEntrada, 'suprimento')
  })

  test('as quatro naturezas são distintas entre si', () => {
    const todas = [
      DIRECAO.sangria.naturezaSaida, DIRECAO.sangria.naturezaEntrada,
      DIRECAO.suprimento.naturezaSaida, DIRECAO.suprimento.naturezaEntrada,
    ]
    assert.equal(new Set(todas).size, 4)
  })
})

describe('os dois efeitos', () => {
  test('sangria gera saída no PDV e entrada na tesouraria', () => {
    const t = nova()
    assert.equal(t.ok, true); if (!t.ok) return
    const [saida, entrada] = efeitosDaTransferencia(t.transferencia)

    assert.equal(saida.caixa_id, PDV)
    assert.equal(saida.tipo, 'saida')
    assert.equal(saida.natureza, 'sangria')
    assert.equal(entrada.caixa_id, TES)
    assert.equal(entrada.tipo, 'entrada')
    assert.equal(entrada.natureza, 'sangria_recebida')
  })

  test('suprimento gera saída na tesouraria e entrada no PDV', () => {
    const t = nova({ especie: 'suprimento', caixa_origem_id: TES, caixa_destino_id: PDV })
    assert.equal(t.ok, true); if (!t.ok) return
    const [saida, entrada] = efeitosDaTransferencia(t.transferencia)

    assert.equal(saida.caixa_id, TES)
    assert.equal(saida.natureza, 'suprimento_entregue')
    assert.equal(entrada.caixa_id, PDV)
    assert.equal(entrada.natureza, 'suprimento')
  })

  test('SÃO EXATAMENTE DOIS — nunca um, nunca três', () => {
    const t = nova(); if (!t.ok) return
    assert.equal(efeitosDaTransferencia(t.transferencia).length, 2)
  })

  test('cada lado aponta para o outro como contraparte', () => {
    const t = nova(); if (!t.ok) return
    const [saida, entrada] = efeitosDaTransferencia(t.transferencia)
    assert.equal(saida.contraparte_caixa_id, entrada.caixa_id)
    assert.equal(entrada.contraparte_caixa_id, saida.caixa_id)
  })

  test('os dois efeitos têm o MESMO valor — dinheiro não encolhe no caminho', () => {
    const t = nova({ valor: 137.45 }); if (!t.ok) return
    const [a, b] = efeitosDaTransferencia(t.transferencia)
    assert.equal(a.valor, b.valor)
    assert.equal(a.valor, 137.45)
  })

  test('o valor viaja positivo nos dois lados — o sinal está em tipo', () => {
    const t = nova(); if (!t.ok) return
    for (const e of efeitosDaTransferencia(t.transferencia)) assert.ok(e.valor > 0)
  })
})

describe('o que pode virar uma transferência', () => {
  test('sangria válida passa', () => {
    assert.equal(nova().ok, true)
  })

  test('O ID É OBRIGATÓRIO — sem ele não há idempotência', () => {
    // Gerar um id aqui quando falta transformaria cada retry numa
    // transferência nova. Falta de id é recusa, não conveniência.
    const r = validarNovaTransferencia({
      especie: 'sangria', caixa_origem_id: PDV, caixa_destino_id: TES, valor: 10,
    })
    assert.equal(r.ok, false); if (r.ok) return
    assert.match(r.erro, /dentificador/)
  })

  test('id que não é uuid é recusado', () => {
    assert.equal(nova({ id: 'transferencia-1' }).ok, false)
    assert.equal(nova({ id: '' }).ok, false)
  })

  test('valor zero e negativo são recusados', () => {
    assert.equal(nova({ valor: 0 }).ok, false)
    assert.equal(nova({ valor: -100 }).ok, false)
  })

  test('valor não numérico é recusado', () => {
    assert.equal(nova({ valor: 'mil' }).ok, false)
    assert.equal(nova({ valor: null }).ok, false)
    assert.equal(nova({ valor: Infinity }).ok, false)
  })

  test('origem igual ao destino é recusada', () => {
    const r = nova({ caixa_destino_id: PDV })
    assert.equal(r.ok, false); if (r.ok) return
    assert.match(r.erro, /mesmo caixa/)
  })

  test('espécie fora das duas é recusada', () => {
    assert.equal(nova({ especie: 'transferencia' }).ok, false)
    assert.equal(nova({ especie: '' }).ok, false)
  })

  test('fração de centavo é arredondada', () => {
    const r = nova({ valor: 10.005 }); if (!r.ok) return
    assert.equal(r.transferencia.valor, 10.01)
  })

  test('observação em branco vira null, não string vazia', () => {
    const r = nova({ observacao: '   ' }); if (!r.ok) return
    assert.equal(r.transferencia.observacao, null)
  })

  test('observação longa é truncada', () => {
    const r = nova({ observacao: 'x'.repeat(900) }); if (!r.ok) return
    assert.equal(r.transferencia.observacao?.length, 500)
  })
})

describe('a combinação de caixas', () => {
  test('sangria PDV → tesouraria passa', () => {
    assert.equal(validarCombinacao('sangria', caixaPdv(), caixaTes(), EMP_A).ok, true)
  })

  test('suprimento tesouraria → PDV passa', () => {
    assert.equal(validarCombinacao('suprimento', caixaTes(), caixaPdv(), EMP_A).ok, true)
  })

  test('PDV → PDV é recusado nas duas espécies', () => {
    assert.equal(validarCombinacao('sangria', caixaPdv(), caixaPdv({ id: PDV2 }), EMP_A).ok, false)
    assert.equal(validarCombinacao('suprimento', caixaPdv(), caixaPdv({ id: PDV2 }), EMP_A).ok, false)
  })

  test('tesouraria → tesouraria é recusado nas duas espécies', () => {
    assert.equal(validarCombinacao('sangria', caixaTes(), caixaTes({ id: PDV2 }), EMP_A).ok, false)
    assert.equal(validarCombinacao('suprimento', caixaTes(), caixaTes({ id: PDV2 }), EMP_A).ok, false)
  })

  test('SANGRIA INVERTIDA é recusada — é o erro fácil', () => {
    // Tesouraria → PDV com espécie sangria tem valor certo e caixas certos.
    // Só a direção está trocada.
    const r = validarCombinacao('sangria', caixaTes(), caixaPdv(), EMP_A)
    assert.equal(r.ok, false); if (r.ok) return
    assert.match(r.erro, /PDV para a tesouraria/)
  })

  test('suprimento invertido é recusado', () => {
    assert.equal(validarCombinacao('suprimento', caixaPdv(), caixaTes(), EMP_A).ok, false)
  })

  test('A TRANSFERÊNCIA NÃO CRUZA CNPJ', () => {
    // O caso que a RLS não pega: as duas empresas são do mesmo grupo, o
    // usuário tem vínculo nas duas, e `empresa_do_meu_grupo()` deixa passar.
    const r = validarCombinacao('sangria', caixaPdv(), caixaTes({ empresa_id: EMP_B }), EMP_A)
    assert.equal(r.ok, false); if (r.ok) return
    assert.match(r.erro, /empresa ativa/)
  })

  test('nem quando as DUAS pontas são da outra empresa', () => {
    // Consistentes entre si, mas não são da empresa ativa.
    const r = validarCombinacao('sangria',
      caixaPdv({ empresa_id: EMP_B }), caixaTes({ empresa_id: EMP_B }), EMP_A)
    assert.equal(r.ok, false)
  })

  test('caixa inativo não movimenta', () => {
    assert.equal(validarCombinacao('sangria', caixaPdv({ ativo: false }), caixaTes(), EMP_A).ok, false)
    assert.equal(validarCombinacao('sangria', caixaPdv(), caixaTes({ ativo: false }), EMP_A).ok, false)
  })

  test('caixa inexistente é recusado, não ignorado', () => {
    assert.equal(validarCombinacao('sangria', null, caixaTes(), EMP_A).ok, false)
    assert.equal(validarCombinacao('sangria', caixaPdv(), undefined, EMP_A).ok, false)
  })

  test('banco não participa desta fase', () => {
    const banco = { id: PDV2, tipo: 'banco' as const, empresa_id: EMP_A, ativo: true }
    assert.equal(validarCombinacao('sangria', banco, caixaTes(), EMP_A).ok, false)
    assert.equal(validarCombinacao('suprimento', caixaTes(), banco, EMP_A).ok, false)
  })
})

describe('o estorno', () => {
  test('devolver uma sangria é, economicamente, um suprimento', () => {
    assert.equal(especieDoEstorno('sangria'), 'suprimento')
  })

  test('e devolver um suprimento é uma sangria', () => {
    assert.equal(especieDoEstorno('suprimento'), 'sangria')
  })

  test('estornar duas vezes volta à espécie original — por isso não se encadeia', () => {
    assert.equal(especieDoEstorno(especieDoEstorno('sangria')), 'sangria')
  })

  test('o par do estorno tem os caixas invertidos', () => {
    const t = nova(); if (!t.ok) return
    const orig = efeitosDaTransferencia(t.transferencia)

    const e = validarNovaTransferencia({
      id: ID, especie: especieDoEstorno('sangria'),
      caixa_origem_id: TES, caixa_destino_id: PDV, valor: 1000,
    })
    assert.equal(e.ok, true); if (!e.ok) return
    const est = efeitosDaTransferencia(e.transferencia)

    // O que saiu do PDV volta para o PDV, no mesmo valor.
    assert.equal(orig[0].caixa_id, est[1].caixa_id)
    assert.equal(orig[0].tipo, 'saida')
    assert.equal(est[1].tipo, 'entrada')
    assert.equal(orig[0].valor, est[1].valor)
  })
})

describe('o que a tela diz antes de confirmar', () => {
  test('sangria nomeia origem e destino sem ambiguidade', () => {
    assert.equal(
      resumoDaOperacao('sangria', 'YOGA', 'Caixa da Empresa', 'R$ 1.000,00'),
      'R$ 1.000,00 sairá do Caixa PDV YOGA e entrará na Tesouraria da empresa.')
  })

  test('suprimento diz o contrário', () => {
    assert.equal(
      resumoDaOperacao('suprimento', 'Caixa da Empresa', 'YOGA', 'R$ 200,00'),
      'R$ 200,00 sairá da Tesouraria e entrará no Caixa PDV YOGA.')
  })

  test('as duas frases nunca coincidem', () => {
    const a = resumoDaOperacao('sangria', 'YOGA', 'Tesouraria', 'R$ 10,00')
    const b = resumoDaOperacao('suprimento', 'Tesouraria', 'YOGA', 'R$ 10,00')
    assert.notEqual(a, b)
  })
})

describe('o extrato', () => {
  test('cada natureza tem rótulo legível', () => {
    for (const n of ['sangria', 'sangria_recebida', 'suprimento', 'suprimento_entregue']) {
      assert.ok(ROTULO_NATUREZA[n], `sem rótulo para ${n}`)
    }
  })

  test('quem enviou mostra Destino; quem recebeu mostra Origem', () => {
    assert.equal(rotuloContraparte('sangria'), 'Destino')
    assert.equal(rotuloContraparte('suprimento_entregue'), 'Destino')
    assert.equal(rotuloContraparte('sangria_recebida'), 'Origem')
    assert.equal(rotuloContraparte('suprimento'), 'Origem')
  })

  test('natureza da Fase 1 não tem contraparte', () => {
    assert.equal(rotuloContraparte('aporte'), null)
    assert.equal(rotuloContraparte('ajuste'), null)
  })

  test('os rótulos da Fase 1 continuam existindo', () => {
    for (const n of ['aporte', 'retirada_socio', 'deposito_banco', 'ajuste']) {
      assert.ok(ROTULO_NATUREZA[n])
    }
  })
})

describe('os estados da RPC viram HTTP', () => {
  test('sucesso é 200', () => {
    for (const e of ['aplicada', 'ja_aplicada', 'estornada', 'ja_estornada']) {
      assert.equal(statusDoEstado(e), 200, e)
    }
  })

  test('payload inválido é 400', () => {
    assert.equal(statusDoEstado('payload_invalido'), 400)
  })

  test('não encontrada é 404', () => {
    assert.equal(statusDoEstado('nao_encontrada'), 404)
  })

  test('CONFLITO É 409, não 500 — o cliente precisa distinguir', () => {
    for (const e of ['conflito_payload', 'empresas_diferentes', 'combinacao_invalida',
                     'caixa_invalido', 'nao_estorna_estorno']) {
      assert.equal(statusDoEstado(e), 409, e)
    }
  })

  test('estado desconhecido cai em 409, nunca em 200', () => {
    assert.notEqual(statusDoEstado('algo_novo_do_futuro'), 200)
  })
})

// ── Garantias estruturais das rotas ──────────────────────────────────────
describe('as rotas da Fase 2', () => {
  const raiz = path.join(__dirname, '..', '..')
  const fonte = (p: string) => fs.readFileSync(path.join(raiz, p), 'utf8')
  const TRANSF = 'src/app/api/caixa/transferencias/route.ts'
  const ESTORNO = 'src/app/api/caixa/transferencias/[id]/estornar/route.ts'
  const ANTIGA = 'src/app/api/caixa/tesouraria/movimentos/[id]/estornar/route.ts'

  test('A ROTA NÃO GRAVA MOVIMENTO — quem grava é a RPC', () => {
    // Se a rota inserisse um lado e depois o outro, existiria um instante em
    // que o dinheiro saiu e não chegou.
    const s = fonte(TRANSF)
    assert.equal(/from\(['"]caixa_movimento['"]\)/.test(s), false)
    assert.equal(/from\(['"]caixa_transferencia['"]\)\s*\.insert/.test(s), false)
    assert.match(s, /rpc\('transferir_caixa_v1'/)
  })

  test('uma chamada de RPC, não duas', () => {
    assert.equal((fonte(TRANSF).match(/\.rpc\(/g) ?? []).length, 1)
  })

  test('a empresa vem do contexto, nunca do corpo', () => {
    const suspeitas = fonte(TRANSF).split('\n')
      .filter(l => /empresa_?[iI]d/.test(l))
      .filter(l => !l.includes('guarda.empresaId'))
    assert.deepEqual(suspeitas, [])
  })

  test('o id da transferência vem do CLIENTE e não é gerado na rota', () => {
    const s = fonte(TRANSF)
    assert.match(s, /id: payload\?\.id/)
    assert.equal(/randomUUID|crypto\.randomUUID/.test(s), false,
      'gerar id na rota faria cada retry virar transferência nova')
  })

  test('o guard vem antes de qualquer escrita', () => {
    for (const r of [TRANSF, ESTORNO]) {
      const s = fonte(r)
      const g = s.indexOf('await contextoCaixa(sb')
      assert.notEqual(g, -1, r)
      assert.equal(/\.insert\(|\.rpc\(|\.update\(/.test(s.slice(0, g)), false, r)
    }
  })

  test('estornar exige permissão própria, não gerenciar_financeiro', () => {
    assert.match(fonte(ESTORNO), /contextoCaixa\(sb, 'estornar_caixa'\)/)
  })

  test('A ROTA ANTIGA RECUSA MOVIMENTO DE TRANSFERÊNCIA', () => {
    // Sem isto, estornar um movimento de sangria devolveria o dinheiro à
    // gaveta sem tirá-lo da tesouraria.
    const s = fonte(ANTIGA)
    assert.match(s, /if \(original\.transferencia_id\)/)
    assert.match(s, /select\([^)]*transferencia_id/)
    const iSelect = s.indexOf('transferencia_id')
    const iInsert = s.indexOf('.insert(')
    assert.ok(iSelect < iInsert, 'a recusa tem de vir antes do INSERT do estorno')
  })
})
