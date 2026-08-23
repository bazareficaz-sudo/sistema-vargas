import { calcularKit } from '@/lib/produtos/kit'
import { buscarConfigUnificacao, estoqueUnificadoDeProdutos } from '@/lib/produtos/estoqueUnificado'
import { calcularPrecoEstoquePorRegra } from '@/lib/shopee/aplicarRegra'
import { enviarParaAnuncio, canalAceitaEnvio, sleep, THROTTLE_ENVIO_MS, type CanalEnvio } from './envio'

// FASE 3 — processador da fila de atualização (sistema → marketplace).
//
// Em MODO SIMULAÇÃO (padrão) ele faz tudo: pega os produtos sujos, acha os
// anúncios mapeados em todos os canais, calcula o estoque e o preço que
// mandaria, grava esse cálculo — e não envia nada. É o único jeito honesto de
// descobrir os erros antes de eles chegarem nos anúncios de verdade.
//
// Com a simulação DESLIGADA ele envia de verdade. Duas salvaguardas que não
// são opcionais:
//
//  • o canal precisa ter "sincronizar estoque" e "atualizar estoque do canal"
//    ligados em Configurar → canal. É por aí que se liga a fila em um canal
//    só, sem tela nova;
//  • produto cujo envio falhou NÃO é marcado como resolvido: volta na próxima
//    rodada. Marcar como enviado o que não foi enviado é a falha mais cara
//    que uma fila pode ter, porque some sem deixar rastro.

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
  simulacao?: boolean
  motivo?: string
  pendentesAntes?: number
  produtosProcessados?: number
  anunciosAvaliados?: number
  enviaria?: number
  semMudanca?: number
  semAnuncio?: number
  comVariacao?: number
  enviados?: number
  falhasEnvio?: number
  canalRecusou?: number
}

