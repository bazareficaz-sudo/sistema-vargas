import { calcular, CONFIG_PADRAO, type ConfigReposicao, type EntradaProduto } from './motor'
import { atualizarRupturas } from './rupturas'

// Recalcula as métricas de reposição de uma empresa.
//
// Roda fora da hora do usuário (cron) e grava o resultado em
// `reposicao_metricas`. A tela só lê. Sem isso, cada abertura do Auxiliar
// leria os 14.281 produtos ativos e refaria seis janelas de venda, ABC,
// cobertura e cruzamento com faltas e pedidos — que é exatamente o que
// deixa a tela de Estoque & Giro lenta hoje.
//
// SÓ GRAVA O QUE TEM ALGO A DIZER. Produto sem venda, sem falta, sem
// estoque e sem mínimo não vira linha: seriam 13 mil registros repetindo
// "não sei nada sobre isto". O total desses fica no resultado da rodada,
// para a tela poder dizer quantos ficaram de fora e por quê.

const DIA = 86_400_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Lê uma tabela inteira em páginas — o PostgREST corta em 1.000 linhas. */
async function paginar<T = Record<string, unknown>>(
  sb: any, tabela: string, select: string,
  filtros: (q: any) => any, pagina = 1000,
): Promise<T[]> {
  const tudo: T[] = []
  for (let inicio = 0; ; inicio += pagina) {
    const { data, error } = await filtros(sb.from(tabela).select(select))
      .range(inicio, inicio + pagina - 1)
    if (error) throw new Error(`${tabela}: ${error.message}`)
    if (!data?.length) break
    tudo.push(...data)
    if (data.length < pagina) break
  }
  return tudo
}

type Janelas = { d7: number; d15: number; d30: number; d60: number; d90: number; d180: number }
const janelasVazias = (): Janelas => ({ d7: 0, d15: 0, d30: 0, d60: 0, d90: 0, d180: 0 })

function somar(j: Janelas, dias: number, qtd: number) {
  if (dias <= 7) j.d7 += qtd
  if (dias <= 15) j.d15 += qtd
  if (dias <= 30) j.d30 += qtd
  if (dias <= 60) j.d60 += qtd
  if (dias <= 90) j.d90 += qtd
  if (dias <= 180) j.d180 += qtd
}

export type ResumoRodada = {
  empresaId: string
  produtos: number
  gravados: number
  semSinal: number
  itensDemanda: number
  diasHistorico: number
  rupturasAbertas: number
  rupturasFechadas: number
  duracaoMs: number
}

