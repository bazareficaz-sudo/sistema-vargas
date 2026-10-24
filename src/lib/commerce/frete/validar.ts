// Validação do que o painel envia para as tabelas de frete.
//
// Mesma defesa das demais rotas de admin: LISTA BRANCA. Um corpo com
// `empresa_id` ou `loja_id` extra é descartado, não obedecido — quem decide
// dono e loja é a sessão, nunca o JSON.

type Saida<T> = { valores: T } | { erro: string }

const AREAS = ['toda_loja', 'bairros', 'cep', 'raio'] as const
const CALCULOS = ['fixo', 'por_km', 'faixas'] as const
const BASES = ['distancia', 'peso', 'subtotal'] as const

function numero(
  v: unknown, nome: string, min: number, max: number, nulavel = false,
): { ok: number | null } | { erro: string } {
  if (v == null || v === '') {
    return nulavel ? { ok: null } : { erro: `${nome}: informe um valor.` }
  }
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  if (!Number.isFinite(n) || n < min || n > max) {
    return { erro: `${nome}: use um valor entre ${min} e ${max}.` }
  }
  return { ok: Math.round(n * 1000) / 1000 }
}

const texto = (v: unknown, max: number) =>
  typeof v === 'string' ? v.trim().slice(0, max) : ''

/** Valida um conjunto de campos numéricos; devolve o primeiro erro ou os valores. */
function numeros(
  corpo: Record<string, unknown>,
  campos: { chave: string; nome: string; min: number; max: number; nulavel?: boolean; padrao?: number }[],
): { valores: Record<string, number | null> } | { erro: string } {
  const out: Record<string, number | null> = {}
  for (const c of campos) {
    const bruto = corpo[c.chave]
    const r = numero(
      (bruto == null || bruto === '') && c.padrao !== undefined ? c.padrao : bruto,
      c.nome, c.min, c.max, c.nulavel,
    )
    if ('erro' in r) return r
    out[c.chave] = r.ok
  }
  return { valores: out }
}

// ─── Configuração geral ──────────────────────────────────────────────────────

export function validarConfigFrete(corpo: Record<string, unknown>): Saida<Record<string, unknown>> {
  const n = numeros(corpo, [
    { chave: 'fator_estrada', nome: 'Fator de estrada', min: 1, max: 3, padrao: 1.3 },
    { chave: 'frete_gratis_acima', nome: 'Frete grátis acima de', min: 0, max: 1_000_000, nulavel: true },
    { chave: 'pedido_minimo', nome: 'Pedido mínimo', min: 0, max: 1_000_000, nulavel: true },
    { chave: 'peso_padrao_kg', nome: 'Peso padrão', min: 0, max: 1000, padrao: 0.3 },
    { chave: 'arredondar_para', nome: 'Arredondar para', min: 0, max: 100, nulavel: true },
    { chave: 'origem_lat', nome: 'Latitude', min: -34, max: 6, nulavel: true },
    { chave: 'origem_lng', nome: 'Longitude', min: -74, max: -33, nulavel: true },
  ])
  if ('erro' in n) return n

  const semRegra = corpo.sem_regra
  if (semRegra !== 'combinar' && semRegra !== 'nao_entrega') {
    return { erro: 'Escolha o que fazer com endereços sem regra.' }
  }

  // Latitude e longitude andam juntas: uma sem a outra não localiza nada.
  if ((n.valores.origem_lat == null) !== (n.valores.origem_lng == null)) {
    return { erro: 'Informe latitude e longitude juntas, ou deixe as duas em branco.' }
  }

  return {
    valores: {
      ativo: corpo.ativo === true,
      sem_regra: semRegra,
      mensagem: texto(corpo.mensagem, 300) || null,
      ...n.valores,
    },
  }
}

// ─── Experiência do cliente (janela de bairro) ───────────────────────────────

const GATILHOS = ['entrada', 'produto', 'carrinho', 'nunca'] as const
const IDENTIFICACOES = ['bairro', 'cep', 'ambos'] as const

export function validarExperienciaFrete(corpo: Record<string, unknown>): Saida<Record<string, unknown>> {
  const gatilho = GATILHOS.find(g => g === corpo.seletor_gatilho)
  const identificacao = IDENTIFICACOES.find(i => i === corpo.seletor_identificacao)
  if (!gatilho) return { erro: 'Escolha quando a janela de bairro aparece.' }
  if (!identificacao) return { erro: 'Escolha o que o cliente informa: bairro, CEP ou os dois.' }

  return {
    valores: {
      seletor_gatilho: gatilho,
      seletor_identificacao: identificacao,
      seletor_titulo: texto(corpo.seletor_titulo, 80) || null,
      faixa_topo: corpo.faixa_topo === true,
      mostrar_no_produto: corpo.mostrar_no_produto === true,
      incentivo_gratis: corpo.incentivo_gratis === true,
    },
  }
}

// ─── Regras ──────────────────────────────────────────────────────────────────

function lerFaixas(v: unknown): { ate: number | null; valor: number }[] | { erro: string } {
  if (!Array.isArray(v)) return []
  if (v.length > 30) return { erro: 'No máximo 30 faixas por regra.' }
  const faixas: { ate: number | null; valor: number }[] = []
  for (const f of v) {
    const o = (f ?? {}) as Record<string, unknown>
    const ate = numero(o.ate, 'Faixa "até"', 0, 1_000_000, true)
    const valor = numero(o.valor, 'Valor da faixa', 0, 100_000)
    if ('erro' in ate) return ate
    if ('erro' in valor) return valor
    faixas.push({ ate: ate.ok, valor: valor.ok as number })
  }
  // Só a última pode ser aberta ("acima de"); aberta no meio engoliria as seguintes.
  const abertas = faixas.filter(f => f.ate == null).length
  if (abertas > 1) return { erro: 'Só uma faixa pode ficar sem limite ("acima de").' }
  return faixas.sort((a, b) => (a.ate ?? Infinity) - (b.ate ?? Infinity))
}

