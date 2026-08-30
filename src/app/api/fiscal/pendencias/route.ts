import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { resolverEmitente } from '@/lib/fiscal/emitirParaVenda'
import { conferirCoerenciaFiscal, type ItemParaConferir } from '@/lib/fiscal/coerencia'
import { buscarCandidatosCest, resolverCest, CestIndisponivelError } from '@/lib/fiscal/cest'
import { proporCorrecao, camposDoCaminho, type ProdutoFiscal, type IdCaminho } from '@/lib/fiscal/correcao'

// PENDÊNCIAS FISCAIS DE UMA VENDA — diagnosticar e resolver sem abrir cadastro.
//
// `acao: 'diagnosticar'` devolve, por produto, o que está errado e os caminhos
// possíveis com a evidência de cada um.
// `acao: 'aplicar'` grava as escolhas e reconfere.
//
// O CLIENTE NÃO MANDA CÓDIGO FISCAL. Ele manda, por produto, qual caminho
// seguir ('com_st' | 'sem_st') e, quando a tabela oficial devolve mais de um
// CEST, qual deles. O servidor reconstrói a proposta inteira do zero, a partir
// da mesma evidência, e grava o que ELE calculou.
//
// Isso não é cerimônia: se a rota aceitasse `{ cfop, csosn, cest }` do cliente,
// esta tela viraria um jeito de escrever qualquer coisa no cadastro fiscal de
// qualquer produto da empresa, sem passar por nenhuma das validações que
// existem justamente para impedir nota recusada.

type Decisao = { produtoId: string; caminho: IdCaminho; cest?: string | null }

const COLUNAS_FISCAIS = 'id, nome, sku, ncm, cest, cfop, csosn, icms_cst'

