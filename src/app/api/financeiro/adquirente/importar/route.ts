import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { lerExtrato, ehReserva, grupoDaLinha } from '@/lib/financeiro/extratoAdquirente'
import {
  pedirRelatorio, listarRelatorios, baixarRelatorio, tokenDoAmbiente,
  buscarPagamento, resumoDoPagamento,
} from '@/lib/financeiro/mercadoPagoRelatorio'

// A IMPORTAÇÃO DO EXTRATO DA ADQUIRENTE, EM TRÊS AÇÕES SEPARADAS.
//
// O relatório do Mercado Pago é assíncrono: pede-se, espera-se, e só então o
// arquivo existe. Uma rota só que fizesse os três passos ficaria pendurada
// esperando — e a Vercel corta função longa no meio, deixando importação pela
// metade sem ninguém saber onde parou.
//
// Então são três chamadas, cada uma rápida e repetível:
//
//   pedir     manda gerar o relatório do período
//   listar    mostra os arquivos prontos
//   importar  baixa um arquivo, lê e grava o que for novo
//
// `importar` é seguro de repetir: a trava `(caixa_id, linha_hash)` no banco
// faz a segunda vez não gravar nada. A idempotência vem da trava, nunca de
// conferir antes de inserir.

export const maxDuration = 60

/**
 * O que já foi importado: as últimas importações e os totais por dia.
 *
 * Leitura separada da importação de propósito — a tela precisa mostrar o
 * estado mesmo quando o token não está configurado, senão quem abre não
 * descobre que já existe extrato guardado.
 */
