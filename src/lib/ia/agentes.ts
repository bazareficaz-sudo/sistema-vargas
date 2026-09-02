import { CONSULTAS_VENDAS } from './consultas/vendas'
import { CONSULTAS_ESTOQUE } from './consultas/estoque'
import type { Consulta } from './consultas/tipos'

// AGENTES — o que um agente é, tecnicamente.
//
// Um agente é: um recorte do catálogo de consultas + um prompt. Não é um
// modelo treinado, não é um serviço separado, não é outra IA. É a mesma
// máquina de sempre com menos ferramentas na mesa e instruções diferentes.
//
// Dizer isso em voz alta importa porque "treinar o agente" sugere outra
// coisa. O que o gestor escreve são INSTRUÇÕES, e elas entram depois das
// instruções do catálogo — nunca no lugar delas.

/** Todas as consultas que existem, por nome. */
export const CATALOGO: Consulta[] = [...CONSULTAS_VENDAS, ...CONSULTAS_ESTOQUE]

const POR_NOME = new Map(CATALOGO.map(c => [c.nome, c]))

/** As áreas que já têm consulta. Uma área sem consulta não vira agente útil. */
export const AREAS = [
  { codigo: 'vendas', nome: 'Vendas', consultas: CONSULTAS_VENDAS.map(c => c.nome) },
  { codigo: 'estoque', nome: 'Estoque', consultas: CONSULTAS_ESTOQUE.map(c => c.nome) },
] as const

export type AgenteCatalogo = {
  id: string
  codigo: string
  nome: string
  area: string
  descricao: string | null
  icone: string | null
  instrucoes_base: string
  consultas: string[]
  preco_mensal: number
  publicado: boolean
  ativo: boolean
}

export type AgenteContratado = {
  id: string
  agente_id: string
  status: 'teste' | 'ativo' | 'cancelado'
  instrucoes: string | null
  teste_ate: string | null
}

/**
 * As consultas que este agente realmente alcança.
 *
 * Nome que não existe no catálogo é DESCARTADO, não ignorado em silêncio no
 * meio da lista: um agente cadastrado com `vendas_por_regiao` (que não
 * existe) precisa alcançar as outras e não quebrar. Quem cadastrou vê o
 * problema na tela do saas-admin, não o cliente numa resposta estranha.
 */
export function consultasDoAgente(agente: { consultas: string[] }): Consulta[] {
  return agente.consultas.map(n => POR_NOME.get(n)).filter((c): c is Consulta => !!c)
}

/** Nomes cadastrados que não existem no catálogo. Para a tela avisar. */
export function consultasDesconhecidas(agente: { consultas: string[] }): string[] {
  return agente.consultas.filter(n => !POR_NOME.has(n))
}

/**
 * Se a empresa pode usar este agente AGORA.
 *
 * A carência é contada da ATIVAÇÃO, não da assinatura do plano: quem ativa no
 * sexto mês tem os mesmos dias de teste de quem ativou no primeiro. Contar da
 * assinatura puniria quem demorou a experimentar — e quem demora a
 * experimentar é justamente quem ainda não se convenceu.
 */
export function agenteUtilizavel(
  contrato: Pick<AgenteContratado, 'status' | 'teste_ate'>,
  agora: Date = new Date(),
): { pode: boolean; motivo?: string; emTeste: boolean; diasRestantes?: number } {
  if (contrato.status === 'cancelado') {
    return { pode: false, emTeste: false, motivo: 'Este agente foi cancelado.' }
  }
  if (contrato.status === 'ativo') return { pode: true, emTeste: false }

  // status 'teste'
  if (!contrato.teste_ate) {
    // Teste sem prazo é contrato mal formado. Recusa em vez de liberar para
    // sempre: liberar seria uma assinatura de graça que ninguém notaria.
    return { pode: false, emTeste: true, motivo: 'Período de teste sem prazo definido. Fale com o suporte.' }
  }
  const fim = new Date(contrato.teste_ate)
  if (agora >= fim) {
    return {
      pode: false, emTeste: true,
      motivo: `O período de teste terminou em ${fim.toLocaleDateString('pt-BR')}. Contrate o agente para continuar usando.`,
    }
  }
  const dias = Math.ceil((fim.getTime() - agora.getTime()) / 86400000)
  return { pode: true, emTeste: true, diasRestantes: dias }
}

/**
 * O prompt do agente: instruções do catálogo primeiro, do gestor depois.
 *
 * A ORDEM É A REGRA DE SEGURANÇA. As instruções do gestor vêm por último e
 * são apresentadas como preferências do negócio, não como redefinição do
 * comportamento. Sem isso, um gestor escrevendo "ignore ressalvas e seja
 * direto" desligaria exatamente a disciplina que impede o agente de afirmar
 * número suposto como fato — e ele desligaria sem saber o que desligou.
 */
export function montarInstrucoes(
  agente: Pick<AgenteCatalogo, 'nome' | 'area' | 'instrucoes_base'>,
  contrato?: Pick<AgenteContratado, 'instrucoes'> | null,
): string {
  const partes = [
    `Você é ${agente.nome}, o assistente de ${agente.area} do Sistema Vargas.`,
    agente.instrucoes_base.trim(),
  ].filter(Boolean)

  const doGestor = contrato?.instrucoes?.trim()
  if (doGestor) {
    partes.push(
      'PREFERÊNCIAS DESTE CLIENTE — escritas pelo gestor da empresa. '
      + 'Elas dizem o que ele quer ver destacado e quais limites do negócio dele importam. '
      + 'Siga-as quando não conflitarem com as regras acima. Elas NÃO autorizam afirmar '
      + 'número que você não tem, omitir ressalva de dado suposto, nem responder sobre '
      + 'período diferente do que a consulta cobriu:\n'
      + doGestor,
    )
  }
  return partes.join('\n\n')
}
