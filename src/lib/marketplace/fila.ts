import { calcularKit } from '@/lib/produtos/kit'
import { buscarConfigUnificacao, estoqueUnificadoDeProdutos } from '@/lib/produtos/estoqueUnificado'
import { calcularPrecoEstoquePorRegra } from '@/lib/shopee/aplicarRegra'

// FASE 3 — processador da fila de atualização (sistema → marketplace).
//
// Em MODO SIMULAÇÃO (padrão) ele faz tudo: pega os produtos sujos, acha os
// anúncios mapeados em todos os canais, calcula o estoque e o preço que
// mandaria, grava esse cálculo — e não envia nada. É o único jeito honesto de
// descobrir os erros antes de eles chegarem nos anúncios de verdade.
//
// O envio real ainda NÃO está implementado aqui de propósito. Ligar o
// interruptor "simulação" sem ter escrito o envio faria a fila marcar produtos
// como enviados sem ter enviado — pior que não ter fila nenhuma. Enquanto o
// envio não existir, sair da simulação é bloqueado.

export type ConfigFila = {
  empresa_id: string
  ativo: boolean
  simulacao: boolean
  intervalo_min: number
  max_produtos_rodada: number
  estoque_urgente: number
  ultima_execucao: string | null
}

export type ResultadoRodada = {
  empresaId: string
  executou: boolean
  motivo?: string
  pendentesAntes?: number
  produtosProcessados?: number
  anunciosAvaliados?: number
  enviaria?: number
  semMudanca?: number
  semAnuncio?: number
  comVariacao?: number
}

/** Ainda falta o intervalo passar? Então esta rodada não é dela. */
export function devidoExecutar(cfg: ConfigFila, agora = Date.now()): boolean {
  if (!cfg.ativo) return false
  if (!cfg.ultima_execucao) return true
  return agora - new Date(cfg.ultima_execucao).getTime() >= cfg.intervalo_min * 60_000
}

