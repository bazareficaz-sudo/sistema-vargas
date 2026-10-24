import {
  casaArea, normalizarTexto,
  type ConfigFrete, type DestinoFrete, type RegraFrete,
} from './calculo'

// A POLÍTICA de entrega de um destino, sem carrinho.
//
// `calcularFrete` responde "quanto custa ESTE pedido". Antes de o cliente ter
// qualquer pedido — na janela de bairro, na faixa do topo — a pergunta é outra:
// "como é a entrega para o meu bairro?". Esta função responde isso com as mesmas
// regras, e nunca inventa número: o que depende de peso, valor ou distância
// que ainda não se conhece sai como uma descrição ("a partir de…"), não como
// um valor.
//
// Pura, como o motor: sem banco nem rede. Roda no servidor (rota, painel) e
// no navegador.

export type PoliticaOpcao = {
  servico: string
  nome: string
  /** Valor da entrega quando já é certo (valor fixo, ou distância conhecida). */
  valor: number | null
  /** Menor valor possível quando depende de peso, valor do pedido ou distância. */
  aPartirDe: number | null
  /** O que faz o valor variar, para o texto: "peso", "valor do pedido"… */
  dependeDe: 'peso' | 'subtotal' | 'distancia' | null
  gratisAcima: number | null
  pedidoMinimo: number | null
  prazo: string | null
}

export type PoliticaDestino =
  | { status: 'opcoes'; opcoes: PoliticaOpcao[] }
  | { status: 'combinar'; motivo: string }
  | { status: 'indisponivel'; motivo: string }

const maior = (a: number | null, b: number | null) =>
  a == null ? b : b == null ? a : Math.max(a, b)

export function politicaDoDestino(
  config: ConfigFrete, regras: RegraFrete[], destino: DestinoFrete,
): PoliticaDestino {
  const escolhidas = new Map<string, PoliticaOpcao>()
  const ordenadas = regras.filter(r => r.ativo).sort((a, b) => a.prioridade - b.prioridade)
  let faltouDistancia = false

  for (const r of ordenadas) {
    if (escolhidas.has(r.servico)) continue
    const area = casaArea(r, destino)
    if (area === 'sem_distancia') { faltouDistancia = true; continue }
    if (area !== true) continue

    let valor: number | null = null
    let aPartirDe: number | null = null
    let dependeDe: PoliticaOpcao['dependeDe'] = null

    if (r.calculoTipo === 'fixo') {
      valor = r.valorFixo
    } else if (r.calculoTipo === 'por_km') {
      if (destino.distanciaKm != null) valor = r.valorBase + destino.distanciaKm * r.valorPorKm
      else { aPartirDe = r.valorBase; dependeDe = 'distancia' }
    } else {
      aPartirDe = r.faixas.length > 0 ? Math.min(...r.faixas.map(f => f.valor)) : null
      dependeDe = r.faixasBase === 'peso' ? 'peso' : r.faixasBase === 'subtotal' ? 'subtotal' : 'distancia'
      // Faixa de distância com a distância conhecida vira valor certo.
      if (dependeDe === 'distancia' && destino.distanciaKm != null) {
        const km = destino.distanciaKm
        const f = [...r.faixas]
          .sort((a, b) => (a.ate ?? Infinity) - (b.ate ?? Infinity))
          .find(x => x.ate == null || km <= x.ate)
        if (f) { valor = f.valor; aPartirDe = null; dependeDe = null }
      }
    }

    escolhidas.set(r.servico, {
      servico: r.servico, nome: r.nome, valor, aPartirDe, dependeDe,
      gratisAcima: r.freteGratisAcima ?? config.freteGratisAcima,
      pedidoMinimo: maior(r.pedidoMinimo, config.pedidoMinimo),
      prazo: r.prazoTexto,
    })
  }

  if (escolhidas.size > 0) {
    const opcoes = [...escolhidas.values()].sort(
      (a, b) => (a.valor ?? a.aPartirDe ?? Infinity) - (b.valor ?? b.aPartirDe ?? Infinity),
    )
    return { status: 'opcoes', opcoes }
  }

  // Há regra por distância que só o CEP resolve: pedir o CEP é mais honesto que
  // dizer que o frete é "combinado".
  if (faltouDistancia) {
    return { status: 'combinar', motivo: 'Informe o seu CEP para calcular a entrega até você.' }
  }
  if (config.semRegra === 'nao_entrega') {
    return { status: 'indisponivel', motivo: 'Ainda não entregamos neste endereço. Você pode retirar na loja.' }
  }
  return { status: 'combinar', motivo: 'Para este endereço o valor da entrega é combinado com a loja.' }
}

const reais = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Uma linha de texto para o cliente: "R$ 8,00 · grátis acima de R$ 150,00 · 1 dia útil". */
export function textoDaOpcao(o: PoliticaOpcao): string {
  const partes: string[] = []

  if (o.valor != null) partes.push(o.valor > 0 ? reais(o.valor) : 'Grátis')
  else if (o.aPartirDe != null) {
    const base = o.dependeDe === 'peso' ? 'conforme o peso'
      : o.dependeDe === 'subtotal' ? 'conforme o valor do pedido'
      : 'conforme a distância'
    partes.push(`a partir de ${reais(o.aPartirDe)} (${base})`)
  }

  if (o.gratisAcima != null && o.valor !== 0) partes.push(`grátis acima de ${reais(o.gratisAcima)}`)
  if (o.pedidoMinimo != null && o.pedidoMinimo > 0) partes.push(`pedido mínimo ${reais(o.pedidoMinimo)}`)
  if (o.prazo) partes.push(o.prazo)
  return partes.join(' · ')
}

/** Bairros que as regras atendem, para a lista da janela. Sem repetir, ordenados. */
export function bairrosAtendidos(regras: RegraFrete[]): { cidade: string | null; bairro: string }[] {
  const vistos = new Map<string, { cidade: string | null; bairro: string }>()
  for (const r of regras) {
    if (!r.ativo || r.areaTipo !== 'bairros') continue
    for (const b of r.bairros) {
      const chave = `${normalizarTexto(r.cidade)}|${normalizarTexto(b)}`
      if (!vistos.has(chave)) vistos.set(chave, { cidade: r.cidade, bairro: b.trim() })
    }
  }
  return [...vistos.values()].sort(
    (a, b) => (a.cidade ?? '').localeCompare(b.cidade ?? '', 'pt-BR') || a.bairro.localeCompare(b.bairro, 'pt-BR'),
  )
}

/** O menor limite de frete grátis entre as regras: a promessa geral da loja. */
export function menorFreteGratis(config: ConfigFrete, regras: RegraFrete[]): number | null {
  const limites = [config.freteGratisAcima, ...regras.filter(r => r.ativo).map(r => r.freteGratisAcima)]
    .filter((x): x is number => x != null)
  return limites.length > 0 ? Math.min(...limites) : null
}
