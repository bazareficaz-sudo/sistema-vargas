import type { CandidatoCest, ResolucaoCest } from './cest'

// PROPOSTA DE CORREÇÃO FISCAL — resolver a pendência sem abrir o cadastro.
//
// Por que isto existe: a conferência de coerência (coerencia.ts) já diz, com o
// nome do produto, o que está errado e qual seria o par certo. Mas quem está no
// balcão com a venda travada tinha que ler a mensagem, abrir o cadastro do
// produto, achar a aba Fiscal, traduzir a frase em três campos e voltar. Numa
// venda de cinco itens com três problemas, são três viagens.
//
// A frase já continha a resposta. Faltava a mão.
//
// NADA AQUI É PALPITE DE IA. Código fiscal não se deduz do nome do produto:
//
//   · CFOP e CST/CSOSN saem do REGIME de quem emite a nota, combinados com uma
//     única pergunta de fato — a mercadoria está em substituição tributária?
//   · A resposta dessa pergunta sai da TABELA OFICIAL do Convênio ICMS
//     142/2018 (`cest_tabela`), consultada pelo NCM. É o mesmo caminho que
//     `cest.ts` já usa, e pela mesma razão: CEST é tabela, não dedução.
//   · O CEST sai da mesma consulta.
//
// A IA entra em um lugar só, e fora deste arquivo: sugerir o NCM quando ele
// não existe. Sem NCM não há o que consultar, e aí não há proposta nenhuma.
//
// O QUE ESTE MÓDULO NÃO DECIDE, E POR QUÊ
//
// Constar na tabela do Convênio 142/2018 significa que a mercadoria PODE estar
// sujeita a ST. Se ela efetivamente está depende do protocolo/convênio entre os
// estados envolvidos e de o imposto ter sido retido antes, na cadeia. Um mesmo
// NCM pode chegar com ST recolhido de um fornecedor e sem ST de outro.
//
// Por isso os DOIS caminhos são sempre calculados e oferecidos. A tabela diz
// qual é o provável e mostra a evidência; quem confirma é gente. O sistema tira
// o trabalho de navegar e de saber os pares de cor — não tira a decisão.

export type ProdutoFiscal = {
  id: string
  nome: string
  sku?: string | null
  ncm?: string | null
  cest?: string | null
  cfop?: string | null
  csosn?: string | null
  icms_cst?: string | null
}

export type CampoFiscal = 'cfop' | 'csosn' | 'icms_cst' | 'cest'

export type Mudanca = { campo: CampoFiscal; de: string | null; para: string | null }

export type IdCaminho = 'com_st' | 'sem_st'

export type Caminho = {
  id: IdCaminho
  titulo: string
  /** O fundamento, em uma frase, para aparecer na tela ao lado do botão. */
  fundamento: string
  mudancas: Mudanca[]
  /** Falta escolher o CEST entre vários — o caminho existe mas não está pronto. */
  faltaEscolherCest: boolean
}

export type PropostaCorrecao = {
  produtoId: string
  nome: string
  sku: string | null
  /** Recomendação da tabela oficial. `null` = não há evidência para recomendar. */
  recomendado: IdCaminho | null
  evidencia: string
  caminhos: Caminho[]
  candidatosCest: CandidatoCest[]
  /** Preenchido quando nem proposta dá para montar (falta NCM). */
  impedimento?: string
}

/** Normaliza para comparação: '' e null são a mesma ausência. */
function ou(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim()
  return s === '' ? null : s
}

function mudanca(campo: CampoFiscal, de: string | null | undefined, para: string | null): Mudanca | null {
  const atual = ou(de)
  if (atual === para) return null
  return { campo, de: atual, para }
}

/**
 * O par de códigos de cada caminho, e de onde ele vem.
 *
 * COM ST (mercadoria já veio com o ICMS retido pelo fornecedor — o varejo é o
 * contribuinte SUBSTITUÍDO):
 *   CFOP 5405 · "venda de mercadoria adquirida de terceiros, em operação com
 *   mercadoria sujeita a ST, na condição de contribuinte substituído"
 *   CSOSN 500 (Simples) · "ICMS cobrado anteriormente por substituição
 *   tributária ou por antecipação"
 *   CST 60 (regime normal) · mesmo conceito
 *   + CEST obrigatório: sem ele a SEFAZ recusa com a rejeição 806.
 *
 * SEM ST (revenda comum):
 *   CFOP 5102 (ou o de venda dentro do estado configurado na empresa)
 *   CSOSN 102 (Simples) · "tributada pelo Simples sem permissão de crédito"
 *   CST 00 (regime normal) · tributada integralmente
 *   e o CEST sai do cadastro: declarar CEST sem ST é declarar ST.
 *
 * O 5403 NÃO aparece em nenhum dos dois de propósito: ele é do contribuinte
 * SUBSTITUTO, quem retém o imposto da cadeia seguinte. Numa venda a consumidor
 * final não há cadeia seguinte, e a NFC-e o recusa (ver CFOP_VALIDO_NFCE em
 * coerencia.ts). É justamente o código que costuma ser copiado da nota do
 * fornecedor por engano.
 */
