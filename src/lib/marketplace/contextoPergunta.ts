import { capacidadesDoCanal, type CapacidadesCanal } from '@/lib/precificacao/capacidades'

// O QUE A IA PODE SABER SOBRE OS ANÚNCIOS DE UM CANAL.
//
// Este arquivo é sobre o que NÃO entra tanto quanto sobre o que entra.
//
// Duas lições pagas caro neste sistema, as duas em 01/09/2026:
//
//   O painel de rascunho mostrava "markup 225,3%" num preço que dava prejuízo
//   de R$ 0,89, porque o frete usado era zero e nada dizia que aquele zero
//   nunca tinha sido medido.
//
//   O "Pergunte ao Vargas" do dashboard recebeu `faturamentoMes: 1336.17` sem
//   data e respondeu "Agosto apresenta R$ 1.336,17 em vendas" — agosto teve
//   R$ 51.498,04. E de `comprasMes: 0` (dia 1º do mês) concluiu "restrição de
//   caixa severa".
//
// Nos dois casos o número estava certo e o RÓTULO estava faltando. Uma frase
// em português é ainda pior que um painel nisso: ela some com a incerteza. Um
// operador desconfia de um campo em branco; não desconfia de um parágrafo bem
// escrito.
//
// REGRA DESTE CONTEXTO: todo número viaja com a origem dele, e o que não se
// sabe é declarado como não sabido — nunca omitido. Campo ausente o modelo
// preenche com o que parecer razoável; campo dizendo "não medido" ele repete.

export type ContagemAnuncios = {
  total: number
  ativos: number
  pausados: number
  comErro: number
  semProdutoVinculado: number
  semPreco: number
}

export type ContextoAnuncios = {
  canal: { nome: string; plataforma: string }

  /** Quando os dados desta tela foram sincronizados com o marketplace. */
  sincronizacao: {
    maisRecente: string | null
    maisAntiga: string | null
    /**
     * Anúncios nunca sincronizados. Existem no sistema e podem não existir
     * mais no marketplace — ou o contrário.
     */
    nuncaSincronizados: number
  }

  anuncios: ContagemAnuncios

  /**
   * DE ONDE SAI A ECONOMIA DESTE CANAL.
   *
   * O motor de precificação mede comissão e frete na API do Mercado Livre
   * quando dá, e cai na tabela configurada quando não dá. A diferença entre
   * as duas decide se uma frase como "sua margem está em 20%" é um fato ou um
   * palpite — e sem isto no contexto, sai como fato.
   */
  economia: {
    comissao: 'medida_na_api' | 'tabela_configurada' | 'nao_configurada'
    frete: 'medido_na_api' | 'modo_configurado' | 'nao_configurado'
    /** Explicação em português, para o modelo poder repetir sem inventar. */
    ressalva: string | null
  }

  /**
   * Campanhas do ESPELHO LOCAL, com a idade dele. Nunca da API: a tela não
   * chama marketplace ao abrir. O espelho envelhece, e a idade é o que
   * permite dizer "os dados de campanha são de X" em vez de afirmar o
   * presente.
   */
  campanhas: {
    total: number
    itensParticipando: number
    itensConvite: number
    sincronizadoEm: string | null
  }

  /**
   * O que este sistema JÁ CONFERIU sobre a plataforma, e o que não conferiu.
   * `nao_verificado` não é `nao_suportado` — a distinção existe justamente
   * para impedir que "não sei" vire "não dá".
   */
  capacidades: Record<string, { estado: string; motivo?: string }>

  /** Perguntas que este contexto NÃO tem como responder. */
  naoRespondivel: string[]
}

/** Achata as capacidades para o JSON do prompt, sem perder o motivo. */
function resumirCapacidades(c: CapacidadesCanal): Record<string, { estado: string; motivo?: string }> {
  const saida: Record<string, { estado: string; motivo?: string }> = {}
  for (const [nome, valor] of Object.entries(c)) {
    if (nome === 'plataforma' || typeof valor === 'string') continue
    saida[nome] = { estado: valor.estado, ...(valor.motivo ? { motivo: valor.motivo } : {}) }
  }
  return saida
}

/**
 * O que este contexto não alcança.
 *
 * Vai explícito no prompt porque a alternativa é o modelo descobrir sozinho
 * que não tem o dado — e a experiência de hoje é que ele não descobre: ele
 * responde com o número mais próximo que encontrar.
 */
export function limitesDoContexto(ctx: ContextoAnuncios): string[] {
  const limites: string[] = []

  limites.push(
    'Este contexto tem CONTAGENS e ESTADO dos anúncios, não a margem de cada anúncio. '
    + 'Para dizer se um anúncio específico dá lucro é preciso rodar o recálculo de preços — '
    + 'não responda sobre margem de anúncio individual com base neste contexto.',
  )

  if (ctx.economia.comissao !== 'medida_na_api' || ctx.economia.frete !== 'medido_na_api') {
    limites.push(
      'A comissão e/ou o frete deste canal NÃO vêm de medição na API. Qualquer afirmação '
      + 'sobre lucratividade seria baseada em valor configurado à mão, não medido.',
    )
  }

  if (ctx.campanhas.sincronizadoEm === null && ctx.campanhas.total > 0) {
    limites.push('As campanhas nunca foram sincronizadas com a plataforma — o espelho local pode estar desatualizado.')
  }

  const naoVerificadas = Object.entries(ctx.capacidades)
    .filter(([, c]) => c.estado === 'nao_verificado')
    .map(([nome]) => nome)
  if (naoVerificadas.length > 0) {
    limites.push(
      `Estas capacidades da plataforma NUNCA foram verificadas: ${naoVerificadas.join(', ')}. `
      + 'Não afirme que a plataforma não faz essas coisas — o sistema apenas não conferiu.',
    )
  }

  if (ctx.anuncios.semProdutoVinculado > 0) {
    limites.push(
      `${ctx.anuncios.semProdutoVinculado} anúncio(s) não têm produto do catálogo vinculado. `
      + 'Para eles não há custo, e portanto não há margem calculável.',
    )
  }

  return limites
}

export function montarCapacidades(plataforma: string, temCredencial: boolean) {
  return resumirCapacidades(capacidadesDoCanal(plataforma, { temCredencial }))
}
