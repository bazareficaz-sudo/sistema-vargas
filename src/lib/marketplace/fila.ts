import { estoqueDoSistema } from './estoqueDoSistema'
import { decidirSimulacao } from '@/lib/marketplace/simulacao'
import { decidirPausa, camposPausaAutomatica, camposReativacao } from '@/lib/marketplace/pausa'
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
  //
  // `estoque_externo` é o estoque que a plataforma tem. A coluna pedida aqui
  // antes chamava-se `estoque` e NÃO EXISTE em marketplace_anuncios: o
  // PostgREST recusa a consulta inteira por uma coluna desconhecida, `anuncios`
  // voltava nulo e TODO produto caía no ramo "nenhum anúncio vinculado".
  // Medido em 26/08/2026: 1.085 linhas em marketplace_fila_simulacao, todas
  // com acao='sem_anuncio' — e 186 daqueles produtos tinham anúncio mapeado.
  // A fila rodava a cada 5 minutos dizendo que não havia nada a fazer.
  //
  // ── E PAGINA, pelo mesmo motivo que a tela de anúncios pagina ───────────
  //
  // O PostgREST corta em 1000 linhas SEM AVISAR — medido neste projeto:
  // "canal com 4999 linhas na tabela só devolvia 1000". Um produto pode ter
  // anúncio em seis canais, então uma rodada de 200 produtos pede bem mais
  // de 1000 linhas, e tudo que ficasse além do corte viraria `sem_anuncio`:
  // a fila diria "este produto não tem anúncio" sobre anúncio que existe,
  // sem errar em lugar nenhum — o mesmo quadro do defeito de 26/08 acima,
  // por outra causa.
  const TAMANHO_PAGINA = 1000
  const anuncios: any[] = []
  for (let offset = 0; offset < 50 * TAMANHO_PAGINA; offset += TAMANHO_PAGINA) {
    const { data: pagina, error: erroAnuncios } = await sb
      .from('marketplace_anuncios')
      .select('id, canal_id, produto_id, id_externo, titulo, preco_venda, estoque_externo, regra_id, tem_variacao, status, pausa_origem')
      .eq('empresa_id', cfg.empresa_id)
      .in('produto_id', produtoIds)
      // Ordem estável: sem ela, duas páginas podem repetir e omitir linhas.
      .order('id', { ascending: true })
      .range(offset, offset + TAMANHO_PAGINA - 1)

    // Falhar alto. Foi o silêncio desta consulta que escondeu o defeito acima
    // por rodadas inteiras: sem anúncio nenhum, a fila não erra — ela conclui.
    if (erroAnuncios) throw new Error(`Consulta de anúncios da fila falhou: ${erroAnuncios.message}`)

    anuncios.push(...(pagina ?? []))
    if (!pagina || pagina.length < TAMANHO_PAGINA) break
  }

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
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em, atualizar_estoque_canal, sincronizar_estoque, fila_simulacao, nome')
    .eq('empresa_id', cfg.empresa_id)
    .not('access_token', 'is', null)
  const mapaCanal = new Map<string, CanalEnvio>((canaisRows ?? []).map((c: any) => [c.id, c as CanalEnvio]))

  // Anúncios que estão numa campanha de desconto ATIVA.
  //
  // A Shopee recusa `update_price` em item com promoção no ar — está
  // registrado no comentário de `shopee/write.ts`, com a mensagem dela. Sem
  // saber disso, a fila trataria a recusa como falha, o produto voltaria na
  // rodada seguinte e nas outras três até bater no teto de tentativas, e
  // desistiria de um item que nunca teve problema nenhum.
  //
  // Enviar ESTOQUE continua valendo: quem está em campanha vende, e vender
  // sem baixar o estoque no canal é o caminho para a sobrevenda.
  const { data: itensEmCampanha } = await sb
    .from('marketplace_promocao_itens')
    .select('anuncio_id, marketplace_promocoes!inner(status, canal_id)')
    .eq('marketplace_promocoes.status', 'ativa')
    .not('anuncio_id', 'is', null)
  const anunciosComPromocao = new Set<string>(
    (itensEmCampanha ?? []).map((i: any) => String(i.anuncio_id)))

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
          estoque_sistema: produto.estoque, estoque_canal: a.estoque_externo,
          detalhe: 'anúncio com variação — fora do escopo da fila',
        })
        continue
      }

      // Unificado do grupo, kit calculado pelos componentes, ou o estoque da
      // própria empresa — a decisão mora em `estoqueDoSistema`, o mesmo lugar
      // que o botão "Enviar estoque" do cadastro do produto consulta.
      const base = await estoqueDoSistema(sb, produto, mapaUnificado)
      const estoqueBase = base.estoque
      const kitInfo = base.kitInfo
      let precoNovo: number | null = null

      // Sem subtrair `estoque_reservado`: os sincronizadores gravam nessa
      // coluna o estoque da própria plataforma, então a subtração mandava
      // "sistema menos o que o canal já tem". Ver o cabeçalho de
      // `estoqueDoSistema.ts` para os números medidos.
      let estoqueNovo = estoqueBase
      let detalhe = base.origem
      let paraPausar = false
      let riscoDaRegra: number | null = null

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
            // Guardado para a frase do motivo: "estoque 1000 chegou ao limite
            // de risco (1000)" explica; "pausado" não.
            riscoDaRegra = regra.estoque_risco ?? null
            detalhe = `regra aplicada${paraPausar ? ' · pausa o anúncio (estoque de risco)' : ''}`
          } else {
            detalhe = `regra não pôde ser aplicada: ${r.motivo}`
          }
        }
      }

      const mudouEstoque = Number(a.estoque_externo ?? -1) !== estoqueNovo
      const mudouPreco = precoNovo != null && Number(a.preco_venda ?? -1) !== precoNovo

      if (!mudouEstoque && !mudouPreco) {
        semMudanca++
        linhas.push({
          empresa_id: cfg.empresa_id, rodada_em: rodadaEm, canal_id: a.canal_id,
          anuncio_id: a.id, produto_id: produto.id, acao: 'sem_mudanca',
          estoque_sistema: estoqueBase, estoque_canal: a.estoque_externo, estoque_enviaria: estoqueNovo,
          preco_canal: a.preco_venda, preco_enviaria: precoNovo,
          detalhe: 'o canal já está com o mesmo número',
        })
        continue
      }

      enviaria++

      let acao = 'enviaria'
      let detalheFinal = `${detalhe} · motivo: ${item.motivo ?? '—'}`

      // SIMULACAO E POR CANAL, com a empresa como padrao. Antes era so da
      // empresa, e ligar o envio real de um canal ligava todos.
      const canalDoAnuncio = mapaCanal.get(a.canal_id)
      const sim = decidirSimulacao(canalDoAnuncio, { simulacaoDaEmpresa: cfg.simulacao })

      if (!sim.simula) {
        const canal = canalDoAnuncio
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
        } else if (a.status === 'encerrado') {
          // Nao e falha: e um anuncio que acabou. Mandar quantidade para um
          // item fechado no Mercado Livre pode recoloca-lo a venda, e a fila
          // nao pode republicar o que alguem encerrou de proposito. Medido em
          // 26/08/2026: 16 anuncios encerrados com id_externo.
          acao = 'encerrado'
          detalheFinal = 'anuncio encerrado no canal — enviar estoque poderia reabri-lo'
        } else {
          // Item em campanha ativa: vai estoque, nao vai preco. A Shopee
          // recusaria o preco de qualquer jeito, e quem manda no preco de um
          // item em promocao e a campanha (update_discount_item), nao o
          // update_price do catalogo.
          const emPromocao = anunciosComPromocao.has(String(a.id))
          if (emPromocao && precoNovo != null) {
            detalheFinal = `${detalheFinal} · preco retido: item em campanha de desconto`
          }

          // PAUSAR, REATIVAR OU NAO MEXER — e quem decide e `decidirPausa`,
          // que sabe distinguir a pausa do sistema da pausa de uma pessoa.
          // Antes, `pausar: false` nao religava nada: o anuncio ficava fora do
          // ar para sempre depois de uma falta de estoque.
          const decisao = decidirPausa({
            anuncio: a, paraPausar,
            estoqueEnviado: estoqueNovo, risco: riscoDaRegra,
          })

          const r = await enviarParaAnuncio(sb, canal, String(a.id_externo), {
            estoque: estoqueNovo,
            preco: emPromocao ? undefined : (precoNovo ?? undefined),
            pausar: decisao.acao === 'pausar',
            reativar: decisao.acao === 'reativar',
          })
          await sleep(THROTTLE_ENVIO_MS)

          if (r.ok) {
            acao = 'enviado'; enviados++
            detalheFinal = `${detalheFinal}`
              + (r.pausado ? ` · anuncio pausado (${decisao.acao === 'pausar' ? decisao.motivo : ''})` : '')
              + (r.reativado ? ' · anuncio reativado (estoque voltou)' : '')
              + (decisao.acao === 'nada' && paraPausar === false && a.status === 'pausado'
                  ? ` · mantido pausado: ${decisao.porque}` : '')
            // O que o canal tem agora e o que acabamos de mandar. Guardar isso
            // evita reenviar o mesmo numero na proxima movimentacao e faz a
            // tela de anuncios refletir a realidade sem esperar a varredura.
            // O preco so entra no espelho se tiver sido MANDADO. Gravar o
            // preco retido faria o espelho jurar que o canal esta com um
            // numero que ele nunca recebeu — e, pior, a rodada seguinte
            // veria "sem mudanca" e nunca mais tentaria enviar.
            await sb.from('marketplace_anuncios').update({
              estoque_externo: estoqueNovo,
              ...(precoNovo != null && !emPromocao ? { preco_venda: precoNovo } : {}),
              // A ORIGEM DA PAUSA VAI JUNTO. Sem ela, a proxima reposicao de
              // estoque nao saberia se pode religar este anuncio.
              ...(decisao.acao === 'pausar' ? camposPausaAutomatica(decisao.motivo) : {}),
              ...(decisao.acao === 'reativar' ? camposReativacao() : {}),
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
        estoque_sistema: estoqueBase, estoque_canal: a.estoque_externo, estoque_enviaria: estoqueNovo,
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