export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const [{ data: importacoes }, { data: extrato }, { data: suspeitos }, { data: saidas }] = await Promise.all([
    sb.from('adquirente_importacao')
      .select('id, arquivo, periodo_de, periodo_ate, linhas_lidas, linhas_novas, linhas_descartadas, erro, cabecalho_recebido, created_at')
      .order('created_at', { ascending: false }).limit(20),
    // 90 dias: o relatório de Liberações olha para trás, e o crédito só
    // aparece trinta dias depois da venda.
    sb.from('adquirente_extrato')
      .select('data, bruto, taxa, liquido, tipo, metodo, canal, metodo_tipo, unidade')
      .gte('data', new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10))
      .order('data', { ascending: false }).limit(5000),
    sb.from('adquirente_extrato_suspeito_v1').select('origem_id').limit(100),
    // AS SAIDAS DA CONTA: o pix do posto, a embalagem, o mercado. Sao 231 em
    // 30 dias, R$ 29.421 -- e uma unica esta lancada em Contas a Pagar.
    sb.from('adquirente_extrato')
      .select('id, origem_id, data, liquido')
      .eq('tipo', 'payment').eq('metodo_tipo', 'account_money').lt('liquido', 0)
      .order('data', { ascending: false }).limit(60),
  ])

  // Soma por dia FORA as reservas, pela mesma regra testada em
  // `totaisPorDia`: reserva é a contrapartida contábil de uma operação que já
  // está no arquivo como `payment` ou `payout`, e somar as duas conta o mesmo
  // dinheiro duas vezes. No arquivo real eram 462 reservas contra 1.266
  // pagamentos.
  const porDia = new Map<string, { data: string; bruto: number; taxa: number; liquido: number; custo: number; lancamentos: number; recebimento: number; saida: number; saque: number; ajuste: number }>()
  for (const e of (extrato ?? []) as any[]) {
    if (ehReserva(String(e.tipo ?? ''))) continue
    const t = porDia.get(e.data) ?? {
      data: e.data, bruto: 0, taxa: 0, liquido: 0, custo: 0, lancamentos: 0,
      recebimento: 0, saida: 0, saque: 0, ajuste: 0,
    }
    t.bruto += Number(e.bruto); t.taxa += Number(e.taxa); t.liquido += Number(e.liquido)
    t.lancamentos += 1
    // Mesma regra de grupo do leitor, para a tela e o arquivo nunca
    // discordarem sobre o que e venda, despesa ou saque.
    const g = grupoDaLinha({
      tipo: String(e.tipo ?? ''), metodoTipo: e.metodo_tipo ?? null,
      liquido: Number(e.liquido), bruto: Number(e.bruto),
    })
    if (g === 'recebimento') t.recebimento += Number(e.liquido)
    else if (g === 'saida') t.saida += Number(e.liquido)
    else if (g === 'saque') t.saque += Number(e.liquido)
    else if (g === 'ajuste') t.ajuste += Number(e.liquido)
    porDia.set(e.data, t)
  }

  // O CUSTO MEDIDO POR FORMA, separado por unidade de negocio.
  //
  // E o numero que responde "a adquirente cobrou o que prometeu?" -- e a
  // separacao e o que o torna confiavel: juntando loja e marketplace, o pix
  // media 3,57% contra 0,49% contratados, porque a comissao de marketplace
  // (~37%) entrava na conta.
  //
  // So vendas: `payment` com bruto positivo. Saque, estorno e disputa nao tem
  // "taxa" a conferir.
  const porForma = new Map<string, {
    unidade: string; metodo: string; linhas: number; bruto: number; custo: number; pct: number
  }>()
  for (const e of (extrato ?? []) as any[]) {
    if (String(e.tipo) !== 'payment') continue
    const bruto = Number(e.bruto)
    if (!(bruto > 0)) continue
    const unidade = e.unidade ?? 'sem unidade'
    const metodo = e.metodo_tipo ?? 'sem metodo'
    const k = `${unidade}|${metodo}`
    const f = porForma.get(k) ?? { unidade, metodo, linhas: 0, bruto: 0, custo: 0, pct: 0 }
    f.linhas += 1
    f.bruto += bruto
    f.custo += bruto - Number(e.liquido)
    porForma.set(k, f)
  }

  return NextResponse.json({
    ok: true,
    tokenConfigurado: tokenDoAmbiente() !== '',
    formas: [...porForma.values()]
      .map(f => ({
        ...f,
        bruto: Number(f.bruto.toFixed(2)),
        custo: Number(f.custo.toFixed(2)),
        // Percentual do TOTAL, nao a media dos percentuais: venda de R$ 5 e
        // venda de R$ 500 nao pesam igual.
        pct: Number((f.custo / f.bruto * 100).toFixed(2)),
      }))
      .sort((a, b) => b.bruto - a.bruto),
    importacoes: importacoes ?? [],
    dias: [...porDia.values()]
      .map(t => ({
        ...t,
        bruto: Number(t.bruto.toFixed(2)),
        taxa: Number(t.taxa.toFixed(2)),
        liquido: Number(t.liquido.toFixed(2)),
        // O custo de VERDADE: bruto menos liquido. Nao e o mesmo que a soma
        // das colunas de tarifa -- no credito o arquivo declara menos de um
        // quinto do que realmente desconta.
        custo: Number((t.bruto - t.liquido).toFixed(2)),
        recebimento: Number(t.recebimento.toFixed(2)),
        saida: Number(t.saida.toFixed(2)),
        saque: Number(t.saque.toFixed(2)),
        ajuste: Number(t.ajuste.toFixed(2)),
      }))
      .sort((a, b) => (a.data < b.data ? 1 : -1)),
    suspeitos: (suspeitos ?? []).length,
    saidas: ((saidas ?? []) as any[]).map(s => ({
      id: s.id, origemId: s.origem_id, data: s.data, valor: Math.abs(Number(s.liquido)),
    })),
  })
}

/** O caixa da adquirente onde o extrato entra. */
async function caixaDaAdquirente(sb: any, empresaId: string, pedido?: string) {
  const q = sb.from('caixa').select('id, nome')
    .eq('empresa_id', empresaId).eq('tipo', 'adquirente').eq('ativo', true)
  const { data } = pedido ? await q.eq('id', pedido) : await q
  return (data ?? [])[0] ?? null
}

/**
 * O hash que impede importar a mesma linha duas vezes.
 *
 * Normaliza espaços e maiúsculas antes, porque o mesmo lançamento pode vir com
 * espaçamento diferente em duas emissões do relatório — e aí seriam dois
 * registros do mesmo dinheiro.
 */
