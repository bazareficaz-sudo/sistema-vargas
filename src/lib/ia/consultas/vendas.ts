import {
  dataISO, intervaloUTC, rotuloPeriodo, MAX_LINHAS, STATUS_NAO_VALE,
  type Consulta, type ResultadoConsulta, type ClienteSupabase,
} from './tipos'

// CONSULTAS DE VENDAS.
//
// A primeira area a ganhar consulta nomeada, e por um motivo concreto: em
// 02/09/2026 o gestor perguntou "teve venda do produto 24150 ontem?" e o
// sistema respondeu que nao tinha o dado. Tinha — 2 vendas, 3 unidades,
// R$ 7,50. O que faltava nao era o dado, era o modelo poder pedi-lo.

const paramsPeriodo = {
  de: { type: 'string', description: 'Data inicial no formato AAAA-MM-DD.' },
  ate: { type: 'string', description: 'Data final no formato AAAA-MM-DD (inclusive).' },
}

/** Valida o intervalo e devolve o erro como resultado, nao como excecao. */
type Periodo =
  | { ok: false; erro: string }
  | { ok: true; de: string; ate: string; inicio: string; fim: string }

function periodo(args: Record<string, unknown>): Periodo {
  const de = dataISO(args.de)
  const ate = dataISO(args.ate)
  if (!de || !ate) {
    return { ok: false, erro: 'Informe `de` e `ate` no formato AAAA-MM-DD. Datas relativas como "ontem" precisam ser convertidas antes.' }
  }
  if (de > ate) return { ok: false, erro: 'A data inicial é posterior à final.' }
  return { ok: true, de, ate, ...intervaloUTC(de, ate) }
}

const erro = (mensagem: string): ResultadoConsulta => ({
  linhas: [], periodo: '—', ressalvas: [mensagem],
})

const RESSALVA_CANCELADAS = 'Vendas canceladas não entram na conta.'

/** Ids das vendas válidas do período — base de tudo que olha itens. */
async function vendasDoPeriodo(sb: ClienteSupabase, empresaId: string, inicio: string, fim: string) {
  const { data } = await sb.from('vendas')
    .select('id, total, created_at, cliente_nome, vendedor_nome, canal, status')
    .eq('empresa_id', empresaId)
    .gte('created_at', inicio).lte('created_at', fim)
  return (data ?? []).filter((v: { status?: string }) => !STATUS_NAO_VALE.includes(String(v.status ?? '')))
}

