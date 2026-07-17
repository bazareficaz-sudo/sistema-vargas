import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getFiscalProvider } from '@/lib/fiscal/factory'
import { FiscalProviderError, type EmissaoNFCeInput } from '@/lib/fiscal/types'

// Mapeamento das formas de pagamento do PDV pro código da tabela nacional
// SEFAZ de formas de pagamento (Nota Técnica 2020.006, válida pra qualquer
// emissor, não é específico da Focus). 'fiado' vira "90 Sem pagamento" —
// a venda fiada não tem contrapartida financeira imediata no ato da venda.
const CODIGO_SEFAZ_PAGAMENTO: Record<string, string> = {
  dinheiro: '01', debito: '04', credito: '03', pix: '17', carteira: '99', fiado: '90',
}

export async function POST(req: Request) {
  const { vendaId } = await req.json()
  if (!vendaId) return NextResponse.json({ ok: false, erro: 'vendaId ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: venda } = await sb.from('vendas').select('*').eq('id', vendaId).eq('empresa_id', empresaId).single()
  if (!venda) return NextResponse.json({ ok: false, erro: 'Venda não encontrada' }, { status: 404 })
  if (venda.nfce_status === 'autorizada') {
    return NextResponse.json({ ok: true, jaEmitida: true, chave: venda.nfce_chave, numero: venda.nfce_numero })
  }

  const { data: itensVenda } = await sb.from('venda_itens').select('*').eq('venda_id', vendaId).eq('tipo', 'venda')
  if (!itensVenda || itensVenda.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Venda sem itens para emitir' }, { status: 400 })
  }

  const produtoIds = [...new Set(itensVenda.map(i => i.produto_id).filter(Boolean))]
  const { data: produtos } = produtoIds.length > 0
    ? await sb.from('produtos').select('id, nome, sku, ncm, cfop, icms_cst, icms_origem, unidade').in('id', produtoIds)
    : { data: [] as any[] }
  const produtoPorId = new Map((produtos ?? []).map(p => [p.id, p]))

  const { data: empresa } = await sb.from('empresas').select('cnpj').eq('id', empresaId).single()
  if (!empresa?.cnpj) {
    return NextResponse.json({ ok: false, erro: 'CNPJ da empresa não cadastrado — preencha em Empresas antes de emitir.' }, { status: 400 })
  }
  const { data: configFiscal } = await sb.from('empresa_config_fiscal').select('*').eq('empresa_id', empresaId).single()

  const semNcm = itensVenda.filter(i => !i.produto_id || !produtoPorId.get(i.produto_id)?.ncm)
  if (semNcm.length > 0) {
    const nomes = semNcm.map(i => i.produto_nome).join(', ')
    return NextResponse.json({ ok: false, erro: `Produto(s) sem NCM cadastrado — emissão bloqueada: ${nomes}` }, { status: 400 })
  }

  let cliente: { nome: string; cpf_cnpj: string | null } | null = null
  if (venda.cliente_id) {
    const { data: cli } = await sb.from('clientes').select('nome, cpf_cnpj').eq('id', venda.cliente_id).single()
    cliente = cli ?? null
  }

  const cfopPadrao = configFiscal?.cfop_venda_dentro ?? '5102'
  const itens: EmissaoNFCeInput['itens'] = itensVenda.map((it, idx) => {
    const produto = produtoPorId.get(it.produto_id)!
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
      icmsSituacaoTributaria: produto.icms_cst || '102',
    }
  })

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
    const provider = await getFiscalProvider(sb, empresaId)
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
        empresa_id: empresaId,
        acao: 'emitir_nfce',
        descricao: `Venda ${vendaId} — ${resultado.status}`,
        dados: { vendaId, status: resultado.status, chave: resultado.chave, motivoRejeicao: resultado.motivoRejeicao },
        operador: user.email ?? null,
      })
    } catch {}

    return NextResponse.json({
      ok: resultado.status === 'autorizada',
      status: resultado.status,
      chave: resultado.chave,
      numero: resultado.numero,
      danfeUrl: resultado.danfeUrl,
      motivoRejeicao: resultado.motivoRejeicao,
    })
  } catch (e: any) {
    const erro = e instanceof FiscalProviderError ? e.message : (e?.message ?? 'Erro ao emitir NFC-e')
    await sb.from('vendas').update({ nfce_status: 'erro', nfce_motivo_rejeicao: erro, updated_at: new Date().toISOString() }).eq('id', vendaId)
    return NextResponse.json({ ok: false, erro }, { status: 400 })
  }
}
