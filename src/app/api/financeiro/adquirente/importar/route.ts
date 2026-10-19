import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { lerExtrato } from '@/lib/financeiro/extratoAdquirente'
import {
  pedirRelatorio, listarRelatorios, baixarRelatorio, tokenDoAmbiente,
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

  return NextResponse.json({
    ok: false, erro: 'Acao desconhecida. Use pedir, listar ou importar.',
  }, { status: 400 })
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
    linha_original: l.linhaOriginal,
    linha_hash: hashDaLinha(l.linhaOriginal),
  }))

  // Em lotes: um INSERT com milhares de linhas estoura o limite da requisição,
  // e falharia justamente no mês que mais tem o que conferir.
  let novas = 0
  for (let i = 0; i < registros.length; i += 500) {
    const lote = registros.slice(i, i + 500)
    const { data, error } = await sb.from('adquirente_extrato')
      .upsert(lote, { onConflict: 'caixa_id,linha_hash', ignoreDuplicates: true })
      .select('id')
    if (error) {
      await sb.from('adquirente_importacao').update({
        linhas_novas: novas,
        erro: `Falha ao gravar a partir da linha ${i + 1}: ${error.message}`,
      }).eq('id', imp.id)
      return NextResponse.json({ ok: false, erro: error.message, importacaoId: imp.id }, { status: 500 })
    }
    novas += (data ?? []).length
  }

  await sb.from('adquirente_importacao').update({ linhas_novas: novas }).eq('id', imp.id)

  return NextResponse.json({
    ok: true,
    importacaoId: imp.id,
    caixa: caixa.nome,
    lidas: linhas.length,
    novas,
    // Repetidas não é erro: é o resultado esperado de reimportar o mesmo
    // arquivo, e mostrar o número evita a dúvida "importou ou não?".
    repetidas: linhas.length - novas,
    descartadas,
    cabecalhoRecebido: cabecalho.recebido,
  })
}
