import { unstable_cache } from 'next/cache'
import { db } from '../db'
import { carregarFrete } from './servico'
import { bairrosAtendidos, menorFreteGratis } from './politica'

// O que a VITRINE precisa saber do frete para montar a janela de bairro, a
// faixa do topo e o bloco da página do produto — sem expor regra nenhuma de
// preço: só os bairros que a loja atende e as escolhas de exibição do gestor.
//
// Em cache porque o layout roda em toda página; `invalidarVitrine()` limpa
// pela tag `loja:{id}` quando o gestor salva no painel.

export type EntregaVitrine = {
  ativo: boolean
  gatilho: 'entrada' | 'produto' | 'carrinho' | 'nunca'
  identificacao: 'bairro' | 'cep' | 'ambos'
  titulo: string | null
  faixaTopo: boolean
  mostrarNoProduto: boolean
  incentivoGratis: boolean
  /** Bairros da lista da janela (de regras "por bairro"). */
  bairros: { cidade: string | null; bairro: string }[]
  /** Promessa geral: o menor limite de frete grátis entre as regras. */
  gratisAcima: number | null
}

const DESLIGADO: EntregaVitrine = {
  ativo: false, gatilho: 'nunca', identificacao: 'cep', titulo: null,
  faixaTopo: false, mostrarNoProduto: false, incentivoGratis: false,
  bairros: [], gratisAcima: null,
}

async function ler(lojaId: string): Promise<EntregaVitrine> {
  const frete = await carregarFrete(lojaId)
  if (!frete) return DESLIGADO

  const { data: c } = await db()
    .from('loja_frete_config')
    .select('seletor_gatilho, seletor_identificacao, seletor_titulo, faixa_topo, mostrar_no_produto, incentivo_gratis')
    .eq('loja_id', lojaId).maybeSingle()

  const bairros = bairrosAtendidos(frete.regras)
  const identificacao = (c?.seletor_identificacao ?? 'ambos') as EntregaVitrine['identificacao']

  return {
    ativo: true,
    gatilho: (c?.seletor_gatilho ?? 'produto') as EntregaVitrine['gatilho'],
    // Sem nenhum bairro cadastrado, "escolher o bairro" não tem o que mostrar.
    identificacao: bairros.length === 0 ? 'cep' : identificacao,
    titulo: c?.seletor_titulo ?? null,
    faixaTopo: c?.faixa_topo ?? true,
    mostrarNoProduto: c?.mostrar_no_produto ?? true,
    incentivoGratis: c?.incentivo_gratis ?? true,
    bairros,
    gratisAcima: menorFreteGratis(frete.config, frete.regras),
  }
}

export function entregaDaVitrine(lojaId: string): Promise<EntregaVitrine> {
  return unstable_cache(() => ler(lojaId), ['loja-entrega', lojaId], {
    revalidate: 300, tags: [`loja:${lojaId}`],
  })()
}
