import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  valorMonetario, dataDoExtrato, dividirLinha, detectarSeparador,
  lerCabecalho, lerExtrato, totaisPorDia, conferirDia,
} from '../../src/lib/financeiro/extratoAdquirente'

// LER O EXTRATO DA ADQUIRENTE SEM ERRAR DINHEIRO.
//
// O relatório de Liberações do Mercado Pago vem como CSV, e as colunas
// dependem da configuração da conta — a própria API tem um endpoint para
// escolher quais colunas sair e em que ordem. Então nada pode ser lido por
// posição, e todo formato de número tem de ser tratado.
//
// Estes testes existem porque os erros daqui NÃO APARECEM: produzem um número
// plausível e errado, e alguém vai procurar um roubo que não houve.

describe('o número em dinheiro', () => {
  test('formato brasileiro', () => {
    assert.equal(valorMonetario('1.234,56'), 1234.56)
    assert.equal(valorMonetario('0,49'), 0.49)
    assert.equal(valorMonetario('-12,30'), -12.3)
  })

  test('formato internacional', () => {
    assert.equal(valorMonetario('1,234.56'), 1234.56)
    assert.equal(valorMonetario('12.34'), 12.34)
  })

  test('O ERRO MAIS CARO: mil reais lidos como um real e vinte', () => {
    // "1.234,56" interpretado como formato internacional daria 1,23456. A
    // conferência acusaria falta de mil reais num dia que fechou certo.
    assert.notEqual(valorMonetario('1.234,56'), 1.23456)
    assert.equal(valorMonetario('1.234,56'), 1234.56)
  })

  test('milhar sem decimal nenhum', () => {
    // "1.234" é mil duzentos e trinta e quatro, não um e vinte e três.
    assert.equal(valorMonetario('1.234'), 1234)
    assert.equal(valorMonetario('1.234.567'), 1234567)
  })

  test('mas duas casas depois do ponto é decimal', () => {
    assert.equal(valorMonetario('12.34'), 12.34)
    assert.equal(valorMonetario('1234.56'), 1234.56)
  })

  test('com símbolo, espaço e espaço fino', () => {
    assert.equal(valorMonetario('R$ 1.234,56'), 1234.56)
    assert.equal(valorMonetario(' 10,00 '), 10)
    assert.equal(valorMonetario('R$ 5,50'), 5.5)
  })

  test('parênteses são negativo, convenção contábil', () => {
    assert.equal(valorMonetario('(12,30)'), -12.3)
  })

  test('vazio e lixo viram zero, não NaN', () => {
    // NaN propagaria por toda a soma e o total do dia viraria "NaN" na tela.
    assert.equal(valorMonetario(''), 0)
    assert.equal(valorMonetario(null), 0)
    assert.equal(valorMonetario(undefined), 0)
    assert.equal(valorMonetario('-'), 0)
    assert.equal(valorMonetario('abc'), 0)
  })
})

describe('a data', () => {
  test('ISO com e sem hora', () => {
    assert.equal(dataDoExtrato('2026-10-20'), '2026-10-20')
    assert.equal(dataDoExtrato('2026-10-20T14:35:02.000-03:00'), '2026-10-20')
  })

  test('brasileira', () => {
    assert.equal(dataDoExtrato('20/10/2026'), '2026-10-20')
  })

  test('ilegível devolve nulo', () => {
    assert.equal(dataDoExtrato('ontem'), null)
    assert.equal(dataDoExtrato(''), null)
  })
})

describe('dividir a linha', () => {
  test('respeita aspas com vírgula dentro', () => {
    // É o caso que `split(',')` erra: a descrição vem com vírgula e TODAS as
    // colunas seguintes deslocam — a taxa vai para a casa do líquido.
    const campos = dividirLinha('1,"Pagamento, parcela 2/3",10.00', ',')
    assert.deepEqual(campos, ['1', 'Pagamento, parcela 2/3', '10.00'])
  })

  test('aspa dobrada é aspa literal', () => {
    assert.deepEqual(dividirLinha('a,"diz ""oi""",b', ','), ['a', 'diz "oi"', 'b'])
  })

  test('campo vazio no meio não some', () => {
    assert.deepEqual(dividirLinha('a,,c', ','), ['a', '', 'c'])
  })
})

describe('o separador', () => {
  test('ponto e vírgula na exportação brasileira', () => {
    assert.equal(detectarSeparador('DATE;SOURCE_ID;GROSS_AMOUNT'), ';')
  })

  test('vírgula na internacional', () => {
    assert.equal(detectarSeparador('DATE,SOURCE_ID,GROSS_AMOUNT'), ',')
  })

  test('tabulação', () => {
    assert.equal(detectarSeparador('DATE\tSOURCE_ID\tGROSS_AMOUNT'), '\t')
  })
})

