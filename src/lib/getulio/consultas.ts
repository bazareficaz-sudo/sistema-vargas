import {
  dataISO, intervaloUTC, rotuloPeriodo, MAX_LINHAS,
  type Consulta, type ResultadoConsulta,
} from '@/lib/ia/consultas/tipos'
import { buscarProdutoInteligente, type ProdutoAchado } from '@/lib/busca/produtoInteligente'

// CONSULTAS DO GETÚLIO — o que ele pode perguntar ao banco quando o dono
// conversa pelo WhatsApp.
//
// Mesmas regras do catálogo de lib/ia/consultas: catálogo fechado,
// `empresa_id` fixado pelo servidor, toda resposta diz o que cobre. A
// diferença é o alcance: as consultas de vendas de lá olham só o balcão
// (tabela `vendas`); as daqui somam os marketplaces — "quanto vendi ontem?"
// sem os marketplaces seria metade da resposta. Rodam com a chave de serviço
// (as funções getulio_* não abrem para usuário comum).

const erro = (mensagem: string): ResultadoConsulta => ({ linhas: [], periodo: '—', ressalvas: [mensagem] })

const paramsPeriodo = {
  de: { type: 'string', description: 'Data inicial no formato AAAA-MM-DD.' },
  ate: { type: 'string', description: 'Data final no formato AAAA-MM-DD (inclusive).' },
}

function periodo(args: Record<string, unknown>) {
  const de = dataISO(args.de)
  const ate = dataISO(args.ate)
  if (!de || !ate) return null
  if (de > ate) return null
  return { de, ate, ...intervaloUTC(de, ate) }
}
const ERRO_PERIODO = 'Informe `de` e `ate` no formato AAAA-MM-DD (converta "ontem", "semana passada" antes), com `de` ≤ `ate`.'

const r2 = (v: unknown) => Number(Number(v ?? 0).toFixed(2))

