// QUEM PODE RELIGAR UM ANÚNCIO PAUSADO.
//
// Regra pedida pelo gestor em 03/09/2026, em três partes:
//
//   1. estoque zerou (ou cruzou o risco) → o sistema pausa;
//   2. pessoa pausou → fica marcado PAUSA MANUAL e só pessoa reativa;
//   3. estoque voltou → religa o que a falta de estoque desligou, e NÃO
//      religa o que a pessoa desligou.
//
// Tudo depende de saber POR QUE está pausado, que é o que
// `marketplace_anuncios.pausa_origem` passou a guardar.

export type OrigemPausa = 'automatica' | 'manual' | null | undefined

export type AnuncioPausavel = {
  status?: string | null
  pausa_origem?: OrigemPausa
}

/**
 * O anúncio pode ser religado pelo sistema, sem pessoa nenhuma?
 *
 * `null` É TRATADO COMO MANUAL, e essa é a decisão que mais importa aqui.
 *
 * Anúncio pausado antes desta coluna existir não diz por quê. Religar no
 * escuro significaria reativar, na primeira reposição de estoque, algo que
 * alguém tirou do ar meses atrás por um motivo que o sistema não conhece —
 * foto errada, preço errado, produto com defeito. O prejuízo de religar o que
 * não devia é maior que o de manter pausado algo que já estava pausado.
 */
export function podeReligarAutomaticamente(a: AnuncioPausavel): boolean {
  return a.status === 'pausado' && a.pausa_origem === 'automatica'
}

/** O anúncio está pausado por mão humana (ou por origem desconhecida)? */
export function pausadoManualmente(a: AnuncioPausavel): boolean {
  return a.status === 'pausado' && a.pausa_origem !== 'automatica'
}

export type DecisaoPausa =
  | { acao: 'pausar'; motivo: string }
  | { acao: 'reativar' }
  | { acao: 'nada'; porque: string }

/**
 * O que fazer com este anúncio, dado o estoque que a regra calculou.
 *
 * `paraPausar` vem de `aplicarRegra` — já é `estoqueEnviado <= risco`, com o
 * complemento somado. Ver `regraEstoque.ts` para por que esse número engana
 * quem lê os dois campos separados.
 */
export function decidirPausa(params: {
  anuncio: AnuncioPausavel
  /** A regra concluiu que este anúncio deve ficar fora do ar. */
  paraPausar: boolean
  /** Estoque que está sendo enviado, para a frase do motivo. */
  estoqueEnviado?: number | null
  /** Estoque de risco configurado, para a frase do motivo. */
  risco?: number | null
}): DecisaoPausa {
  const { anuncio, paraPausar } = params
  const pausado = anuncio.status === 'pausado'

  if (paraPausar) {
    if (pausado) return { acao: 'nada', porque: 'já está pausado' }
    const est = params.estoqueEnviado
    const risco = params.risco
    return {
      acao: 'pausar',
      motivo: est != null && risco != null
        ? `Estoque ${est} chegou ao limite de risco (${risco}).`
        : 'Estoque insuficiente pela regra do canal.',
    }
  }

  // A regra não quer mais pausar. Reativar só se foi o sistema que pausou.
  if (!pausado) return { acao: 'nada', porque: 'já está ativo' }

  if (podeReligarAutomaticamente(anuncio)) return { acao: 'reativar' }

  return {
    acao: 'nada',
    porque: anuncio.pausa_origem === 'manual'
      ? 'pausa manual — só reativa por ação de uma pessoa'
      : 'pausado por origem desconhecida — tratado como manual, não reativa sozinho',
  }
}

/** Campos a gravar quando o SISTEMA pausa. */
export function camposPausaAutomatica(motivo: string) {
  return {
    status: 'pausado',
    pausa_origem: 'automatica',
    pausa_em: new Date().toISOString(),
    pausa_por: null,
    pausa_motivo: motivo,
    updated_at: new Date().toISOString(),
  }
}

/** Campos a gravar quando uma PESSOA pausa. */
export function camposPausaManual(userId: string | null) {
  return {
    status: 'pausado',
    pausa_origem: 'manual',
    pausa_em: new Date().toISOString(),
    pausa_por: userId,
    pausa_motivo: null,
    updated_at: new Date().toISOString(),
  }
}

/**
 * Campos a gravar ao reativar, seja por pessoa ou pelo sistema.
 *
 * Limpa a origem: um anúncio ativo não tem motivo de pausa, e deixar o rastro
 * antigo faria a próxima leitura achar que ele ainda está pausado por aquilo.
 */
export function camposReativacao() {
  return {
    status: 'ativo',
    pausa_origem: null,
    pausa_em: null,
    pausa_por: null,
    pausa_motivo: null,
    updated_at: new Date().toISOString(),
  }
}
