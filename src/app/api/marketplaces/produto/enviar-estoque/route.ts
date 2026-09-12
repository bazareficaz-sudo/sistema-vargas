import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { estoqueDoSistema } from '@/lib/marketplace/estoqueDoSistema'
import { buscarConfigUnificacao, estoqueUnificadoDeProdutos } from '@/lib/produtos/estoqueUnificado'
import { enviarParaAnuncio, canalAceitaEnvio, sleep, THROTTLE_ENVIO_MS, type CanalEnvio } from '@/lib/marketplace/envio'
import { ehCanalMarketplace } from '@/lib/marketplace/canais'

// Envio manual do estoque do sistema para todos os anúncios de UM produto.
//
// A fila (`fila.ts`) faz isso sozinha a cada 5 minutos para quem teve
// movimentação. Este botão existe para quem não quer esperar — conferir uma
// correção de estoque na hora, sem depender do relógio — e por isso ele calcula
// pelo MESMO `estoqueDoSistema` que a fila usa. Dois caminhos com contas
// diferentes mandariam números diferentes para o mesmo anúncio, e quem visse a
// divergência não teria como saber qual dos dois estava certo.
//
// PREÇO NÃO VAI. O botão diz "estoque" e manda estoque. O mesmo produto tem
// preços diferentes por canal (medido na tela: R$ 20,90, R$ 22,01 e R$ 24,90
// para o mesmo item em três anúncios) — levar o preço do sistema de carona
// sobrescreveria essa diferença sem ninguém ter pedido.
export const maxDuration = 120

type Resultado = {
  anuncioId: string
  titulo: string
  canalNome: string
  situacao: 'enviado' | 'sem_mudanca' | 'ignorado' | 'erro'
  detalhe: string
}

