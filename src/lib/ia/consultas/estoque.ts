import {
  dataISO, intervaloUTC, rotuloPeriodo, MAX_LINHAS, STATUS_NAO_VALE,
  type Consulta, type ResultadoConsulta,
} from './tipos'

// CONSULTAS DE ESTOQUE.
//
// Segunda area do catalogo. As mesmas regras de vendas valem: catalogo
// fechado, `empresa_id` fixado pelo servidor, e toda resposta declara o que
// cobre.
//
// UM NUMERO DESTE SISTEMA QUE MUDA COMO ESTAS CONSULTAS SAO ESCRITAS: medido
// em 02/09/2026, `estoque_minimo > 0` em ZERO das 28.752 linhas de
// `produto_estoque`. Ninguem configurou minimo em produto nenhum.
//
// Uma consulta de "produtos abaixo do minimo" responderia "nenhum" — e
// "nenhum" ali significa "ninguem cadastrou minimo", nao "esta tudo
// abastecido". As duas frases levam a decisoes opostas, e um agente que
// confunde as duas manda o gestor dormir tranquilo em cima de uma ruptura.

const erro = (mensagem: string): ResultadoConsulta => ({
  linhas: [], periodo: '—', ressalvas: [mensagem],
})

/** Teto de produtos varridos quando a pergunta e sobre o catalogo inteiro. */
const TETO_VARREDURA = 300