function hashDaLinha(linha: string): string {
  return createHash('md5').update(linha.replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex')
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_financeiro')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const token = tokenDoAmbiente()
  if (!token) {
    // A mensagem diz o NOME da variável de propósito: existe outra parecida em
    // produção (`MERCADOPAGO_ACCESS_TOKEN`, das assinaturas), e "token não
    // configurado" faria alguém conferir a errada.
    return NextResponse.json({
      ok: false,
      erro: 'O token do Mercado Pago nao esta configurado no servidor. Defina MP_RELATORIOS_TOKEN nas variaveis de ambiente do projeto.',
    }, { status: 503 })
  }

  const acao = body.acao
  if (acao === 'pedir') return pedir(body, token)
  if (acao === 'listar') return listar(token)
  if (acao === 'importar') return importar(sb, guarda.empresaId, body, token)
  if (acao === 'quem_recebeu') return quemRecebeu(body, token)

  return NextResponse.json({
    ok: false, erro: 'Acao desconhecida. Use pedir, listar, importar ou quem_recebeu.',
  }, { status: 400 })
}

/**
 * PARA QUEM FOI ESTE PAGAMENTO.
 *
 * O relatorio de Liberacoes traz data, valor e identificador das 231 saidas da
 * conta -- R$ 29.421 em 30 dias --, mas NAO o nome de quem recebeu. Sem o nome
 * nao ha categoria, e 231 linhas de "saiu R$ 200,00" nao sao controle de
 * despesa.
 *
 * Esta acao le UM pagamento pelo id, e devolve tambem `camposPresentes`: a
 * lista do que a resposta trouxe. E deliberado -- a forma da resposta ainda
 * nao foi vista, e hoje ja aconteceu tres vezes de o dado real contradizer a
 * documentacao. Olhar primeiro, construir depois.
 */
async function quemRecebeu(body: any, token: string) {
  const id = String(body.origemId ?? '').trim()
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ ok: false, erro: 'Identificador invalido.' }, { status: 400 })
  }
  try {
    const p = await buscarPagamento(id, { token })
    return NextResponse.json({ ok: true, origemId: id, resumo: resumoDoPagamento(p) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'Falha ao ler o pagamento.' }, { status: 502 })
  }
}

function dataValida(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

async function pedir(body: any, token: string) {
  if (!dataValida(body.de) || !dataValida(body.ate)) {
    return NextResponse.json({ ok: false, erro: 'Informe o periodo (de e ate) no formato AAAA-MM-DD.' }, { status: 400 })
  }
  if (body.de > body.ate) {
    return NextResponse.json({ ok: false, erro: 'A data inicial e depois da final.' }, { status: 400 })
  }

  const r = await pedirRelatorio(body.de, body.ate, { token })
  // `aceito: false` com 200 na nossa rota: a chamada funcionou, o Mercado Pago
  // é que recusou. Devolver 500 faria parecer defeito nosso.
  return NextResponse.json({ ok: r.aceito, erro: r.aceito ? undefined : r.mensagem, mensagem: r.mensagem })
}

async function listar(token: string) {
  try {
    const relatorios = await listarRelatorios({ token })
    return NextResponse.json({ ok: true, relatorios })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'Falha ao listar.' }, { status: 502 })
  }
}

