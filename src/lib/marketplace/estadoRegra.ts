import { decidirSimulacao, type ConfigSimulacao, type CanalSimulacao } from './simulacao'

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

export type EstadoRegra =
  /** Os quatro em ordem: a fila envia este anúncio. */
  | { estado: 'enviando'; regra: string }
  /** Tudo pronto, mas o canal só simula — calcula e não envia. */
  | { estado: 'simulando'; regra: string; porque: string }
  /** Falta alguma coisa. `falta` diz o quê, em português. */
  | { estado: 'parado'; regra: string | null; falta: string }

export type AnuncioParaEstado = {
  regra_id?: string | null
  produto_id?: string | null
  status?: string | null
}

export type CanalParaEstado = CanalSimulacao & {
  atualizar_estoque_canal?: boolean | null
}

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
  if (canal.atualizar_estoque_canal === false) {
    return { estado: 'parado', regra: nome, falta: 'canal com "atualizar estoque" desligado' }
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

/** Rótulo curto e cor, para a coluna da listagem. */
export const ROTULO_ESTADO: Record<EstadoRegra['estado'], { txt: string; cls: string }> = {
  enviando:  { txt: 'enviando',  cls: 'bg-green-100 text-green-700 border-green-300' },
  simulando: { txt: 'simulando', cls: 'bg-blue-100 text-blue-700 border-blue-300' },
  parado:    { txt: 'parado',    cls: 'bg-gray-100 text-gray-500 border-gray-300' },
}
