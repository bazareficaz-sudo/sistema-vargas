import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { resolverEmitente } from '@/lib/fiscal/emitirParaVenda'
import { conferirCoerenciaFiscal, situacaoTributariaIcms, type ItemParaConferir } from '@/lib/fiscal/coerencia'
import { buscarCandidatosCest, resolverCest, CestIndisponivelError } from '@/lib/fiscal/cest'
import { verificarNcm, vizinhosDoNcm, explicarNcm, apenasDigitos, type CandidatoNcm } from '@/lib/fiscal/ncm'
import { proporCorrecao, camposDoCaminho, type ProdutoFiscal, type IdCaminho } from '@/lib/fiscal/correcao'

// PENDÊNCIAS FISCAIS DE UMA VENDA — diagnosticar e resolver sem abrir cadastro.
//
// `acao: 'diagnosticar'` devolve, por produto, o que está errado e os caminhos
// possíveis com a evidência de cada um.
// `acao: 'aplicar'` grava as escolhas e reconfere.
//
// O CLIENTE NÃO MANDA CÓDIGO FISCAL. Ele manda, por produto, qual caminho
// seguir ('com_st' | 'sem_st') e, quando há mais de uma opção na tabela
// oficial, qual CEST ou qual NCM — sempre entre os que a tabela ofereceu. O
// servidor reconstrói a proposta inteira do zero e grava o que ELE calculou.
//
// Se a rota aceitasse `{ cfop, csosn, cest, ncm }` do cliente, esta tela
// viraria um jeito de escrever qualquer coisa no cadastro fiscal de qualquer
// produto, sem passar por nenhuma das validações que existem para impedir nota
// recusada.
//
// A ORDEM IMPORTA: o NCM decide o CEST. Trocar o NCM sem refazer a consulta de
// CEST deixaria o produto com um CEST da classificação antiga — por isso, ao
// aplicar, tudo é recalculado a partir do NCM escolhido.