export async function POST(req: Request) {
  const { vendaId, acao, decisoes } = await req.json() as {
    vendaId?: string
    acao?: 'diagnosticar' | 'aplicar'
    decisoes?: Decisao[]
  }
  if (!vendaId) return NextResponse.json({ ok: false, erro: 'vendaId ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  // A venda é lida pela empresa da sessão: uma linha a menos por onde uma
  // empresa poderia mexer no cadastro fiscal de outra.
  const { data: venda } = await sb.from('vendas')
    .select('id, nfce_status').eq('id', vendaId).eq('empresa_id', empresaId).maybeSingle()
  if (!venda) return NextResponse.json({ ok: false, erro: 'Venda não encontrada' }, { status: 404 })
  if (venda.nfce_status === 'autorizada') {
    return NextResponse.json({ ok: false, erro: 'Esta venda já tem NFC-e autorizada — cancele a nota antes de mexer no cadastro.' }, { status: 400 })
  }

  const { data: itensVenda } = await sb.from('venda_itens')
    .select('produto_id, produto_nome').eq('venda_id', vendaId).eq('tipo', 'venda')
  if (!itensVenda?.length) {
    return NextResponse.json({ ok: false, erro: 'Venda sem itens' }, { status: 400 })
  }

  // O regime que vale é o de quem EMITE, resolvido pelo mesmo caminho da
  // emissão. Aqui isso não é detalhe: nesta instalação uma empresa de Lucro
  // Presumido emite por uma do Simples, e é dessa divergência que nasce o par
  // quebrado que esta tela conserta.
  const { simplesNacional, cfopPadrao } = await resolverEmitente(sb, empresaId)

  const produtoIds = [...new Set(itensVenda.map(i => i.produto_id).filter(Boolean))]
  const { data: produtos } = produtoIds.length
    ? await sb.from('produtos').select(COLUNAS_FISCAIS).in('id', produtoIds).eq('empresa_id', empresaId)
    : { data: [] as ProdutoFiscal[] }
  const porId = new Map((produtos ?? []).map((p: ProdutoFiscal) => [p.id, p]))

  const escolhaDe = new Map((decisoes ?? []).map(d => [d.produtoId, d]))

  // Uma consulta à tabela CEST por produto. A falha de consulta NÃO vira
  // "não se aplica": sem a tabela não há evidência, e sem evidência não há
  // recomendação — a tela diz isso em vez de recomendar no escuro.
  let cestIndisponivel: string | null = null
  const propostas = []
  const itensParaConferir: ItemParaConferir[] = []

  for (const item of itensVenda) {
    const produto = item.produto_id ? porId.get(item.produto_id) : null
    if (!produto) {
      propostas.push({
        produtoId: item.produto_id ?? null,
        nome: item.produto_nome,
        sku: null,
        problemas: ['Item sem produto vinculado no cadastro — não há campo fiscal para corrigir.'],
        recomendado: null,
        evidencia: '',
        caminhos: [],
        candidatosCest: [],
        impedimento: 'Vincule o item a um produto para poder corrigir os dados fiscais.',
      })
      continue
    }

    let resolucao
    try {
      resolucao = resolverCest(await buscarCandidatosCest(sb, produto.ncm))
    } catch (e) {
      if (!(e instanceof CestIndisponivelError)) throw e
      cestIndisponivel = e.message
      resolucao = { certeza: 'nao_aplica' as const }
    }

    const decisao = escolhaDe.get(produto.id)
    const proposta = proporCorrecao({
      produto, simplesNacional, cfopPadraoVenda: cfopPadrao,
      resolucao,
      cestEscolhido: decisao?.cest ?? null,
    })

    // Os problemas de HOJE, do mesmo conferidor que bloqueia a emissão — não
    // uma segunda opinião escrita aqui, que poderia discordar dele.
    const situacao = simplesNacional
      ? (produto.csosn ?? produto.icms_cst ?? '')
      : (produto.icms_cst ?? '')
    const paraConferir: ItemParaConferir = {
      nome: produto.nome, sku: produto.sku,
      cfop: produto.cfop || cfopPadrao,
      situacao: String(situacao),
      cest: String(produto.cest ?? '').replace(/\D/g, '').length === 7
        ? String(produto.cest).replace(/\D/g, '') : undefined,
    }
    itensParaConferir.push(paraConferir)
    const { erros } = conferirCoerenciaFiscal([paraConferir], simplesNacional)

    propostas.push({ ...proposta, problemas: erros })
  }

  if (acao !== 'aplicar') {
    return NextResponse.json({
      ok: true,
      simplesNacional,
      cestIndisponivel,
      // A conferência do conjunto, que é a que trava a emissão de verdade.
      bloqueios: conferirCoerenciaFiscal(itensParaConferir, simplesNacional).erros,
      pendencias: propostas.filter(p => p.problemas.length > 0 || p.impedimento),
      total: propostas.length,
    })
  }

  // ── APLICAR ────────────────────────────────────────────────────────────────
  if (!decisoes?.length) {
    return NextResponse.json({ ok: false, erro: 'Nenhuma decisão informada' }, { status: 400 })
  }

  const aplicados: { produtoId: string; nome: string; campos: Record<string, string | null> }[] = []
  const recusados: { produtoId: string; motivo: string }[] = []

  for (const decisao of decisoes) {
    const proposta = propostas.find(p => p.produtoId === decisao.produtoId)
    if (!proposta) { recusados.push({ produtoId: decisao.produtoId, motivo: 'Produto não faz parte desta venda.' }); continue }
    if (proposta.impedimento) { recusados.push({ produtoId: decisao.produtoId, motivo: proposta.impedimento }); continue }

    const campos = camposDoCaminho(proposta, decisao.caminho)
    if (!campos) {
      recusados.push({ produtoId: decisao.produtoId, motivo: 'Falta escolher o CEST entre os candidatos da tabela.' })
      continue
    }
    if (Object.keys(campos).length === 0) continue // já estava assim

    const { error } = await sb.from('produtos').update(campos)
      .eq('id', decisao.produtoId).eq('empresa_id', empresaId)
    if (error) { recusados.push({ produtoId: decisao.produtoId, motivo: error.message }); continue }
    aplicados.push({ produtoId: decisao.produtoId, nome: proposta.nome, campos })
  }

  // Reconferência com o estado NOVO, lido do banco. Não basta confiar que o
  // update fez o que a proposta dizia — quem responde se a nota sai é a
  // conferência sobre o que está gravado agora.
  const { data: depois } = produtoIds.length
    ? await sb.from('produtos').select(COLUNAS_FISCAIS).in('id', produtoIds).eq('empresa_id', empresaId)
    : { data: [] as ProdutoFiscal[] }
  const depoisPorId = new Map((depois ?? []).map((p: ProdutoFiscal) => [p.id, p]))

  const conferirDepois: ItemParaConferir[] = itensVenda.map(i => {
    const p = i.produto_id ? depoisPorId.get(i.produto_id) : null
    const situacao = !p ? '' : simplesNacional ? (p.csosn ?? p.icms_cst ?? '') : (p.icms_cst ?? '')
    const cestLimpo = String(p?.cest ?? '').replace(/\D/g, '')
    return {
      nome: p?.nome ?? i.produto_nome, sku: p?.sku ?? null,
      cfop: p?.cfop || cfopPadrao,
      situacao: String(situacao),
      cest: cestLimpo.length === 7 ? cestLimpo : undefined,
    }
  })
  const restantes = conferirCoerenciaFiscal(conferirDepois, simplesNacional).erros

  return NextResponse.json({
    ok: recusados.length === 0,
    aplicados,
    recusados,
    bloqueios: restantes,
    prontaParaEmitir: restantes.length === 0,
  })
}
