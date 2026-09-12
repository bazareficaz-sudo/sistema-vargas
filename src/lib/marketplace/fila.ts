import { estoqueDoSistema } from './estoqueDoSistema'
import { decidirSimulacao } from '@/lib/marketplace/simulacao'
import { decidirPausa, camposPausaAutomatica, camposReativacao } from '@/lib/marketplace/pausa'
import { buscarConfigUnificacao, estoqueUnificadoDeProdutos } from '@/lib/produtos/estoqueUnificado'
import { calcularPrecoEstoquePorRegra } from '@/lib/shopee/aplicarRegra'
import { enviarParaAnuncio, sleep, THROTTLE_ENVIO_MS, type AlvoVariacao, type CanalEnvio } from './envio'
import { precisaEnviar } from './precisaEnviar'
import { canalAceitaEnvio, type CanalComInterruptores } from './canais'
import {
  variacoesElegiveis, decidirPausaComVariacoes, rotuloDaVariacao, resumoDosAlvos,
  type AlvoCalculado, type VariacaoDoAnuncio,
} from './estoqueVariacoes'

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
  // ANTES DE LER A FILA, ADOTAR O QUE MUDOU NO ANÚNCIO.
  //
  // A fila só é alimentada por movimentação de ESTOQUE ou PREÇO do produto
  // (`trg_fila_produto`). Mas há duas coisas que mudam o que deveria estar no
  // canal sem tocar em estoque nenhum, e as duas custaram um dia de
  // investigação cada:
  //
  //   MAPEAR o anúncio a um produto. Caso real de 04/09/2026: a Pistola foi
  //   vendida sem estar mapeada — a fila avaliou e gravou `sem_anuncio`, com
  //   razão — e foi mapeada DEPOIS. A partir dali ninguém mais pediu nada, e
  //   o anúncio ficou parado com a tela dizendo "enviando".
  //
  //   VINCULAR uma regra. A tela já pede o enfileiramento desde `2b6e7cc`,
  //   mas são sete lugares diferentes que gravam `produto_id`, em cinco
  //   componentes. Corrigir um por um deixaria o próximo de fora.
  //
  // A rodada é o único lugar por onde tudo passa, então a adoção mora aqui.
  await adotarAnunciosAlterados(sb, cfg)

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
  //
  // ── O LIMITE DE INQUILINO VEM DO CANAL, NAO DE `empresa_id` ─────────────
  //
  // Esta consulta exigia `marketplace_anuncios.empresa_id`; a LISTAGEM da tela
  // nunca exigiu — ela filtra por `canal_id`. Alinhar as duas e o certo:
  // `canal_id` e obrigatorio para um anuncio existir, e o canal pertence a
  // empresa por `marketplace_canais.empresa_id`. O limite de inquilino
  // continua existindo; passa a apoiar-se na coluna que o sustenta.
  //
  // ── CORRECAO DE UMA CAUSA QUE ESTE COMENTARIO AFIRMOU E O BANCO DESMENTIU ─
  //
  // A versao anterior deste bloco dizia que anuncios com `empresa_id` nulo ou
  // divergente ficavam invisiveis para a fila, e que era isso que produzia os
  // 157 `sem_anuncio` de 200 medidos em 04/09/2026. Os 157 foram reais; a
  // causa, nao. Medido depois, e reconferido em 07/09/2026:
  //
  //     9285 anuncios · 0 com empresa_id nulo · 0 divergentes do canal
  //
  // Nenhuma linha se encaixava na explicacao. Os `sem_anuncio` daquela rodada
  // eram produtos que de fato nao tinham anuncio mapeado — a fila estava
  // dizendo a verdade. A mudanca para `canal_id` segue valendo pelo argumento
  // do paragrafo acima, que nao depende daquela causa.
  const { data: canaisDaEmpresa } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em, atualizar_estoque_canal, sincronizar_estoque, fila_simulacao, nome')
    .eq('empresa_id', cfg.empresa_id)
  type CanalLinha = CanalEnvio & { nome?: string | null }
  const canaisLista = (canaisDaEmpresa ?? []) as CanalLinha[]
  const idsDeCanal = canaisLista.map(c => c.id)

  const TAMANHO_PAGINA = 1000
  const anuncios: any[] = []
  for (let offset = 0; idsDeCanal.length > 0 && offset < 50 * TAMANHO_PAGINA; offset += TAMANHO_PAGINA) {
    const { data: pagina, error: erroAnuncios } = await sb
      .from('marketplace_anuncios')
      .select('id, canal_id, produto_id, id_externo, titulo, preco_venda, estoque_externo, estoque_reservado, regra_id, tem_variacao, status, pausa_origem, empresa_id')
      .in('canal_id', idsDeCanal)
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

  // ── ANÚNCIO COM VARIAÇÃO ENTRA POR OUTRA PORTA ──────────────────────────
  //
  // A consulta acima acha anúncios por `marketplace_anuncios.produto_id`. Num
  // anúncio com variação esse campo não é o que manda: o produto do ERP mora
  // em CADA variação (`marketplace_anuncio_variacoes.produto_id`), e é o
  // estoque dele que precisa subir. Medido em 12/09/2026: 594 anúncios com
  // variação, 193 variações mapeadas, e só 115 daqueles anúncios têm produto
  // no pai — ou seja, buscar só pelo pai deixaria a maioria de fora.
  //
  // Sem este bloco, mexer no estoque de "Camiseta azul M" enfileirava o
  // produto, a fila não achava anúncio nenhum para ele e gravava
  // `sem_anuncio` — dizendo que um produto anunciado não está anunciado.
  const variacoesDaRodada: any[] = []
  for (let offset = 0; offset < 50 * TAMANHO_PAGINA; offset += TAMANHO_PAGINA) {
    const { data: pagina, error } = await sb
      .from('marketplace_anuncio_variacoes')
      .select('id, anuncio_id, produto_id')
      .in('produto_id', produtoIds)
      .order('id', { ascending: true })
      .range(offset, offset + TAMANHO_PAGINA - 1)
    if (error) throw new Error(`Consulta de variações da fila falhou: ${error.message}`)
    variacoesDaRodada.push(...(pagina ?? []))
    if (!pagina || pagina.length < TAMANHO_PAGINA) break
  }

  const idsAnunciosPorVariacao = [...new Set<string>(variacoesDaRodada.map(v => v.anuncio_id))]
  const jaCarregados = new Set<string>((anuncios ?? []).map((a: any) => a.id))
  const faltantes = idsAnunciosPorVariacao.filter(id => !jaCarregados.has(id))
  if (faltantes.length > 0 && idsDeCanal.length > 0) {
    for (let i = 0; i < faltantes.length; i += TAMANHO_PAGINA) {
      const { data: extras, error } = await sb
        .from('marketplace_anuncios')
        .select('id, canal_id, produto_id, id_externo, titulo, preco_venda, estoque_externo, estoque_reservado, regra_id, tem_variacao, status, pausa_origem, empresa_id')
        .in('id', faltantes.slice(i, i + TAMANHO_PAGINA))
        // O limite de inquilino continua vindo do canal, como na consulta
        // principal: sem isto, um id de variação de outra empresa traria o
        // anúncio dela para dentro desta rodada.
        .in('canal_id', idsDeCanal)
      if (error) throw new Error(`Consulta de anúncios com variação falhou: ${error.message}`)
      anuncios.push(...(extras ?? []))
    }
  }

  // Anúncio com variação sai do mapa por produto: ele é processado UMA vez
  // por rodada, não uma vez por produto da fila que caia nele. Dois produtos
  // enfileirados que sejam variações do mesmo anúncio pediriam o mesmo envio
  // duas vezes — e a segunda veria o espelho já atualizado pela primeira.
  const porProduto = new Map<string, any[]>()
  const anunciosComVariacao = new Map<string, any>()
  for (const a of anuncios ?? []) {
    if (a.tem_variacao) { anunciosComVariacao.set(a.id, a); continue }
    if (!a.produto_id) continue
    const lista = porProduto.get(a.produto_id) ?? []
    lista.push(a)
    porProduto.set(a.produto_id, lista)
  }

  // Quais produtos da fila estão cobertos por um anúncio com variação —
  // para não caírem em `sem_anuncio` mais abaixo.
  const cobertosPorVariacao = new Set<string>(
    variacoesDaRodada
      .filter(v => anunciosComVariacao.has(v.anuncio_id))
      .map(v => v.produto_id))

  // ── POR QUE NAO ACHOU, quando nao acha ──────────────────────────────────
  //
  // `sem_anuncio` era um beco sem saida: dizia "nenhum anuncio vinculado" e
  // pronto, e a mesma frase servia para produto realmente sem anuncio e para
  // anuncio que a consulta nao alcancou. Foram necessarias duas investigacoes
  // (26/08 e 04/09) para separar as duas, cada uma custando dias.
  //
  // UMA consulta a mais por rodada, so quando sobrou produto sem anuncio, e
  // sem NENHUM filtro de escopo: se o anuncio existe e ficou de fora, a linha
  // passa a dizer isso, com o canal dele.
  const semAnuncioIds = produtoIds.filter((id: string) => !porProduto.has(id) && !cobertosPorVariacao.has(id))
  const forasteiros = new Map<string, { canais: string[]; total: number }>()
  if (semAnuncioIds.length > 0) {
    const { data: fora } = await sb
      .from('marketplace_anuncios')
      .select('produto_id, canal_id, empresa_id')
      .in('produto_id', semAnuncioIds)
    type Forasteiro = { produto_id: string; canal_id: string; empresa_id: string | null }
    for (const a of (fora ?? []) as Forasteiro[]) {
      const e = forasteiros.get(a.produto_id) ?? { canais: [], total: 0 }
      e.total++
      if (!e.canais.includes(a.canal_id)) e.canais.push(a.canal_id)
      forasteiros.set(a.produto_id, e)
    }
  }
  const nomeDoCanal = new Map<string, string>(
    canaisLista.map(c => [c.id, c.nome ?? c.plataforma ?? c.id]))

  // Estoque unificado do grupo, quando ligado: resolvido de uma vez para
  // todos os produtos da rodada, não uma consulta por anúncio.
  const cfgUnif = await buscarConfigUnificacao(sb, cfg.empresa_id)
  const mapaUnificado = await estoqueUnificadoDeProdutos(sb, cfg.empresa_id, produtoIds, cfgUnif)

  // Canais COM CREDENCIAL, para o envio. Sai da lista ja carregada acima: o
  // escopo dos anuncios precisa de TODOS os canais da empresa (senao anuncio
  // de canal sem token viraria `sem_anuncio`, que e mentira), e o envio
  // precisa so dos que tem token.
  const mapaCanal = new Map<string, CanalEnvio>(
    canaisLista.filter(c => c.access_token).map(c => [c.id, c]))

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
    // Coberto por anúncio com variação: o trabalho dele acontece no bloco
    // próprio, depois deste laço, uma vez por anúncio.
    if (lista.length === 0 && cobertosPorVariacao.has(item.produto_id)) continue
    if (lista.length === 0) {
      // Movimentação de produto sem anúncio mapeado. Registrar em vez de
      // ignorar calado: com ~91% dos anúncios sem produto vinculado, uma fila
      // "sem nada para fazer" pode ser falta de mapeamento, não falta de
      // movimento — e essas duas coisas pedem ações opostas.
      semAnuncio++
      const fora = forasteiros.get(produto.id)
      linhas.push({
        empresa_id: cfg.empresa_id, rodada_em: rodadaEm, produto_id: produto.id,
        acao: 'sem_anuncio', estoque_sistema: produto.estoque,
        detalhe: fora
          ? `${produto.nome} (${produto.sku ?? 's/ SKU'}) — ${fora.total} anúncio(s) EXISTEM `
            + `mas ficaram fora do alcance da fila: canal `
            + fora.canais.map(c => nomeDoCanal.get(c) ?? `desconhecido (${c})`).join(', ')
            + '. Canal de outra empresa, ou anúncio sem canal válido.'
          : `${produto.nome} (${produto.sku ?? 's/ SKU'}) — nenhum anúncio vinculado`,
      })
      continue
    }

    for (const a of lista) {
      anunciosAvaliados++

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

      // QUEM DECIDE É `precisaEnviar`, e não a comparação com o espelho.
      //
      // O espelho (`estoque_externo`) é o que ACREDITAMOS ter mandado, e ele
      // era escrito mesmo quando a Shopee recusava o item dentro de uma
      // resposta aceita. Quando a última LEITURA da plataforma
      // (`estoque_reservado`) contradiz o espelho, quem está errado é o
      // espelho — e "já igual" era o que mantinha o anúncio travado.
      const decisaoEnvio = precisaEnviar({
        estoqueExterno: a.estoque_externo,
        estoqueMedido: a.estoque_reservado,
        estoqueNovo,
        precoEspelho: a.preco_venda,
        precoNovo,
      })

      if (!decisaoEnvio.enviar) {
        semMudanca++
        linhas.push({
          empresa_id: cfg.empresa_id, rodada_em: rodadaEm, canal_id: a.canal_id,
          anuncio_id: a.id, produto_id: produto.id, acao: 'sem_mudanca',
          estoque_sistema: estoqueBase, estoque_canal: a.estoque_externo, estoque_enviaria: estoqueNovo,
          preco_canal: a.preco_venda, preco_enviaria: precoNovo,
          detalhe: decisaoEnvio.motivo,
        })
        continue
      }
      if (decisaoEnvio.espelhoDivergente) {
        // Vai para a linha da fila: é a evidência de que um envio anterior foi
        // dado como aceito sem ter sido, e some se ninguém a escrever.
        detalhe = `${detalhe} · ⚠ ${decisaoEnvio.motivo}`
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

  // ── ANÚNCIOS COM VARIAÇÃO ───────────────────────────────────────────────
  //
  // Uma passada por ANÚNCIO (não por produto): o envio é uma chamada só com
  // a lista de modelos, e dois produtos da fila que sejam variações do mesmo
  // anúncio têm de virar um envio, não dois.
  for (const a of anunciosComVariacao.values()) {
    const { data: todasVariacoes } = await sb
      .from('marketplace_anuncio_variacoes')
      .select('id, model_id, nome_variacao, sku_variacao, produto_id, preco, estoque')
      .eq('anuncio_id', a.id)
      .order('nome_variacao', { ascending: true })

    const { elegiveis, ignoradas } = variacoesElegiveis((todasVariacoes ?? []) as VariacaoDoAnuncio[])
    anunciosAvaliados++
    comVariacao++

    // Produtos da FILA que dependem deste anúncio — é para eles que uma
    // falha aqui precisa voltar como pendência.
    //
    // O produto do anúncio-pai entra junto quando está na fila: há 115
    // anúncios com variação que TÊM produto no pai, e foi por ele que alguns
    // chegaram até aqui. Sem esta linha, um envio que falhasse marcaria esse
    // produto como resolvido — a falha mais cara que uma fila pode ter.
    const produtosDaFilaNesteAnuncio = [...new Set<string>([
      ...elegiveis.map(v => v.produto_id!),
      ...(a.produto_id ? [a.produto_id as string] : []),
    ])].filter((id: string) => produtoIds.includes(id))

    // As linhas do que ficou de fora vão para o log com o motivo: "sem
    // produto vinculado" é acionável no Mapa de anúncios, e some se ninguém
    // a escrever.
    for (const ig of ignoradas) {
      linhas.push({
        empresa_id: cfg.empresa_id, rodada_em: rodadaEm, canal_id: a.canal_id,
        anuncio_id: a.id, variacao_id: ig.variacao.id, produto_id: null,
        acao: 'variacao_sem_produto', estoque_canal: ig.variacao.estoque,
        detalhe: ig.detalhe,
      })
    }

    if (elegiveis.length === 0) {
      // `com_variacao` e não `sem_anuncio`: o anúncio existe e está mapeado —
      // o que falta é vincular produto às variações dele. Chamar isso de "sem
      // anúncio" mandaria quem lê para o lugar errado.
      linhas.push({
        empresa_id: cfg.empresa_id, rodada_em: rodadaEm, canal_id: a.canal_id,
        anuncio_id: a.id, produto_id: a.produto_id ?? null, acao: 'com_variacao',
        detalhe: `${a.titulo ?? 'anúncio'} — com variação, e nenhuma variação tem produto vinculado. `
          + 'Mapeie as variações no Mapa de anúncios para a fila poder mandar estoque.',
      })
      continue
    }

    // Produtos das variações: podem não estar na rodada (uma variação do
    // mesmo anúncio cujo produto não se mexeu). Precisam vir assim mesmo —
    // o envio manda a lista inteira de modelos controlados, e omitir os
    // parados faria a plataforma ficar sem o número deles.
    const idsProdutoVariacao = [...new Set<string>(elegiveis.map(v => v.produto_id!))]
    const faltando = idsProdutoVariacao.filter(id => !mapaProduto.has(id))
    if (faltando.length > 0) {
      const { data: extras } = await sb
        .from('produtos')
        .select('id, nome, sku, estoque, preco_venda, preco_custo, tipo')
        .in('id', faltando)
      for (const p of (extras ?? []) as ProdutoFila[]) mapaProduto.set(p.id, p)
    }

    // Estoque unificado do grupo para os produtos que não vieram na conta da
    // rodada — mesma função, mesma configuração. Entra NO MESMO mapa: escolher
    // um dos dois deixaria metade das variações sem o número unificado.
    if (faltando.length > 0) {
      const extra = await estoqueUnificadoDeProdutos(sb, cfg.empresa_id, faltando, cfgUnif)
      if (extra && mapaUnificado) for (const [k, v] of extra) mapaUnificado.set(k, v)
    }

    let regraDoAnuncio: any = null
    if (a.regra_id) {
      if (!regrasUsadas.has(a.regra_id)) {
        const { data } = await sb.from('marketplace_regras_preco').select('*').eq('id', a.regra_id).maybeSingle()
        regrasUsadas.set(a.regra_id, data ?? null)
      }
      regraDoAnuncio = regrasUsadas.get(a.regra_id)
    }

    const alvos: AlvoCalculado[] = []
    const porVariacao = new Map<string, { estoqueSistema: number; origem: string; motivo: string; variacao: VariacaoDoAnuncio }>()

    for (const v of elegiveis) {
      const produtoDaVariacao = mapaProduto.get(v.produto_id!)
      if (!produtoDaVariacao) {
        linhas.push({
          empresa_id: cfg.empresa_id, rodada_em: rodadaEm, canal_id: a.canal_id,
          anuncio_id: a.id, variacao_id: v.id, produto_id: v.produto_id,
          acao: 'erro', detalhe: `${rotuloDaVariacao(v)}: produto vinculado não existe mais`,
        })
        continue
      }

      const base = await estoqueDoSistema(sb, produtoDaVariacao, mapaUnificado)
      let estoqueNovo: number | undefined = base.estoque
      let precoNovo: number | null = null
      let emRisco = false
      let detalheVar = base.origem

      if (regraDoAnuncio) {
        let estoquePorDeposito: number | undefined
        if (!base.kitInfo && regraDoAnuncio.modo_estoque === 'deposito' && regraDoAnuncio.deposito_id) {
          const { data: pe } = await sb.from('produto_estoque').select('quantidade')
            .eq('deposito_id', regraDoAnuncio.deposito_id).eq('produto_id', produtoDaVariacao.id).maybeSingle()
          estoquePorDeposito = pe?.quantidade ?? 0
        }

        // O PREÇO BASE É O DA VARIAÇÃO, não o do anúncio. Num anúncio com
        // variação, `marketplace_anuncios.preco_venda` é o preço de alguma
        // delas (ou o menor) — usar esse número no modo percentual faria
        // todas as variações convergirem para o preço de uma só.
        const r = calcularPrecoEstoquePorRegra(
          regraDoAnuncio,
          {
            preco_venda: v.preco ?? a.preco_venda,
            produtos: {
              id: produtoDaVariacao.id, preco_venda: produtoDaVariacao.preco_venda,
              preco_custo: produtoDaVariacao.preco_custo, estoque: base.estoque,
            },
          },
          { estoquePorDeposito, kitInfo: base.kitInfo },
        )

        if (r.aplicavel) {
          if (typeof r.estoqueNovo === 'number') estoqueNovo = r.estoqueNovo
          if (typeof r.precoNovo === 'number') precoNovo = r.precoNovo
          emRisco = !!r.paraPausar
          detalheVar = `regra aplicada${emRisco ? ' · variação no estoque de risco' : ''}`
        } else {
          estoqueNovo = undefined
          detalheVar = `regra não pôde ser aplicada: ${r.motivo}`
        }
      }

      // A variação tem UMA coluna de estoque (`estoque`), escrita pela
      // sincronização de catálogo com o que a plataforma devolveu. Não existe
      // o par espelho/medida que o anúncio simples tem, então `estoqueMedido`
      // vai nulo: inventar uma segunda fonte a partir da mesma coluna faria o
      // detector de divergência concordar consigo mesmo.
      const decisao = precisaEnviar({
        estoqueExterno: v.estoque,
        estoqueMedido: null,
        estoqueNovo,
        precoEspelho: v.preco,
        precoNovo,
      })

      alvos.push({
        variacaoId: v.id, modelId: v.model_id!, rotulo: rotuloDaVariacao(v),
        produtoId: v.produto_id!, estoqueNovo, precoNovo, emRisco, enviar: decisao.enviar,
      })
      porVariacao.set(v.id, {
        estoqueSistema: base.estoque, origem: base.origem,
        motivo: decisao.enviar ? detalheVar : decisao.motivo, variacao: v,
      })
    }

    const aEnviar = alvos.filter(x => x.enviar && (x.estoqueNovo !== undefined || x.precoNovo != null))

    if (aEnviar.length === 0) {
      semMudanca++
      for (const alvo of alvos) {
        const ctx = porVariacao.get(alvo.variacaoId)!
        linhas.push({
          empresa_id: cfg.empresa_id, rodada_em: rodadaEm, canal_id: a.canal_id,
          anuncio_id: a.id, variacao_id: alvo.variacaoId, produto_id: alvo.produtoId,
          acao: 'sem_mudanca', estoque_sistema: ctx.estoqueSistema,
          estoque_canal: ctx.variacao.estoque, estoque_enviaria: alvo.estoqueNovo,
          preco_canal: ctx.variacao.preco, preco_enviaria: alvo.precoNovo,
          detalhe: `${alvo.rotulo}: ${ctx.motivo}`,
        })
      }
      continue
    }

    enviaria += aEnviar.length

    const canalDoAnuncio = mapaCanal.get(a.canal_id)
    const sim = decidirSimulacao(canalDoAnuncio, { simulacaoDaEmpresa: cfg.simulacao })
    const pausaVar = decidirPausaComVariacoes(alvos)
    const decisaoPausa = decidirPausa({
      anuncio: a, paraPausar: pausaVar.pausar,
      estoqueEnviado: null, risco: regraDoAnuncio?.estoque_risco ?? null,
    })

    let acaoAnuncio = 'enviaria'
    let detalheAnuncio = `${resumoDosAlvos(alvos, ignoradas)} · ${pausaVar.porque}`
    let enviouOk = false

    if (!sim.simula) {
      const emPromocao = anunciosComPromocao.has(String(a.id))
      if (!canalDoAnuncio) {
        acaoAnuncio = 'erro'; detalheAnuncio = 'canal nao encontrado ou sem token'
        falhasEnvio++
        for (const id of produtosDaFilaNesteAnuncio) comFalha.set(id, detalheAnuncio)
      } else if (!canalAceitaEnvio(canalDoAnuncio)) {
        acaoAnuncio = 'canal_desligado'
        detalheAnuncio = 'canal nao aceita atualizacao automatica (Configurar → canal)'
        canalRecusou++
      } else if (!a.id_externo) {
        acaoAnuncio = 'erro'; detalheAnuncio = 'anuncio sem id no canal'
        falhasEnvio++
        for (const id of produtosDaFilaNesteAnuncio) comFalha.set(id, detalheAnuncio)
      } else if (a.status === 'encerrado') {
        acaoAnuncio = 'encerrado'
        detalheAnuncio = 'anuncio encerrado no canal — enviar estoque poderia reabri-lo'
      } else {
        const variacoesEnvio: AlvoVariacao[] = aEnviar.map(x => ({
          modelId: x.modelId,
          estoque: x.estoqueNovo ?? null,
          preco: emPromocao ? null : (x.precoNovo ?? null),
        }))

        const r = await enviarParaAnuncio(sb, canalDoAnuncio, String(a.id_externo), {
          variacoes: variacoesEnvio,
          pausar: decisaoPausa.acao === 'pausar',
          reativar: decisaoPausa.acao === 'reativar',
        })
        await sleep(THROTTLE_ENVIO_MS)

        if (r.ok) {
          acaoAnuncio = 'enviado'; enviados++; enviouOk = true
          detalheAnuncio = `${detalheAnuncio}`
            + (emPromocao ? ' · preco retido: item em campanha de desconto' : '')
            + (r.pausado ? ' · anuncio pausado (todas as variações em risco)' : '')
            + (r.reativado ? ' · anuncio reativado (estoque voltou)' : '')

          // O espelho de cada variação recebe o que acabou de ser mandado.
          // Sem isto, a rodada seguinte veria o número antigo e reenviaria o
          // mesmo estoque para sempre.
          for (const x of aEnviar) {
            await sb.from('marketplace_anuncio_variacoes').update({
              ...(x.estoqueNovo !== undefined ? { estoque: x.estoqueNovo } : {}),
              ...(x.precoNovo != null && !emPromocao ? { preco: x.precoNovo } : {}),
              updated_at: new Date().toISOString(),
            }).eq('id', x.variacaoId)
          }
          await sb.from('marketplace_anuncios').update({
            ...(decisaoPausa.acao === 'pausar' ? camposPausaAutomatica(decisaoPausa.motivo) : {}),
            ...(decisaoPausa.acao === 'reativar' ? camposReativacao() : {}),
          }).eq('id', a.id)
        } else {
          acaoAnuncio = 'erro'; falhasEnvio++
          detalheAnuncio = r.erro ?? 'falha ao enviar'
          for (const id of produtosDaFilaNesteAnuncio) comFalha.set(id, detalheAnuncio)
        }
      }
    }

    // Uma linha por variação, para o extrato dizer qual modelo recebeu o quê.
    for (const alvo of alvos) {
      const ctx = porVariacao.get(alvo.variacaoId)!
      const mandou = aEnviar.some(x => x.variacaoId === alvo.variacaoId)
      linhas.push({
        empresa_id: cfg.empresa_id, rodada_em: rodadaEm, canal_id: a.canal_id,
        anuncio_id: a.id, variacao_id: alvo.variacaoId, produto_id: alvo.produtoId,
        acao: mandou ? acaoAnuncio : 'sem_mudanca',
        estoque_sistema: ctx.estoqueSistema,
        estoque_canal: ctx.variacao.estoque,
        estoque_enviaria: alvo.estoqueNovo,
        preco_canal: ctx.variacao.preco,
        preco_enviaria: alvo.precoNovo,
        detalhe: mandou
          ? `${alvo.rotulo}: ${enviouOk || sim.simula ? ctx.motivo : detalheAnuncio}`
          : `${alvo.rotulo}: ${ctx.motivo}`,
      })
    }

    // E uma linha do anúncio, com o resumo — é ela que responde "o que
    // aconteceu com este anúncio nesta rodada".
    linhas.push({
      empresa_id: cfg.empresa_id, rodada_em: rodadaEm, canal_id: a.canal_id,
      anuncio_id: a.id, produto_id: a.produto_id ?? null, acao: acaoAnuncio,
      estoque_canal: a.estoque_externo,
      detalhe: `anúncio com variação · ${detalheAnuncio}`,
    })
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


/**
 * Põe na fila os produtos cujo ANÚNCIO mudou depois da última vez que a fila
 * olhou para eles.
 *
 * A COMPARAÇÃO É `anuncio.updated_at > fila.enviado_em`, e é ela que impede
 * o laço infinito: depois desta rodada, `enviado_em` fica mais novo que
 * `updated_at` e o produto não é adotado de novo. Adotar por "nunca enviado"
 * seria mais simples e readotaria para sempre um anúncio que a plataforma
 * recusa — passando por cima do limite de tentativas.
 *
 * O RECORTE de 2000 anúncios por rodada, pelos mais recentemente alterados,
 * existe porque isto roda a cada intervalo e a tabela tem ~9.300 linhas. O
 * atraso acumulado tem o botão "Reconciliar tudo", que é explícito e não
 * paga esse custo em toda rodada.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function adotarAnunciosAlterados(sb: any, cfg: ConfigFila) {
  const { data: canais } = await sb
    .from('marketplace_canais')
    .select('id, plataforma, sincronizar_estoque, atualizar_estoque_canal')
    .eq('empresa_id', cfg.empresa_id)
  const enviaveis = ((canais ?? []) as CanalComInterruptores[])
    .filter(c => canalAceitaEnvio(c))
    .map(c => (c as { id: string }).id)
  if (enviaveis.length === 0) return

  const { data: anuncios } = await sb
    .from('marketplace_anuncios')
    .select('produto_id, updated_at')
    .in('canal_id', enviaveis)
    .not('produto_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(2000)

  // E as VARIAÇÕES mapeadas, pelo mesmo motivo e com a mesma regra.
  //
  // Num anúncio com variação, quem carrega o produto é a variação. Mapear uma
  // variação é exatamente o caso da Pistola descrito acima — muda o que
  // deveria estar no canal sem tocar em estoque nenhum — e sem esta consulta
  // a fila só descobriria isso na próxima movimentação do produto, que pode
  // não vir nunca.
  const { data: variacoes } = await sb
    .from('marketplace_anuncio_variacoes')
    .select('produto_id, updated_at, marketplace_anuncios!inner(canal_id)')
    .in('marketplace_anuncios.canal_id', enviaveis)
    .not('produto_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(2000)

  type Recente = { produto_id: string; updated_at: string | null }
  const maisRecente = new Map<string, string>()
  for (const a of [...((anuncios ?? []) as Recente[]), ...((variacoes ?? []) as Recente[])]) {
    if (!a.updated_at) continue
    const atual = maisRecente.get(a.produto_id)
    if (!atual || a.updated_at > atual) maisRecente.set(a.produto_id, a.updated_at)
  }
  if (maisRecente.size === 0) return

  const ids = [...maisRecente.keys()]
  const { data: naFila } = await sb
    .from('marketplace_fila')
    .select('produto_id, enviado_em')
    .eq('empresa_id', cfg.empresa_id)
    .in('produto_id', ids)

  type NaFila = { produto_id: string; enviado_em: string | null }
  const ultimoOlhar = new Map<string, string | null>(
    ((naFila ?? []) as NaFila[]).map(f => [f.produto_id, f.enviado_em]))

  const adotar: string[] = []
  for (const [produtoId, alteradoEm] of maisRecente) {
    // O TETO É CHECADO NO TOPO. Checar no fim deixava o caminho do `continue`
    // passar por cima dele, e a primeira rodada de uma conta nova adotaria
    // todos os anúncios de uma vez em vez de drenar por rodada.
    if (adotar.length >= cfg.max_produtos_rodada) break

    const visto = ultimoOlhar.get(produtoId)
    if (!ultimoOlhar.has(produtoId)) {
      // Nunca esteve na fila: o anúncio existe e ninguém nunca pediu nada.
      adotar.push(produtoId)
    } else if (visto && alteradoEm > visto) {
      // `enviado_em` nulo = já está pendente, não precisa ser adotado.
      adotar.push(produtoId)
    }
  }
  if (adotar.length === 0) return

  const agora = new Date().toISOString()
  await sb.from('marketplace_fila').upsert(
    adotar.map(produto_id => ({
      empresa_id: cfg.empresa_id,
      produto_id,
      sujo_em: agora,
      motivo: 'anúncio mapeado ou alterado',
      prioridade: 0,
      enviado_em: null,
      tentativas: 0,
    })),
    { onConflict: 'empresa_id,produto_id' },
  )
}