async function importar(sb: any, empresaId: string, body: any, token: string) {
  const arquivo = typeof body.arquivo === 'string' ? body.arquivo.trim() : ''
  if (!arquivo) return NextResponse.json({ ok: false, erro: 'Informe o arquivo a importar.' }, { status: 400 })

  const caixa = await caixaDaAdquirente(sb, empresaId, body.caixaId)
  if (!caixa) {
    return NextResponse.json({
      ok: false,
      erro: 'Nenhuma adquirente cadastrada. Cadastre em Financeiro > Bancos e Contas antes de importar.',
    }, { status: 400 })
  }

  let csv: string
  try {
    csv = await baixarRelatorio(arquivo, { token })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'Falha ao baixar.' }, { status: 502 })
  }

  const { linhas, cabecalho, descartadas } = lerExtrato(csv)

  // Registra a importação ANTES de gravar as linhas, mesmo quando vai falhar.
  // É o que permite responder "tentamos importar este arquivo e deu isto" —
  // sem o registro, uma importação que não trouxe nada é indistinguível de uma
  // que nunca aconteceu.
  const { data: imp, error: erroImp } = await sb.from('adquirente_importacao').insert({
    empresa_id: empresaId,
    caixa_id: caixa.id,
    arquivo,
    periodo_de: dataValida(body.de) ? body.de : null,
    periodo_ate: dataValida(body.ate) ? body.ate : null,
    linhas_lidas: linhas.length,
    linhas_descartadas: descartadas.length,
    cabecalho_recebido: cabecalho.recebido,
    erro: cabecalho.faltando.length > 0
      ? `Colunas obrigatorias ausentes: ${cabecalho.faltando.join(', ')}`
      : null,
  }).select('id').single()

  if (erroImp) return NextResponse.json({ ok: false, erro: erroImp.message }, { status: 500 })

  // A RECUSA QUE PROTEGE OS NÚMEROS. Sem as colunas obrigatórias, o leitor
  // devolve lista vazia — e gravar "zero linhas" como se fosse sucesso faria a
  // conferência concluir que o Mercado Pago não pagou nada no período.
  //
  // O cabeçalho que chegou vai junto porque as colunas dependem da
  // configuração da conta: é a informação que permite consertar os apelidos.
  if (cabecalho.faltando.length > 0) {
    return NextResponse.json({
      ok: false,
      erro: `O arquivo nao tem as colunas necessarias: ${cabecalho.faltando.join(', ')}.`,
      cabecalhoRecebido: cabecalho.recebido,
      importacaoId: imp.id,
    }, { status: 422 })
  }

  // A linha original vem DO LEITOR, junto de cada registro. Procurá-la aqui
  // pelo identificador acharia a mesma linha para todos os lançamentos que
  // compartilham `source_id` — e o Mercado Pago emite vários assim (pagamento,
  // ajuste de taxa, estorno). Os dois virariam o mesmo hash, e o segundo seria
  // descartado como reimportação.
  const registros = linhas.map(l => ({
    empresa_id: empresaId,
    caixa_id: caixa.id,
    importacao_id: imp.id,
    data: l.data,
    origem_id: l.origemId,
    referencia_externa: l.referenciaExterna,
    tipo: l.tipo,
    bruto: l.bruto,
    taxa: l.taxa,
    liquido: l.liquido,
    parcelas: l.parcelas,
    metodo: l.metodo,
    data_aprovacao: l.dataAprovacao,
    unidade: l.unidade,
    canal: l.canal,
    metodo_tipo: l.metodoTipo,
    compra_id: l.compraId,
    linha_original: l.linhaOriginal,
    linha_hash: hashDaLinha(l.linhaOriginal),
  }))

  // Em lotes: um INSERT com milhares de linhas estoura o limite da requisição,
  // e falharia justamente no mês que mais tem o que conferir.
  for (let i = 0; i < registros.length; i += 500) {
    const lote = registros.slice(i, i + 500)
    const { error } = await sb.from('adquirente_extrato')
      .upsert(lote, { onConflict: 'caixa_id,linha_hash', ignoreDuplicates: true })
    if (error) {
      await sb.from('adquirente_importacao').update({
        erro: `Falha ao gravar a partir da linha ${i + 1}: ${error.message}`,
      }).eq('id', imp.id)
      return NextResponse.json({ ok: false, erro: error.message, importacaoId: imp.id }, { status: 500 })
    }
  }

  // QUANTAS ENTRARAM DE VERDADE, contadas no banco.
  //
  // Antes eu contava pelas linhas que o `upsert` devolvia no `select`. Com
  // `ignoreDuplicates`, ele não devolve nada — e a tela dizia "1941 lidas,
  // 0 novas" numa importação em que as 1941 entraram. Quem lesse concluiria
  // que a importação não fez nada.
  //
  // Contar por `importacao_id` é exato: linha ignorada por já existir mantém
  // o id da importação que a trouxe primeiro.
  const { count: novas } = await sb.from('adquirente_extrato')
    .select('id', { count: 'exact', head: true })
    .eq('importacao_id', imp.id)

  await sb.from('adquirente_importacao').update({ linhas_novas: novas ?? 0 }).eq('id', imp.id)

  return NextResponse.json({
    ok: true,
    importacaoId: imp.id,
    caixa: caixa.nome,
    lidas: linhas.length,
    novas: novas ?? 0,
    // Repetidas não é erro: é o resultado esperado de reimportar o mesmo
    // arquivo, e mostrar o número evita a dúvida "importou ou não?".
    repetidas: linhas.length - (novas ?? 0),
    descartadas,
    cabecalhoRecebido: cabecalho.recebido,
  })
}
