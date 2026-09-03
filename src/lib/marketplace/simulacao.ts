// ESTE CANAL ENVIA DE VERDADE OU SÓ SIMULA?
//
// Até 03/09/2026 a resposta era só da empresa: `marketplace_fila_config.
// simulacao` ligava ou desligava o envio de todos os canais juntos. Isso
// impedia o teste que o gestor precisava fazer — envio real em UM canal,
// mantendo os outros em simulação.
//
// A herança existe para o caso comum continuar simples: quem nunca abriu a
// configuração de um canal segue o que a empresa decidir, e mudar a empresa
// alcança todos os canais que não escolheram nada.

export type ConfigSimulacao = {
  /** `marketplace_fila_config.simulacao` — o padrão da empresa. */
  simulacaoDaEmpresa: boolean
}

export type CanalSimulacao = {
  /** `marketplace_canais.fila_simulacao`. NULL = herda da empresa. */
  fila_simulacao?: boolean | null
}

export type DecisaoSimulacao = {
  /** Verdadeiro quando NADA é enviado ao marketplace. */
  simula: boolean
  /** De onde veio a decisão — a tela mostra isto para o operador. */
  origem: 'canal' | 'empresa'
  /** Frase pronta, sem jargão. */
  explicacao: string
}

/**
 * Decide por canal, com a empresa como padrão.
 *
 * `false` NO CANAL É UMA ESCOLHA, não ausência. É o que permite "esta empresa
 * está em simulação, MENOS a Shp Ouro". Por isso a checagem é contra
 * `null`/`undefined` e não contra a falsidade do valor — um `??` aqui trataria
 * `false` como ausente e o canal nunca sairia de simulação.
 */
export function decidirSimulacao(
  canal: CanalSimulacao | null | undefined,
  config: ConfigSimulacao,
): DecisaoSimulacao {
  const doCanal = canal?.fila_simulacao
  if (doCanal === true || doCanal === false) {
    return {
      simula: doCanal,
      origem: 'canal',
      explicacao: doCanal
        ? 'Este canal está em simulação: a fila calcula e registra, mas não envia nada ao marketplace.'
        : 'Este canal ENVIA de verdade, mesmo que a empresa esteja em simulação.',
    }
  }
  return {
    simula: config.simulacaoDaEmpresa,
    origem: 'empresa',
    explicacao: config.simulacaoDaEmpresa
      ? 'Seguindo a empresa: em simulação, nada é enviado ao marketplace.'
      : 'Seguindo a empresa: os envios são reais.',
  }
}