// Quantas rodadas um produto pode falhar antes de a fila desistir dele.
// Sem limite, um anúncio quebrado (id externo inválido, anúncio encerrado no
// canal) ficaria eternamente no topo da fila consumindo o teto da rodada e
// impedindo os produtos de trás de serem atendidos.
export const MAX_TENTATIVAS_ENVIO = 5

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

  // Pendente = `enviado_em IS NULL`. Quem enfileira limpa esse campo (ver
  // supabase-fila-pendente-consertar.sql), então não é preciso comparar
  // `sujo_em > enviado_em` aqui — comparação entre COLUNAS que o PostgREST
  // não faz: ele lia "enviado_em" como texto e estourava
  // (`invalid input syntax for type timestamp`), derrubando toda rodada.
  //
  // Urgente primeiro; dentro da mesma prioridade, o que está sujo há mais
  // tempo — assim nada fica para trás enquanto produtos novos furam a fila.
  const { data: pendentes, error: erroFila } = await sb
    .from('marketplace_fila')
    .select('id, produto_id, sujo_em, motivo, prioridade, enviado_em, tentativas')
    .eq('empresa_id', cfg.empresa_id)
    .is('enviado_em', null)
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

  // Canais da empresa: plataforma, credenciais e os interruptores que dizem
  // se aquele canal aceita receber atualizacao.
  const { data: canaisRows } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em, atualizar_estoque_canal, sincronizar_estoque')
    .eq('empresa_id', cfg.empresa_id)
    .not('access_token', 'is', null)
  const mapaCanal = new Map<string, CanalEnvio>((canaisRows ?? []).map((c: any) => [c.id, c as CanalEnvio]))

  const regrasUsadas = new Map<string, any>()
  const linhas: any[] = []
  const rodadaEm = new Date().toISOString()
  let anunciosAvaliados = 0, enviaria = 0, semMudanca = 0, semAnuncio = 0, comVariacao = 0
  let enviados = 0, falhasEnvio = 0, canalRecusou = 0

  // Produtos cujo envio falhou nesta rodada: continuam pendentes.
  const comFalha = new Map<string, string>()

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
      let paraPausar = false

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
            paraPausar = !!r.paraPausar
            detalhe = `regra aplicada${paraPausar ? ' · pausa o anúncio (estoque de risco)' : ''}`
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

      let acao = 'enviaria'
      let detalheFinal = `${detalhe} · motivo: ${item.motivo ?? '—'}`

      if (!cfg.simulacao) {
        const canal = mapaCanal.get(a.canal_id)
        if (!canal) {
          acao = 'erro'; detalheFinal = 'canal nao encontrado ou sem token'
          comFalha.set(produto.id, detalheFinal); falhasEnvio++
        } else if (!canalAceitaEnvio(canal)) {
          // Nao e falha: e o canal dizendo que nao quer receber. Contar como
          // falha faria o produto voltar para sempre por uma decisao de
          // configuracao que nao vai mudar sozinha.
          acao = 'canal_desligado'
          detalheFinal = 'canal nao aceita atualizacao automatica (Configurar → canal)'
          canalRecusou++
        } else if (!a.id_externo) {
          acao = 'erro'; detalheFinal = 'anuncio sem id no canal'
          comFalha.set(produto.id, detalheFinal); falhasEnvio++
        } else {
          const r = await enviarParaAnuncio(sb, canal, String(a.id_externo), {
            estoque: estoqueNovo,
            preco: precoNovo ?? undefined,
            pausar: paraPausar,
          })
          await sleep(THROTTLE_ENVIO_MS)

          if (r.ok) {
            acao = 'enviado'; enviados++
            detalheFinal = `${detalheFinal}${r.pausado ? ' · anuncio pausado' : ''}`
            // O que o canal tem agora e o que acabamos de mandar. Guardar isso
            // evita reenviar o mesmo numero na proxima movimentacao e faz a
            // tela de anuncios refletir a realidade sem esperar a varredura.
            await sb.from('marketplace_anuncios').update({
              estoque: estoqueNovo,
              ...(precoNovo != null ? { preco_venda: precoNovo } : {}),
            }).eq('id', a.id)
          } else {
            acao = 'erro'; falhasEnvio++
            detalheFinal = r.erro ?? 'falha ao enviar'
            comFalha.set(produto.id, detalheFinal)
          }
        }
      }

      linhas.push({
        empresa_id: cfg.empresa_id, rodada_em: rodadaEm, canal_id: a.canal_id,
        anuncio_id: a.id, produto_id: produto.id, acao,
        estoque_sistema: estoqueBase, estoque_canal: a.estoque, estoque_enviaria: estoqueNovo,
        preco_canal: a.preco_venda, preco_enviaria: precoNovo,
        detalhe: detalheFinal,
      })
    }
  }

  if (linhas.length) {
    await sb.from('marketplace_fila_simulacao').insert(linhas)
  }

  // Quem foi resolvido sai da fila; quem falhou fica, para a proxima rodada
  // tentar de novo — ate o limite de tentativas.
  //
  // Em simulacao nada falha, entao a fila esvazia inteira. Isso e de
  // proposito: se ela nao esvaziasse, os mesmos produtos reapareceriam em
  // toda rodada e a simulacao viraria um retrato repetido, sem mostrar o
  // fluxo real de movimentacoes.
  const agoraIso = new Date().toISOString()
  const resolvidos = pendentes.filter((p: any) => !comFalha.has(p.produto_id))
  const falhados = pendentes.filter((p: any) => comFalha.has(p.produto_id))

  if (resolvidos.length) {
    await sb.from('marketplace_fila')
      .update({ enviado_em: agoraIso, ultimo_erro: null })
      .in('id', resolvidos.map((p: any) => p.id))
  }

  for (const p of falhados) {
    const tentativas = (p.tentativas ?? 0) + 1
    const desistir = tentativas >= MAX_TENTATIVAS_ENVIO
    await sb.from('marketplace_fila').update({
      tentativas,
      ultimo_erro: comFalha.get(p.produto_id) ?? 'falha ao enviar',
      // Ao desistir, sai da fila mas o erro fica gravado e visivel na tela.
      // Deixa-lo pendente para sempre travaria o topo da fila e faria os
      // produtos de tras nunca serem atendidos.
      ...(desistir ? { enviado_em: agoraIso } : {}),
    }).eq('id', p.id)
  }

  await sb.from('marketplace_fila_config')
    .update({ ultima_execucao: new Date().toISOString() }).eq('empresa_id', cfg.empresa_id)

  return {
    ...base, executou: true, simulacao: cfg.simulacao,
    pendentesAntes: pendentes.length,
    produtosProcessados: pendentes.length,
    anunciosAvaliados, enviaria, semMudanca, semAnuncio, comVariacao,
    enviados, falhasEnvio, canalRecusou,
  }
}
