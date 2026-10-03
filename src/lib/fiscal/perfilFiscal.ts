import { SITUACAO_COM_ST } from './coerencia'

// PERFIL FISCAL — o CFOP e o CST/CSOSN deixam de ser do produto.
//
// Por que isto existe: o cadastro de produto tem UM campo de CFOP. Isso basta
// para a NFC-e, que é sempre a mesma operação (balcão, consumidor final, dentro
// do estado). Não basta para a NF-e de marketplace: o MESMO produto sai como
// 5102 para um cliente do estado, 6108 para uma pessoa física de outro estado e
// 6102 para uma loja de outro estado. O código depende da OPERAÇÃO, e a
// operação só se conhece na hora de emitir.
//
// O desenho:
//
//   · o produto guarda o que é dele — NCM, CEST, origem — e aponta para um
//     perfil ("Revenda tributada", "Revenda com ST");
//   · o perfil tem uma regra para cada situação × regime de quem emite;
//   · na emissão, a situação sai do destinatário (UF e inscrição estadual) e o
//     regime sai da empresa emitente (`resolverEmitente`).
//
// Mudar a tributação de centenas de produtos vira editar uma linha do perfil.
//
// POR QUE O REGIME, E NÃO A EMPRESA: o grupo tem uma empresa no Simples (que
// usa CSOSN) e uma no Lucro Presumido (que usa CST), e um mesmo produto pode
// ser faturado por qualquer uma delas — o PDV e cada canal de marketplace
// escolhem quem emite. O código que vai na nota depende do regime de QUEM
// EMITE, não de quem é dono do produto (ver o comentário de `resolverEmitente`
// sobre os 102 produtos com CST 60 emitidos pelo Simples).

export type RegimeRegra = 'simples' | 'normal'

export type SituacaoOperacao =
  | 'interna_consumidor_final'
  | 'interna_contribuinte'
  | 'interestadual_consumidor_final'
  | 'interestadual_contribuinte'

export const SITUACOES: { chave: SituacaoOperacao; rotulo: string; exemplo: string }[] = [
  { chave: 'interna_consumidor_final', rotulo: 'Dentro do estado · consumidor final', exemplo: 'Pessoa física, ou empresa sem inscrição estadual, do mesmo estado' },
  { chave: 'interna_contribuinte', rotulo: 'Dentro do estado · contribuinte', exemplo: 'Empresa com inscrição estadual do mesmo estado (revenda)' },
  { chave: 'interestadual_consumidor_final', rotulo: 'Outro estado · consumidor final', exemplo: 'O caso típico de marketplace: pessoa física de outro estado' },
  { chave: 'interestadual_contribuinte', rotulo: 'Outro estado · contribuinte', exemplo: 'Empresa com inscrição estadual de outro estado' },
]

export const REGIMES: { chave: RegimeRegra; rotulo: string; codigo: 'CSOSN' | 'CST' }[] = [
  { chave: 'simples', rotulo: 'Simples Nacional', codigo: 'CSOSN' },
  { chave: 'normal', rotulo: 'Regime normal (Presumido / Real)', codigo: 'CST' },
]

export type RegraPerfil = {
  regime: RegimeRegra
  situacao: SituacaoOperacao
  cfop: string | null
  icms_situacao: string | null
}

export function regimeDoEmitente(simplesNacional: boolean): RegimeRegra {
  return simplesNacional ? 'simples' : 'normal'
}

function regra(regime: RegimeRegra, situacao: SituacaoOperacao, cfop: string | null, icms: string | null): RegraPerfil {
  return { regime, situacao, cfop, icms_situacao: icms }
}