export async function recalcularEmpresa(sb: any, empresaId: string): Promise<ResumoRodada> {
  const t0 = Date.now()
  const inicioRodada = new Date().toISOString()

  // ── Regras ────────────────────────────────────────────────────
  const { data: cfgRow } = await sb.from('reposicao_config')
    .select('*').eq('empresa_id', empresaId).maybeSingle()
  const cfg: ConfigReposicao = { ...CONFIG_PADRAO, ...(cfgRow ?? {}) }

  // ── Catálogo ──────────────────────────────────────────────────
  const produtos = await paginar<any>(sb, 'produtos',
    'id, nome, sku, categoria, marca, estoque, estoque_minimo, preco_custo, preco_venda, fornecedor_padrao_id',
    q => q.eq('empresa_id', empresaId).eq('ativo', true))

  const porSku = new Map<string, string>()
  for (const p of produtos) if (p.sku) porSku.set(String(p.sku).trim(), p.id)

  // ── Lead time por produto ────────────────────────────────────
  //
  // Preferência: prazo REAL medido em fornecedor_produto (diferença entre
  // pedido e entrada) > prazo cadastrado nesse par > prazo cadastrado no
  // fornecedor > padrão da empresa. Cada nível só existe quando o de cima
  // falta — não há "média" entre eles, porque misturar um número medido
  // com um chutado produz um terceiro número que não é nem uma coisa nem
  // outra.
  const leadTimePorProduto: Record<string, number> = {}
  {
    const comFornecedor = produtos.filter((p: any) => p.fornecedor_padrao_id)
    if (comFornecedor.length > 0) {
      const fornecedorIds = [...new Set(comFornecedor.map((p: any) => p.fornecedor_padrao_id))]
      const prazoFornecedor = new Map<string, number>()
      for (let i = 0; i < fornecedorIds.length; i += 200) {
        const { data } = await sb.from('fornecedores')
          .select('id, prazo_entrega_dias').in('id', fornecedorIds.slice(i, i + 200))
        for (const f of data ?? []) if (f.prazo_entrega_dias > 0) prazoFornecedor.set(f.id, f.prazo_entrega_dias)
      }

      const produtoIds = comFornecedor.map((p: any) => p.id)
      const prazoPar = new Map<string, number>()
      for (let i = 0; i < produtoIds.length; i += 200) {
        const { data } = await sb.from('fornecedor_produto')
          .select('produto_id, prazo_entrega_real_dias, prazo_entrega_dias')
          .eq('empresa_id', empresaId).in('produto_id', produtoIds.slice(i, i + 200))
        for (const fp of data ?? []) {
          const v = fp.prazo_entrega_real_dias ?? fp.prazo_entrega_dias
          if (v > 0) prazoPar.set(fp.produto_id, v)
        }
      }

      for (const p of comFornecedor) {
        const v = prazoPar.get(p.id) ?? prazoFornecedor.get(p.fornecedor_padrao_id)
        if (v) leadTimePorProduto[p.id] = v
      }
    }
  }

  // ── Demanda ───────────────────────────────────────────────────
  const desde = new Date(Date.now() - 180 * DIA).toISOString()
  const vendasJanela: Record<string, Janelas> = {}
  const ultimaVenda: Record<string, string> = {}
  let itensDemanda = 0

  const idadeEmDias = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / DIA)

  // Um item de venda pode chegar com o id antigo do Base44 (24 caracteres
  // hex, do período 28–31/07). Nesses casos o SKU é a única ponte com o
  // cadastro — sem ela, 471 linhas de venda ficariam órfãs e os produtos
  // correspondentes pareceriam nunca ter vendido.
  function registrar(produtoId: string | null, sku: string | null, qtd: number, quando: string) {
    let id = produtoId && UUID.test(produtoId) ? produtoId : null
    if (!id && sku) id = porSku.get(String(sku).trim()) ?? null
    if (!id || !(qtd > 0)) return
    const j = (vendasJanela[id] ??= janelasVazias())
    somar(j, idadeEmDias(quando), qtd)
    if (!ultimaVenda[id] || quando > ultimaVenda[id]) ultimaVenda[id] = quando
    itensDemanda++
  }

  const vendas = await paginar<any>(sb, 'vendas', 'id, created_at, itens',
    q => q.eq('empresa_id', empresaId).eq('status', 'concluida').gte('created_at', desde))

  const dataDaVenda = new Map<string, string>(vendas.map((v: any) => [v.id, v.created_at]))
  const primeiraVenda = vendas.reduce(
    (min: string | null, v: any) => (!min || v.created_at < min ? v.created_at : min), null as string | null)

  // Os itens moram em DOIS lugares e nenhum é completo sozinho:
  // `venda_itens` só existe a partir de 08/07; `vendas.itens` (jsonb) vem
  // desde o começo. Ler só a tabela perde os dois primeiros meses; ler só
  // o jsonb perde o que foi gravado depois. A tabela manda quando existe,
  // o jsonb cobre o resto.
  const itens = await paginar<any>(sb, 'venda_itens',
    'venda_id, produto_id, produto_sku, quantidade, created_at',
    q => q.gte('created_at', desde))

  const vendasComTabela = new Set<string>()
  for (const it of itens) {
    if (!dataDaVenda.has(it.venda_id)) continue   // venda de outra empresa
    vendasComTabela.add(it.venda_id)
    registrar(it.produto_id, it.produto_sku, Number(it.quantidade ?? 0), it.created_at ?? dataDaVenda.get(it.venda_id)!)
  }
  for (const v of vendas) {
    if (vendasComTabela.has(v.id)) continue
    for (const it of Array.isArray(v.itens) ? v.itens : []) {
      registrar(it.produto_id ?? null, it.produto_sku ?? null, Number(it.quantidade ?? 0), v.created_at)
    }
  }

  // Marketplace é metade da saída de mercadoria da empresa. Ignorá-lo faz
  // o motor subestimar pela metade a demanda de tudo que está anunciado.
  if (cfg.considerar_marketplace) {
    const pedidos = await paginar<any>(sb, 'marketplace_pedidos', 'id, created_at, status',
      q => q.eq('empresa_id', empresaId).gte('created_at', desde))
    const dataDoPedido = new Map<string, string>(
      pedidos.filter((p: any) => p.status !== 'cancelado').map((p: any) => [p.id, p.created_at]))

    if (dataDoPedido.size > 0) {
      const itensMp = await paginar<any>(sb, 'marketplace_pedido_itens',
        'pedido_id, produto_id, sku, quantidade', q => q)
      for (const it of itensMp) {
        const quando = dataDoPedido.get(it.pedido_id)
        if (!quando) continue
        registrar(it.produto_id ?? null, it.sku ?? null, Number(it.quantidade ?? 0), quando)
      }
    }
  }

  const diasHistorico = primeiraVenda
    ? Math.max(1, Math.floor((Date.now() - new Date(primeiraVenda).getTime()) / DIA))
    : 1

  // Quanto a loja inteira acelerou — a régua contra a qual a tendência de
  // cada produto é medida. Ver o comentário de `fatorLoja` no motor: sem
  // isso a tendência mede o crescimento do uso do PDV, não o do produto.
  const totalLoja = Object.values(vendasJanela).reduce(
    (acc, j) => { acc.d15 += j.d15; acc.d90 += j.d90; return acc },
    { d15: 0, d90: 0 })
  const lojaRecente = totalLoja.d15 / Math.max(1, Math.min(15, diasHistorico))
  const lojaLonga = totalLoja.d90 / Math.max(1, Math.min(90, diasHistorico))
  const fatorLoja = lojaLonga > 0 ? lojaRecente / lojaLonga : 1

  // ── Já pedido ao fornecedor ───────────────────────────────────
  const pedidoAberto: Record<string, number> = {}
  if (cfg.considerar_pedidos_abertos) {
    const pedidos = await paginar<any>(sb, 'pedidos_compra', 'id, status',
      q => q.eq('empresa_id', empresaId).not('status', 'in', '("cancelado","recebido")'))
    const ids = pedidos.map((p: any) => p.id)
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await sb.from('pedidos_compra_itens')
        .select('produto_id, quantidade').in('pedido_id', ids.slice(i, i + 100))
      for (const it of data ?? []) {
        if (!it.produto_id) continue
        pedidoAberto[it.produto_id] = (pedidoAberto[it.produto_id] ?? 0) + Number(it.quantidade ?? 0)
      }
    }
  }

  // ── Sinais do balcão ──────────────────────────────────────────
  const faltas: Record<string, { faltas: number; encomendas: number; unidades: number }> = {}
  if (cfg.considerar_faltas || cfg.considerar_encomendas) {
    const abertas = await paginar<any>(sb, 'faltas',
      'produto_id, produto_sku, tipo, quantidade_solicitada, status',
      q => q.eq('empresa_id', empresaId)
        .in('status', ['pendente', 'em_analise', 'em_compra', 'pedido', 'notificado', 'comprado']))
    for (const f of abertas) {
      let id = f.produto_id && UUID.test(f.produto_id) ? f.produto_id : null
      if (!id && f.produto_sku) id = porSku.get(String(f.produto_sku).trim()) ?? null
      if (!id) continue
      const alvo = (faltas[id] ??= { faltas: 0, encomendas: 0, unidades: 0 })
      if (f.tipo === 'encomenda') alvo.encomendas++; else alvo.faltas++
      alvo.unidades += Number(f.quantidade_solicitada ?? 1)
    }
  }

  // ── Estoque em outros depósitos ───────────────────────────────
  const outrosDepositos: Record<string, number> = {}
  if (cfg.considerar_outros_depositos) {
    const { data: principal } = await sb.from('depositos')
      .select('id').eq('empresa_id', empresaId).eq('principal', true).maybeSingle()
    const saldos = await paginar<any>(sb, 'produto_estoque', 'produto_id, deposito_id, quantidade',
      q => q.eq('empresa_id', empresaId).gt('quantidade', 0))
    for (const s of saldos) {
      if (principal && s.deposito_id === principal.id) continue
      outrosDepositos[s.produto_id] = (outrosDepositos[s.produto_id] ?? 0) + Number(s.quantidade ?? 0)
    }
  }

  // ── Curva ABC ─────────────────────────────────────────────────
  //
  // Por faturamento dos últimos 90 dias. Só entra quem vendeu — produto
  // sem venda não é "classe C", é produto sem classificação.
  //
  // Duas condições, não uma. A regra clássica do acumulado (80% do
  // faturamento = classe A) pressupõe concentração; com seis semanas de
  // história e venda espalhada por mil itens, ela devolveu quase todo o
  // catálogo como A no ensaio — e uma classe que contém todo mundo não
  // classifica ninguém. Exigir também estar entre os 20% de maior
  // faturamento devolve à letra o sentido que ela deveria ter.
  const faturamento = produtos
    .map((p: any) => ({ id: p.id, valor: (vendasJanela[p.id]?.d90 ?? 0) * Number(p.preco_venda ?? 0) }))
    .filter(x => x.valor > 0)
    .sort((a, b) => b.valor - a.valor)
  const total = faturamento.reduce((s, x) => s + x.valor, 0)
  const classe: Record<string, 'A' | 'B' | 'C'> = {}
  let acumulado = 0
  faturamento.forEach((x, i) => {
    acumulado += x.valor
    const pctValor = total > 0 ? acumulado / total : 1
    const pctPosicao = (i + 1) / faturamento.length
    classe[x.id] =
      pctValor <= 0.8 && pctPosicao <= 0.2 ? 'A'
      : pctValor <= 0.95 && pctPosicao <= 0.5 ? 'B'
      : 'C'
  })

  // Mesma regra, por MARGEM em vez de faturamento — produto de giro alto e
  // margem baixa (cimento, por exemplo) pode ser classe A num critério e
  // pouco relevante no outro. As duas classificações convivem; nenhuma
  // substitui a outra.
  const margemTotal = produtos
    .map((p: any) => ({
      id: p.id,
      valor: (vendasJanela[p.id]?.d90 ?? 0) * (Number(p.preco_venda ?? 0) - Number(p.preco_custo ?? 0)),
    }))
    .filter(x => x.valor > 0)
    .sort((a, b) => b.valor - a.valor)
  const totalMargem = margemTotal.reduce((s, x) => s + x.valor, 0)
  const classeMargem: Record<string, 'A' | 'B' | 'C'> = {}
  let acumuladoMargem = 0
  margemTotal.forEach((x, i) => {
    acumuladoMargem += x.valor
    const pctValor = totalMargem > 0 ? acumuladoMargem / totalMargem : 1
    const pctPosicao = (i + 1) / margemTotal.length
    classeMargem[x.id] =
      pctValor <= 0.8 && pctPosicao <= 0.2 ? 'A'
      : pctValor <= 0.95 && pctPosicao <= 0.5 ? 'B'
      : 'C'
  })

  // ── Ruptura ───────────────────────────────────────────────────
  // Compara o retrato de ontem (última rodada) com o de hoje — nenhum
  // outro ponto do sistema precisa avisar isto, só esta rodada, que já lê
  // o catálogo inteiro de qualquer forma.
  const resumoRupturas = await atualizarRupturas(sb, empresaId, produtos)

  // ── Cálculo ───────────────────────────────────────────────────
  const linhas: Record<string, unknown>[] = []
  let semSinal = 0

  for (const p of produtos) {
    const j = vendasJanela[p.id] ?? janelasVazias()
    const f = faltas[p.id] ?? { faltas: 0, encomendas: 0, unidades: 0 }
    const estoque = Number(p.estoque ?? 0)
    const minimo = Number(p.estoque_minimo ?? 0)

    const temAlgoADizer = j.d180 > 0 || f.faltas > 0 || f.encomendas > 0 || estoque !== 0 || minimo > 0
    if (!temAlgoADizer) { semSinal++; continue }

    const entrada: EntradaProduto = {
      estoque,
      estoqueMinimo: minimo,
      custo: Number(p.preco_custo ?? 0),
      preco: Number(p.preco_venda ?? 0),
      vendas: j,
      ultimaVenda: ultimaVenda[p.id] ?? null,
      faltasAbertas: f.faltas,
      encomendasAbertas: f.encomendas,
      unidadesSolicitadas: f.unidades,
      pedidoAbertoQtd: pedidoAberto[p.id] ?? 0,
      estoqueOutrosDepositos: outrosDepositos[p.id] ?? 0,
      leadTimeDias: leadTimePorProduto[p.id] ?? cfg.lead_time_padrao_dias,
      classeAbc: classe[p.id] ?? null,
      diasHistorico,
      fatorLoja,
    }

    const r = calcular(entrada, cfg)
    if (r.prioridade === 'sem_dados' && estoque === 0) { semSinal++; continue }

    linhas.push({
      empresa_id: empresaId, produto_id: p.id,
      vendas_7: j.d7, vendas_15: j.d15, vendas_30: j.d30,
      vendas_60: j.d60, vendas_90: j.d90, vendas_180: j.d180,
      media_diaria: r.mediaDiaria, media_diaria_recente: r.mediaDiariaRecente,
      tendencia: r.tendencia, dias_sem_venda: r.diasSemVenda,
      ultima_venda: ultimaVenda[p.id] ?? null,
      estoque_atual: estoque, estoque_minimo: minimo,
      estoque_outros_depositos: entrada.estoqueOutrosDepositos,
      pedido_aberto_qtd: entrada.pedidoAbertoQtd,
      faltas_abertas: f.faltas, encomendas_abertas: f.encomendas,
      unidades_solicitadas: f.unidades,
      cobertura_dias: r.coberturaDias, previsao_ruptura: r.previsaoRuptura,
      lead_time_dias: entrada.leadTimeDias,
      estoque_seguranca: r.estoqueSeguranca, ponto_reposicao: r.pontoReposicao,
      sugestao_quantidade: r.sugestaoQuantidade, custo_estimado: r.custoEstimado,
      score: r.score, prioridade: r.prioridade,
      classe_abc: classe[p.id] ?? null, classe_abc_margem: classeMargem[p.id] ?? null, giro: r.giro,
      motivos: r.motivos,
      calculado_em: inicioRodada,
    })
  }

  // ── Gravação ──────────────────────────────────────────────────
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await sb.from('reposicao_metricas')
      .upsert(linhas.slice(i, i + 500), { onConflict: 'empresa_id,produto_id' })
    if (error) throw new Error(`gravar métricas: ${error.message}`)
  }

  // Produto que tinha linha e agora não tem mais nada a dizer (foi
  // desativado, ou o sinal sumiu) sairia da conta mas continuaria na tela
  // com o número da rodada passada.
  await sb.from('reposicao_metricas')
    .delete().eq('empresa_id', empresaId).lt('calculado_em', inicioRodada)

  return {
    empresaId,
    produtos: produtos.length,
    gravados: linhas.length,
    semSinal,
    itensDemanda,
    diasHistorico,
    rupturasAbertas: resumoRupturas.abertas,
    rupturasFechadas: resumoRupturas.fechadas,
    duracaoMs: Date.now() - t0,
  }
}