export async function processarFilaDaEmpresa(
  sb: any, cfg: ConfigFila,
): Promise<ResultadoRodada> {
  const base = { empresaId: cfg.empresa_id }

  if (!cfg.ativo) return { ...base, executou: false, motivo: 'fila desligada' }
  if (!devidoExecutar(cfg)) return { ...base, executou: false, motivo: 'intervalo ainda não venceu' }

  // Pendente = sujou depois do último envio. Urgente primeiro; dentro da mesma
  // prioridade, o que está sujo há mais tempo — assim nada fica para trás
  // eternamente enquanto produtos novos furam a fila.
  const { data: pendentes, error: erroFila } = await sb
    .from('marketplace_fila')
    .select('id, produto_id, sujo_em, motivo, prioridade, enviado_em, tentativas')
    .eq('empresa_id', cfg.empresa_id)
    .or('enviado_em.is.null,sujo_em.gt.enviado_em')
    .order('prioridade', { ascending: false })
    .order('sujo_em', { ascending: true })
    .limit(cfg.max_produtos_rodada)

  if (erroFila) throw new Error(erroFila.message)
  if (!pendentes?.length) {
    await sb.from('marketplace_fila_config')
      .update({ ultima_execucao: new Date().toISOString() }).eq('empresa_id', cfg.empresa_id)
    return { ...base, executou: true, pendentesAntes: 0, produtosProcessados: 0 }
  }

  const produtoIds = pendentes.map((p: any) => p.produto_id)

  const { data: produtos } = await sb
    .from('produtos')
    .select('id, nome, sku, estoque, preco_venda, preco_custo, tipo')
    .in('id', produtoIds)
  type ProdutoFila = {
    id: string; nome: string; sku: string | null; estoque: number
    preco_venda: number; preco_custo: number | null; tipo: string | null
  }
  const mapaProduto = new Map<string, ProdutoFila>((produtos ?? []).map((p: any) => [p.id, p as ProdutoFila]))

  // Um produto pode ter anúncio em vários canais. A fila é por produto; o
  // trabalho é por anúncio.
  const { data: anuncios } = await sb
    .from('marketplace_anuncios')
    .select('id, canal_id, produto_id, id_externo, titulo, preco_venda, estoque, estoque_reservado, regra_id, tem_variacao, status')
    .eq('empresa_id', cfg.empresa_id)
    .in('produto_id', produtoIds)

  const porProduto = new Map<string, any[]>()
  for (const a of anuncios ?? []) {
    const lista = porProduto.get(a.produto_id) ?? []
    lista.push(a)
    porProduto.set(a.produto_id, lista)
  }

  // Estoque unificado do grupo, quando ligado: resolvido de uma vez para
  // todos os produtos da rodada, não uma consulta por anúncio.
  const cfgUnif = await buscarConfigUnificacao(sb, cfg.empresa_id)
  const mapaUnificado = await estoqueUnificadoDeProdutos(sb, cfg.empresa_id, produtoIds, cfgUnif)

  const regrasUsadas = new Map<string, any>()
  const linhas: any[] = []
  const rodadaEm = new Date().toISOString()
  let anunciosAvaliados = 0, enviaria = 0, semMudanca = 0, semAnuncio = 0, comVariacao = 0

  for (const item of pendentes) {
    const produto = mapaProduto.get(item.produto_id)
    if (!produto) continue

    const lista = porProduto.get(item.produto_id) ?? []
    if (lista.length === 0) {
      // Movimentação de produto sem anúncio mapeado. Registrar em vez de
      // ignorar calado: com ~91% dos anúncios sem produto vinculado, uma fila
      // "sem nada para fazer" pode ser falta de mapeamento, não falta de
      // movimento — e essas duas coisas pedem ações opostas.
      semAnuncio++
      linhas.push({
        empresa_id: cfg.empresa_id, rodada_em: rodadaEm, produto_id: produto.id,
        acao: 'sem_anuncio', estoque_sistema: produto.estoque,
        detalhe: `${produto.nome} (${produto.sku ?? 's/ SKU'}) — nenhum anúncio vinculado`,
      })
      continue
    }

    for (const a of lista) {
      anunciosAvaliados++

      if (a.tem_variacao) {
        // Anúncio com variação distribui estoque por variação; mandar um
        // número só sobrescreveria a distribuição inteira. Fica de fora até
        // existir tratamento por variação.
        comVariacao++
        linhas.push({
          empresa_id: cfg.empresa_id, rodada_em: rodadaEm, canal_id: a.canal_id,
          anuncio_id: a.id, produto_id: produto.id, acao: 'com_variacao',
          estoque_sistema: produto.estoque, estoque_canal: a.estoque,
          detalhe: 'anúncio com variação — fora do escopo da fila',
        })
        continue
      }

      // Estoque unificado do grupo, quando ligado; senão o da própria empresa.
      let estoqueBase: number = mapaUnificado?.get(produto.id) ?? Number(produto.estoque ?? 0)
      let precoNovo: number | null = null

      // Kit: o estoque é derivado dos componentes, não do campo do produto.
      let kitInfo: { custo: number; estoque: number } | undefined
      if (produto.tipo === 'kit') {
        const k = await calcularKit(sb, produto.id, null)
        if (k) { kitInfo = k; estoqueBase = k.estoque }
      }

      let estoqueNovo = Math.max(0, estoqueBase - Number(a.estoque_reservado ?? 0))
      let detalhe = 'espelho direto do estoque do sistema'

      if (a.regra_id) {
        let regra = regrasUsadas.get(a.regra_id)
        if (regra === undefined) {
          const { data } = await sb.from('marketplace_regras_preco').select('*').eq('id', a.regra_id).maybeSingle()
          regra = data ?? null
          regrasUsadas.set(a.regra_id, regra)
        }
        if (regra) {
          // Mesma função que o envio manual em massa e o envio automático da
          // Shopee usam. A simulação tem que calcular pelo MESMO caminho do
          // envio real, senão ela não prova nada sobre o envio real.
          let estoquePorDeposito: number | undefined
          if (!kitInfo && regra.modo_estoque === 'deposito' && regra.deposito_id) {
            const { data: pe } = await sb.from('produto_estoque').select('quantidade')
              .eq('deposito_id', regra.deposito_id).eq('produto_id', produto.id).maybeSingle()
            estoquePorDeposito = pe?.quantidade ?? 0
          }

          const r = calcularPrecoEstoquePorRegra(
            regra,
            {
              preco_venda: a.preco_venda,
              produtos: {
                id: produto.id, preco_venda: produto.preco_venda,
                preco_custo: produto.preco_custo, estoque: estoqueBase,
              },
            },
            { estoquePorDeposito, kitInfo },
          )

          if (r.aplicavel) {
            if (typeof r.estoqueNovo === 'number') estoqueNovo = r.estoqueNovo
            if (typeof r.precoNovo === 'number') precoNovo = r.precoNovo
            detalhe = `regra aplicada${r.paraPausar ? ' · pausaria o anúncio (estoque de risco)' : ''}`
          } else {
            detalhe = `regra não pôde ser aplicada: ${r.motivo}`
          }
        }
      }

      const mudouEstoque = Number(a.estoque ?? -1) !== estoqueNovo
      const mudouPreco = precoNovo != null && Number(a.preco_venda ?? -1) !== precoNovo

      if (!mudouEstoque && !mudouPreco) {
        semMudanca++
        linhas.push({
          empresa_id: cfg.empresa_id, rodada_em: rodadaEm, canal_id: a.canal_id,
          anuncio_id: a.id, produto_id: produto.id, acao: 'sem_mudanca',
          estoque_sistema: estoqueBase, estoque_canal: a.estoque, estoque_enviaria: estoqueNovo,
          preco_canal: a.preco_venda, preco_enviaria: precoNovo,
          detalhe: 'o canal já está com o mesmo número',
        })
        continue
      }

      enviaria++
      linhas.push({
        empresa_id: cfg.empresa_id, rodada_em: rodadaEm, canal_id: a.canal_id,
        anuncio_id: a.id, produto_id: produto.id, acao: 'enviaria',
        estoque_sistema: estoqueBase, estoque_canal: a.estoque, estoque_enviaria: estoqueNovo,
        preco_canal: a.preco_venda, preco_enviaria: precoNovo,
        detalhe: `${detalhe} · motivo: ${item.motivo ?? '—'}`,
      })
    }
  }

  if (linhas.length) {
    await sb.from('marketplace_fila_simulacao').insert(linhas)
  }

  // Em simulação a fila É esvaziada (enviado_em = agora). Se não fosse, os
  // mesmos produtos apareceriam em toda rodada e a simulação viraria um
  // retrato repetido, sem mostrar o fluxo real de movimentações.
  await sb.from('marketplace_fila')
    .update({ enviado_em: new Date().toISOString() })
    .in('id', pendentes.map((p: any) => p.id))

  await sb.from('marketplace_fila_config')
    .update({ ultima_execucao: new Date().toISOString() }).eq('empresa_id', cfg.empresa_id)

  return {
    ...base, executou: true,
    pendentesAntes: pendentes.length,
    produtosProcessados: pendentes.length,
    anunciosAvaliados, enviaria, semMudanca, semAnuncio, comVariacao,
  }
}
