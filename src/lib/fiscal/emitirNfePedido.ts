import { getFiscalProvider } from './factory'
import { FiscalProviderError } from './types'
import { resolverEmitente } from './emitirParaVenda'
import { verificarNcm, explicarNcm } from './ncm'
import {
  destinatarioTiktok, destinatarioShopee, destinatarioMercadoLivre, type DestinatarioFiscal,
} from './destinatario'
import { montarNfeDoPedido, type ItemDoPedido, type ResultadoMontagem } from './nfePedido'
import type { RegraPerfil } from './perfilFiscal'
import { buscarDadosFaturamentoML } from '@/lib/mercadolivre/billing'
import { refreshAccessTokenIfNeeded } from '@/lib/mercadolivre/client'
import { enviarNfeAoMarketplace, type ResultadoEnvioCanal } from './enviarNfeAoMarketplace'

// NF-e DE PEDIDO DE MARKETPLACE — a parte que fala com banco e rede.
//
// A montagem (o que vai na nota) é pura e mora em nfePedido.ts. Aqui só se
// carrega o que ela precisa, se chama o provedor e se grava o resultado.
//
// Duas entradas, de propósito com o MESMO caminho até a montagem:
//   · prepararNfeDoPedido — a prévia da tela: "vai sair 6108 / CSOSN 102 para
//     SP", ou a lista do que impede. Não envia nada.
//   · emitirNfeDoPedido — prepara igual e envia.
//
// Diferenças em relação à NFC-e de balcão (emitirParaVenda.ts) que importam:
//   · NÃO cria venda: o pedido já é o registro da venda, e criar uma linha em
//     `vendas` mexeria em relatório e estoque;
//   · quem emite é a empresa escolhida NO CANAL (a nota precisa sair pelo CNPJ
//     da conta do marketplace), resolvida pelo mesmo resolverEmitente;
//   · nota de HOMOLOGAÇÃO não preenche nfe_numero/nfe_chave do pedido — essas
//     colunas movem a esteira e vão na etiqueta, e nota de teste não fatura.

const COLUNAS_PEDIDO = 'id, empresa_id, canal_id, numero_pedido, id_externo, dados_brutos, nfe_numero, nfe_chave, nfe_status, nfe_emissao, destinatario_fiscal'
const COLUNAS_CANAL = 'id, nome, plataforma, empresa_id, empresa_fiscal_id, seller_id, access_token, refresh_token, token_expira_em, intermediador_cnpj, intermediador_id'

export type PreparacaoNfe =
  | { ok: false; erro: string }
  | {
      ok: true
      montagem: ResultadoMontagem
      emitente: { id: string; nome: string; ambiente: 'producao' | 'homologacao' }
      destinatario: DestinatarioFiscal
      pedido: any
    }

async function obterDestinatario(sb: any, pedido: any, canal: any): Promise<DestinatarioFiscal | { erro: string }> {
  switch (canal.plataforma) {
    case 'tiktok':
      return destinatarioTiktok(pedido.dados_brutos)
    case 'shopee':
      return destinatarioShopee(pedido.dados_brutos)
    case 'mercadolivre': {
      // Já buscado numa tentativa anterior: não pergunta de novo ao ML.
      if (pedido.destinatario_fiscal?.fonte === 'mercadolivre') return pedido.destinatario_fiscal
      if (!canal.access_token) return { erro: `Canal "${canal.nome}" não está conectado ao Mercado Livre.` }
      try {
        const ml = await refreshAccessTokenIfNeeded(sb, {
          id: canal.id, empresaId: canal.empresa_id, sellerId: canal.seller_id,
          accessToken: canal.access_token, refreshToken: canal.refresh_token, tokenExpiraEm: canal.token_expira_em,
        })
        return destinatarioMercadoLivre(await buscarDadosFaturamentoML(ml, String(pedido.id_externo)))
      } catch (e: any) {
        return { erro: `Não foi possível buscar os dados de faturamento no Mercado Livre: ${e?.message ?? e}` }
      }
    }
    default:
      return { erro: `NF-e ainda não disponível para pedidos de ${canal.plataforma}.` }
  }
}

