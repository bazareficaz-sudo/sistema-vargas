import { decidirSimulacao, type ConfigSimulacao, type CanalSimulacao } from './simulacao'
import { canalAceitaEnvio, type CanalComInterruptores } from './canais'

// A REGRA DESTE ANÚNCIO ESTÁ FUNCIONANDO?
//
// Escrito em 03/09/2026, depois de o gestor dizer "está confuso". E estava:
// para um anúncio receber preço e estoque automaticamente, QUATRO coisas
// precisam ser verdade ao mesmo tempo, em lugares diferentes do sistema —
// e a tela não mostrava nenhuma delas.
//
//   1. o anúncio tem uma REGRA vinculada       (marketplace_anuncios.regra_id)
//   2. o anúncio tem PRODUTO do catálogo       (marketplace_anuncios.produto_id)
//   3. o canal aceita atualização              (canais.atualizar_estoque_canal)
//   4. o canal não está em simulação           (canais.fila_simulacao / empresa)
//
// Medido no mesmo dia: dos 9.281 anúncios das seis contas, ZERO tinham regra
// vinculada. Ligar o envio real não enviaria nada, e nada na tela explicaria
// por quê — o operador veria "ENVIANDO" e um silêncio.
//
// São interruptores EM SÉRIE. Mostrar só o último ligado dá a impressão de
// que está tudo pronto, e é justamente essa impressão que custou a confusão.
//
// ── 04/09/2026: ERAM QUATRO, E SÃO SETE ────────────────────────────────────
//
// O gestor voltou com um anúncio que mostrava "enviando", tinha regra, tinha
// movimentação e continuava com o estoque inicial na Shopee 12 horas depois.
// Relendo `fila.ts` contra este arquivo, ele checava QUATRO das SETE
// condições que a fila de fato exige. As três que faltavam:
//
//   5. a FILA DA EMPRESA está ligada           (marketplace_fila_config.ativo)
//      Desligada, nenhuma rodada acontece e TODO anúncio mostra "enviando".
//
//   6. o canal tem `sincronizar_estoque`       (canais.sincronizar_estoque)
//      `canalAceitaEnvio` exige os DOIS interruptores; este arquivo olhava só
//      um. Pior: ele testava `atualizar_estoque_canal === false`, então NULO
//      passava como ligado aqui e era recusado lá — e a fila registra
//      `canal_desligado`, que não conta como falha, some da fila e não repete.
//      Por isso agora quem responde é `canalAceitaEnvio`, a MESMA função.
//
//   7. o anúncio NÃO tem variação              (marketplace_anuncios.tem_variacao)
//      A fila pula anúncio com variação na primeira linha do laço
//      ("distribui estoque por variação; mandar um número só sobrescreveria a
//      distribuição inteira") e grava `com_variacao`. Nada é enviado, nunca.

export type EstadoRegra =
  /** Os sete em ordem: a fila envia este anúncio. */
  | { estado: 'enviando'; regra: string }
  /** Tudo pronto, mas o canal só simula — calcula e não envia. */
  | { estado: 'simulando'; regra: string; porque: string }
  /** Falta alguma coisa. `falta` diz o quê, em português. */
  | { estado: 'parado'; regra: string | null; falta: string }

export type AnuncioParaEstado = {
  regra_id?: string | null
  produto_id?: string | null
  status?: string | null
  /** A fila pula anúncio com variação. Ver o laço em `fila.ts`. */
  tem_variacao?: boolean | null
}

export type CanalParaEstado = CanalSimulacao & CanalComInterruptores

/**
 * O que impede este anúncio de receber preço e estoque, se é que algo impede.
 *
 * A ORDEM DAS CHECAGENS É A ORDEM DE QUEM CONSERTA. Sem produto não adianta
 * discutir regra; sem regra não adianta ligar o canal. Mostrar a falta mais
 * profunda primeiro faria o operador ligar o canal e continuar sem entender
 * por que nada acontece.
 */
export function estadoDaRegra(params: {
  anuncio: AnuncioParaEstado
  canal: CanalParaEstado
  config: ConfigSimulacao
  /** Nome da regra vinculada, quando existe. */
  nomeRegra?: string | null
  /**
   * `marketplace_fila_config.ativo` da empresa. O interruptor mestre: com ele
   * desligado nenhuma rodada roda, e todo o resto é irrelevante.
   *
   * `undefined` = quem chamou não sabe. Nesse caso não se afirma nada sobre
   * ele — melhor calar do que inventar que a fila está ligada.
   */
  filaAtiva?: boolean | null
}): EstadoRegra {
  const { anuncio, canal, config } = params
  const nome = params.nomeRegra ?? null

  if (!anuncio.produto_id) {
    return { estado: 'parado', regra: nome, falta: 'sem produto do catálogo vinculado' }
  }
  if (!anuncio.regra_id) {
    return { estado: 'parado', regra: null, falta: 'sem regra de preço/estoque' }
  }
  // Anúncio encerrado no canal não recebe nada — mandar quantidade para um
  // item fechado pode recolocá-lo à venda, e a fila não republica o que
  // alguém encerrou.
  if (anuncio.status === 'encerrado') {
    return { estado: 'parado', regra: nome, falta: 'anúncio encerrado no canal' }
  }
  // A MESMA função que a fila usa, e não uma cópia da regra dela. Cobre
  // plataforma sem API (Loja Online) e os DOIS interruptores do canal.
  if (!canalAceitaEnvio(canal)) {
    return { estado: 'parado', regra: nome, falta: faltaDoCanal(canal) }
  }
  // A fila pula este anúncio antes de calcular qualquer coisa, e ainda tira o
  // produto da fila como se tivesse resolvido. Dizer "enviando" aqui é a
  // promessa mais cara que esta coluna pode fazer.
  if (anuncio.tem_variacao) {
    return { estado: 'parado', regra: nome, falta: 'anúncio com variação — a fila ainda não envia por variação' }
  }
  if (params.filaAtiva === false) {
    return { estado: 'parado', regra: nome, falta: 'fila de atualização desligada (Marketplaces → Fila)' }
  }

  const sim = decidirSimulacao(canal, config)
  if (sim.simula) {
    return {
      estado: 'simulando', regra: nome ?? 'regra',
      porque: sim.origem === 'canal' ? 'este canal está em simulação' : 'a empresa está em simulação',
    }
  }

  return { estado: 'enviando', regra: nome ?? 'regra' }
}

/** Qual dos interruptores do canal está faltando, dito por nome. */
function faltaDoCanal(canal: CanalParaEstado): string {
  if (!canal.sincronizar_estoque) return 'canal com "sincronizar estoque" desligado'
  if (!canal.atualizar_estoque_canal) return 'canal com "atualizar estoque do canal" desligado'
  return 'canal não recebe atualização automática (não é marketplace)'
}

/** Rótulo curto e cor, para a coluna da listagem. */
export const ROTULO_ESTADO: Record<EstadoRegra['estado'], { txt: string; cls: string }> = {
  enviando:  { txt: 'enviando',  cls: 'bg-green-100 text-green-700 border-green-300' },
  simulando: { txt: 'simulando', cls: 'bg-blue-100 text-blue-700 border-blue-300' },
  parado:    { txt: 'parado',    cls: 'bg-gray-100 text-gray-500 border-gray-300' },
}