function montarCaminho(
  id: IdCaminho,
  produto: ProdutoFiscal,
  simplesNacional: boolean,
  cfopPadraoVenda: string,
  cestParaAplicar: string | null,
  faltaEscolherCest: boolean,
): Caminho {
  const comST = id === 'com_st'
  const cfop = comST ? '5405' : (ou(cfopPadraoVenda) ?? '5102')
  const situacao = comST ? (simplesNacional ? '500' : '60') : (simplesNacional ? '102' : '00')

  const mudancas = [
    mudanca('cfop', produto.cfop, cfop),
    // Um regime só. Preencher os dois deixa o cadastro ambíguo, e foi
    // exatamente isso que produziu o par quebrado desta venda: produto com
    // CST 60 (regime normal) sendo emitido por empresa do Simples, que ignora
    // o CST, não acha CSOSN e cai no padrão 102 — contradizendo o CFOP 5405.
    simplesNacional ? mudanca('csosn', produto.csosn, situacao) : mudanca('csosn', produto.csosn, null),
    simplesNacional ? mudanca('icms_cst', produto.icms_cst, null) : mudanca('icms_cst', produto.icms_cst, situacao),
    mudanca('cest', produto.cest, comST ? cestParaAplicar : null),
  ].filter((m): m is Mudanca => m !== null)

  const nomeSituacao = simplesNacional ? 'CSOSN' : 'CST'
  return {
    id,
    titulo: comST
      ? `Tem ST — o imposto já foi recolhido antes (CFOP 5405 · ${nomeSituacao} ${situacao})`
      : `Não tem ST — revenda comum (CFOP ${cfop} · ${nomeSituacao} ${situacao})`,
    fundamento: comST
      ? 'Revenda de mercadoria com ICMS-ST já retido pelo fornecedor: a loja é contribuinte substituído. O CEST é obrigatório nesse caso.'
      : 'Revenda tributada normalmente, sem substituição tributária. O CEST sai do cadastro — declará-lo sem ST é declarar ST.',
    mudancas,
    faltaEscolherCest: comST && faltaEscolherCest,
  }
}

/**
 * Monta a proposta para UM produto.
 *
 * Pura: recebe a evidência já resolvida (a consulta ao banco fica na rota) e
 * devolve os dois caminhos com a recomendação. Assim dá para prender em teste
 * cada combinação sem subir banco.
 */
export function proporCorrecao(entrada: {
  produto: ProdutoFiscal
  simplesNacional: boolean
  cfopPadraoVenda: string
  resolucao: ResolucaoCest
  /** Escolha do operador quando a tabela devolve mais de um CEST. */
  cestEscolhido?: string | null
}): PropostaCorrecao {
  const { produto, simplesNacional, cfopPadraoVenda, resolucao } = entrada
  const ncm = ou(produto.ncm)

  const candidatos = resolucao.certeza === 'ambiguo' ? resolucao.candidatos : []
  const escolhido = ou(entrada.cestEscolhido)
  const permitidos = new Set(candidatos.map(c => c.cest))

  const cestParaAplicar =
    resolucao.certeza === 'unico' ? resolucao.cest
    // A escolha do operador só vale se estiver na lista que a tabela permitiu.
    // Fora dela não é escolha, é digitação — e CEST digitado errado em produto
    // com ST vira recusa na SEFAZ ou recolhimento errado.
    : (escolhido && permitidos.has(escolhido)) ? escolhido
    : null

  const faltaEscolherCest = resolucao.certeza === 'ambiguo' && cestParaAplicar === null

  const caminhos = [
    montarCaminho('com_st', produto, simplesNacional, cfopPadraoVenda, cestParaAplicar, faltaEscolherCest),
    montarCaminho('sem_st', produto, simplesNacional, cfopPadraoVenda, null, false),
  ]

  const base = {
    produtoId: produto.id,
    nome: produto.nome,
    sku: ou(produto.sku),
    caminhos,
    candidatosCest: candidatos,
  }

  if (!ncm) {
    return {
      ...base,
      recomendado: null,
      evidencia: 'Sem NCM, não há como consultar a tabela de substituição tributária.',
      impedimento: 'Preencha o NCM primeiro — é o que permite consultar a tabela oficial. O botão "Preencher fiscal" no cadastro sugere um.',
    }
  }

  if (resolucao.certeza === 'nao_aplica') {
    return {
      ...base,
      recomendado: 'sem_st',
      evidencia: `O NCM ${ncm} não consta na tabela do Convênio ICMS 142/2018. Nenhum CEST se aplica, o que indica mercadoria fora da substituição tributária.`,
    }
  }

  const quantos = resolucao.certeza === 'unico' ? 1 : resolucao.candidatos.length
  const quais = resolucao.certeza === 'unico'
    ? `CEST ${resolucao.cest} (${resolucao.descricao})`
    : `${quantos} CEST possíveis`

  return {
    ...base,
    recomendado: 'com_st',
    evidencia: `O NCM ${ncm} consta na tabela do Convênio ICMS 142/2018 como ${quais}. Isso indica mercadoria da lista de substituição tributária — confirme se o ICMS-ST já foi retido pelo fornecedor.`,
  }
}

/**
 * Os campos a gravar, a partir do caminho escolhido.
 *
 * Separado de propósito: a rota que grava reconstrói a proposta do zero, a
 * partir da mesma evidência, e só aceita do cliente QUAL caminho seguir — nunca
 * os valores. Se o cliente pudesse mandar os códigos, esta tela viraria um jeito
 * de escrever qualquer coisa no cadastro fiscal sem passar por validação.
 */
export function camposDoCaminho(proposta: PropostaCorrecao, id: IdCaminho): Record<string, string | null> | null {
  const caminho = proposta.caminhos.find(c => c.id === id)
  if (!caminho || caminho.faltaEscolherCest) return null
  const campos: Record<string, string | null> = {}
  for (const m of caminho.mudancas) campos[m.campo] = m.para
  return campos
}
