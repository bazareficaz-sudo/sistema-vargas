// CAPACIDADES COMERCIAIS DO CANAL — camada PURA.
//
// A pergunta que este arquivo responde é diferente de "isto é economicamente
// bom?". É: **isto pode ser publicado neste canal?**
//
// Separar as duas é o ponto. O Vargas pode concluir que "3+ unidades a
// R$ 57,90" é saudável, e isso NÃO significa que o Mercado Livre ou a Shopee
// aceitem configurar exatamente assim. Estratégia calculada e estratégia
// publicável são coisas diferentes, e a tela precisa poder dizer qual é qual.
//
// OS QUATRO ESTADOS, E POR QUE NÃO SÃO DOIS
//
// Um booleano obrigaria a chamar de "não suportado" tudo que apenas não foi
// verificado — e aí o sistema mentiria com cara de certeza. A diferença entre
// "a plataforma não faz" e "nós ainda não conferimos" é a diferença entre uma
// limitação e uma tarefa.

export type EstadoCapacidade =
  /** Conferido: a plataforma faz, e o sistema sabe usar. */
  | 'suportado'
  /** Conferido: a plataforma não faz, ou não expõe pela API. */
  | 'nao_suportado'
  /** Ninguém conferiu. NÃO é o mesmo que não suportado. */
  | 'nao_verificado'
  /** A conta não tem credencial/escopo para isto — pode virar suportado. */
  | 'indisponivel_por_credencial'

export type Capacidade = {
  estado: EstadoCapacidade
  /** Por que está nesse estado. Obrigatório fora de `suportado`. */
  motivo?: string
  /** Onde a verificação está registrada, quando houve uma. */
  evidencia?: string
}

export type NomeCapacidade =
  | 'campanhasLeitura'
  | 'campanhasEscrita'
  | 'precoQuantidade'
  | 'precoQuantidadeEscrita'
  | 'variacoes'
  | 'subsidioCampanha'
  | 'webhookPromocao'

export type CapacidadesCanal = Record<NomeCapacidade, Capacidade> & { plataforma: string }

const NAO_VERIFICADO_ML: Capacidade = {
  estado: 'nao_verificado',
  motivo: 'A documentação oficial do Mercado Livre responde 403 a este ambiente e não houve credencial para sondar a API. Ver as perguntas em src/lib/precificacao/adaptadores.ts.',
  evidencia: 'docs/precificacao-fase2-comercial.md §6',
}

const CAPACIDADES: Record<string, Omit<CapacidadesCanal, 'plataforma'>> = {
  shopee: {
    campanhasLeitura: {
      estado: 'suportado',
      evidencia: 'lib/shopee/discount.ts — get_discount_list e get_discount, com espelho em marketplace_promocoes',
    },
    campanhasEscrita: {
      estado: 'nao_verificado',
      motivo: 'A leitura foi implementada; criar ou alterar campanha pela API nunca foi exercitado nesta conta.',
    },
    precoQuantidade: {
      estado: 'nao_verificado',
      motivo: 'Não foi verificado se a Shopee expõe desconto por quantidade pela API desta integração.',
    },
    precoQuantidadeEscrita: {
      estado: 'nao_verificado',
      motivo: 'Depende da leitura acima ser verificada primeiro.',
    },
    variacoes: {
      estado: 'suportado',
      motivo: 'A Shopee cobra preço por variação (model_id), e o sistema reconhece isso — inclusive recusando aplicar preço de anúncio em item com variações de preços diferentes.',
      evidencia: 'lib/precificacao/campanhas.ts — itemDoAnuncio',
    },
    subsidioCampanha: {
      estado: 'nao_verificado',
      motivo: 'Não foi verificado se a Shopee informa quanto ela banca do desconto.',
    },
    webhookPromocao: {
      estado: 'nao_verificado',
      motivo: 'A sincronização de campanhas é manual; não há cron nem webhook configurado.',
    },
  },
  mercadolivre: {
    campanhasLeitura: NAO_VERIFICADO_ML,
    campanhasEscrita: NAO_VERIFICADO_ML,
    precoQuantidade: NAO_VERIFICADO_ML,
    precoQuantidadeEscrita: NAO_VERIFICADO_ML,
    variacoes: {
      estado: 'suportado',
      motivo: 'O sistema lê e edita variações de anúncio do ML.',
      evidencia: 'lib/marketplace/EditarAnuncioModal e marketplace_anuncio_variacoes',
    },
    subsidioCampanha: NAO_VERIFICADO_ML,
    webhookPromocao: NAO_VERIFICADO_ML,
  },
}

const DESCONHECIDA = (plataforma: string): Capacidade => ({
  estado: 'nao_verificado',
  motivo: `O sistema não tem informação sobre as capacidades comerciais de ${plataforma}.`,
})

/**
 * As capacidades de um canal.
 *
 * `temCredencial: false` rebaixa tudo que dependeria de API para
 * `indisponivel_por_credencial` — que é reversível, ao contrário de
 * `nao_suportado`. Um canal desconectado não vira um canal incapaz.
 */
export function capacidadesDoCanal(
  plataforma: string,
  opcoes: { temCredencial?: boolean } = {},
): CapacidadesCanal {
  const base = CAPACIDADES[plataforma]
  const nomes: NomeCapacidade[] = [
    'campanhasLeitura', 'campanhasEscrita', 'precoQuantidade',
    'precoQuantidadeEscrita', 'variacoes', 'subsidioCampanha', 'webhookPromocao',
  ]

  const saida = { plataforma } as CapacidadesCanal
  for (const nome of nomes) {
    const c = base?.[nome] ?? DESCONHECIDA(plataforma)
    // `variacoes` não depende de credencial: é conhecimento sobre o modelo da
    // plataforma, não uma chamada de API.
    const dependeDeApi = nome !== 'variacoes'
    saida[nome] = opcoes.temCredencial === false && dependeDeApi && c.estado !== 'nao_suportado'
      ? {
          estado: 'indisponivel_por_credencial',
          motivo: 'O canal não tem conexão ativa. Reconecte para que o sistema possa verificar.',
        }
      : c
  }
  return saida
}

/** Só `suportado` autoriza publicar. As outras três, não — por motivos diferentes. */
export function podePublicar(c: Capacidade): boolean {
  return c.estado === 'suportado'
}

export const ROTULO_CAPACIDADE: Record<EstadoCapacidade, { texto: string; cor: string }> = {
  suportado: { texto: 'disponível', cor: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  nao_suportado: { texto: 'não suportado', cor: 'text-gray-600 bg-gray-50 border-gray-200' },
  nao_verificado: { texto: 'não verificado', cor: 'text-amber-700 bg-amber-50 border-amber-200' },
  indisponivel_por_credencial: { texto: 'sem conexão', cor: 'text-gray-600 bg-gray-50 border-gray-200' },
}

/**
 * Frase para a tela quando a estratégia é boa mas o canal não a publica.
 *
 * A funcionalidade NÃO é escondida por causa disso: o usuário precisa poder
 * enxergar que economicamente cabe, mesmo que a publicação ainda dependa de
 * trabalho nosso.
 */
export function explicarPublicacao(c: Capacidade): string {
  if (c.estado === 'suportado') return 'Pode ser publicado neste canal.'
  if (c.estado === 'nao_suportado') return `Economicamente válido, mas o canal não oferece este recurso. ${c.motivo ?? ''}`.trim()
  if (c.estado === 'indisponivel_por_credencial') return `Economicamente válido. ${c.motivo ?? 'Canal sem conexão.'}`
  return `Economicamente válido, publicação no canal ainda não disponível. ${c.motivo ?? ''}`.trim()
}