const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
/** "09/10 (sexta)" — o dia da semana vai calculado: o modelo errou ao deduzir (chamou domingo de sábado). */
const dataComSemana = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00-03:00`)
  return Number.isNaN(d.getTime()) ? iso : `${iso.slice(8, 10)}/${iso.slice(5, 7)} (${SEMANA[d.getUTCDay()]})`
}
const hoje = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)

/** "shopee", "ML", "mercado livre", "Shp Ouro" → plataforma ou nome de canal. */
export function normalizarCanal(texto: string): { plataforma?: string; nome?: string } {
  const t = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  if (!t) return {}
  if (/^(shopee|shp)$/.test(t)) return { plataforma: 'shopee' }
  if (/^(ml|mercado ?livre|meli)$/.test(t)) return { plataforma: 'mercadolivre' }
  if (/^(tiktok|tik tok|tiktok shop|tt)$/.test(t)) return { plataforma: 'tiktok' }
  if (/^(nuvemshop|nuvem|loja virtual)$/.test(t)) return { plataforma: 'nuvemshop' }
  return { nome: texto.trim().replace(/[,()%]/g, ' ') }
}

/**
 * Os produtos de que o dono está falando, pela busca de balcão: os que
 * batem com todos os termos; sem nenhum, os parecidos (faltou um termo).
 */
async function produtosDoTermo(sb: any, empresaId: string, termo: string, max = 10): Promise<{ produtos: ProdutoAchado[]; aproximado: boolean }> {
  const r = await buscarProdutoInteligente(sb, empresaId, termo, 30)
  if (r.exatos.length) return { produtos: r.exatos.slice(0, max), aproximado: false }
  return { produtos: r.parecidos.slice(0, max), aproximado: r.parecidos.length > 0 }
}

export const CONSULTAS_GETULIO: Consulta[] = [
  {
    nome: 'buscar_produto',
    descricao: 'Acha produtos pelo jeito que o dono fala, como no balcão: palavras em qualquer ordem, sem acento, plural, abreviações e equivalentes (mono = monopolar = unipolar = 1P; "32 amperes" = 32A). Devolve nome, SKU, marca, estoque atual e preço. Use SEMPRE primeiro em perguntas sobre produto.',
    parametros: {
      type: 'object',
      properties: { termo: { type: 'string', description: 'As palavras do dono sobre o produto, do jeito que ele falou (ex.: "disjuntor 32a mono guepar").' } },
      required: ['termo'],
    },
    async executar(sb, empresaId, args) {
      const termo = String(args.termo ?? '').trim()
      if (termo.length < 2) return erro('Informe o que procurar.')
      const r = await buscarProdutoInteligente(sb, empresaId, termo, 30)
      const linha = (p: ProdutoAchado, tipo: string) => ({
        tipo, produto: p.nome, sku: p.sku, marca: p.marca, estoque: p.estoque,
        preco: p.preco_venda != null ? r2(p.preco_venda) : null, ...(p.ativo ? {} : { inativo: true }),
      })
      const linhas = [
        ...r.exatos.slice(0, 15).map(p => linha(p, 'bate com tudo')),
        ...(r.exatos.length < 5 ? r.parecidos.slice(0, 8).map(p => linha(p, 'parecido (faltou um termo)')) : []),
      ]
      return {
        linhas, periodo: 'saldo atual',
        truncado: r.exatos.length > 15,
        ressalvas: [
          `Termos procurados: ${r.grupos.map(g => g[0]).join(' + ') || '—'}.`,
          ...(r.exatos.length === 0 && r.parecidos.length ? ['Nenhum produto bate com TODOS os termos — os listados são os mais parecidos; apresente como opções.'] : []),
          ...(linhas.length === 0 ? ['Nada encontrado. Isso é diferente de o produto existir e estar zerado — sugira outras palavras.'] : []),
          'Estoque negativo significa venda sem entrada lançada; trate como zero disponível.',
        ],
      }
    },
  },
  {
    nome: 'vendas_por_canal',
    descricao: 'Faturamento e número de vendas/pedidos por canal (balcão/PDV e cada marketplace) num período, com o total geral. Use para "quanto vendi", "como foi a semana", comparações entre canais.',
    parametros: { type: 'object', properties: paramsPeriodo, required: ['de', 'ate'] },
    async executar(sb, empresaId, args) {
      const p = periodo(args)
      if (!p) return erro(ERRO_PERIODO)
      const { data, error } = await sb.rpc('getulio_vendas_periodo', { p_empresa: empresaId, p_inicio: p.inicio, p_fim: p.fim })
      if (error) return erro(error.message)
      const linhas = ((data ?? []) as any[]).map(l => ({ canal: l.canal, faturamento: r2(l.faturamento), vendas_ou_pedidos: Number(l.pedidos) }))
      const total = linhas.reduce((s, l) => s + l.faturamento, 0)
      return {
        linhas: [...linhas.filter(l => l.vendas_ou_pedidos > 0), { canal: 'TOTAL', faturamento: r2(total), vendas_ou_pedidos: linhas.reduce((s, l) => s + l.vendas_ou_pedidos, 0) }],
        periodo: rotuloPeriodo(p.de, p.ate),
        ressalvas: ['Cancelados não entram.', 'Marketplace pelo valor total do pedido (com frete), na data do pedido.'],
      }
    },
  },
  {
    nome: 'vendas_de_um_produto_todos_canais',
    descricao: 'Quanto um produto vendeu num período, separado por canal (balcão e marketplaces). Busca por SKU exato ou parte do nome.',
    parametros: {
      type: 'object',
      properties: { termo: { type: 'string', description: 'SKU exato ou parte do nome.' }, ...paramsPeriodo },
      required: ['termo', 'de', 'ate'],
    },
    async executar(sb, empresaId, args) {
      const p = periodo(args)
      if (!p) return erro(ERRO_PERIODO)
      const termo = String(args.termo ?? '').trim()
      if (termo.length < 2) return erro('Informe o SKU ou parte do nome do produto.')
      const { produtos, aproximado } = await produtosDoTermo(sb, empresaId, termo, 8)
      if (produtos.length === 0) return erro(`Nenhum produto encontrado com "${termo}". Tente outras palavras.`)
      const linhas: Record<string, unknown>[] = []
      for (const prod of produtos) {
        if (!prod.sku) continue
        const { data, error } = await sb.rpc('getulio_vendas_produto', { p_empresa: empresaId, p_termo: prod.sku, p_inicio: p.inicio, p_fim: p.fim })
        if (error) return erro(error.message)
        for (const l of (data ?? []) as any[]) {
          if (l.sku !== prod.sku) continue
          linhas.push({ produto: l.produto, sku: l.sku, canal: l.canal, quantidade: Number(l.quantidade), faturamento: r2(l.faturamento) })
        }
      }
      return {
        linhas: linhas.slice(0, MAX_LINHAS), periodo: rotuloPeriodo(p.de, p.ate), truncado: linhas.length > MAX_LINHAS,
        ressalvas: [
          `Produtos considerados: ${produtos.map(x => `${x.nome} (SKU ${x.sku})`).join('; ')}.`,
          ...(aproximado ? ['Nenhum produto bateu com todos os termos — estes são os mais parecidos.'] : []),
          linhas.length === 0 ? 'Esses produtos não tiveram venda no período.' : 'Cancelados não entram.',
        ],
      }
    },
  },
  {
    nome: 'pedidos_marketplace',
    descricao: 'Pedidos de marketplace por situação: "atrasados" (prazo de postagem vencido e não enviados), "para_hoje" (prazo vence até o fim de hoje), "aguardando_envio" (todos confirmados ainda não enviados).',
    parametros: {
      type: 'object',
      properties: { situacao: { type: 'string', description: '"atrasados", "para_hoje" ou "aguardando_envio".' } },
      required: ['situacao'],
    },
    async executar(sb, empresaId, args) {
      const situacao = String(args.situacao ?? '')
      const agora = new Date()
      let q = sb.from('marketplace_pedidos')
        .select('numero_pedido, numero_interno, cliente_nome, valor_total, prazo_postagem, status, marketplace_canais(nome)')
        .eq('empresa_id', empresaId).in('status', ['novo', 'confirmado'])
      if (situacao === 'atrasados') q = q.lt('prazo_postagem', agora.toISOString()).gt('prazo_postagem', new Date(agora.getTime() - 15 * 86_400_000).toISOString())
      else if (situacao === 'para_hoje') q = q.gte('prazo_postagem', agora.toISOString()).lte('prazo_postagem', new Date(`${hoje()}T23:59:59-03:00`).toISOString())
      else if (situacao !== 'aguardando_envio') return erro('Situação inválida: use "atrasados", "para_hoje" ou "aguardando_envio".')
      const { data } = await q.order('prazo_postagem', { ascending: true }).limit(MAX_LINHAS + 1)
      const linhas = ((data ?? []) as any[]).map(p => ({
        canal: p.marketplace_canais?.nome ?? '', pedido: p.numero_interno ? `PV-${String(p.numero_interno).padStart(6, '0')}` : p.numero_pedido,
        cliente: p.cliente_nome, valor: r2(p.valor_total),
        prazo_postagem: p.prazo_postagem ? new Date(p.prazo_postagem).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null,
      }))
      return { linhas: linhas.slice(0, MAX_LINHAS), periodo: `situação atual (${situacao})`, truncado: linhas.length > MAX_LINHAS }
    },
  },
  {
    nome: 'contas_a_pagar',
    descricao: 'Contas a pagar em aberto com vencimento no período, e as já vencidas (se incluir_vencidas). Use para "quanto tenho pra pagar essa semana", "contas vencidas".',
    parametros: {
      type: 'object',
      properties: { ...paramsPeriodo, incluir_vencidas: { type: 'boolean', description: 'true para incluir as vencidas antes de `de`.' } },
      required: ['de', 'ate'],
    },
    async executar(sb, empresaId, args) {
      const de = dataISO(args.de), ate = dataISO(args.ate)
      if (!de || !ate || de > ate) return erro(ERRO_PERIODO)
      const { data } = await sb.from('contas_pagar')
        .select('descricao, valor, vencimento, data_vencimento, status')
        .eq('empresa_id', empresaId).in('status', ['pendente', 'vencido']).limit(1000)
      const lista = ((data ?? []) as any[]).map(c => ({ ...c, venc: String(c.data_vencimento ?? c.vencimento ?? '') }))
      const noPeriodo = lista.filter(c => c.venc >= de && c.venc <= ate)
      const vencidas = args.incluir_vencidas ? lista.filter(c => c.venc && c.venc < de) : []
      const linha = (c: any, tipo: string) => ({ tipo, descricao: c.descricao, valor: r2(c.valor), vencimento: dataComSemana(c.venc), _ord: c.venc })
      const linhas = [...vencidas.map(c => linha(c, 'vencida')), ...noPeriodo.map(c => linha(c, c.venc < hoje() ? 'vencida' : 'a vencer'))]
        .sort((a, b) => a._ord.localeCompare(b._ord))
        .map(({ _ord, ...resto }) => resto)
      return {
        linhas: [
          ...linhas.slice(0, MAX_LINHAS),
          { tipo: 'TOTAL a vencer no período', valor: r2(noPeriodo.reduce((s, c) => s + Number(c.valor ?? 0), 0)) },
          ...(args.incluir_vencidas ? [{ tipo: 'TOTAL vencidas', valor: r2(vencidas.reduce((s, c) => s + Number(c.valor ?? 0), 0)) }] : []),
        ],
        periodo: rotuloPeriodo(de, ate), truncado: linhas.length > MAX_LINHAS,
        ressalvas: ['Só contas em aberto (pendente/vencido).'],
      }
    },
  },
  {
    nome: 'contas_a_receber_atrasadas',
    descricao: 'Parcelas a receber de clientes que já venceram e não foram pagas (crediário), com o total.',
    parametros: { type: 'object', properties: {} },
    async executar(sb, empresaId) {
      const { data } = await sb.from('contas_receber')
        .select('cliente_nome, valor_aberto, data_vencimento, status')
        .eq('empresa_id', empresaId).in('status', ['vencido', 'aberto', 'parcial']).lt('data_vencimento', hoje()).limit(1000)
      const lista = ((data ?? []) as any[]).filter(c => Number(c.valor_aberto ?? 0) > 0)
      const porCliente = new Map<string, number>()
      for (const c of lista) porCliente.set(c.cliente_nome ?? 'cliente', (porCliente.get(c.cliente_nome ?? 'cliente') ?? 0) + Number(c.valor_aberto))
      const linhas = [...porCliente].sort((a, b) => b[1] - a[1]).map(([cliente, valor]) => ({ cliente, em_atraso: r2(valor) }))
      return {
        linhas: [...linhas.slice(0, MAX_LINHAS), { cliente: 'TOTAL', em_atraso: r2(lista.reduce((s, c) => s + Number(c.valor_aberto), 0)) }],
        periodo: `vencidas até ontem (${lista.length} parcela(s))`, truncado: linhas.length > MAX_LINHAS,
      }
    },
  },
  {
    nome: 'avisos_do_getulio',
    descricao: 'Os assuntos que o Getúlio está acompanhando agora (os mesmos do resumo diário e da Central), com detalhe completo. Use para "detalha o item 2", "o que tem de urgente", "e os anúncios travados?".',
    parametros: { type: 'object', properties: {} },
    async executar(sb, empresaId) {
      const { data } = await sb.from('getulio_sinais')
        .select('gravidade, titulo, detalhe, valor, detectado_em, dados')
        .eq('empresa_id', empresaId).is('resolvido_em', null).is('dispensado_em', null).limit(60)
      const linhas = ((data ?? []) as any[]).map(s => ({
        gravidade: s.gravidade, titulo: s.titulo, detalhe: s.detalhe, valor_em_jogo: s.valor,
        desde: new Date(s.detectado_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        ...(Array.isArray(s.dados?.produtos) ? { produtos: s.dados.produtos.slice(0, 15) } : {}),
        ...(Array.isArray(s.dados?.maiores) ? { maiores: s.dados.maiores } : {}),
      }))
      return { linhas, periodo: 'situação na última varredura (feita de hora em hora)' }
    },
  },
  {
    nome: 'anuncios_filtrados',
    descricao: 'Lista anúncios cruzando MARCA, CANAL e SITUAÇÃO de estoque/status — ex.: "produtos Guepar anunciados na Shopee que estão zerados", "anúncios pausados do ML", "o que está ativo no TikTok sem estoque no sistema". Mostra o estoque do sistema E o do anúncio, com totais por canal.',
    parametros: {
      type: 'object',
      properties: {
        marca: { type: 'string', description: 'Marca (ou palavra do nome) dos produtos. Opcional.' },
        canal: { type: 'string', description: 'Plataforma ("shopee", "mercadolivre", "tiktok", "nuvemshop") ou nome do canal ("Shp Ouro"). Opcional.' },
        situacao: { type: 'string', description: '"zerado_no_anuncio" (anúncio com estoque 0 no canal), "zerado_no_sistema" (produto sem estoque no sistema), "qualquer_zerado" (um ou outro), "ativos", "pausados" ou "todos".' },
      },
      required: ['situacao'],
    },
    async executar(sb, empresaId, args) {
      const marca = String(args.marca ?? '').trim().replace(/[,()%]/g, ' ').trim()
      const canalTxt = normalizarCanal(String(args.canal ?? ''))
      const situacao = String(args.situacao ?? 'todos')
      const validas = ['zerado_no_anuncio', 'zerado_no_sistema', 'qualquer_zerado', 'ativos', 'pausados', 'todos']
      if (!validas.includes(situacao)) return erro(`Situação inválida. Use: ${validas.join(', ')}.`)

      let q = sb.from('marketplace_anuncios')
        .select('titulo, status, status_externo, estoque_externo, preco_venda, marketplace_canais!inner(nome, plataforma, empresa_id), produtos!inner(nome, sku, marca, estoque)')
        .eq('marketplace_canais.empresa_id', empresaId)
      if (canalTxt.plataforma) q = q.eq('marketplace_canais.plataforma', canalTxt.plataforma)
      else if (canalTxt.nome) q = q.ilike('marketplace_canais.nome', `%${canalTxt.nome}%`)
      if (marca) q = q.or(`marca.ilike.%${marca}%,nome.ilike.%${marca}%`, { referencedTable: 'produtos' })
      if (situacao === 'ativos') q = q.eq('status', 'ativo')
      if (situacao === 'pausados') q = q.eq('status', 'pausado')
      if (situacao === 'zerado_no_anuncio') q = q.lte('estoque_externo', 0)
      if (situacao === 'zerado_no_sistema') q = q.lte('produtos.estoque', 0)
      const { data, error } = await q.limit(2000)
      if (error) return erro(error.message)

      let lista = (data ?? []) as any[]
      if (situacao === 'qualquer_zerado') {
        lista = lista.filter(a => Number(a.estoque_externo ?? 0) <= 0 || Number(a.produtos?.estoque ?? 0) <= 0)
      }
      // Encerrado não interessa a ninguém numa lista dessas.
      lista = lista.filter(a => a.status !== 'encerrado')

      const porCanal = new Map<string, number>()
      for (const a of lista) porCanal.set(a.marketplace_canais.nome, (porCanal.get(a.marketplace_canais.nome) ?? 0) + 1)
      const linhas = lista
        .sort((x, y) => String(x.produtos?.nome).localeCompare(String(y.produtos?.nome)))
        .map(a => ({
          canal: a.marketplace_canais.nome, produto: a.produtos?.nome, sku: a.produtos?.sku,
          estoque_sistema: Number(a.produtos?.estoque ?? 0), estoque_no_anuncio: a.estoque_externo,
          status: a.status, preco: r2(a.preco_venda),
        }))
      return {
        linhas: [
          ...[...porCanal].map(([canal, n]) => ({ canal, TOTAL_DE_ANUNCIOS: n })),
          ...linhas.slice(0, MAX_LINHAS),
        ],
        periodo: 'situação atual (última sincronização de cada canal)',
        truncado: linhas.length > MAX_LINHAS,
        ressalvas: [
          '"Zerado no anúncio" = o canal está mostrando 0; "zerado no sistema" = não há o produto em estoque. São coisas diferentes: zerado no sistema e com estoque no anúncio é risco de vender o que não tem; com estoque no sistema e zerado no anúncio é venda perdida.',
          'Anúncio com variações (vinculado por variação) não entra nesta lista.',
          ...(linhas.length > MAX_LINHAS ? [`Mostrando ${MAX_LINHAS} de ${linhas.length}; os totais por canal estão completos.`] : []),
        ],
      }
    },
  },
  {
    nome: 'anuncios_de_um_produto',
    descricao: 'Em quais canais um produto está anunciado: status, estoque e preço em cada anúncio. Busca por SKU exato ou parte do nome.',
    parametros: {
      type: 'object',
      properties: { termo: { type: 'string', description: 'SKU exato ou parte do nome.' } },
      required: ['termo'],
    },
    async executar(sb, empresaId, args) {
      const termo = String(args.termo ?? '').trim()
      if (termo.length < 2) return erro('Informe o SKU ou parte do nome do produto.')
      const { produtos } = await produtosDoTermo(sb, empresaId, termo, 10)
      if (!produtos.length) return erro(`Nenhum produto encontrado com "${termo}". Tente outras palavras.`)
      const { data: anuncios } = await sb.from('marketplace_anuncios')
        .select('produto_id, titulo, status, status_externo, estoque_externo, preco_venda, marketplace_canais(nome)')
        .in('produto_id', produtos.map((p: any) => p.id)).limit(MAX_LINHAS)
      const porProduto = new Map(produtos.map((p: any) => [p.id, p]))
      const linhas = ((anuncios ?? []) as any[]).map(a => ({
        produto: (porProduto.get(a.produto_id) as any)?.nome, estoque_sistema: Number((porProduto.get(a.produto_id) as any)?.estoque ?? 0),
        canal: a.marketplace_canais?.nome, status: a.status, status_no_canal: a.status_externo,
        estoque_no_canal: a.estoque_externo, preco: r2(a.preco_venda),
      }))
      return {
        linhas, periodo: 'situação atual (última sincronização de cada canal)',
        ressalvas: linhas.length === 0 ? ['O produto existe, mas não está vinculado a nenhum anúncio.'] : ['Anúncio com variações mostra o preço do anúncio, não de cada variação.'],
      }
    },
  },
]