export const CONSULTAS_ESTOQUE: Consulta[] = [
  {
    nome: 'estoque_de_um_produto',
    descricao: 'Saldo de um produto por depósito, com o total. Busca por SKU exato ou parte do nome.',
    parametros: {
      type: 'object',
      properties: {
        termo: { type: 'string', description: 'SKU exato (ex.: "24150") ou parte do nome do produto.' },
      },
      required: ['termo'],
    },
    async executar(sb, empresaId, args) {
      const termo = String(args.termo ?? '').trim()
      if (!termo) return erro('Informe o SKU ou parte do nome do produto.')

      let q = sb.from('produtos')
        .select('id, nome, sku, estoque, preco_custo, preco_venda, ativo')
        .eq('empresa_id', empresaId)
      q = /^\d+$/.test(termo) ? q.eq('sku', termo) : q.ilike('nome', `%${termo}%`)
      const { data: produtos } = await q.limit(MAX_LINHAS)

      const lista = (produtos ?? []) as { id: string; nome: string; sku: string; estoque: number; preco_custo: number; ativo: boolean }[]
      if (lista.length === 0) {
        return {
          linhas: [], periodo: 'saldo atual',
          // "Nao achei o produto" e "o produto tem zero" sao respostas
          // diferentes, e quem pergunta precisa saber qual das duas recebeu.
          ressalvas: [`Nenhum produto encontrado com "${termo}". Isso é diferente de o produto existir e estar zerado.`],
        }
      }

      // O saldo POR DEPOSITO vem de `produto_estoque`; `produtos.estoque` e o
      // consolidado. Mostrar os dois deixa ver quando eles discordam — e eles
      // discordam quando alguma movimentacao entrou por fora.
      const { data: porDeposito } = await sb.from('produto_estoque')
        .select('produto_id, quantidade, deposito_id, localizacao, depositos(nome)')
        .eq('empresa_id', empresaId).in('produto_id', lista.map(p => p.id))

      const mapa = new Map<string, { deposito: string; quantidade: number; localizacao: string | null }[]>()
      for (const l of (porDeposito ?? []) as { produto_id: string; quantidade: number; localizacao: string | null; depositos?: { nome?: string } | null }[]) {
        const atual = mapa.get(l.produto_id) ?? []
        atual.push({
          deposito: String(l.depositos?.nome ?? l.produto_id),
          quantidade: Number(l.quantidade ?? 0),
          localizacao: l.localizacao ?? null,
        })
        mapa.set(l.produto_id, atual)
      }

      return {
        linhas: lista.map(p => {
          const depositos = mapa.get(p.id) ?? []
          const somaDepositos = depositos.reduce((s, d) => s + d.quantidade, 0)
          return {
            sku: p.sku, produto: p.nome, ativo: p.ativo,
            estoque_total: Number(p.estoque ?? 0),
            por_deposito: depositos,
            // Divergencia entre o consolidado e a soma dos depositos e um
            // fato, nao um detalhe: significa movimentacao que entrou por
            // fora do fluxo normal.
            ...(Math.abs(somaDepositos - Number(p.estoque ?? 0)) > 0.001
              ? { atencao: `O consolidado (${p.estoque}) não bate com a soma dos depósitos (${somaDepositos}).` }
              : {}),
          }
        }),
        periodo: 'saldo atual',
      }
    },
  },

  {
    nome: 'produtos_sem_estoque',
    descricao: 'Produtos ativos com saldo zerado ou negativo. Opcionalmente só os que venderam num período.',
    parametros: {
      type: 'object',
      properties: {
        vendidos_desde: { type: 'string', description: 'Opcional, AAAA-MM-DD: só produtos que venderam a partir desta data (ou seja, ruptura de item que tem saída).' },
      },
    },
    async executar(sb, empresaId, args) {
      const { data } = await sb.from('produtos')
        .select('id, nome, sku, estoque, preco_venda')
        .eq('empresa_id', empresaId).eq('ativo', true).lte('estoque', 0)
        .order('nome').limit(TETO_VARREDURA)
      const zerados = (data ?? []) as { id: string; nome: string; sku: string; estoque: number }[]

      const desde = args.vendidos_desde ? dataISO(args.vendidos_desde) : null
      if (args.vendidos_desde && !desde) return erro('`vendidos_desde` precisa estar no formato AAAA-MM-DD.')

      if (!desde) {
        return {
          linhas: zerados.slice(0, MAX_LINHAS).map(p => ({ sku: p.sku, produto: p.nome, estoque: Number(p.estoque ?? 0) })),
          periodo: 'saldo atual',
          truncado: zerados.length >= TETO_VARREDURA,
          ressalvas: [
            'Somente produtos ativos.',
            'Sem `vendidos_desde`, a lista inclui itens que talvez nunca tenham vendido — ruptura de verdade é item zerado que TEM saída.',
          ],
        }
      }

      // Cruza com quem realmente vendeu: ruptura que importa e a do item com
      // saida. Um catalogo de 28 mil itens tem milhares de zerados que nunca
      // sairam, e listar todos afogaria o que interessa.
      const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
      const { inicio, fim } = intervaloUTC(desde, hoje)
      const { data: vendas } = await sb.from('vendas')
        .select('id, status').eq('empresa_id', empresaId)
        .gte('created_at', inicio).lte('created_at', fim)
      const idsVendas = (vendas ?? [])
        .filter((v: { status?: string }) => !STATUS_NAO_VALE.includes(String(v.status ?? '')))
        .map((v: { id: string }) => String(v.id))

      const skusVendidos = new Set<string>()
      if (idsVendas.length > 0) {
        const { data: itens } = await sb.from('venda_itens')
          .select('produto_sku').in('venda_id', idsVendas).limit(5000)
        for (const i of (itens ?? []) as { produto_sku?: string }[]) {
          if (i.produto_sku) skusVendidos.add(String(i.produto_sku))
        }
      }

      const comSaida = zerados.filter(p => skusVendidos.has(String(p.sku)))
      return {
        linhas: comSaida.slice(0, MAX_LINHAS).map(p => ({ sku: p.sku, produto: p.nome, estoque: Number(p.estoque ?? 0) })),
        periodo: `zerados hoje, entre os que venderam ${rotuloPeriodo(desde, hoje)}`,
        truncado: comSaida.length > MAX_LINHAS || zerados.length >= TETO_VARREDURA,
        ressalvas: [
          'Somente produtos ativos.',
          `Varredura limitada aos primeiros ${TETO_VARREDURA} produtos zerados.`,
        ],
      }
    },
  },

  {
    nome: 'produtos_abaixo_do_minimo',
    descricao: 'Produtos cujo saldo está abaixo do estoque mínimo cadastrado.',
    parametros: { type: 'object', properties: {} },
    async executar(sb, empresaId) {
      // ANTES DE RESPONDER, PERGUNTA SE A REGRA EXISTE.
      //
      // Medido em 02/09/2026: ZERO das 28.752 linhas tem `estoque_minimo`
      // maior que zero. Sem esta checagem a consulta responderia "nenhum
      // produto abaixo do mínimo" — que o gestor leria como "estoque
      // saudável" quando o certo é "a regra nunca foi cadastrada".
      const { count: comMinimo } = await sb.from('produto_estoque')
        .select('id', { count: 'exact', head: true })
        .eq('empresa_id', empresaId).gt('estoque_minimo', 0)

      if (!comMinimo) {
        return {
          linhas: [], periodo: 'saldo atual',
          ressalvas: [
            'NENHUM produto tem estoque mínimo cadastrado neste sistema. A lista vazia significa que a regra não existe — NÃO que o estoque está saudável. Para usar este alerta é preciso cadastrar o mínimo nos produtos.',
          ],
        }
      }

      const { data } = await sb.from('produto_estoque')
        .select('produto_id, quantidade, estoque_minimo, depositos(nome), produtos(nome, sku)')
        .eq('empresa_id', empresaId).gt('estoque_minimo', 0)
        .order('quantidade').limit(TETO_VARREDURA)

      const abaixo = (data ?? []).filter((l: { quantidade?: number; estoque_minimo?: number }) =>
        Number(l.quantidade ?? 0) < Number(l.estoque_minimo ?? 0))

      return {
        linhas: abaixo.slice(0, MAX_LINHAS).map((l: Record<string, unknown>) => {
          const p = l.produtos as { nome?: string; sku?: string } | null
          const d = l.depositos as { nome?: string } | null
          return {
            sku: p?.sku ?? '', produto: p?.nome ?? '', deposito: d?.nome ?? '',
            quantidade: Number(l.quantidade ?? 0), minimo: Number(l.estoque_minimo ?? 0),
          }
        }),
        periodo: 'saldo atual',
        truncado: abaixo.length > MAX_LINHAS,
        ressalvas: [`${comMinimo} linha(s) têm mínimo cadastrado — o alerta só enxerga essas.`],
      }
    },
  },

  {
    nome: 'capital_parado',
    descricao: 'Produtos com estoque que NÃO venderam num período — dinheiro parado na prateleira. Ordenado pelo valor de custo em estoque.',
    parametros: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Data inicial no formato AAAA-MM-DD. Produtos sem nenhuma venda a partir dela.' },
      },
      required: ['desde'],
    },
    async executar(sb, empresaId, args) {
      const desde = dataISO(args.desde)
      if (!desde) return erro('Informe `desde` no formato AAAA-MM-DD.')
      const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

      // Varre os que têm MAIS capital parado, não o catálogo inteiro: são 28
      // mil produtos, e a pergunta interessante é onde está o dinheiro.
      const { data } = await sb.from('produtos')
        .select('id, nome, sku, estoque, preco_custo')
        .eq('empresa_id', empresaId).eq('ativo', true).gt('estoque', 0)
        .order('preco_custo', { ascending: false }).limit(TETO_VARREDURA)
      const comEstoque = (data ?? []) as { nome: string; sku: string; estoque: number; preco_custo: number }[]

      const { inicio, fim } = intervaloUTC(desde, hoje)
      const { data: vendas } = await sb.from('vendas')
        .select('id, status').eq('empresa_id', empresaId)
        .gte('created_at', inicio).lte('created_at', fim)
      const idsVendas = (vendas ?? [])
        .filter((v: { status?: string }) => !STATUS_NAO_VALE.includes(String(v.status ?? '')))
        .map((v: { id: string }) => String(v.id))

      const vendidos = new Set<string>()
      if (idsVendas.length > 0) {
        const { data: itens } = await sb.from('venda_itens')
          .select('produto_sku').in('venda_id', idsVendas).limit(5000)
        for (const i of (itens ?? []) as { produto_sku?: string }[]) {
          if (i.produto_sku) vendidos.add(String(i.produto_sku))
        }
      }

      const parados = comEstoque
        .filter(p => !vendidos.has(String(p.sku)))
        .map(p => ({
          sku: p.sku, produto: p.nome,
          estoque: Number(p.estoque ?? 0),
          custo_unitario: Number(p.preco_custo ?? 0),
          capital_parado: Number((Number(p.estoque ?? 0) * Number(p.preco_custo ?? 0)).toFixed(2)),
        }))
        .sort((a, b) => b.capital_parado - a.capital_parado)

      return {
        linhas: parados.slice(0, MAX_LINHAS),
        periodo: `sem vendas ${rotuloPeriodo(desde, hoje)}`,
        truncado: comEstoque.length >= TETO_VARREDURA,
        ressalvas: [
          `Varredura limitada aos ${TETO_VARREDURA} produtos de maior custo unitário — não é o catálogo inteiro.`,
          'Produto sem custo cadastrado aparece com capital parado zero, o que subestima o problema.',
        ],
      }
    },
  },

  {
    nome: 'movimentacoes_de_um_produto',
    descricao: 'Histórico de entradas e saídas de um produto: o que mexeu no saldo, quando e por quê.',
    parametros: {
      type: 'object',
      properties: {
        termo: { type: 'string', description: 'SKU exato ou parte do nome do produto.' },
        de: { type: 'string', description: 'Opcional, AAAA-MM-DD.' },
        ate: { type: 'string', description: 'Opcional, AAAA-MM-DD.' },
      },
      required: ['termo'],
    },
    async executar(sb, empresaId, args) {
      const termo = String(args.termo ?? '').trim()
      if (!termo) return erro('Informe o SKU ou parte do nome do produto.')

      let qp = sb.from('produtos').select('id, nome, sku').eq('empresa_id', empresaId)
      qp = /^\d+$/.test(termo) ? qp.eq('sku', termo) : qp.ilike('nome', `%${termo}%`)
      const { data: produtos } = await qp.limit(5)
      const lista = (produtos ?? []) as { id: string; nome: string; sku: string }[]
      if (lista.length === 0) return erro(`Nenhum produto encontrado com "${termo}".`)

      let q = sb.from('estoque_movimentacoes')
        .select('produto_nome, tipo, quantidade, estoque_anterior, estoque_novo, motivo, usuario, created_at')
        .eq('empresa_id', empresaId).in('produto_id', lista.map(p => p.id))
        .order('created_at', { ascending: false })

      const de = args.de ? dataISO(args.de) : null
      const ate = args.ate ? dataISO(args.ate) : null
      if (de && ate) {
        const { inicio, fim } = intervaloUTC(de, ate)
        q = q.gte('created_at', inicio).lte('created_at', fim)
      }

      const { data: movs } = await q.limit(MAX_LINHAS)
      return {
        linhas: (movs ?? []) as Record<string, unknown>[],
        periodo: de && ate ? rotuloPeriodo(de, ate) : 'todo o histórico registrado',
        ressalvas: [
          // O sistema tem estoque alterado por fora do fluxo — ver o caso do
          // SKU 2906. Uma lista vazia aqui nao prova que o saldo nao mudou.
          'Movimentação gravada por fora deste registro (importação direta no banco, por exemplo) não aparece aqui. Lista vazia não prova que o saldo não mudou.',
        ],
      }
    },
  },
]
