import { db } from '../db'
import { conferirCarrinho } from '../carrinho'
import type { Loja } from '../tipos'
import {
  calcularFrete,
  type ConfigFrete, type RegraFrete, type ItemFrete, type ResultadoFrete, type OpcaoFrete,
} from './calculo'
import { distanciaRetaKm, localizarCep, type EnderecoLocalizado } from './geo'
import { politicaDoDestino, type PoliticaDestino } from './politica'

// Liga o motor de frete ao banco e ao mundo: carrega regras, pesa o carrinho
// com os dados REAIS do servidor (preço e peso nunca vêm do navegador) e
// resolve a distância até o endereço.
//
// Toda leitura aqui tolera a ausência das tabelas: se a migração do frete
// ainda não rodou, `carregarFrete` devolve `null` e a loja segue com o
// comportamento de antes (frete combinado). Por isso o deploy não depende da
// ordem entre SQL e código.

const num = (v: unknown, padrao = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : padrao
}
const numOuNull = (v: unknown) => (v == null || v === '' ? null : num(v, NaN)) as number | null

export function paraConfig(c: Record<string, any>): ConfigFrete {
  return {
    ativo: !!c.ativo,
    fatorEstrada: num(c.fator_estrada, 1.3),
    freteGratisAcima: numOuNull(c.frete_gratis_acima),
    pedidoMinimo: numOuNull(c.pedido_minimo),
    semRegra: c.sem_regra === 'nao_entrega' ? 'nao_entrega' : 'combinar',
    pesoPadraoKg: num(c.peso_padrao_kg, 0.3),
    arredondarPara: numOuNull(c.arredondar_para),
    mensagem: c.mensagem ?? null,
  }
}

export function paraRegra(r: Record<string, any>): RegraFrete {
  return {
    id: r.id,
    nome: r.nome,
    servico: r.servico || 'Entrega',
    ativo: !!r.ativo,
    prioridade: num(r.prioridade, 100),
    areaTipo: r.area_tipo,
    bairros: Array.isArray(r.bairros) ? r.bairros : [],
    cidade: r.cidade ?? null,
    cepFaixas: Array.isArray(r.cep_faixas) ? r.cep_faixas : [],
    kmMin: numOuNull(r.km_min),
    kmMax: numOuNull(r.km_max),
    calculoTipo: r.calculo_tipo,
    valorFixo: num(r.valor_fixo),
    valorBase: num(r.valor_base),
    valorPorKm: num(r.valor_por_km),
    faixasBase: r.faixas_base ?? 'distancia',
    faixas: Array.isArray(r.faixas)
      ? r.faixas.map((f: any) => ({ ate: f.ate == null ? null : num(f.ate), valor: num(f.valor) }))
      : [],
    pesoFranquiaKg: numOuNull(r.peso_franquia_kg),
    adicionalPorKg: num(r.adicional_por_kg),
    pesoMaxKg: numOuNull(r.peso_max_kg),
    freteGratisAcima: numOuNull(r.frete_gratis_acima),
    pedidoMinimo: numOuNull(r.pedido_minimo),
    prazoTexto: r.prazo_texto ?? null,
  }
}

export type FreteCarregado = {
  config: ConfigFrete
  regras: RegraFrete[]
  origem: { lat: number; lng: number } | null
}

/** `null` = frete desligado, sem configuração ou migração ainda não aplicada. */
export async function carregarFrete(lojaId: string): Promise<FreteCarregado | null> {
  const { data: c, error } = await db()
    .from('loja_frete_config').select('*').eq('loja_id', lojaId).maybeSingle()
  if (error || !c || !c.ativo) return null

  const { data: rs, error: erroRegras } = await db()
    .from('loja_frete_regras').select('*').eq('loja_id', lojaId)
  if (erroRegras) return null

  const origem = c.origem_lat != null && c.origem_lng != null
    ? { lat: num(c.origem_lat), lng: num(c.origem_lng) }
    : null

  return {
    config: paraConfig(c),
    regras: ((rs ?? []) as Record<string, any>[]).map(paraRegra),
    origem,
  }
}

export type EntradaDestino = {
  cep?: string
  bairro?: string
  cidade?: string
  uf?: string
}

export type CalculoFrete = {
  endereco: EnderecoLocalizado | null
  distanciaKm: number | null
  resultado: ResultadoFrete
}

