import { getFiscalProvider } from './factory'
import { FiscalProviderError, type EmissaoNFCeInput } from './types'
import { conferirCoerenciaFiscal, situacaoTributariaIcms } from './coerencia'
import { verificarNcm, explicarNcm } from './ncm'

// Mapeamento das formas de pagamento do PDV pro código da tabela nacional
// SEFAZ de formas de pagamento (Nota Técnica 2020.006, válida pra qualquer
// emissor, não é específico da Focus). 'fiado' vira "90 Sem pagamento" —
// a venda fiada não tem contrapartida financeira imediata no ato da venda.
/**
 * O campo limpo de máscara, se e somente se tiver exatamente N dígitos.
 *
 * O cadastro aceita CEST digitado com máscara ("10.079.00"), colado de PDF ou
 * do XML do fornecedor. Os provedores querem os 7 dígitos limpos. E um valor
 * incompleto não é "quase certo": é ausente, e precisa aparecer como ausente
 * para a conferência reclamar antes da SEFAZ.
 */
function soDigitos(valor: unknown, digitos: number): string | undefined {
  const limpo = String(valor ?? '').replace(/\D/g, '')
  return limpo.length === digitos ? limpo : undefined
}

const CODIGO_SEFAZ_PAGAMENTO: Record<string, string> = {
  dinheiro: '01', debito: '04', credito: '03', pix: '17', carteira: '99', fiado: '90',
}

/**
 * Quem efetivamente emite o documento, e sob qual regime.
 *
 * Igual a `empresaId` no caso comum. Só diverge quando configurado em
 * Empresas → Fiscal ("Empresa que emite o documento fiscal das vendas do
 * PDV"): a venda continua pertencendo a `empresaId`, mas CNPJ, numeração/série
 * e credenciais do provedor passam a ser os da empresa fiscal escolhida.
 *
 * ESTÁ AQUI, EXPORTADA, POR UM MOTIVO CONCRETO. O regime que vale para os
 * códigos do produto é o de quem EMITE, não o de quem vende. Na configuração
 * real deste sistema uma empresa de Lucro Presumido (CRT 3) emite por uma do
 * Simples (CRT 1) — e foi assim que 102 produtos ficaram com CST 60 (regime
 * normal) enquanto a nota, emitida pelo Simples, procurava CSOSN, não achava,
 * caía no padrão 102 e contradizia o CFOP 5405.
 *
 * Qualquer tela que proponha corrigir campo fiscal precisa resolver o emitente
 * pelo MESMO caminho da emissão. Duas resoluções que discordam produzem
 * exatamente o defeito que a correção deveria consertar.
 */
export async function resolverEmitente(sb: any, empresaId: string): Promise<{
  empresaFiscalId: string
  configFiscal: any
  simplesNacional: boolean
  cfopPadrao: string
}> {
  let { data: configFiscal } = await sb.from('empresa_config_fiscal').select('*').eq('empresa_id', empresaId).single()
  const empresaFiscalId: string = configFiscal?.empresa_fiscal_id || empresaId
  if (empresaFiscalId !== empresaId) {
    const { data: configFiscalEmitente } = await sb.from('empresa_config_fiscal').select('*').eq('empresa_id', empresaFiscalId).single()
    configFiscal = configFiscalEmitente
  }
  const crt = String(configFiscal?.crt ?? '1')
  return {
    empresaFiscalId,
    configFiscal,
    simplesNacional: crt === '1' || crt === '2',
    cfopPadrao: configFiscal?.cfop_venda_dentro ?? '5102',
  }
}

export type ResultadoEmissao = {
  ok: boolean
  jaEmitida?: boolean
  status?: string
  chave?: string
  numero?: string
  danfeUrl?: string
  motivoRejeicao?: string
  erro?: string
}