describe('o cabeçalho, casado por nome', () => {
  test('acha as colunas em inglês', () => {
    const c = lerCabecalho(['DATE', 'SOURCE_ID', 'GROSS_AMOUNT', 'MP_FEE_AMOUNT'])
    assert.deepEqual(c.faltando, [])
    assert.equal(c.mapa.data, 0)
    assert.equal(c.mapa.taxa, 3)
  })

  test('e em português, com acento e espaço', () => {
    const c = lerCabecalho([' Data ', 'Operation_Id', 'Valor Bruto', 'Taxa'])
    assert.deepEqual(c.faltando, [])
  })

  test('ORDEM DIFERENTE não muda nada', () => {
    // É a razão de existir o casamento por nome: a configuração da conta
    // decide a ordem das colunas, e ler por posição trocaria taxa por bruto.
    const c = lerCabecalho(['MP_FEE_AMOUNT', 'GROSS_AMOUNT', 'SOURCE_ID', 'DATE'])
    assert.equal(c.mapa.taxa, 0)
    assert.equal(c.mapa.bruto, 1)
    assert.equal(c.mapa.data, 3)
  })

  test('coluna que falta é DITA, com o cabeçalho que chegou', () => {
    // Falhar calado aqui produziria conferência de valores zerados.
    const c = lerCabecalho(['DATE', 'DESCRIPTION'])
    assert.ok(c.faltando.includes('origemId'))
    assert.ok(c.faltando.includes('bruto'))
    assert.deepEqual(c.recebido, ['DATE', 'DESCRIPTION'])
  })
})

describe('ler o arquivo inteiro', () => {
  const CSV = [
    'DATE;SOURCE_ID;EXTERNAL_REFERENCE;RECORD_TYPE;GROSS_AMOUNT;MP_FEE_AMOUNT;NET_CREDIT_AMOUNT;INSTALLMENTS;PAYMENT_METHOD',
    '2026-10-20T10:00:00Z;MP-1;;release;100,00;-3,04;96,96;1;credit_card',
    '2026-10-20T10:05:00Z;MP-2;;release;200,00;-0,98;199,02;1;pix',
    '2026-10-21T09:00:00Z;MP-3;;release;300,00;-9,12;290,88;3;credit_card',
  ].join('\n')

  test('lê as três linhas, com a taxa POSITIVA', () => {
    const { linhas, cabecalho, descartadas } = lerExtrato(CSV)
    assert.deepEqual(cabecalho.faltando, [])
    assert.deepEqual(descartadas, [])
    assert.equal(linhas.length, 3)
    // No arquivo a taxa vem negativa, porque é débito. Guardamos positiva: no
    // ledger ela já é uma SAÍDA, e o sinal estaria contado duas vezes.
    assert.equal(linhas[0].taxa, 3.04)
    assert.equal(linhas[0].bruto, 100)
    assert.equal(linhas[0].liquido, 96.96)
    assert.equal(linhas[2].parcelas, 3)
  })

  test('pula linhas de resumo antes do cabeçalho', () => {
    const comLixo = 'Relatorio de liberacoes\nConta: 123\n\n' + CSV
    const { linhas, cabecalho } = lerExtrato(comLixo)
    assert.deepEqual(cabecalho.faltando, [])
    assert.equal(linhas.length, 3)
  })

  test('linha sem data ou sem id é DESCARTADA COM MOTIVO', () => {
    const ruim = CSV + '\n;MP-4;;release;50,00;-1,00;49,00;1;pix' +
                       '\n2026-10-22T10:00:00Z;;;release;60,00;-1,00;59,00;1;pix'
    const { linhas, descartadas } = lerExtrato(ruim)
    assert.equal(linhas.length, 3)
    assert.equal(descartadas.length, 2)
    assert.match(descartadas[0].motivo, /sem data/)
    assert.match(descartadas[1].motivo, /sem identificador/)
  })

  test('sem coluna de líquido, calcula bruto menos taxa', () => {
    // Devolver zero faria a conferência dizer que nada caiu na conta.
    const semLiquido = [
      'DATE;SOURCE_ID;GROSS_AMOUNT;MP_FEE_AMOUNT',
      '2026-10-20;MP-9;100,00;-3,04',
    ].join('\n')
    const { linhas } = lerExtrato(semLiquido)
    assert.equal(linhas[0].liquido, 96.96)
  })

  test('arquivo vazio não explode', () => {
    const { linhas, cabecalho } = lerExtrato('')
    assert.equal(linhas.length, 0)
    assert.ok(cabecalho.faltando.length > 0)
  })

  test('arquivo com cabeçalho irreconhecível devolve vazio, não lixo', () => {
    const { linhas, cabecalho } = lerExtrato('coluna_a;coluna_b\n1;2')
    assert.equal(linhas.length, 0)
    assert.ok(cabecalho.faltando.length > 0)
  })

  test('CRLF do Windows', () => {
    const { linhas } = lerExtrato(CSV.split('\n').join('\r\n'))
    assert.equal(linhas.length, 3)
  })
})