export async function POST(req: Request) {
  const { produtoId } = await req.json()
  if (!produtoId) return NextResponse.json({ ok: false, erro: 'produtoId ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: produto } = await sb
    .from('produtos')
    .select('id, nome, estoque, tipo')
    .eq('id', produtoId).eq('empresa_id', empresaId).maybeSingle()

  if (!produto) return NextResponse.json({ ok: false, erro: 'Produto não encontrado nesta empresa' }, { status: 404 })

  const { data: anuncios, error: erroAnuncios } = await sb
    .from('marketplace_anuncios')
    .select('id, canal_id, id_externo, titulo, tem_variacao, status, estoque_externo, marketplace_canais(nome)')
    .eq('empresa_id', empresaId)
    .eq('produto_id', produtoId)

  if (erroAnuncios) return NextResponse.json({ ok: false, erro: erroAnuncios.message }, { status: 400 })

  // ANÚNCIO COM VARIAÇÃO ENTRA PELA VARIAÇÃO.
  //
  // Num anúncio com variação, o produto do ERP mora em cada
  // `marketplace_anuncio_variacoes.produto_id` — buscar só por
  // `marketplace_anuncios.produto_id` deixa de fora justamente os anúncios em
  // que este produto é uma das variações.
  const { data: variacoesDoProduto } = await sb
    .from('marketplace_anuncio_variacoes')
    .select('id, anuncio_id, model_id, nome_variacao, sku_variacao, preco, estoque')
    .eq('empresa_id', empresaId)
    .eq('produto_id', produtoId)

  const porAnuncio = new Map<string, any[]>()
  for (const v of (variacoesDoProduto ?? []) as any[]) {
    const lista = porAnuncio.get(v.anuncio_id) ?? []
    lista.push(v)
    porAnuncio.set(v.anuncio_id, lista)
  }

  const listaAnuncios: any[] = [...(anuncios ?? [])]
  const jaTem = new Set<string>(listaAnuncios.map(a => a.id))
  const faltantes = [...porAnuncio.keys()].filter(id => !jaTem.has(id))
  if (faltantes.length > 0) {
    const { data: extras } = await sb
      .from('marketplace_anuncios')
      .select('id, canal_id, id_externo, titulo, tem_variacao, status, estoque_externo, marketplace_canais(nome)')
      .eq('empresa_id', empresaId)
      .in('id', faltantes)
    listaAnuncios.push(...(extras ?? []))
  }

  if (!listaAnuncios.length) {
    return NextResponse.json({ ok: false, erro: 'Nenhum anúncio vinculado a este produto.' }, { status: 400 })
  }

  const cfgUnif = await buscarConfigUnificacao(sb, empresaId)
  const mapaUnificado = await estoqueUnificadoDeProdutos(sb, empresaId, [produtoId], cfgUnif)
  const { estoque, origem } = await estoqueDoSistema(sb, produto, mapaUnificado)

  const { data: canaisRows } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em, atualizar_estoque_canal, sincronizar_estoque, nome')
    .eq('empresa_id', empresaId)
  const mapaCanal = new Map<string, CanalEnvio & { nome: string }>(
    (canaisRows ?? []).map((c: any) => [c.id, c]))

  const resultados: Resultado[] = []
  let enviados = 0

  for (const a of listaAnuncios) {
    const canal = a.canal_id ? mapaCanal.get(a.canal_id) : undefined
    const canalNome = canal?.nome
      ?? (Array.isArray(a.marketplace_canais) ? a.marketplace_canais[0]?.nome : a.marketplace_canais?.nome)
      ?? '—'
    const linha = { anuncioId: a.id, titulo: a.titulo ?? '—', canalNome }

    const variacoesDesteProduto = porAnuncio.get(a.id) ?? []

    if (a.tem_variacao && variacoesDesteProduto.length === 0) {
      // O anúncio tem variação e NENHUMA delas é deste produto. Mandar o
      // número no nível do item achataria a distribuição inteira — que é o
      // que esta exclusão sempre evitou. O que mudou é que agora ela só vale
      // quando realmente não há variação mapeada para cá.
      resultados.push({
        ...linha, situacao: 'ignorado',
        detalhe: 'anúncio com variação e nenhuma variação vinculada a este produto — '
          + 'mapeie a variação no Mapa de anúncios',
      })
      continue
    }
    if (a.status === 'encerrado') {
      // Mandar quantidade para um anúncio encerrado não é atualizar: no
      // Mercado Livre, gravar `available_quantity` num item fechado pode
      // recolocá-lo à venda. Um botão de estoque não pode ter como efeito
      // colateral republicar o que alguém encerrou de propósito.
      resultados.push({ ...linha, situacao: 'ignorado', detalhe: 'anúncio encerrado — enviar estoque poderia reabri-lo' })
      continue
    }
    if (!canal || !canal.access_token) {
      resultados.push({ ...linha, situacao: 'erro', detalhe: 'canal sem conexão — refaça a autenticação em Configurar' })
      continue
    }
    if (!ehCanalMarketplace(canal.plataforma)) {
      // A Loja Online lê o estoque do ERP ao renderizar: não há para onde enviar.
      resultados.push({ ...linha, situacao: 'ignorado', detalhe: `${canal.plataforma} não recebe envio de estoque` })
      continue
    }
    if (!a.id_externo) {
      resultados.push({ ...linha, situacao: 'erro', detalhe: 'anúncio sem ID no canal — nunca foi sincronizado' })
      continue
    }
    const comVariacao = variacoesDesteProduto.length > 0

    // O espelho a comparar é o da VARIAÇÃO quando é por variação. O do
    // anúncio é a soma (ou o de alguma delas) e nunca bateria com o estoque
    // de um produto só — o botão reenviaria o mesmo número para sempre.
    const jaIgual = comVariacao
      ? variacoesDesteProduto.every(v => Number(v.estoque ?? -1) === estoque)
      : Number(a.estoque_externo ?? -1) === estoque

    if (jaIgual) {
      resultados.push({
        ...linha, situacao: 'sem_mudanca',
        detalhe: comVariacao
          ? `${variacoesDesteProduto.length} variação(ões) já com ${estoque}`
          : `o canal já está com ${estoque}`,
      })
      continue
    }

    const r = await enviarParaAnuncio(sb, canal, String(a.id_externo), comVariacao
      ? { variacoes: variacoesDesteProduto.map(v => ({ modelId: String(v.model_id), estoque })) }
      : { estoque })
    await sleep(THROTTLE_ENVIO_MS)

    if (r.ok) {
      enviados++
      if (comVariacao) {
        // Só as variações DESTE produto — as outras não receberam número
        // nenhum e o espelho delas não pode dizer que receberam.
        for (const v of variacoesDesteProduto) {
          await sb.from('marketplace_anuncio_variacoes')
            .update({ estoque, updated_at: new Date().toISOString() })
            .eq('id', v.id)
        }
        await sb.from('marketplace_anuncios')
          .update({ ultima_atualizacao: new Date().toISOString() })
          .eq('id', a.id)
      } else {
        await sb.from('marketplace_anuncios')
          .update({ estoque_externo: estoque, ultima_atualizacao: new Date().toISOString() })
          .eq('id', a.id)
      }
      // O interruptor de Configurar → canal governa a fila AUTOMÁTICA. Aqui
      // alguém clicou: o pedido explícito vale mais que o padrão. Mas o
      // envio diz que o automático está desligado, senão o operador conclui
      // que a partir de agora aquele canal se atualiza sozinho — e não se.
      const automatico = canalAceitaEnvio(canal)
      resultados.push({
        ...linha, situacao: 'enviado',
        detalhe: (comVariacao
          ? `${variacoesDesteProduto.length} variação(ões) → ${estoque}: `
            + variacoesDesteProduto.map(v => v.nome_variacao || v.sku_variacao || `modelo ${v.model_id}`).join(', ')
          : `${a.estoque_externo ?? '—'} → ${estoque}`)
          + (automatico ? '' : ' · atenção: atualização automática deste canal está desligada'),
      })
    } else {
      resultados.push({ ...linha, situacao: 'erro', detalhe: r.erro ?? 'o canal recusou' })
    }
  }

  await sb.from('marketplace_sync_log').insert({
    canal_id: listaAnuncios[0]?.canal_id ?? null,
    tipo: 'push_estoque_manual',
    status: resultados.some(r => r.situacao === 'erro') ? 'erro' : 'ok',
    mensagem: `${produto.nome}: estoque ${estoque} (${origem}) — ${enviados} anúncio(s) atualizado(s) de ${listaAnuncios.length}`,
    detalhes: { produtoId, estoque, origem, resultados },
  })

  return NextResponse.json({ ok: true, estoque, origem, enviados, resultados })
}
