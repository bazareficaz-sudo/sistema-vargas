import type { EmissaoNFeInput, EmissaoNFeItem } from './types'
import type { DestinatarioFiscal } from './destinatario'
import { pendenciasDestinatario, explicarPendencias } from './destinatario'
import {
  situacaoDaOperacao, regraDoPerfil, regimeDoEmitente, exigeDifal, SITUACOES,
  type RegraPerfil, type SituacaoOperacao, type RegimeRegra,
} from './perfilFiscal'
import { SITUACAO_COM_ST } from './coerencia'

// MONTAGEM DA NF-e DE UM PEDIDO DE MARKETPLACE — sem banco, sem rede.
//
// Recebe tudo já carregado e devolve OU a nota pronta para o provedor, OU a
// lista do que impede a emissão. É a mesma função que a tela usa para
// pré-visualizar ("o que vai sair na nota") e que a emissão usa para enviar:
// uma conta só, para a prévia nunca mostrar uma coisa e a nota sair outra
// (o defeito que coerencia.ts já documenta na NFC-e).
//
// DECISÕES QUE A CONTABILIDADE PRECISA CONFIRMAR (e que por isso estão aqui,
// nomeadas, e não espalhadas):
//
//   · VALOR: a nota leva cada item pelo preço do pedido × quantidade. Sem
//     frete e sem o desconto/cupom da plataforma — o frete do marketplace é
//     cobrado e pago dentro da logística dele.
//   · FRETE: modalidade 0 (contratado pelo remetente), que é como funciona a
//     logística do marketplace na conta do vendedor.
//   · PAGAMENTO: 99 "Outros", descrito como pagamento pelo marketplace — quem
//     recebe do comprador é o marketplace, não a loja.

export const MODALIDADE_FRETE_MARKETPLACE = 0

export type ProdutoDaNota = {
  id: string
  nome: string
  sku: string | null
  ncm: string | null
  cest: string | null
  icms_origem: number | null
  unidade: string | null
  icms_percentual: number | null
  pis_cst: string | null
  pis_percentual: number | null
  cofins_cst: string | null
  cofins_percentual: number | null
}

export type ItemDoPedido = {
  nome: string
  quantidade: number
  precoUnitario: number
  produto: ProdutoDaNota | null
  perfil: { nome: string; regras: RegraPerfil[] } | null
}

export type DadosNfePedido = {
  pedido: { id: string; numero: string }
  canal: { nome: string; intermediadorCnpj: string | null; intermediadorId: string | null }
  emitente: {
    cnpj: string
    uf: string | null
    simplesNacional: boolean
    /** empresas.regime_tributario — decide PIS/COFINS cumulativo ou não. */
    regimeTributario: string | null
    naturezaOperacao: string | null
  }
  destinatario: DestinatarioFiscal
  itens: ItemDoPedido[]
}

export type LinhaResumo = {
  nome: string
  sku: string | null
  quantidade: number
  valor: number
  perfil: string | null
  cfop: string | null
  icmsSituacao: string | null
  aliquotaIcms: number | null
}

export type ResumoNfe = {
  situacao: SituacaoOperacao | null
  situacaoRotulo: string | null
  regime: RegimeRegra
  difal: boolean
  total: number
  linhas: LinhaResumo[]
}

export type ResultadoMontagem =
  | { ok: true; input: EmissaoNFeInput; resumo: ResumoNfe }
  | { ok: false; erros: string[]; resumo: ResumoNfe }

const REGIAO_SUL_SUDESTE_SEM_ES = new Set(['SP', 'RJ', 'MG', 'PR', 'SC', 'RS'])

/**
 * Alíquota interestadual de ICMS (Resolução do Senado 22/1989 e 13/2012).
 *   · mercadoria importada (origem 1, 2, 3 ou 8): 4%;
 *   · de Sul/Sudeste (menos ES) para Norte, Nordeste, Centro-Oeste ou ES: 7%;
 *   · demais: 12%.
 */
export function aliquotaInterestadual(ufOrigem: string, ufDestino: string, origemProduto: number | null): number {
  if ([1, 2, 3, 8].includes(Number(origemProduto))) return 4
  if (REGIAO_SUL_SUDESTE_SEM_ES.has(ufOrigem) && !REGIAO_SUL_SUDESTE_SEM_ES.has(ufDestino)) return 7
  return 12
}