describe('os totais do dia', () => {
  const { linhas } = lerExtrato([
    'DATE;SOURCE_ID;GROSS_AMOUNT;MP_FEE_AMOUNT;NET_CREDIT_AMOUNT',
    '2026-10-20;MP-1;100,00;-3,04;96,96',
    '2026-10-20;MP-2;200,00;-0,98;199,02',
    '2026-10-21;MP-3;300,00;-9,12;290,88',
  ].join('\n'))

  test('soma por data, mais recente primeiro', () => {
    const t = totaisPorDia(linhas)
    assert.equal(t.length, 2)
    assert.equal(t[0].data, '2026-10-21')
    assert.equal(t[1].bruto, 300)
    assert.equal(t[1].taxa, 4.02)
    assert.equal(t[1].liquido, 295.98)
    assert.equal(t[1].lancamentos, 2)
  })
})

describe('a conferência do dia', () => {
  const deles = totaisPorDia(lerExtrato([
    'DATE;SOURCE_ID;GROSS_AMOUNT;MP_FEE_AMOUNT',
    '2026-10-20;MP-1;100,00;-3,04',
    '2026-10-20;MP-2;200,00;-0,98',
  ].join('\n')).linhas)

  test('fecha quando bate', () => {
    const d = conferirDia([{ data: '2026-10-20', bruto: 300, taxa: 4.02 }], deles)
    assert.equal(d.length, 1)
    assert.equal(d[0].confere, true)
    assert.equal(d[0].difBruto, 0)
  })

  test('um centavo de arredondamento ainda fecha', () => {
    // Taxa arredondada por transação não fecha com taxa arredondada no total.
    // Tratar isso como erro treina o lojista a ignorar o alerta — e aí o
    // alerta não serve mais para nada.
    const d = conferirDia([{ data: '2026-10-20', bruto: 300, taxa: 4.01 }], deles)
    assert.equal(d[0].confere, true)
    assert.equal(d[0].difTaxa, 0.01)
  })

  test('diferença de verdade não fecha, e diz de quanto', () => {
    const d = conferirDia([{ data: '2026-10-20', bruto: 250, taxa: 4.02 }], deles)
    assert.equal(d[0].confere, false)
    assert.equal(d[0].difBruto, 50)
  })

  test('dia que só existe no extrato aparece', () => {
    // Venda que o caixa não lançou. Omitir seria perder exatamente o caso que
    // a conferência existe para achar.
    const d = conferirDia([], deles)
    assert.equal(d.length, 1)
    assert.equal(d[0].nossoBruto, 0)
    assert.equal(d[0].delesBruto, 300)
    assert.equal(d[0].confere, false)
  })

  test('A ARMADILHA DA DATA, registrada: venda de hoje x liberação de 30 dias', () => {
    // No nosso ledger a venda no crédito entra na data em que VENDEU; no
    // extrato, na data em que o dinheiro foi LIBERADO. Comparar por dia faz
    // toda venda no crédito parecer divergência — e a tela fica vermelha num
    // mês correto.
    //
    // Este teste não conserta nada: documenta que a função compara DATAS, e
    // que casar crédito exige transação por transação. Quem chamar filtra.
    const nossoDia20 = [{ data: '2026-10-20', bruto: 100, taxa: 3.04 }]
    const liberadoEmNovembro = totaisPorDia(lerExtrato([
      'DATE;SOURCE_ID;GROSS_AMOUNT;MP_FEE_AMOUNT',
      '2026-11-19;MP-77;100,00;-3,04',
    ].join('\n')).linhas)

    const d = conferirDia(nossoDia20, liberadoEmNovembro)
    assert.equal(d.length, 2, 'dois dias distintos, e nenhum dos dois fecha')
    assert.ok(d.every(x => !x.confere))
  })

  test('dia que só existe no nosso caixa aparece', () => {
    // Venda lançada que o Mercado Pago não reconhece.
    const d = conferirDia([{ data: '2026-10-25', bruto: 80, taxa: 2.43 }], deles)
    assert.equal(d.length, 2)
    const so = d.find(x => x.data === '2026-10-25')!
    assert.equal(so.delesBruto, 0)
    assert.equal(so.confere, false)
  })
})