function lerFaixasCep(v: unknown): { de: string; ate: string }[] | { erro: string } {
  if (!Array.isArray(v)) return []
  if (v.length > 50) return { erro: 'No máximo 50 faixas de CEP por regra.' }
  const out: { de: string; ate: string }[] = []
  for (const f of v) {
    const o = (f ?? {}) as Record<string, unknown>
    const de = String(o.de ?? '').replace(/\D/g, '')
    const ate = String(o.ate ?? '').replace(/\D/g, '')
    if (de.length !== 8 || ate.length !== 8) return { erro: 'CEP da faixa: use 8 dígitos.' }
    if (de > ate) return { erro: 'CEP da faixa: o inicial é maior que o final.' }
    out.push({ de, ate })
  }
  return out
}

export function validarRegraFrete(corpo: Record<string, unknown>): Saida<Record<string, unknown>> {
  const nome = texto(corpo.nome, 80)
  if (!nome) return { erro: 'Dê um nome à regra.' }

  const area = AREAS.find(a => a === corpo.area_tipo)
  const calculo = CALCULOS.find(c => c === corpo.calculo_tipo)
  if (!area) return { erro: 'Escolha onde a regra vale.' }
  if (!calculo) return { erro: 'Escolha como o valor é calculado.' }
  const base = BASES.find(b => b === corpo.faixas_base) ?? 'distancia'

  const n = numeros(corpo, [
    { chave: 'prioridade', nome: 'Prioridade', min: 0, max: 10_000, padrao: 100 },
    { chave: 'valor_fixo', nome: 'Valor fixo', min: 0, max: 100_000, padrao: 0 },
    { chave: 'valor_base', nome: 'Valor base', min: 0, max: 100_000, padrao: 0 },
    { chave: 'valor_por_km', nome: 'Valor por km', min: 0, max: 10_000, padrao: 0 },
    { chave: 'km_min', nome: 'Distância mínima', min: 0, max: 5000, nulavel: true },
    { chave: 'km_max', nome: 'Distância máxima', min: 0, max: 5000, nulavel: true },
    { chave: 'peso_franquia_kg', nome: 'Franquia de peso', min: 0, max: 10_000, nulavel: true },
    { chave: 'adicional_por_kg', nome: 'Adicional por kg', min: 0, max: 10_000, padrao: 0 },
    { chave: 'peso_max_kg', nome: 'Peso máximo', min: 0, max: 100_000, nulavel: true },
    { chave: 'frete_gratis_acima', nome: 'Frete grátis acima de', min: 0, max: 1_000_000, nulavel: true },
    { chave: 'pedido_minimo', nome: 'Pedido mínimo', min: 0, max: 1_000_000, nulavel: true },
  ])
  if ('erro' in n) return n
  const v = n.valores

  const faixas = lerFaixas(corpo.faixas)
  if ('erro' in faixas) return faixas
  const cepFaixas = lerFaixasCep(corpo.cep_faixas)
  if ('erro' in cepFaixas) return cepFaixas

  const bairros = Array.isArray(corpo.bairros)
    ? [...new Set(corpo.bairros.map(b => texto(b, 100)).filter(Boolean))].slice(0, 300)
    : []

  // Coerência entre área, cálculo e o que foi preenchido: regra incompleta
  // não casaria com nada, e o lojista concluiria que o frete "não funciona".
  if (area === 'bairros' && bairros.length === 0) return { erro: 'Informe ao menos um bairro.' }
  if (area === 'cep' && cepFaixas.length === 0) return { erro: 'Informe ao menos uma faixa de CEP.' }
  if (area === 'raio' && v.km_min != null && v.km_max != null && v.km_min > v.km_max) {
    return { erro: 'A distância mínima é maior que a máxima.' }
  }
  if (calculo === 'faixas' && faixas.length === 0) return { erro: 'Cadastre ao menos uma faixa de valor.' }
  if (calculo === 'por_km' && area === 'toda_loja' && v.valor_por_km === 0 && v.valor_base === 0) {
    return { erro: 'Informe o valor base ou o valor por km.' }
  }
  if (v.adicional_por_kg && v.peso_franquia_kg == null) {
    return { erro: 'Informe a franquia de peso (até quantos kg não cobra extra).' }
  }

  return {
    valores: {
      nome,
      servico: texto(corpo.servico, 60) || 'Entrega',
      ativo: corpo.ativo !== false,
      area_tipo: area,
      bairros,
      cidade: texto(corpo.cidade, 100) || null,
      cep_faixas: cepFaixas,
      calculo_tipo: calculo,
      faixas_base: base,
      faixas,
      prazo_texto: texto(corpo.prazo_texto, 120) || null,
      ...v,
    },
  }
}

// ─── Produto especial ────────────────────────────────────────────────────────

export function validarProdutoFrete(corpo: Record<string, unknown>): Saida<Record<string, unknown>> {
  const n = numeros(corpo, [
    { chave: 'adicional_unidade', nome: 'Adicional por unidade', min: 0, max: 10_000, padrao: 0 },
    { chave: 'peso_kg', nome: 'Peso', min: 0, max: 10_000, nulavel: true },
  ])
  if ('erro' in n) return n

  const frete_gratis = corpo.frete_gratis === true
  const somente_retirada = corpo.somente_retirada === true
  if (frete_gratis && somente_retirada) {
    return { erro: 'Um produto não pode ser "frete grátis" e "somente retirada" ao mesmo tempo.' }
  }
  return { valores: { frete_gratis, somente_retirada, ...n.valores } }
}