const CST_ICMS_TRIBUTADO = new Set(['00', '20'])
const CST_PIS_COM_ALIQUOTA = new Set(['01', '02'])

// Operação com ST exige o CEST — a SEFAZ recusa com "Rejeição 806" (a mesma
// rede de coerencia.ts na NFC-e, aqui para os CFOPs da NF-e).
function conferirCEST(cfop: string, icmsSituacao: string, cest: string | null): string | null {
  const temST = /^[56]40\d$/.test(cfop) || SITUACAO_COM_ST.has(icmsSituacao)
  if (!temST || String(cest ?? '').replace(/\D/g, '').length === 7) return null
  return `operação com substituição tributária (CFOP ${cfop}, ${icmsSituacao}) sem CEST cadastrado — ` +
    `a SEFAZ recusa com "Rejeição 806". Preencha o CEST na aba Fiscal do produto.`
}

function dinheiro(v: number): number {
  return Math.round(v * 100) / 100
}

export function montarNfeDoPedido(d: DadosNfePedido): ResultadoMontagem {
  const erros: string[] = []
  const regime = regimeDoEmitente(d.emitente.simplesNacional)
  const naoCumulativo = d.emitente.regimeTributario === 'lucro_real'
  const resumo: ResumoNfe = { situacao: null, situacaoRotulo: null, regime, difal: false, total: 0, linhas: [] }

  // Destinatário primeiro: sem a UF dele não há situação, e sem situação
  // nenhum item tem CFOP. Pendência aqui vira UMA frase, não uma por item.
  const pendencias = pendenciasDestinatario(d.destinatario)
  if (pendencias.length > 0) erros.push(explicarPendencias(d.destinatario, pendencias))

  const sit = situacaoDaOperacao(d.emitente.uf, {
    uf: d.destinatario.endereco.uf, inscricaoEstadual: d.destinatario.inscricaoEstadual,
  })
  if (!sit.ok) {
    if (pendencias.length === 0 || !/destinatário/.test(sit.erro)) erros.push(sit.erro)
  } else {
    resumo.situacao = sit.situacao
    resumo.situacaoRotulo = SITUACOES.find(s => s.chave === sit.situacao)?.rotulo ?? null
    resumo.difal = exigeDifal(regime, sit.situacao)
  }

  if (!d.canal.intermediadorCnpj || d.canal.intermediadorCnpj.replace(/\D/g, '').length !== 14) {
    erros.push(`O canal "${d.canal.nome}" está sem o CNPJ do marketplace (intermediador). ` +
      `Venda por marketplace exige esse dado na NF-e — preencha em Marketplaces → canal → Configurar.`)
  }

  const itens: EmissaoNFeItem[] = []
  d.itens.forEach((it, idx) => {
    const p = it.produto
    const valor = dinheiro(it.quantidade * it.precoUnitario)
    resumo.total = dinheiro(resumo.total + valor)
    const linha: LinhaResumo = {
      nome: p?.nome ?? it.nome, sku: p?.sku ?? null, quantidade: it.quantidade, valor,
      perfil: it.perfil?.nome ?? null, cfop: null, icmsSituacao: null, aliquotaIcms: null,
    }
    resumo.linhas.push(linha)
    const quem = p?.sku ? `${p.nome} (SKU ${p.sku})` : (p?.nome ?? it.nome)

    if (!p) { erros.push(`${it.nome}: item sem produto vinculado — mapeie o anúncio antes de emitir.`); return }
    if (!it.perfil) {
      erros.push(`${quem}: sem perfil fiscal. Defina na aba Fiscal do produto ou em Produtos → Perfis fiscais.`)
      return
    }
    if (!sit.ok) return

    const r = regraDoPerfil(it.perfil, regime, sit.situacao)
    if (!r.ok) { erros.push(`${quem}: ${r.erro}`); return }
    linha.cfop = r.cfop
    linha.icmsSituacao = r.icmsSituacao

    // Alíquota de ICMS só existe no regime normal com CST tributado. No
    // Simples (CSOSN 102/500) e no CST 60 não se destaca ICMS.
    let aliquotaIcms: number | undefined
    if (regime === 'normal' && CST_ICMS_TRIBUTADO.has(r.icmsSituacao)) {
      if (sit.interestadual) {
        aliquotaIcms = aliquotaInterestadual(d.emitente.uf!, d.destinatario.endereco.uf!, p.icms_origem)
      } else if (p.icms_percentual != null && p.icms_percentual > 0) {
        aliquotaIcms = Number(p.icms_percentual)
      } else {
        erros.push(`${quem}: venda dentro do estado com CST ${r.icmsSituacao} precisa da alíquota de ICMS ` +
          `(aba Fiscal do produto, campo "ICMS %").`)
        return
      }
      linha.aliquotaIcms = aliquotaIcms
    }

    const cestProblema = conferirCEST(r.cfop, r.icmsSituacao, p.cest)
    if (cestProblema) { erros.push(`${quem}: ${cestProblema}`); return }

    // PIS/COFINS: o do produto, senão o padrão do regime (o mesmo de
    // regimeDefault.ts). No Simples vão sem alíquota — estão no DAS.
    const pisCst = p.pis_cst || (regime === 'simples' ? '49' : '01')
    const cofinsCst = p.cofins_cst || (regime === 'simples' ? '49' : '01')
    const pisAliquota = CST_PIS_COM_ALIQUOTA.has(pisCst)
      ? Number(p.pis_percentual ?? (naoCumulativo ? 1.65 : 0.65)) : undefined
    const cofinsAliquota = CST_PIS_COM_ALIQUOTA.has(cofinsCst)
      ? Number(p.cofins_percentual ?? (naoCumulativo ? 7.6 : 3)) : undefined

    itens.push({
      numeroItem: idx + 1,
      produtoId: p.id,
      codigoProduto: p.sku || p.id,
      descricao: p.nome,
      ncm: String(p.ncm ?? '').replace(/\D/g, ''),
      cfop: r.cfop,
      unidade: p.unidade || 'UN',
      quantidade: it.quantidade,
      valorUnitario: it.precoUnitario,
      valorDesconto: 0,
      icmsOrigem: String(p.icms_origem ?? 0),
      icmsSituacaoTributaria: r.icmsSituacao,
      pisCst,
      cofinsCst,
      ...(p.cest ? { cest: String(p.cest).replace(/\D/g, '') } : {}),
      ...(aliquotaIcms != null ? { aliquotaIcms } : {}),
      ...(pisAliquota != null ? { pisAliquota } : {}),
      ...(cofinsAliquota != null ? { cofinsAliquota } : {}),
    })
  })

  if (d.itens.length === 0) erros.push('Pedido sem itens.')
  if (erros.length > 0 || !sit.ok) return { ok: false, erros, resumo }

  const dest = d.destinatario
  const doc = dest.cpfCnpj!
  const e = dest.endereco
  const input: EmissaoNFeInput = {
    referencia: d.pedido.id,
    cnpjEmitente: d.emitente.cnpj,
    naturezaOperacao: d.emitente.naturezaOperacao || 'Venda de mercadoria',
    // Consumidor final = quem não tem IE. Contribuinte compra para revender.
    consumidorFinal: !sit.contribuinte,
    destinatario: {
      nome: dest.nome!,
      ...(doc.length === 11 ? { cpf: doc } : { cnpj: doc }),
      indicadorIe: sit.contribuinte ? 1 : 9,
      ...(sit.contribuinte && dest.inscricaoEstadual ? { inscricaoEstadual: dest.inscricaoEstadual } : {}),
      endereco: {
        logradouro: e.logradouro!,
        numero: e.numero || 'S/N',
        ...(e.complemento ? { complemento: e.complemento } : {}),
        bairro: e.bairro!,
        cep: e.cep!,
        municipio: e.municipio!,
        uf: e.uf!,
      },
    },
    intermediador: {
      cnpj: d.canal.intermediadorCnpj!.replace(/\D/g, ''),
      idCadastro: d.canal.intermediadorId || d.canal.nome,
    },
    modalidadeFrete: MODALIDADE_FRETE_MARKETPLACE,
    itens,
    pagamentos: [{ forma: 'marketplace', codigoSefaz: '99', valor: resumo.total, descricao: `Pagamento via ${d.canal.nome}` }],
    observacao: `Pedido ${d.canal.nome} nº ${d.pedido.numero}`,
  }
  return { ok: true, input, resumo }
}