// Lógica central de emissão de NFC-e a partir de uma venda já salva —
// compartilhada entre a rota HTTP (usuário logado, clica "Emitir agora") e
// o executor de automações (cron, sem sessão de usuário). `sb` pode ser
// tanto o cliente com sessão quanto o admin client — ambos têm os mesmos
// métodos de query.
export async function emitirNfceParaVenda(sb: any, empresaId: string, vendaId: string, operador?: string | null): Promise<ResultadoEmissao> {
  const { data: venda } = await sb.from('vendas').select('*').eq('id', vendaId).eq('empresa_id', empresaId).single()
  if (!venda) return { ok: false, erro: 'Venda não encontrada' }
  if (venda.nfce_status === 'autorizada') {
    return { ok: true, jaEmitida: true, status: venda.nfce_status, chave: venda.nfce_chave, numero: venda.nfce_numero }
  }

  const { data: itensVenda } = await sb.from('venda_itens').select('*').eq('venda_id', vendaId).eq('tipo', 'venda')
  if (!itensVenda || itensVenda.length === 0) {
    return { ok: false, erro: 'Venda sem itens para emitir' }
  }

  const produtoIds = [...new Set(itensVenda.map((i: any) => i.produto_id).filter(Boolean))]
  const { data: produtos } = produtoIds.length > 0
    ? await sb.from('produtos').select('id, nome, sku, ncm, cest, cfop, icms_cst, csosn, pis_cst, cofins_cst, icms_origem, unidade').in('id', produtoIds)
    : { data: [] as any[] }
  const produtoPorId = new Map((produtos ?? []).map((p: any) => [p.id, p]))

  const { empresaFiscalId, configFiscal, simplesNacional, cfopPadrao } = await resolverEmitente(sb, empresaId)

  const { data: empresa } = await sb.from('empresas').select('cnpj').eq('id', empresaFiscalId).single()
  if (!empresa?.cnpj) {
    return { ok: false, erro: 'CNPJ da empresa emitente não cadastrado — preencha em Empresas antes de emitir.' }
  }

  // NCM: presente E existente E vigente.
  //
  // A checagem antiga era so `!ncm`. Formato certo nao e codigo certo: a venda
  // #201722 tinha NCM 32100090, oito digitos, preenchido pela IA — e esse
  // codigo nao existe na nomenclatura. Passou por tudo e morreu na SEFAZ com
  // "Rejeicao 778", que nao diz qual produto nem o que trocar.
  const problemasNcm: string[] = []
  for (const i of itensVenda as any[]) {
    const p = i.produto_id ? (produtoPorId.get(i.produto_id) as any) : null
    if (!p) { problemasNcm.push(`${i.produto_nome}: item sem produto vinculado.`); continue }
    const frase = explicarNcm(await verificarNcm(sb, p.ncm))
    if (frase) problemasNcm.push(`${p.nome}: ${frase}`)
  }
  if (problemasNcm.length > 0) {
    return { ok: false, erro: `NCM invalido — emissao bloqueada: ${problemasNcm.join(' · ')}` }
  }

  // Destinatário da nota. Duas origens, nesta ordem:
  //
  //   1. cliente cadastrado (venda.cliente_id) — o caminho que já existia;
  //   2. CPF/CNPJ informado direto na venda — o caso do balcão ("põe meu CPF
  //      na nota"), que não tinha para onde ir e por isso NENHUMA das 96
  //      notas emitidas até aqui saiu identificada.
  //
  // O cadastro tem prioridade porque é o dado mais completo; o informado na
  // venda entra quando não há cadastro, ou quando o cadastro está sem
  // documento.
  let cliente: { nome: string | null; cpf_cnpj: string | null } | null = null
  if (venda.cliente_id) {
    const { data: cli } = await sb.from('clientes').select('nome, cpf_cnpj').eq('id', venda.cliente_id).single()
    cliente = cli ?? null
  }
  if (!cliente?.cpf_cnpj && venda.cliente_cpf_cnpj) {
    cliente = {
      nome: cliente?.nome ?? venda.cliente_nome ?? null,
      cpf_cnpj: venda.cliente_cpf_cnpj,
    }
  }


  // CRT da empresa QUE EMITE (1 Simples Nacional, 2 Simples c/ excesso,
  // 3 regime normal). Isso decide se o item leva CSOSN ou CST de ICMS —
  // mandar o do regime errado é rejeitado na hora ("CST do ICMS é inválido
  // para empresa no regime normal" / "CSOSN é inválido para empresa no
  // regime simples nacional ou MEI"). Antes o código mandava '102' fixo,
  // que só funciona no Simples — toda emissão de empresa em regime normal
  // era rejeitada.

  // O cadastro de produto tem as duas colunas (`csosn` e `icms_cst`), mas na
  // prática os códigos foram misturados: há produto com CSOSN gravado em
  // `icms_cst`. Dá pra separar pelo formato — CST tem 2 dígitos (00, 40, 60)
  // e CSOSN tem 3 (102, 400) — e assim nunca mandar o código do regime
  // errado, que a SEFAZ rejeita item por item.
  // A regra em si mora em `coerencia.ts`, exportada — porque a tela de
  // pendências fiscais precisa enxergar exatamente o mesmo valor que vai na
  // nota. Ver o comentário de lá: a primeira versão daquela tela recalculou
  // isto por conta própria, chegou noutro resultado, e anunciava "nenhuma
  // pendência" enquanto a emissão recusava o mesmo item.

  // Desconto do cabeçalho da venda, rateado entre os itens.
  //
  // O PDV grava o desconto na venda (`vendas.desconto`), não no item. A NFC-e
  // não tem esse conceito: o total da nota é a soma dos itens menos o desconto
  // DELES. Sem ratear, a nota fechava no valor bruto enquanto o pagamento ia
  // no líquido, e a SEFAZ recusava com "Rejeição 865: Total dos pagamentos
  // menor que o total da nota" — toda venda com desconto era rejeitada.
  //
  // Rateio proporcional ao valor bruto de cada item; o último item absorve a
  // sobra do arredondamento, para a soma bater no centavo com o desconto
  // informado (mesma técnica do rateio de juros em contas a pagar).
  const descontoVenda = Number(venda.desconto ?? 0)
  const brutoPorItem: number[] = itensVenda.map((it: any) => Number(it.quantidade) * Number(it.preco_unitario))
  const brutoTotal = brutoPorItem.reduce((a, b) => a + b, 0)

  function ratearDesconto(): number[] {
    const zeros = itensVenda!.map(() => 0)
    if (descontoVenda <= 0 || brutoTotal <= 0) return zeros
    // Desconto já lançado item a item: respeita o que veio e não rateia de novo.
    if (itensVenda!.some((it: any) => Number(it.desconto ?? 0) > 0)) return zeros

    const rateio = brutoPorItem.map(b => Math.round((descontoVenda * b / brutoTotal) * 100) / 100)
    const somado = rateio.reduce((a, b) => a + b, 0)
    const ultimo = rateio.length - 1
    rateio[ultimo] = Math.round((rateio[ultimo] + (descontoVenda - somado)) * 100) / 100
    return rateio
  }
  const descontoPorItem = ratearDesconto()

  // Desconto maior que a mercadoria não vira nota válida em nenhum cenário.
  // Barrar aqui com o valor à vista é mais útil que a recusa da SEFAZ, que
  // devolve só o número da rejeição para quem está no balcão.
  if (descontoVenda > brutoTotal) {
    return {
      ok: false,
      erro: `Desconto (R$ ${descontoVenda.toFixed(2)}) maior que o valor dos produtos (R$ ${brutoTotal.toFixed(2)}) — emissão bloqueada.`,
    }
  }

  const itens: EmissaoNFCeInput['itens'] = itensVenda.map((it: any, idx: number) => {
    const produto = produtoPorId.get(it.produto_id) as any
    return {
      numeroItem: idx + 1,
      produtoId: it.produto_id,
      codigoProduto: produto.sku || produto.id,
      descricao: it.produto_nome,
      ncm: produto.ncm,
      cfop: produto.cfop || cfopPadrao,
      unidade: produto.unidade || 'UN',
      quantidade: Number(it.quantidade),
      valorUnitario: Number(it.preco_unitario),
      // Os dois nunca coexistem: o rateio só roda quando nenhum item traz
      // desconto próprio, então somar é seguro e dispensa um condicional.
      valorDesconto: Number(it.desconto ?? 0) + descontoPorItem[idx],
      icmsOrigem: String(produto.icms_origem ?? 0),
      icmsSituacaoTributaria: situacaoTributariaIcms(produto, simplesNacional),
      // 49 = "outras operações": aceito nos dois regimes e não exige
      // alíquota, que o cadastro de produto não obriga hoje. Quando o
      // produto tem CST próprio cadastrado, ele manda.
      pisCst: produto.pis_cst || '49',
      cofinsCst: produto.cofins_cst || '49',
      // Só dígitos: o cadastro aceita o CEST digitado com ponto ("10.079.00")
      // e os dois provedores querem os 7 dígitos limpos. Menos que 7 não é
      // CEST — vai como ausente, e a conferência abaixo reclama com o nome do
      // produto, em vez de a SEFAZ devolver o número da rejeição.
      cest: soDigitos(produto.cest, 7),
    }
  })

  // Confere o par CFOP × situação tributária antes de gastar uma ida à SEFAZ.
  // Ela valida os dois juntos, não separados: uma venda real foi recusada com
  // "Rejeição 725: CFOP inválido" tendo CFOP 5403 (com substituição tributária)
  // e CSOSN 102 (sem). A recusa não diz qual produto nem o que trocar — quem
  // está no balcão fica só com o número da rejeição. Aqui a mensagem sai com o
  // nome do produto e o par correto, antes de a nota sair.
  const coerencia = conferirCoerenciaFiscal(
    itens.map(i => {
      const p = produtoPorId.get(i.produtoId) as any
      return { nome: i.descricao, sku: p?.sku, cfop: i.cfop, situacao: i.icmsSituacaoTributaria, cest: i.cest }
    }),
    simplesNacional,
  )
  if (coerencia.erros.length > 0) {
    return { ok: false, erro: `Dados fiscais incoerentes — emissão bloqueada:\n${coerencia.erros.join('\n')}` }
  }

  const pagamentosBrutos: { forma: string; valor: number }[] =
    Array.isArray(venda.pagamentos) && venda.pagamentos.length > 0
      ? venda.pagamentos
      : [{ forma: venda.forma_pagamento, valor: Number(venda.total) }]

  const pagamentos: EmissaoNFCeInput['pagamentos'] = pagamentosBrutos.map(p => ({
    forma: p.forma,
    codigoSefaz: CODIGO_SEFAZ_PAGAMENTO[p.forma] ?? '99',
    valor: p.valor,
  }))

  const cpfCnpjDigits = cliente?.cpf_cnpj?.replace(/\D/g, '') ?? ''
  // Só 11 (CPF) ou 14 (CNPJ) dígitos viram destinatário. Antes, qualquer
  // texto não-vazio montava o bloco — um documento incompleto ia sem `cpf` e
  // sem `cnpj`, e a SEFAZ rejeitava a nota inteira. Documento inválido agora
  // vira nota de consumidor não identificado, que é ruim mas emite.
  const documentoValido = cpfCnpjDigits.length === 11 || cpfCnpjDigits.length === 14

  const input: EmissaoNFCeInput = {
    referencia: venda.id,
    cnpjEmitente: empresa.cnpj,
    naturezaOperacao: configFiscal?.natureza_operacao ?? 'Venda de Mercadorias',
    ...(documentoValido ? {
      destinatario: {
        nome: cliente?.nome ?? undefined,
        cpf: cpfCnpjDigits.length === 11 ? cpfCnpjDigits : undefined,
        cnpj: cpfCnpjDigits.length === 14 ? cpfCnpjDigits : undefined,
      },
    } : {}),
    itens,
    pagamentos,
  }

  try {
    const provider = await getFiscalProvider(sb, empresaFiscalId)
    const resultado = await provider.emissao.emitirNFCe(input)

    await sb.from('vendas').update({
      nfce_emitida: resultado.status === 'autorizada',
      nfce_chave: resultado.chave ?? null,
      nfce_numero: resultado.numero ?? null,
      nfce_serie: resultado.serie ?? null,
      nfce_url_pdf: resultado.danfeUrl ?? null,
      nfce_status: resultado.status,
      nfce_protocolo: resultado.protocolo ?? null,
      nfce_xml_url: resultado.xmlUrl ?? null,
      nfce_motivo_rejeicao: resultado.motivoRejeicao ?? null,
      nfce_provider: provider.nome,
      updated_at: new Date().toISOString(),
    }).eq('id', vendaId)

    // nfe_logs é auditoria de melhor esforço — falha aqui não pode derrubar a resposta
    try {
      await sb.from('nfe_logs').insert({
        empresa_id: empresaFiscalId,
        acao: 'emitir_nfce',
        descricao: `Venda ${vendaId} — ${resultado.status}`,
        dados: { vendaId, status: resultado.status, chave: resultado.chave, motivoRejeicao: resultado.motivoRejeicao },
        operador: operador ?? null,
      })
    } catch {}

    return {
      ok: resultado.status === 'autorizada',
      status: resultado.status,
      chave: resultado.chave,
      numero: resultado.numero,
      danfeUrl: resultado.danfeUrl,
      motivoRejeicao: resultado.motivoRejeicao,
    }
  } catch (e: any) {
    const erro = e instanceof FiscalProviderError ? e.message : (e?.message ?? 'Erro ao emitir NFC-e')
    await sb.from('vendas').update({ nfce_status: 'erro', nfce_motivo_rejeicao: erro, updated_at: new Date().toISOString() }).eq('id', vendaId)
    return { ok: false, erro }
  }
}
