import { getFiscalProvider } from './factory'
import { FiscalProviderError, type EmissaoNFCeInput } from './types'
import { conferirCoerenciaFiscal } from './coerencia'

// Mapeamento das formas de pagamento do PDV pro código da tabela nacional
// SEFAZ de formas de pagamento (Nota Técnica 2020.006, válida pra qualquer
// emissor, não é específico da Focus). 'fiado' vira "90 Sem pagamento" —
// a venda fiada não tem contrapartida financeira imediata no ato da venda.
const CODIGO_SEFAZ_PAGAMENTO: Record<string, string> = {
  dinheiro: '01', debito: '04', credito: '03', pix: '17', carteira: '99', fiado: '90',
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
    ? await sb.from('produtos').select('id, nome, sku, ncm, cfop, icms_cst, csosn, pis_cst, cofins_cst, icms_origem, unidade').in('id', produtoIds)
    : { data: [] as any[] }
  const produtoPorId = new Map((produtos ?? []).map((p: any) => [p.id, p]))

  // Empresa que efetivamente emite o documento — igual a empresaId no caso
  // comum. Só diverge quando configurado em Empresas → Fiscal ("Empresa
  // que emite o documento fiscal das vendas do PDV"): a venda continua
  // pertencendo a empresaId (checado acima), mas CNPJ, numeração/série e
  // credenciais do provedor passam a ser os da empresa fiscal escolhida —
  // resolvido aqui, um ponto só, então os 4 lugares que chamam esta função
  // (PDV, "Emitir agora", emissão em massa, automação) ficam consistentes
  // sem precisar mudar nada nelas.
  let { data: configFiscal } = await sb.from('empresa_config_fiscal').select('*').eq('empresa_id', empresaId).single()
  const empresaFiscalId: string = configFiscal?.empresa_fiscal_id || empresaId
  if (empresaFiscalId !== empresaId) {
    const { data: configFiscalEmitente } = await sb.from('empresa_config_fiscal').select('*').eq('empresa_id', empresaFiscalId).single()
    configFiscal = configFiscalEmitente
  }

  const { data: empresa } = await sb.from('empresas').select('cnpj').eq('id', empresaFiscalId).single()
  if (!empresa?.cnpj) {
    return { ok: false, erro: 'CNPJ da empresa emitente não cadastrado — preencha em Empresas antes de emitir.' }
  }

  const semNcm = itensVenda.filter((i: any) => !i.produto_id || !(produtoPorId.get(i.produto_id) as any)?.ncm)
  if (semNcm.length > 0) {
    const nomes = semNcm.map((i: any) => i.produto_nome).join(', ')
    return { ok: false, erro: `Produto(s) sem NCM cadastrado — emissão bloqueada: ${nomes}` }
  }

  let cliente: { nome: string; cpf_cnpj: string | null } | null = null
  if (venda.cliente_id) {
    const { data: cli } = await sb.from('clientes').select('nome, cpf_cnpj').eq('id', venda.cliente_id).single()
    cliente = cli ?? null
  }

  const cfopPadrao = configFiscal?.cfop_venda_dentro ?? '5102'

  // CRT da empresa QUE EMITE (1 Simples Nacional, 2 Simples c/ excesso,
  // 3 regime normal). Isso decide se o item leva CSOSN ou CST de ICMS —
  // mandar o do regime errado é rejeitado na hora ("CST do ICMS é inválido
  // para empresa no regime normal" / "CSOSN é inválido para empresa no
  // regime simples nacional ou MEI"). Antes o código mandava '102' fixo,
  // que só funciona no Simples — toda emissão de empresa em regime normal
  // era rejeitada.
  const crt = String(configFiscal?.crt ?? '1')
  const simplesNacional = crt === '1' || crt === '2'

  // O cadastro de produto tem as duas colunas (`csosn` e `icms_cst`), mas na
  // prática os códigos foram misturados: há produto com CSOSN gravado em
  // `icms_cst`. Dá pra separar pelo formato — CST tem 2 dígitos (00, 40, 60)
  // e CSOSN tem 3 (102, 400) — e assim nunca mandar o código do regime
  // errado, que a SEFAZ rejeita item por item.
  const ehCsosn = (v: unknown) => /^\d{3}$/.test(String(v ?? ''))
  const ehCst = (v: unknown) => /^\d{2}$/.test(String(v ?? ''))

  function situacaoTributariaIcms(produto: any): string {
    if (simplesNacional) {
      if (ehCsosn(produto.csosn)) return String(produto.csosn)
      if (ehCsosn(produto.icms_cst)) return String(produto.icms_cst)
      return '102' // sem permissão de crédito — padrão do varejo no Simples
    }
    if (ehCst(produto.icms_cst)) return String(produto.icms_cst)
    return '00' // tributada integralmente
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
      valorDesconto: Number(it.desconto ?? 0),
      icmsOrigem: String(produto.icms_origem ?? 0),
      icmsSituacaoTributaria: situacaoTributariaIcms(produto),
      // 49 = "outras operações": aceito nos dois regimes e não exige
      // alíquota, que o cadastro de produto não obriga hoje. Quando o
      // produto tem CST próprio cadastrado, ele manda.
      pisCst: produto.pis_cst || '49',
      cofinsCst: produto.cofins_cst || '49',
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
      return { nome: i.descricao, sku: p?.sku, cfop: i.cfop, situacao: i.icmsSituacaoTributaria }
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

  const input: EmissaoNFCeInput = {
    referencia: venda.id,
    cnpjEmitente: empresa.cnpj,
    naturezaOperacao: configFiscal?.natureza_operacao ?? 'Venda de Mercadorias',
    ...(cpfCnpjDigits ? {
      destinatario: {
        nome: cliente?.nome,
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