export async function prepararNfeDoPedido(sb: any, empresaId: string, pedidoId: string): Promise<PreparacaoNfe> {
  const { data: pedido } = await sb.from('marketplace_pedidos').select(COLUNAS_PEDIDO)
    .eq('id', pedidoId).eq('empresa_id', empresaId).maybeSingle()
  if (!pedido) return { ok: false, erro: 'Pedido não encontrado' }
  const { data: canal } = await sb.from('marketplace_canais').select(COLUNAS_CANAL).eq('id', pedido.canal_id).maybeSingle()
  if (!canal) return { ok: false, erro: 'Canal do pedido não encontrado' }

  // Sem escolha no canal, resolverEmitente cairia na empresa que emite pelo
  // PDV — no grupo, a Ouro e Prata, em produção. Para o PDV isso é a
  // configuração certa; para marketplace, não: a NF-e tem de sair pelo CNPJ
  // da conta de vendedor daquele canal, e "ML Eficaz" faturado pela Ouro e
  // Prata seria uma nota real com o CNPJ errado. Então aqui a escolha é
  // obrigatória.
  if (!canal.empresa_fiscal_id) {
    return {
      ok: false,
      erro: `Escolha qual empresa emite a nota do canal "${canal.nome}" em Marketplaces → canal → Configurar → Nota fiscal. ` +
        `Precisa ser a empresa dona da conta de vendedor no marketplace.`,
    }
  }

  let emitente: Awaited<ReturnType<typeof resolverEmitente>>
  try {
    emitente = await resolverEmitente(sb, empresaId, canal.empresa_fiscal_id)
  } catch (e: any) {
    return { ok: false, erro: e?.message ?? 'Empresa emissora inválida' }
  }
  const [{ data: empresa }, { data: nfeConfig }] = await Promise.all([
    sb.from('empresas').select('nome, nome_fantasia, cnpj, uf, regime_tributario').eq('id', emitente.empresaFiscalId).single(),
    sb.from('nfe_config').select('ambiente').eq('empresa_id', emitente.empresaFiscalId).maybeSingle(),
  ])
  if (!empresa?.cnpj) return { ok: false, erro: 'CNPJ da empresa emitente não cadastrado — preencha em Empresas.' }

  const dest = await obterDestinatario(sb, pedido, canal)
  if ('erro' in dest) return { ok: false, erro: dest.erro }

  const { data: itensPedido } = await sb.from('marketplace_pedido_itens')
    .select('produto_id, nome_produto, sku, quantidade, preco_unitario').eq('pedido_id', pedidoId)
  const produtoIds = [...new Set((itensPedido ?? []).map((i: any) => i.produto_id).filter(Boolean))]
  const { data: produtos } = produtoIds.length > 0
    ? await sb.from('produtos')
        .select('id, nome, sku, ncm, cest, icms_origem, unidade, icms_percentual, pis_cst, pis_percentual, cofins_cst, cofins_percentual, perfil_fiscal_id')
        .in('id', produtoIds)
    : { data: [] as any[] }
  const produtoPorId = new Map((produtos ?? []).map((p: any) => [p.id, p]))

  const perfilIds = [...new Set((produtos ?? []).map((p: any) => p.perfil_fiscal_id).filter(Boolean))]
  const { data: perfis } = perfilIds.length > 0
    ? await sb.from('perfis_fiscais').select('id, nome, perfil_fiscal_regras(regime, situacao, cfop, icms_situacao)').in('id', perfilIds)
    : { data: [] as any[] }
  const perfilPorId = new Map((perfis ?? []).map((p: any) => [p.id, { nome: p.nome, regras: (p.perfil_fiscal_regras ?? []) as RegraPerfil[] }]))

  const itens: ItemDoPedido[] = (itensPedido ?? []).map((i: any) => {
    const p: any = i.produto_id ? produtoPorId.get(i.produto_id) : null
    return {
      nome: i.nome_produto,
      quantidade: Number(i.quantidade),
      precoUnitario: Number(i.preco_unitario),
      produto: p ?? null,
      perfil: p?.perfil_fiscal_id ? perfilPorId.get(p.perfil_fiscal_id) ?? null : null,
    }
  })

  const montagem = montarNfeDoPedido({
    pedido: { id: pedido.id, numero: pedido.numero_pedido || pedido.id_externo },
    canal: { nome: canal.nome, intermediadorCnpj: canal.intermediador_cnpj, intermediadorId: canal.intermediador_id || canal.seller_id },
    emitente: {
      cnpj: empresa.cnpj, uf: empresa.uf, simplesNacional: emitente.simplesNacional,
      regimeTributario: empresa.regime_tributario, naturezaOperacao: emitente.configFiscal?.natureza_operacao ?? null,
    },
    destinatario: dest,
    itens,
  })

  // NCM existente e vigente — a mesma checagem da NFC-e. Fica fora da
  // montagem porque precisa consultar a tabela oficial no banco.
  const problemasNcm: string[] = []
  for (const p of produtos ?? []) {
    const frase = explicarNcm(await verificarNcm(sb, p.ncm))
    if (frase) problemasNcm.push(`${p.nome}: ${frase}`)
  }
  const montagemFinal: ResultadoMontagem = problemasNcm.length === 0 ? montagem
    : { ok: false, erros: [...(montagem.ok ? [] : montagem.erros), ...problemasNcm], resumo: montagem.resumo }

  return {
    ok: true,
    montagem: montagemFinal,
    emitente: {
      id: emitente.empresaFiscalId,
      nome: empresa.nome_fantasia || empresa.nome,
      ambiente: nfeConfig?.ambiente === 'homologacao' ? 'homologacao' : 'producao',
    },
    destinatario: dest,
    pedido,
  }
}