export const CONSULTAS_VENDAS: Consulta[] = [
  {
    nome: 'vendas_resumo_periodo',
    descricao: 'Total vendido, número de vendas e ticket médio num intervalo de datas.',
    parametros: { type: 'object', properties: paramsPeriodo, required: ['de', 'ate'] },
    async executar(sb, empresaId, args) {
      const p = periodo(args)
      if (!p.ok) return erro(p.erro)
      const vendas = await vendasDoPeriodo(sb, empresaId, p.inicio, p.fim)
      const total = vendas.reduce((s: number, v: { total?: number }) => s + Number(v.total ?? 0), 0)
      return {
        linhas: [{
          vendas: vendas.length,
          faturamento: Number(total.toFixed(2)),
          ticket_medio: vendas.length ? Number((total / vendas.length).toFixed(2)) : 0,
        }],
        periodo: rotuloPeriodo(p.de, p.ate),
        ressalvas: [RESSALVA_CANCELADAS],
      }
    },
  },

  {
    nome: 'vendas_de_um_produto',
    descricao: 'Se um produto foi vendido num período, e quanto. Busca por SKU exato ou por parte do nome.',
    parametros: {
      type: 'object',
      properties: {
        ...paramsPeriodo,
        termo: { type: 'string', description: 'SKU exato (ex.: "24150") ou parte do nome do produto.' },
      },
      required: ['de', 'ate', 'termo'],
    },
    async executar(sb, empresaId, args) {
      const p = periodo(args)
      if (!p.ok) return erro(p.erro)
      const termo = String(args.termo ?? '').trim()
      if (!termo) return erro('Informe o SKU ou parte do nome do produto.')

      const vendas = await vendasDoPeriodo(sb, empresaId, p.inicio, p.fim)
      if (vendas.length === 0) {
        return { linhas: [], periodo: rotuloPeriodo(p.de, p.ate), ressalvas: ['Não houve nenhuma venda neste período.'] }
      }
      const ids = vendas.map((v: { id: string }) => String(v.id))

      // O NOME E O SKU VEM DE `venda_itens`, nao de `produtos`.
      //
      // A tabela guarda os dois desnormalizados — o que o item ERA na hora da
      // venda. Isso e o certo aqui por dois motivos: o cadastro pode ter sido
      // renomeado depois, e 601 das 4.124 linhas de `venda_itens` tem
      // `produto_id` que nao aponta para produto nenhum (medido em 01/09). Um
      // JOIN com `produtos` perderia essas vendas em silencio.
      let q = sb.from('venda_itens')
        .select('produto_sku, produto_nome, quantidade, total, venda_id')
        .in('venda_id', ids)
      q = /^\d+$/.test(termo)
        ? q.eq('produto_sku', termo)
        : q.ilike('produto_nome', `%${termo}%`)

      const { data: itens } = await q.limit(500)
      const lista = itens ?? []

      const porProduto = new Map<string, { sku: string; nome: string; quantidade: number; total: number; vendas: Set<string> }>()
      for (const i of lista as { produto_sku?: string; produto_nome?: string; quantidade?: number; total?: number; venda_id?: string }[]) {
        const chave = String(i.produto_sku ?? i.produto_nome ?? '?')
        const atual = porProduto.get(chave) ?? {
          sku: String(i.produto_sku ?? ''), nome: String(i.produto_nome ?? ''),
          quantidade: 0, total: 0, vendas: new Set<string>(),
        }
        atual.quantidade += Number(i.quantidade ?? 0)
        atual.total += Number(i.total ?? 0)
        if (i.venda_id) atual.vendas.add(String(i.venda_id))
        porProduto.set(chave, atual)
      }

      const linhas = [...porProduto.values()]
        .sort((a, b) => b.total - a.total)
        .slice(0, MAX_LINHAS)
        .map(p2 => ({
          sku: p2.sku, produto: p2.nome,
          quantidade: Number(p2.quantidade.toFixed(3)),
          total: Number(p2.total.toFixed(2)),
          vendas: p2.vendas.size,
        }))

      return {
        linhas,
        periodo: rotuloPeriodo(p.de, p.ate),
        ressalvas: linhas.length === 0
          // A DIFERENÇA IMPORTA: "não vendeu" e "não existe com esse código"
          // pedem respostas diferentes de quem pergunta.
          ? [`Nenhuma venda de "${termo}" neste período. Isso não diz se o produto existe no cadastro — apenas que não foi vendido.`]
          : [RESSALVA_CANCELADAS],
      }
    },
  },

  {
    nome: 'vendas_por_cliente',
    descricao: 'Quanto cada cliente comprou num período. Aceita um termo para filtrar por nome.',
    parametros: {
      type: 'object',
      properties: {
        ...paramsPeriodo,
        termo: { type: 'string', description: 'Opcional: parte do nome do cliente.' },
      },
      required: ['de', 'ate'],
    },
    async executar(sb, empresaId, args) {
      const p = periodo(args)
      if (!p.ok) return erro(p.erro)
      const termo = String(args.termo ?? '').trim().toLowerCase()
      const vendas = await vendasDoPeriodo(sb, empresaId, p.inicio, p.fim)

      const mapa = new Map<string, { total: number; vendas: number }>()
      for (const v of vendas as { cliente_nome?: string; total?: number }[]) {
        const nome = String(v.cliente_nome ?? '').trim() || '(sem cliente identificado)'
        if (termo && !nome.toLowerCase().includes(termo)) continue
        const atual = mapa.get(nome) ?? { total: 0, vendas: 0 }
        atual.total += Number(v.total ?? 0)
        atual.vendas += 1
        mapa.set(nome, atual)
      }

      const todas = [...mapa.entries()].sort((a, b) => b[1].total - a[1].total)
      return {
        linhas: todas.slice(0, MAX_LINHAS).map(([cliente, d]) => ({
          cliente, vendas: d.vendas, total: Number(d.total.toFixed(2)),
        })),
        periodo: rotuloPeriodo(p.de, p.ate),
        truncado: todas.length > MAX_LINHAS,
        ressalvas: [
          RESSALVA_CANCELADAS,
          'Vendas sem cliente identificado aparecem agrupadas como "(sem cliente identificado)".',
        ],
      }
    },
  },

  {
    nome: 'vendas_por_vendedor',
    descricao: 'Quanto cada vendedor vendeu num período.',
    parametros: { type: 'object', properties: paramsPeriodo, required: ['de', 'ate'] },
    async executar(sb, empresaId, args) {
      const p = periodo(args)
      if (!p.ok) return erro(p.erro)
      const vendas = await vendasDoPeriodo(sb, empresaId, p.inicio, p.fim)
      const mapa = new Map<string, { total: number; vendas: number }>()
      for (const v of vendas as { vendedor_nome?: string; total?: number }[]) {
        const nome = String(v.vendedor_nome ?? '').trim() || '(sem vendedor)'
        const atual = mapa.get(nome) ?? { total: 0, vendas: 0 }
        atual.total += Number(v.total ?? 0)
        atual.vendas += 1
        mapa.set(nome, atual)
      }
      return {
        linhas: [...mapa.entries()].sort((a, b) => b[1].total - a[1].total)
          .slice(0, MAX_LINHAS)
          .map(([vendedor, d]) => ({ vendedor, vendas: d.vendas, total: Number(d.total.toFixed(2)) })),
        periodo: rotuloPeriodo(p.de, p.ate),
        ressalvas: [RESSALVA_CANCELADAS],
      }
    },
  },

  {
    nome: 'produtos_mais_vendidos',
    descricao: 'Ranking dos produtos mais vendidos num período, por faturamento ou por quantidade.',
    parametros: {
      type: 'object',
      properties: {
        ...paramsPeriodo,
        por: { type: 'string', description: '"faturamento" (padrão) ou "quantidade".' },
      },
      required: ['de', 'ate'],
    },
    async executar(sb, empresaId, args) {
      const p = periodo(args)
      if (!p.ok) return erro(p.erro)
      const porQuantidade = String(args.por ?? '').toLowerCase().startsWith('quant')
      const vendas = await vendasDoPeriodo(sb, empresaId, p.inicio, p.fim)
      if (vendas.length === 0) {
        return { linhas: [], periodo: rotuloPeriodo(p.de, p.ate), ressalvas: ['Não houve nenhuma venda neste período.'] }
      }
      const ids = vendas.map((v: { id: string }) => String(v.id))

      const { data: itens } = await sb.from('venda_itens')
        .select('produto_sku, produto_nome, quantidade, total')
        .in('venda_id', ids).limit(5000)

      const mapa = new Map<string, { sku: string; nome: string; quantidade: number; total: number }>()
      for (const i of (itens ?? []) as { produto_sku?: string; produto_nome?: string; quantidade?: number; total?: number }[]) {
        const chave = String(i.produto_sku ?? i.produto_nome ?? '?')
        const atual = mapa.get(chave) ?? { sku: String(i.produto_sku ?? ''), nome: String(i.produto_nome ?? ''), quantidade: 0, total: 0 }
        atual.quantidade += Number(i.quantidade ?? 0)
        atual.total += Number(i.total ?? 0)
        mapa.set(chave, atual)
      }

      const ordenado = [...mapa.values()].sort((a, b) =>
        porQuantidade ? b.quantidade - a.quantidade : b.total - a.total)

      return {
        linhas: ordenado.slice(0, 20).map(x => ({
          sku: x.sku, produto: x.nome,
          quantidade: Number(x.quantidade.toFixed(3)),
          total: Number(x.total.toFixed(2)),
        })),
        periodo: rotuloPeriodo(p.de, p.ate),
        truncado: ordenado.length > 20,
        ressalvas: [RESSALVA_CANCELADAS, `Ordenado por ${porQuantidade ? 'quantidade' : 'faturamento'}.`],
      }
    },
  },
]