/** Itens do carrinho no formato do motor, com peso e regras por produto. */
export async function itensParaFrete(
  loja: Loja, pedido: { produtoId: string; quantidade: number }[],
): Promise<{ itens: ItemFrete[]; subtotal: number }> {
  const conferido = await conferirCarrinho(loja, pedido)
  const validos = conferido.itens.filter(i => i.quantidade > 0 && !i.indisponivel)
  const ids = validos.map(i => i.produto.produtoId)
  if (ids.length === 0) return { itens: [], subtotal: 0 }

  const [{ data: pesos }, { data: especiais }] = await Promise.all([
    db().from('loja_vitrine_produtos').select('produto_id, peso_kg')
      .eq('loja_id', loja.id).in('produto_id', ids),
    db().from('loja_frete_produtos').select('*').eq('loja_id', loja.id).in('produto_id', ids),
  ])

  const pesoDe = new Map(((pesos ?? []) as any[]).map(p => [p.produto_id, numOuNull(p.peso_kg)]))
  const especialDe = new Map(((especiais ?? []) as any[]).map(e => [e.produto_id, e]))

  const itens: ItemFrete[] = validos.map(i => {
    const e = especialDe.get(i.produto.produtoId)
    const pesoCadastro = pesoDe.get(i.produto.produtoId) ?? null
    return {
      produtoId: i.produto.produtoId,
      nome: i.produto.nome,
      quantidade: i.quantidade,
      pesoKg: e?.peso_kg != null ? num(e.peso_kg) : (pesoCadastro && pesoCadastro > 0 ? pesoCadastro : null),
      precoUnitario: i.produto.preco,
      freteGratis: !!e?.frete_gratis,
      somenteRetirada: !!e?.somente_retirada,
      adicionalUnidade: e ? num(e.adicional_unidade) : 0,
    }
  })
  return { itens, subtotal: validos.reduce((s, i) => s + i.subtotal, 0) }
}

/**
 * Calcula o frete de um carrinho para um destino. `null` = frete desligado
 * (o chamador cai no comportamento antigo de frete combinado).
 */
export async function calcularParaCarrinho(
  loja: Loja,
  pedido: { produtoId: string; quantidade: number }[],
  destino: EntradaDestino,
): Promise<CalculoFrete | null> {
  const frete = await carregarFrete(loja.id)
  if (!frete) return null

  const [{ itens }, endereco] = await Promise.all([
    itensParaFrete(loja, pedido),
    destino.cep ? localizarCep(destino.cep) : Promise.resolve(null),
  ])

  // O que o cliente digitou ou corrigiu vale mais que o que o CEP trouxe: o
  // bairro de um CEP "geral" de cidade pequena vem vazio, e o cliente sabe o seu.
  const bairro = destino.bairro?.trim() || endereco?.bairro || null
  const cidade = destino.cidade?.trim() || endereco?.cidade || null
  const uf = destino.uf?.trim() || endereco?.uf || null

  let distanciaKm: number | null = null
  if (frete.origem && endereco?.lat != null && endereco.lng != null) {
    const reta = distanciaRetaKm(frete.origem, { lat: endereco.lat, lng: endereco.lng })
    distanciaKm = Math.round(reta * frete.config.fatorEstrada * 10) / 10
  }

  const resultado = calcularFrete(frete.config, frete.regras, itens, {
    cep: destino.cep ?? null, bairro, cidade, uf, distanciaKm,
  })
  return { endereco, distanciaKm, resultado }
}

/** Escolhe a opção pelo serviço que o cliente viu; na falta, a mais barata. */
export function escolherOpcao(r: ResultadoFrete, servico?: string): OpcaoFrete | null {
  if (r.status !== 'opcoes') return null
  return r.opcoes.find(o => o.servico === servico) ?? r.opcoes[0]
}

export type PoliticaConsultada = {
  local: { bairro: string | null; cidade: string | null; uf: string | null; cep: string | null }
  /** `true` quando o CEP não foi achado — o bairro informado à mão ainda vale. */
  cepNaoEncontrado: boolean
  politica: PoliticaDestino
  /** Só quando a consulta traz um produto: o frete real daquele item. */
  cotacao: ResultadoFrete | null
}

/**
 * Como é a entrega para um destino — e, se vier um produto, quanto custa
 * levá-lo. `null` = frete desligado. O destino pode ser só um bairro (a
 * janela da loja) ou um CEP (que traz bairro, cidade e distância).
 */
export async function consultarPolitica(
  loja: Loja,
  destino: EntradaDestino,
  produto?: { produtoId: string; quantidade: number },
): Promise<PoliticaConsultada | null> {
  const frete = await carregarFrete(loja.id)
  if (!frete) return null

  const endereco = destino.cep ? await localizarCep(destino.cep) : null
  const bairro = destino.bairro?.trim() || endereco?.bairro || null
  const cidade = destino.cidade?.trim() || endereco?.cidade || null
  const uf = destino.uf?.trim() || endereco?.uf || null

  let distanciaKm: number | null = null
  if (frete.origem && endereco?.lat != null && endereco.lng != null) {
    const reta = distanciaRetaKm(frete.origem, { lat: endereco.lat, lng: endereco.lng })
    distanciaKm = Math.round(reta * frete.config.fatorEstrada * 10) / 10
  }

  const d = { cep: destino.cep ?? null, bairro, cidade, uf, distanciaKm }

  let cotacao: ResultadoFrete | null = null
  if (produto) {
    const { itens } = await itensParaFrete(loja, [produto])
    if (itens.length > 0) cotacao = calcularFrete(frete.config, frete.regras, itens, d)
  }

  return {
    local: { bairro, cidade, uf, cep: destino.cep ?? endereco?.cep ?? null },
    cepNaoEncontrado: !!destino.cep && !endereco,
    politica: politicaDoDestino(frete.config, frete.regras, d),
    cotacao,
  }
}
