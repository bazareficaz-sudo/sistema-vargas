import { calcular } from './motor'
import type { ConfigTaxas, FaixaFrete, Objetivo, Resultado } from './tipos'

// Hierarquia de regras: qual objetivo de lucro vale pra um produto num canal.
//
// Uma regra não sabe nada de taxa — ela só diz quanto você quer ganhar. Quem
// sabe o que o canal cobra é a configuração da Fase 1. O preço nasce das duas.
//
// A regra mais específica vence. E, tão importante quanto acertar o preço:
// o sistema guarda POR QUE aquela regra venceu, pra a pergunta "por que este
// anúncio está com esse preço?" ter resposta em vez de suposição.

export type NivelRegra = 'produto' | 'categoria' | 'marca' | 'canal' | 'plataforma' | 'empresa'

export const NIVEIS: { valor: NivelRegra; label: string; ajuda: string }[] = [
  { valor: 'produto',    label: 'Produto específico', ajuda: 'Vale só para um produto. Ganha de todas as outras.' },
  { valor: 'categoria',  label: 'Categoria',          ajuda: 'Vale para todos os produtos de uma categoria.' },
  { valor: 'marca',      label: 'Marca',              ajuda: 'Vale para todos os produtos de uma marca.' },
  { valor: 'canal',      label: 'Canal',              ajuda: 'Vale para tudo que é vendido numa conta específica.' },
  { valor: 'plataforma', label: 'Marketplace',        ajuda: 'Vale para todas as contas de um marketplace.' },
  { valor: 'empresa',    label: 'Regra geral',        ajuda: 'Vale para tudo que não se encaixar em nenhuma regra acima.' },
]

// O peso decide quem ganha. Os saltos são grandes de propósito: o bônus de
// canal (+5) nunca faz uma regra de marca passar na frente de uma de
// categoria, só desempata entre regras do mesmo nível.
const PESO_NIVEL: Record<NivelRegra, number> = {
  produto: 100, categoria: 60, marca: 50, canal: 30, plataforma: 20, empresa: 10,
}
const BONUS_CANAL = 5

export type Regra = {
  id: string
  nome: string
  nivel: NivelRegra
  alvoId: string | null
  alvoTexto: string | null
  canalId: string | null
  objetivoTipo: Objetivo['tipo']
  objetivoValor: number
  /**
   * MARGEM PISO — limite econômico absoluto, em % de margem líquida.
   *
   * Nome antigo, semântica confirmada na auditoria da Fase 2: é isto que
   * `aplicarRegra` já tratava como piso. Não foi renomeada porque renomear
   * coluna em produção para ganhar clareza de nome é troca ruim.
   */
  margemMinima: number | null
  /**
   * MARGEM PROMOCIONAL MÍNIMA — até onde uma promoção pode reduzir sem
   * precisar de aprovação. NULA = sem política promocional declarada; o
   * classificador então usa o próprio piso, deixando a faixa promocional
   * vazia. Ver `margens.ts` e supabase-precificacao-margem-promocional.sql.
   */
  margemPromocionalMinima: number | null
  arredondamento: string
  prioridade: number
}

export type ProdutoParaRegra = {
  id: string
  categoria: string | null
  marca: string | null
}

export type CanalParaRegra = { id: string; plataforma: string }

export type Candidata = {
  regra: Regra
  casou: boolean
  peso: number
  motivo: string
}

function normalizar(t: string | null | undefined): string {
  return (t ?? '').trim().toLowerCase()
}

function avaliar(regra: Regra, produto: ProdutoParaRegra, canal: CanalParaRegra): Candidata {
  // Restrição de canal vale em qualquer nível e é eliminatória.
  if (regra.canalId && regra.canalId !== canal.id) {
    return { regra, casou: false, peso: 0, motivo: 'é de outro canal' }
  }

  const peso = PESO_NIVEL[regra.nivel] + (regra.canalId ? BONUS_CANAL : 0) + Math.min(regra.prioridade, 4) * 0.1

  switch (regra.nivel) {
    case 'produto':
      return regra.alvoId === produto.id
        ? { regra, casou: true, peso, motivo: 'é a regra deste produto' }
        : { regra, casou: false, peso: 0, motivo: 'é de outro produto' }
    case 'categoria':
      return normalizar(regra.alvoTexto) === normalizar(produto.categoria)
        ? { regra, casou: true, peso, motivo: `a categoria do produto é ${produto.categoria}` }
        : { regra, casou: false, peso: 0, motivo: `vale para a categoria ${regra.alvoTexto}` }
    case 'marca':
      return normalizar(regra.alvoTexto) === normalizar(produto.marca)
        ? { regra, casou: true, peso, motivo: `a marca do produto é ${produto.marca}` }
        : { regra, casou: false, peso: 0, motivo: `vale para a marca ${regra.alvoTexto}` }
    case 'canal':
      return regra.alvoId === canal.id
        ? { regra, casou: true, peso, motivo: 'é a regra deste canal' }
        : { regra, casou: false, peso: 0, motivo: 'é de outro canal' }
    case 'plataforma':
      return normalizar(regra.alvoTexto) === normalizar(canal.plataforma)
        ? { regra, casou: true, peso, motivo: `o canal é do ${canal.plataforma}` }
        : { regra, casou: false, peso: 0, motivo: `vale para ${regra.alvoTexto}` }
    case 'empresa':
      return { regra, casou: true, peso, motivo: 'é a regra geral da empresa' }
    default:
      return { regra, casou: false, peso: 0, motivo: 'nível desconhecido' }
  }
}