export type ResultadoNfePedido = {
  ok: boolean
  status?: string
  ambiente?: 'producao' | 'homologacao'
  numero?: string
  chave?: string
  danfeUrl?: string
  motivoRejeicao?: string
  erro?: string
  erros?: string[]
  jaEmitida?: boolean
  /** A nota não pôde nem ser montada (produto sem perfil, endereço faltando…). */
  bloqueada?: boolean
  /** Envio da nota ao marketplace, feito logo após a autorização em produção. */
  envioCanal?: ResultadoEnvioCanal
}

// Bloqueio gravado no pedido — só quando quem chama pede (a automação). Sem
// isso, a automação tentaria o mesmo pedido a cada 5 minutos, refazendo a
// consulta ao marketplace, e ninguém veria o motivo na tela do pedido. O
// clique manual não grava: ali o motivo já aparece na hora.
async function registrarBloqueio(sb: any, pedidoId: string, statusAtual: string | null, motivo: string, operador?: string | null) {
  const q = sb.from('marketplace_pedidos').update({
    nfe_status: 'bloqueada',
    nfe_emissao: { status: 'bloqueada', motivoRejeicao: motivo, em: new Date().toISOString(), operador: operador ?? null },
  }).eq('id', pedidoId)
  // Não atropela uma emissão que começou entre a leitura e esta escrita.
  await (statusAtual == null ? q.is('nfe_status', null) : q.eq('nfe_status', statusAtual))
}

