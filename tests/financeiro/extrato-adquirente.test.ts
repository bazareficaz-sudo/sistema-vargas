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

  test('CADA linha traz a SUA original, mesmo com source_id repetido', () => {
    // O Mercado Pago emite vários registros com o mesmo `source_id`: o
    // pagamento, o ajuste de taxa, o estorno. A importação usa a linha
    // original para montar o hash de unicidade — se duas linhas devolvessem a
    // mesma original, virariam o mesmo hash e a segunda seria descartada como
    // reimportação. Descarte invisível, que é o erro que a trava existe para
    // não cometer.
    const mesmoId = [
      'DATE;SOURCE_ID;RECORD_TYPE;GROSS_AMOUNT;MP_FEE_AMOUNT',
      '2026-10-20;MP-55;release;100,00;-3,04',
      '2026-10-20;MP-55;fee_adjustment;0,00;-0,50',
      '2026-11-02;MP-55;refund;-100,00;0,00',
    ].join('\n')

    const { linhas } = lerExtrato(mesmoId)
    assert.equal(linhas.length, 3)
    const originais = linhas.map(l => l.linhaOriginal)
    assert.equal(new Set(originais).size, 3, 'as tres originais tem de ser distintas')
    assert.match(originais[0], /release/)
    assert.match(originais[1], /fee_adjustment/)
    assert.match(originais[2], /refund/)
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

describe('O ARQUIVO REAL DO BAZAR EFICAZ, lido em 19/10/2026', () => {
  // Linhas copiadas do arquivo que o Mercado Pago gerou de verdade. A primeira
  // versão deste leitor importou 1.941 delas e mostrou na tela
  // "R$ 1.259,41 − R$ 8,46 = R$ 1.512,58" — conta que não fecha.
  //
  // Duas causas, as duas corrigidas aqui:
  //   1. NET_DEBIT_AMOUNT era ignorada: saída de dinheiro virava zero no
  //      liquido, enquanto o bruto carregava o negativo
  //   2. as reservas eram somadas junto com os pagamentos, contando o mesmo
  //      dinheiro duas vezes
  const REAL = [
    'DATE;SOURCE_ID;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT;GROSS_AMOUNT;MP_FEE_AMOUNT;TAXES_AMOUNT;PAYMENT_METHOD;TRANSACTION_APPROVAL_DATE;BUSINESS_UNIT;SUB_UNIT;BALANCE_AMOUNT;PAYMENT_METHOD_TYPE;PURCHASE_ID',
    '2026-10-19T08:49:46.000-03:00;184959657662;payment;60.50;0.00;60.80;-0.30;0.00;pix;2026-10-19T08:49:46.000-03:00;Mercado Pago;QR;99.53;bank_transfer;',
    '2026-10-19T08:48:38.000-03:00;183927157371;payment;29.08;0.00;30.00;-0.17;0.00;elo;2026-10-19T08:48:38.000-03:00;Mercado Pago;Point;39.03;credit_card;',
    '2026-10-19T07:20:49.000-03:00;184951342350;payment;0.00;13.29;-13.29;0.00;0.00;available_money;2026-10-19T07:20:49.000-03:00;;;0.00;account_money;',
    '2026-10-19T07:00:00.000-03:00;184951342399;reserve_for_payment;60.50;0.00;0.00;0.00;0.00;pix;2026-10-19T07:00:00.000-03:00;Mercado Pago;QR;0.00;bank_transfer;',
  ].join('\n')

  const { linhas, cabecalho, descartadas } = lerExtrato(REAL)

  test('o cabeçalho real é reconhecido por inteiro', () => {
    assert.deepEqual(cabecalho.faltando, [])
    assert.deepEqual(descartadas, [])
    assert.equal(linhas.length, 4)
  })

  test('no pix a tarifa declarada fecha exata', () => {
    const l = linhas[0]
    assert.equal(l.bruto, 60.80)
    assert.equal(l.taxa, 0.30)
    assert.equal(l.liquido, 60.50)
    assert.equal(Number((l.bruto - l.taxa).toFixed(2)), l.liquido)
  })

  test('NO CRÉDITO NÃO FECHA, e é por isso que `custo` existe', () => {
    // Venda de R$ 30,00 no elo: o arquivo declara MP_FEE de 0,17 e credita
    // 29,08. O custo real foi 0,92 — 3,07%, que bate com a taxa contratada de
    // 3,04%. A tarifa declarada mostra menos de um quinto disso.
    //
    // No pix a conta fecha exata, então não é arredondamento: no crédito há
    // desconto que a coluna de tarifa não declara, provavelmente antecipação
    // (o arquivo real tem linhas `fee-release_in_advance`).
    //
    // Conferir pela coluna de tarifa diria que o Mercado Pago cobrou 0,57% num
    // cartão de 3%. Vale o `custo`, que é bruto menos liquido.
    const elo = linhas.find(l => l.metodo === 'elo')!
    assert.equal(elo.bruto, 30.00)
    assert.equal(elo.liquido, 29.08)
    assert.equal(elo.taxa, 0.17, 'o que o arquivo DECLARA')
    assert.equal(Number((elo.bruto - elo.liquido).toFixed(2)), 0.92, 'o que REALMENTE custou')
    assert.notEqual(elo.taxa, 0.92)
  })

  test('A SAÍDA, que antes virava zero', () => {
    // NET_DEBIT_AMOUNT = 13,29 e NET_CREDIT = 0. Lendo só o crédito, o líquido
    // ficava 0 enquanto o bruto ficava −13,29 — e o total do dia mentia.
    const saida = linhas.find(l => l.metodoTipo === 'account_money')!
    assert.equal(saida.bruto, -13.29)
    assert.equal(saida.liquido, -13.29)
  })

  test('a data de APROVAÇÃO é lida, e é a da venda', () => {
    // É o que torna possível conferir crédito por dia: os dois lados passam a
    // ter a data da venda, em vez de a liberação trinta dias depois.
    assert.equal(linhas[0].dataAprovacao, '2026-10-19')
  })

  test('o canal e o tipo do método vêm junto', () => {
    assert.equal(linhas[0].canal, 'QR')
    assert.equal(linhas[0].metodoTipo, 'bank_transfer')
    assert.equal(linhas[1].canal, 'Point')
    assert.equal(linhas[1].metodoTipo, 'credit_card')
    assert.equal(linhas[1].metodo, 'elo')
  })

  test('A RESERVA FICA FORA DO TOTAL', () => {
    // No arquivo real eram 462 reservas somadas a 1.266 pagamentos: o mesmo
    // dinheiro contado duas vezes.
    const t = totaisPorDia(linhas)
    assert.equal(t.length, 1)
    assert.equal(t[0].lancamentos, 3, 'tres pagamentos, a reserva de fora')
    assert.equal(t[0].bruto, 77.51)   // 60,80 + 30,00 − 13,29
    assert.equal(t[0].taxa, 0.47)     // 0,30 + 0,17, o que o arquivo declara
    assert.equal(t[0].liquido, 76.29) // 60,50 + 29,08 − 13,29
  })

  test('o CUSTO do dia é bruto menos líquido, e supera a tarifa declarada', () => {
    // 77,51 − 76,29 = 1,22 de custo real, contra 0,47 declarados em tarifa.
    // A diferença é o crédito, como mostrado acima.
    const t = totaisPorDia(linhas)[0]
    assert.equal(t.custo, 1.22)
    assert.ok(t.custo > t.taxa, 'o custo real é maior que a tarifa declarada')
  })

  test('quem quiser auditar o arquivo inteiro pede as reservas', () => {
    const t = totaisPorDia(linhas, { incluirReservas: true })
    assert.equal(t[0].lancamentos, 4)
  })

  test('imposto entra na taxa, somado à tarifa', () => {
    // TAXES_AMOUNT é coluna própria. Ignorá-la subestima o custo, e
    // subestimar custo infla margem.
    const comImposto = [
      'DATE;SOURCE_ID;DESCRIPTION;NET_CREDIT_AMOUNT;NET_DEBIT_AMOUNT;GROSS_AMOUNT;MP_FEE_AMOUNT;TAXES_AMOUNT',
      '2026-10-19;X1;payment;90.00;0.00;100.00;-8.00;-2.00',
    ].join('\n')
    const { linhas: l } = lerExtrato(comImposto)
    assert.equal(l[0].taxa, 10)
    assert.equal(l[0].liquido, 90)
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
