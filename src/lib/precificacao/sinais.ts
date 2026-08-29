// SINAIS COMERCIAIS — estoque e velocidade de venda. Camada PURA.
//
// Estoque e vendas NÃO entram no motor financeiro. Eles não mudam comissão,
// frete nem margem: mudam a PRIORIDADE de uma recomendação. Um item com boa
// margem e estoque parado é candidato a promoção; o mesmo item com estoque
// curto e saída boa não é.
//
// Por isso este arquivo não importa `motor.ts` nem `cenarios.ts`. Ele produz
// sinais; quem os combina com a economia é `recomendacoes.ts`.
//
// DE ONDE VEM O ESTOQUE (auditado em 29/08/2026)
//
// O número comercialmente correto para marketplace já existe e já é usado:
// `estoqueDoSistema()` + `estoqueUnificadoDeProdutos()`, o mesmo par que
// `lib/marketplace/fila.ts` usa para decidir o que enviar ao canal. O
// comentário de `estoqueUnificado.ts` é explícito: "este número é o que vai
// para os ANÚNCIOS dos marketplaces. O PDV continua vendendo do estoque da
// própria empresa".
//
// A unificação entre empresas do grupo só vale quando explicitamente ligada
// (`empresa_config_estoque.estoque_unificado_ativo` mais participantes
// cadastrados). Este módulo NÃO soma grupo por conta própria — recebe o
// número já resolvido por quem tem essa autorização.

export type OrigemEstoque = 'sistema' | 'unificado' | 'desconhecido'

export type SinalEstoque = {
  /** Unidades comercialmente disponíveis. Nulo = não foi possível saber. */
  disponivel: number | null
  origem: OrigemEstoque
  temEstoque: boolean
}

export function sinalDeEstoque(disponivel: number | null | undefined, origem: OrigemEstoque = 'sistema'): SinalEstoque {
  const n = disponivel == null ? null : Number(disponivel)
  const valido = n != null && Number.isFinite(n)
  return {
    disponivel: valido ? n : null,
    origem: valido ? origem : 'desconhecido',
    temEstoque: valido ? n > 0 : false,
  }
}

// ── Vendas e cobertura ──────────────────────────────────────────────────────

export type NivelCobertura = 'sem_estoque' | 'curta' | 'normal' | 'longa' | 'sem_venda' | 'desconhecida'

export type LimitesCobertura = { curta: number; longa: number }

/**
 * Padrões em dias. Ficam aqui, e não espalhados em componente, porque a
 * primeira coisa que muda quando o segmento muda são estes dois números.
 */
export const LIMITES_COBERTURA: LimitesCobertura = { curta: 15, longa: 90 }

export type EntradaVendas = {
  /** Unidades vendidas na janela. */
  unidades: number | null
  /** Tamanho da janela em dias. */
  dias: number
  /** Quantos pedidos distintos compuseram essas unidades. */
  pedidos?: number | null
  /** Unidades do maior pedido da janela — para detectar o pico solitário. */
  maiorPedido?: number | null
}

export type SinalVendas = {
  unidades: number | null
  dias: number
  mediaDiaria: number | null
  /** Dias de estoque no ritmo atual. Nulo quando não dá para calcular. */
  coberturaDias: number | null
  nivel: NivelCobertura
  /**
   * A média é boa o suficiente para decidir?
   *
   * Falsa quando não há venda, quando a janela é curta demais, ou quando um
   * único pedido responde pela maior parte do volume — nos três casos a média
   * existe mas descreve mal o que vem pela frente.
   */
  confiavel: boolean
  motivo: string
}

const JANELA_MINIMA_DIAS = 14

/**
 * Cobertura de estoque: quantos dias o que existe dura no ritmo recente.
 *
 * Os casos que este cálculo precisa acertar são justamente os que uma divisão
 * ingênua erra: produto sem venda (dividir por zero), produto novo (média de
 * poucos dias vira profecia), estoque zero (cobertura zero, não infinita) e o
 * pico solitário (uma venda grande que não se repete).
 */
export function sinalDeVendas(
  estoque: SinalEstoque,
  vendas: EntradaVendas,
  limites: LimitesCobertura = LIMITES_COBERTURA,
): SinalVendas {
  const dias = Math.max(0, Math.trunc(Number(vendas.dias) || 0))
  const unidades = vendas.unidades == null ? null : Math.max(0, Number(vendas.unidades))

  const semDados = (motivo: string): SinalVendas => ({
    unidades, dias, mediaDiaria: null, coberturaDias: null,
    nivel: 'desconhecida', confiavel: false, motivo,
  })

  if (unidades == null || dias <= 0) {
    return semDados('Não há dados de venda para este anúncio na janela consultada.')
  }

  // Estoque zero decide antes de qualquer média: não há o que cobrir, e
  // estratégia comercial nenhuma faz sentido agora.
  if (!estoque.temEstoque) {
    return {
      unidades, dias, mediaDiaria: unidades / dias, coberturaDias: 0,
      nivel: 'sem_estoque', confiavel: true,
      motivo: estoque.disponivel == null
        ? 'Estoque desconhecido.'
        : 'Sem estoque disponível — nenhuma estratégia de preço muda isso.',
    }
  }

  if (unidades === 0) {
    return {
      unidades: 0, dias, mediaDiaria: 0, coberturaDias: null,
      nivel: 'sem_venda', confiavel: true,
      motivo: `Nenhuma venda nos últimos ${dias} dias. Sem ritmo, não há cobertura a calcular.`,
    }
  }

  const mediaDiaria = unidades / dias
  const coberturaDias = Math.round(estoque.disponivel! / mediaDiaria)

  // Janela curta: a média existe, mas descreve pouco.
  if (dias < JANELA_MINIMA_DIAS) {
    return {
      unidades, dias, mediaDiaria, coberturaDias,
      nivel: 'desconhecida', confiavel: false,
      motivo: `Janela de ${dias} dias é curta demais para virar ritmo — mínimo de ${JANELA_MINIMA_DIAS}.`,
    }
  }

  // Pico solitário: um pedido responde pela maior parte do volume.
  const maior = vendas.maiorPedido ?? null
  const pedidos = vendas.pedidos ?? null
  const dominado = maior != null && unidades > 0 && maior / unidades > 0.6
  if (dominado || pedidos === 1) {
    return {
      unidades, dias, mediaDiaria, coberturaDias,
      nivel: 'desconhecida', confiavel: false,
      motivo: pedidos === 1
        ? 'Todo o volume da janela veio de um pedido só — não é ritmo, é evento.'
        : `Um único pedido responde por ${Math.round((maior! / unidades) * 100)}% do volume — a média não descreve o ritmo.`,
    }
  }

  const nivel: NivelCobertura = coberturaDias <= limites.curta ? 'curta'
    : coberturaDias >= limites.longa ? 'longa'
    : 'normal'

  const explicacao = nivel === 'curta'
    ? `${coberturaDias} dias de estoque no ritmo atual — pouco para abrir mão de margem.`
    : nivel === 'longa'
      ? `${coberturaDias} dias de estoque no ritmo atual — mercadoria parada.`
      : `${coberturaDias} dias de estoque no ritmo atual.`

  return { unidades, dias, mediaDiaria, coberturaDias, nivel, confiavel: true, motivo: explicacao }
}