type Decisao = { produtoId: string; caminho: IdCaminho; cest?: string | null; ncm?: string | null }

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

  let cestIndisponivel: string | null = null

  /**
   * Tudo o que se sabe sobre UM produto, a partir da escolha do operador.
   *
   * O NCM entra primeiro porque ele decide o CEST. É por isso que esta função
   * existe em vez de um trecho solto: ela é chamada no diagnóstico e de novo na
   * gravação, com a mesma ordem, e assim as duas não podem divergir.
   */
  async function montarProposta(produto: ProdutoFiscal, decisao?: Decisao) {
    const ncmDoCadastro = apenasDigitos(produto.ncm)
    const escolhidoNcm = apenasDigitos(decisao?.ncm)

    let candidatosNcm: CandidatoNcm[] = []
    let ncmEfetivo = ncmDoCadastro
    let problemaNcm: string | null = null

    const situacao = await verificarNcm(sb, ncmDoCadastro)
    if (situacao.situacao !== 'vigente') {
      candidatosNcm = await vizinhosDoNcm(sb, ncmDoCadastro)
      // A escolha só vale se estiver na lista que a tabela ofereceu. Fora dela
      // não é escolha, é digitação — e foi digitação livre (da IA) que pôs um
      // NCM inexistente no cadastro.
      if (escolhidoNcm && candidatosNcm.some(c => c.codigo === escolhidoNcm)) {
        ncmEfetivo = escolhidoNcm
      } else {
        problemaNcm = explicarNcm(situacao)
      }
    }

    let resolucao
    try {
      resolucao = resolverCest(await buscarCandidatosCest(sb, ncmEfetivo))
    } catch (e) {
      if (!(e instanceof CestIndisponivelError)) throw e
      cestIndisponivel = e.message
      resolucao = { certeza: 'nao_aplica' as const }
    }

    const proposta = proporCorrecao({
      produto: { ...produto, ncm: ncmEfetivo },
      simplesNacional,
      cfopPadraoVenda: cfopPadrao,
      resolucao,
      cestEscolhido: decisao?.cest ?? null,
    })

    const cestLimpo = apenasDigitos(produto.cest)
    const paraConferir: ItemParaConferir = {
      nome: produto.nome, sku: produto.sku,
      cfop: produto.cfop || cfopPadrao,
      // A MESMA função da emissão, não uma leitura parecida.
      situacao: situacaoTributariaIcms(produto, simplesNacional),
      cest: cestLimpo.length === 7 ? cestLimpo : undefined,
    }
    const { erros } = conferirCoerenciaFiscal([paraConferir], simplesNacional)

    const pendencia = {
      ...proposta,
      // O problema de NCM vem PRIMEIRO: sem classificação válida, discutir
      // CFOP e CEST é discutir o par certo do produto errado.
      problemas: [...(problemaNcm ? [`${produto.nome}: ${problemaNcm}`] : []), ...erros],
      candidatosNcm,
      ncmEfetivo,
      // Enquanto o NCM não estiver resolvido, nada é gravado — nem o que já
      // estaria certo. Gravar CFOP/CSOSN sobre classificação inválida só
      // trocaria uma rejeição por outra.
      impedimento: problemaNcm
        ? (candidatosNcm.length > 0
            ? 'Escolha o NCM correto abaixo para poder corrigir o resto.'
            : 'Corrija o NCM no cadastro do produto — a nomenclatura oficial não tem código parecido para sugerir.')
        : proposta.impedimento,
    }
    return { pendencia, paraConferir }
  }

  const propostas = []
  const itensParaConferir: ItemParaConferir[] = []
  for (const item of itensVenda) {
    const produto = item.produto_id ? porId.get(item.produto_id) : null
    if (!produto) {
      propostas.push({
        produtoId: item.produto_id ?? null,
        nome: item.produto_nome, sku: null,
        problemas: ['Item sem produto vinculado no cadastro — não há campo fiscal para corrigir.'],
        recomendado: null, evidencia: '', caminhos: [], candidatosCest: [], candidatosNcm: [],
        impedimento: 'Vincule o item a um produto para poder corrigir os dados fiscais.',
      })
      continue
    }
    const { pendencia, paraConferir } = await montarProposta(produto, escolhaDe.get(produto.id))
    propostas.push(pendencia)
    itensParaConferir.push(paraConferir)
  }

  // Os bloqueios que travam a emissão: o par CFOP × situação × CEST, mais o
  // NCM, que a conferência de coerência não olha (ela não tem a nomenclatura).
  const bloqueiosNcm = propostas.flatMap(p =>
    p.problemas.filter(m => m.includes('Rejeição 778') || m.includes('sem NCM cadastrado')))
  const bloqueios = [...bloqueiosNcm, ...conferirCoerenciaFiscal(itensParaConferir, simplesNacional).erros]

  if (acao !== 'aplicar') {
    return NextResponse.json({
      ok: true, simplesNacional, cestIndisponivel, bloqueios,
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
    const produto = porId.get(decisao.produtoId)
    if (!produto) { recusados.push({ produtoId: decisao.produtoId, motivo: 'Produto não faz parte desta venda.' }); continue }

    // Recalculada do zero, com a escolha desta decisão — inclusive o NCM, que
    // muda o CEST. O que veio do cliente é só a escolha; os valores são estes.
    const { pendencia: proposta } = await montarProposta(produto, decisao)
    if (proposta.impedimento) { recusados.push({ produtoId: decisao.produtoId, motivo: proposta.impedimento }); continue }

    const campos = camposDoCaminho(proposta, decisao.caminho)
    if (!campos) {
      recusados.push({ produtoId: decisao.produtoId, motivo: 'Falta escolher o CEST entre os candidatos da tabela.' })
      continue
    }
    // O NCM escolhido entra junto, e só depois de ter passado pela validação
    // dentro de `montarProposta`.
    if (proposta.ncmEfetivo && proposta.ncmEfetivo !== apenasDigitos(produto.ncm)) {
      campos.ncm = proposta.ncmEfetivo
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

  const restantes: string[] = []
  const conferirDepois: ItemParaConferir[] = []
  for (const i of itensVenda) {
    const p = i.produto_id ? depoisPorId.get(i.produto_id) : null
    if (!p) { restantes.push(`${i.produto_nome}: sem produto vinculado.`); continue }
    const s = await verificarNcm(sb, p.ncm)
    const frase = explicarNcm(s)
    if (frase) restantes.push(`${p.nome}: ${frase}`)
    const cestLimpo = apenasDigitos(p.cest)
    conferirDepois.push({
      nome: p.nome, sku: p.sku,
      cfop: p.cfop || cfopPadrao,
      situacao: situacaoTributariaIcms(p, simplesNacional),
      cest: cestLimpo.length === 7 ? cestLimpo : undefined,
    })
  }
  restantes.push(...conferirCoerenciaFiscal(conferirDepois, simplesNacional).erros)

  return NextResponse.json({
    ok: recusados.length === 0,
    aplicados, recusados,
    bloqueios: restantes,
    prontaParaEmitir: restantes.length === 0,
  })
}