// Regras com que os perfis nascem. São as MESMAS que o
// supabase-perfis-fiscais.sql grava nos dois perfis padrão — se mudar aqui,
// mude lá (o teste confere que todas passam por `conferirRegra`).
//
// As duas linhas interestaduais do perfil com ST ficam VAZIAS de propósito.
// Revender para outro estado uma mercadoria que entrou com ST já recolhido não
// tem resposta única: o ST pago era do consumo DENTRO do estado e pode gerar
// ressarcimento; há quem destaque o ICMS interestadual normal (CST 00 / CSOSN
// 102) e há quem mantenha 60 / 500. Isso é decisão da contabilidade. Linha
// vazia faz a emissão parar com uma mensagem clara, em vez de mandar um par
// chutado para a SEFAZ.
export const REGRAS_PADRAO: Record<'tributada' | 'st', RegraPerfil[]> = {
  tributada: [
    regra('simples', 'interna_consumidor_final', '5102', '102'),
    regra('simples', 'interna_contribuinte', '5102', '102'),
    regra('simples', 'interestadual_consumidor_final', '6108', '102'),
    regra('simples', 'interestadual_contribuinte', '6102', '102'),
    regra('normal', 'interna_consumidor_final', '5102', '00'),
    regra('normal', 'interna_contribuinte', '5102', '00'),
    regra('normal', 'interestadual_consumidor_final', '6108', '00'),
    regra('normal', 'interestadual_contribuinte', '6102', '00'),
  ],
  st: [
    regra('simples', 'interna_consumidor_final', '5405', '500'),
    regra('simples', 'interna_contribuinte', '5405', '500'),
    regra('simples', 'interestadual_consumidor_final', null, null),
    regra('simples', 'interestadual_contribuinte', null, null),
    regra('normal', 'interna_consumidor_final', '5405', '60'),
    regra('normal', 'interna_contribuinte', '5405', '60'),
    regra('normal', 'interestadual_consumidor_final', null, null),
    regra('normal', 'interestadual_contribuinte', null, null),
  ],
}

const CSOSN_VALIDOS = new Set(['101', '102', '103', '201', '202', '203', '300', '400', '500', '900'])
const CST_VALIDOS = new Set(['00', '02', '10', '15', '20', '30', '40', '41', '50', '51', '53', '60', '61', '70', '90'])

// CFOPs que só existem em operação com ST — e por isso exigem uma situação
// tributária com ST. O 6108 (venda a não contribuinte de outro estado) fica
// de fora: ele aceita as duas, a escolha é da contabilidade.
const CFOP_SO_COM_ST = new Set(['5401', '5402', '5403', '5405', '6401', '6402', '6403', '6404'])
// CFOPs de venda comum — com eles, uma situação com ST é contradição.
const CFOP_SEM_ST = new Set(['5101', '5102', '6101', '6102'])

/**
 * Confere UMA regra do perfil. Devolve a frase do problema, ou null.
 *
 * Roda ao salvar o perfil (para o erro aparecer na linha que o causou) e de
 * novo na emissão (para uma regra gravada por fora desta tela não passar).
 * Regra inteiramente vazia é válida: significa "a definir" e bloqueia só a
 * emissão que cair nela.
 */
export function conferirRegra(r: Pick<RegraPerfil, 'regime' | 'situacao' | 'cfop' | 'icms_situacao'>): string | null {
  const cfop = (r.cfop ?? '').trim()
  const icms = (r.icms_situacao ?? '').trim()
  const nomeCodigo = r.regime === 'simples' ? 'CSOSN' : 'CST'

  if (!cfop && !icms) return null
  if (!cfop) return `Falta o CFOP (o ${nomeCodigo} está preenchido).`
  if (!icms) return `Falta o ${nomeCodigo} (o CFOP está preenchido).`

  if (!/^\d{4}$/.test(cfop)) return `CFOP ${cfop} precisa ter 4 dígitos.`
  const interestadual = r.situacao.startsWith('interestadual')
  if (interestadual && !cfop.startsWith('6')) {
    return `Venda para outro estado usa CFOP da família 6 (ex.: 6102, 6108) — ${cfop} não serve.`
  }
  if (!interestadual && !cfop.startsWith('5')) {
    return `Venda dentro do estado usa CFOP da família 5 (ex.: 5102, 5405) — ${cfop} não serve.`
  }

  if (r.regime === 'simples' && !CSOSN_VALIDOS.has(icms)) {
    return `${icms} não é um CSOSN. No Simples Nacional o código tem 3 dígitos (102, 500...).`
  }
  if (r.regime === 'normal' && !CST_VALIDOS.has(icms)) {
    return `${icms} não é um CST de ICMS. No regime normal o código tem 2 dígitos (00, 60...).`
  }

  const temST = SITUACAO_COM_ST.has(icms)
  if (CFOP_SO_COM_ST.has(cfop) && !temST) {
    return `CFOP ${cfop} é de substituição tributária, mas o ${nomeCodigo} ${icms} é de venda comum.`
  }
  if (CFOP_SEM_ST.has(cfop) && temST) {
    return `${nomeCodigo} ${icms} declara substituição tributária, mas o CFOP ${cfop} é de venda comum.`
  }
  return null
}

const UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
])

function uf(valor: string | null | undefined): string | null {
  const v = String(valor ?? '').trim().toUpperCase()
  return UFS.has(v) ? v : null
}

export type ResultadoSituacao =
  | { ok: true; situacao: SituacaoOperacao; interestadual: boolean; contribuinte: boolean }
  | { ok: false; erro: string }

/**
 * Em qual das quatro situações cai esta venda.
 *
 * Contribuinte = destinatário com inscrição estadual de verdade (dígitos).
 * CPF, CNPJ sem IE e "ISENTO" são consumidor final — é o que define o
 * indicador de IE do destinatário na NF-e e, com ele, se cabe DIFAL.
 */
export function situacaoDaOperacao(
  ufEmitente: string | null | undefined,
  destinatario: { uf: string | null | undefined; inscricaoEstadual?: string | null },
): ResultadoSituacao {
  const origem = uf(ufEmitente)
  if (!origem) return { ok: false, erro: 'A empresa emitente está sem UF válida no cadastro (Empresas → endereço).' }
  const destino = uf(destinatario.uf)
  if (!destino) return { ok: false, erro: 'O destinatário está sem UF válida — a NF-e precisa do endereço completo de entrega.' }

  const contribuinte = /\d/.test(String(destinatario.inscricaoEstadual ?? ''))
  const interestadual = origem !== destino
  const situacao: SituacaoOperacao = `${interestadual ? 'interestadual' : 'interna'}_${contribuinte ? 'contribuinte' : 'consumidor_final'}`
  return { ok: true, situacao, interestadual, contribuinte }
}

export type ResultadoRegra =
  | { ok: true; cfop: string; icmsSituacao: string }
  | { ok: false; erro: string }

/** A regra do perfil para esta operação — ou o motivo de não haver uma. */
export function regraDoPerfil(
  perfil: { nome: string; regras: RegraPerfil[] },
  regime: RegimeRegra,
  situacao: SituacaoOperacao,
): ResultadoRegra {
  const r = perfil.regras.find(x => x.regime === regime && x.situacao === situacao)
  const rotuloSituacao = SITUACOES.find(s => s.chave === situacao)?.rotulo ?? situacao
  const rotuloRegime = REGIMES.find(x => x.chave === regime)?.rotulo ?? regime

  if (!r || (!r.cfop && !r.icms_situacao)) {
    return {
      ok: false,
      erro: `O perfil fiscal "${perfil.nome}" não tem regra para "${rotuloSituacao}" no ${rotuloRegime}. ` +
        `Defina em Produtos → Perfis fiscais — o par de códigos deve vir da contabilidade.`,
    }
  }
  const problema = conferirRegra(r)
  if (problema) {
    return { ok: false, erro: `Perfil fiscal "${perfil.nome}", ${rotuloSituacao} (${rotuloRegime}): ${problema}` }
  }
  return { ok: true, cfop: r.cfop!.trim(), icmsSituacao: r.icms_situacao!.trim() }
}

/**
 * A nota precisa do grupo de DIFAL (ICMSUFDest)?
 *
 * Venda a consumidor final NÃO contribuinte de outro estado: o remetente
 * recolhe a diferença entre a alíquota interna do destino e a interestadual
 * (EC 87/2015, LC 190/2022). Vale para o regime normal. O Simples Nacional,
 * em regra, não recolhe nessa operação (STF, ADI 5464) — confirmar com a
 * contabilidade se algum estado de destino exigir.
 */
export function exigeDifal(regime: RegimeRegra, situacao: SituacaoOperacao): boolean {
  return regime === 'normal' && situacao === 'interestadual_consumidor_final'
}