export type ResolucaoRegra = {
  vencedora: Regra | null
  candidatas: Candidata[]      // as que casaram, da mais forte pra mais fraca
  descartadas: Candidata[]     // as que não casaram, com o motivo
}

export function resolverRegra(regras: Regra[], produto: ProdutoParaRegra, canal: CanalParaRegra): ResolucaoRegra {
  const avaliadas = regras.map(r => avaliar(r, produto, canal))
  const casaram = avaliadas.filter(c => c.casou).sort((a, b) => b.peso - a.peso)
  return {
    vencedora: casaram[0]?.regra ?? null,
    candidatas: casaram,
    descartadas: avaliadas.filter(c => !c.casou),
  }
}

export function linhaParaRegra(row: any): Regra {
  return {
    id: row.id,
    nome: row.nome,
    nivel: row.nivel,
    alvoId: row.alvo_id ?? null,
    alvoTexto: row.alvo_texto ?? null,
    canalId: row.canal_id ?? null,
    objetivoTipo: row.objetivo_tipo,
    objetivoValor: Number(row.objetivo_valor),
    margemMinima: row.margem_minima != null ? Number(row.margem_minima) : null,
    margemPromocionalMinima: row.margem_promocional_minima != null ? Number(row.margem_promocional_minima) : null,
    arredondamento: row.arredondamento ?? 'nenhum',
    prioridade: Number(row.prioridade ?? 0),
  }
}

export async function buscarRegras(sb: any, empresaId: string): Promise<Regra[]> {
  const { data } = await sb.from('precificacao_regra')
    .select('*').eq('empresa_id', empresaId).eq('ativo', true)
  return (data ?? []).map(linhaParaRegra)
}

// Aplica a regra passando pelo motor, respeitando a margem mínima.
//
// A margem mínima é um piso, não um alvo: se o objetivo já entrega margem
// igual ou maior, ela não interfere em nada. Quando interfere, o preço sobe
// e o sistema diz que subiu — nunca silenciosamente.
export function aplicarRegra(params: {
  cfg: ConfigTaxas
  custoProduto: number
  regra: Regra
  pesoKg?: number | null
  /** Escada de frete importada do marketplace para este item. */
  freteFaixas?: FaixaFrete[] | null
}): Resultado & { margemMinimaAplicada: boolean } {
  const { cfg, custoProduto, regra } = params
  const arredondamento = regra.arredondamento as any

  const base = calcular({
    cfg, custoProduto, pesoKg: params.pesoKg, freteFaixas: params.freteFaixas,
    objetivo: { tipo: regra.objetivoTipo, valor: regra.objetivoValor } as Objetivo,
    arredondamento,
  })

  if (regra.margemMinima == null || base.margemLiquida >= regra.margemMinima - 0.01) {
    return { ...base, margemMinimaAplicada: false }
  }

  const comPiso = calcular({
    cfg, custoProduto, pesoKg: params.pesoKg, freteFaixas: params.freteFaixas,
    objetivo: { tipo: 'margem_liquida', valor: regra.margemMinima },
    arredondamento,
  })
  return {
    ...comPiso,
    margemMinimaAplicada: true,
    avisos: [
      ...comPiso.avisos,
      `O objetivo da regra daria ${base.margemLiquida.toFixed(1)}% de margem, abaixo do mínimo de ${regra.margemMinima}%. O preço subiu de ${base.preco.toFixed(2)} para ${comPiso.preco.toFixed(2)} para respeitar o piso.`,
    ],
  }
}

export function descreverObjetivo(tipo: string, valor: number): string {
  const v = String(valor).replace('.', ',')
  // "20% de lucro sobre o custo" ao lado de uma coluna que mostra 12% parecia
  // contradição — são o mesmo lucro em bases diferentes (custo e preço). A
  // tela passou a mostrar as duas; aqui basta a base ficar explícita.
  if (tipo === 'margem_liquida') return `margem líquida de ${v}% (sobre o preço)`
  if (tipo === 'sobre_custo') return `${v}% de lucro sobre o custo`
  if (tipo === 'markup') return `markup ${v}× (preço = ${v}× o custo)`
  if (tipo === 'lucro_fixo') return `lucro fixo de R$ ${v}`
  if (tipo === 'preco') return `preço fixo de R$ ${v}`
  return `${tipo} ${v}`
}