export async function emitirNfeDoPedido(
  sb: any, empresaId: string, pedidoId: string, operador?: string | null,
  opts?: { registrarBloqueio?: { statusAtual: string | null } },
): Promise<ResultadoNfePedido> {
  const prep = await prepararNfeDoPedido(sb, empresaId, pedidoId)
  if (!prep.ok) {
    if (opts?.registrarBloqueio && prep.erro !== 'Pedido não encontrado') {
      await registrarBloqueio(sb, pedidoId, opts.registrarBloqueio.statusAtual, prep.erro, operador)
    }
    return { ok: false, erro: prep.erro, bloqueada: true }
  }
  const { pedido, emitente, montagem } = prep

  if (pedido.nfe_status === 'autorizada' && pedido.nfe_emissao?.ambiente === 'producao') {
    return { ok: true, jaEmitida: true, status: 'autorizada', ambiente: 'producao', numero: pedido.nfe_numero, chave: pedido.nfe_chave }
  }
  // Nota emitida fora do sistema e informada à mão ("Informar NF"). Emitir de
  // novo seria faturar a mesma venda duas vezes.
  if (pedido.nfe_numero && pedido.nfe_status !== 'autorizada') {
    return { ok: false, erro: `Este pedido já tem a NF-e nº ${pedido.nfe_numero} informada. Não é possível emitir outra.` }
  }
  if (!montagem.ok) {
    if (opts?.registrarBloqueio) {
      await registrarBloqueio(sb, pedidoId, opts.registrarBloqueio.statusAtual, montagem.erros.join('\n'), operador)
    }
    return { ok: false, erros: montagem.erros, bloqueada: true }
  }

  // Trava contra clique duplo / duas abas: só uma emissão por vez por pedido.
  // Otimista: só vira "processando" se o status ainda for o que acabamos de
  // ler — se outra requisição chegou antes, nenhuma linha muda. A trava
  // vence em 3 minutos, para uma emissão que morreu no meio (queda da função)
  // não prender o pedido para sempre.
  const desde = Date.parse(pedido.nfe_emissao?.processandoDesde ?? '')
  if (pedido.nfe_status === 'processando' && Date.now() - desde < 3 * 60_000) {
    return { ok: false, erro: 'Já existe uma emissão em andamento para este pedido. Aguarde e atualize a tela.' }
  }
  const trava = sb.from('marketplace_pedidos')
    .update({ nfe_status: 'processando', nfe_emissao: { ...(pedido.nfe_emissao ?? {}), processandoDesde: new Date().toISOString() } })
    .eq('id', pedidoId)
  const { data: travado } = await (pedido.nfe_status == null ? trava.is('nfe_status', null) : trava.eq('nfe_status', pedido.nfe_status)).select('id')
  if (!travado?.length) {
    return { ok: false, erro: 'Já existe uma emissão em andamento para este pedido. Aguarde e atualize a tela.' }
  }

  const registro: Record<string, any> = {
    ambiente: emitente.ambiente,
    emitenteId: emitente.id,
    emitenteNome: emitente.nome,
    em: new Date().toISOString(),
    operador: operador ?? null,
    resumo: montagem.resumo,
  }

  try {
    const provider = await getFiscalProvider(sb, emitente.id)
    const r = await provider.emissao.emitirNFe(montagem.input)
    Object.assign(registro, {
      status: r.status, numero: r.numero ?? null, chave: r.chave ?? null, serie: r.serie ?? null,
      protocolo: r.protocolo ?? null, danfeUrl: r.danfeUrl ?? null, xmlUrl: r.xmlUrl ?? null,
      motivoRejeicao: r.motivoRejeicao ?? null, provedor: provider.nome,
    })
    const faturou = r.status === 'autorizada' && emitente.ambiente === 'producao'
    await sb.from('marketplace_pedidos').update({
      nfe_status: r.status,
      nfe_emissao: registro,
      destinatario_fiscal: prep.destinatario,
      ...(faturou ? { nfe_numero: r.numero ?? null, nfe_chave: r.chave ?? null } : {}),
    }).eq('id', pedidoId)

    try {
      await sb.from('nfe_logs').insert({
        empresa_id: emitente.id,
        acao: 'emitir_nfe_pedido',
        descricao: `Pedido ${pedido.numero_pedido ?? pedidoId} — ${r.status} (${emitente.ambiente})`,
        dados: { pedidoId, status: r.status, chave: r.chave, motivoRejeicao: r.motivoRejeicao, ambiente: emitente.ambiente },
        operador: operador ?? null,
      })
    } catch {}

    // Nota autorizada em produção vai direto para o marketplace — é o que
    // libera a etiqueta. Falha aqui NÃO desfaz a nota: ela está emitida; o
    // erro fica no pedido, com botão para reenviar e nova tentativa da
    // automação. Por isso o try próprio, fora do catch de emissão abaixo.
    let envioCanal: ResultadoEnvioCanal | undefined
    if (faturou) {
      try {
        envioCanal = await enviarNfeAoMarketplace(sb, empresaId, pedidoId)
      } catch (e: any) {
        envioCanal = { ok: false, erro: e?.message ?? 'Erro ao enviar a nota ao marketplace' }
      }
    }

    return {
      ok: r.status === 'autorizada', status: r.status, ambiente: emitente.ambiente,
      numero: r.numero, chave: r.chave, danfeUrl: r.danfeUrl, motivoRejeicao: r.motivoRejeicao,
      envioCanal,
    }
  } catch (e: any) {
    const erro = e instanceof FiscalProviderError ? e.message : (e?.message ?? 'Erro ao emitir NF-e')
    await sb.from('marketplace_pedidos').update({
      nfe_status: 'erro',
      nfe_emissao: { ...registro, status: 'erro', motivoRejeicao: erro },
      destinatario_fiscal: prep.destinatario,
    }).eq('id', pedidoId)
    return { ok: false, status: 'erro', ambiente: emitente.ambiente, erro }
  }
}
