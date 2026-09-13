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
//
// ── 13/09/2026: O SÉTIMO DEIXOU DE SER "TEM VARIAÇÃO" ──────────────────────
//
// A fila passou a enviar POR MODELO (Shopee `stock_list[].model_id`, Mercado
// Livre `variations[].id`), então "tem variação" não impede mais nada. O que
// impede é outra coisa, e é ela que precisa aparecer aqui:
//
//   7'. pelo menos UMA variação com produto vinculado
//       (marketplace_anuncio_variacoes.produto_id)
//
// Num anúncio com variação o produto do ERP mora em cada variação, não no pai
// — e a fila só toca no que está mapeado, justamente para não sobrescrever a
// distribuição que o vendedor fez. Sem nenhuma variação mapeada não há número
// nosso para mandar, e aí sim está parado. Com uma que seja, está andando.
//
// Pela mesma razão, o interruptor 2 (produto no anúncio-pai) não se aplica a
// anúncio com variação: exigir o pai marcaria como parado justamente os
// anúncios em que o mapeamento foi feito no lugar certo.

export type EstadoRegra =
  /** Os sete em ordem: a fila envia este anúncio. */
  | { estado: 'enviando'; regra: string; observacao?: string }
  /** Tudo pronto, mas o canal só simula — calcula e não envia. */
  | { estado: 'simulando'; regra: string; porque: string; observacao?: string }
  /** Falta alguma coisa. `falta` diz o quê, em português. */
  | { estado: 'parado'; regra: string | null; falta: string }

export type AnuncioParaEstado = {
  regra_id?: string | null
  produto_id?: string | null
  status?: string | null
  tem_variacao?: boolean | null
  /**
   * As variações do anúncio, quando ele tem. O que importa aqui é só se
   * alguma tem `produto_id` — é o mapeamento que decide se a fila tem número
   * para mandar.
   *
   * Ausente conta como NENHUMA mapeada, de propósito: sem a lista não há
   * evidência de mapeamento, e prometer "enviando" sem evidência é o erro
   * caro desta coluna.
   */
  variacoes?: { produto_id?: string | null }[] | null
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

  const comVariacao = !!anuncio.tem_variacao
  const variacoesMapeadas = (anuncio.variacoes ?? []).filter(v => v.produto_id).length

  // Num anúncio com variação quem carrega o produto é a variação. Cobrar o
  // produto do pai aqui marcaria como parado exatamente os anúncios cujo
  // mapeamento foi feito no lugar certo.
  if (!comVariacao && !anuncio.produto_id) {
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
  // A fila envia por modelo desde 12/09/2026, então ter variação não para
  // mais nada. O que para é não haver mapeamento: sem variação vinculada a um
  // produto, não existe número nosso para mandar, e a fila não toca no que
  // não é dela.
  if (comVariacao && variacoesMapeadas === 0) {
    return {
      estado: 'parado', regra: nome,
      falta: 'nenhuma variação com produto vinculado — mapeie as variações no Mapa de anúncios',
    }
  }
  if (params.filaAtiva === false) {
    return { estado: 'parado', regra: nome, falta: 'fila de atualização desligada (Marketplaces → Fila)' }
  }

  // MAPEAMENTO PARCIAL NÃO É "TUDO CERTO". Com 2 de 5 variações vinculadas, a
  // fila anda — e três modelos continuam com o estoque que o vendedor deixou
  // lá. "Enviando" sozinho esconderia isso até alguém perguntar por que o
  // estoque de um dos modelos nunca muda.
  const total = (anuncio.variacoes ?? []).length
  const observacao = comVariacao && variacoesMapeadas < total
    ? `${variacoesMapeadas} de ${total} variações mapeadas — as demais não recebem estoque`
    : comVariacao
      ? `${variacoesMapeadas} variação(ões), todas mapeadas`
      : undefined

  const sim = decidirSimulacao(canal, config)
  if (sim.simula) {
    return {
      estado: 'simulando', regra: nome ?? 'regra',
      porque: sim.origem === 'canal' ? 'este canal está em simulação' : 'a empresa está em simulação',
      observacao,
    }
  }

  return { estado: 'enviando', regra: nome ?? 'regra', observacao }
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
