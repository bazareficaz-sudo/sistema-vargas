// Os VIGIAS do Getúlio: cada um olha uma parte do negócio e devolve os
// sinais que achou. Sem IA — consultas e contas exatas.
//
// Sinal AGRUPADO (ex.: "16 pedidos atrasados") leva uma `assinatura` em
// `dados`: enquanto ela não muda, o Getúlio não repete o aviso; entrou item
// novo no grupo, a assinatura muda e o aviso volta (ver varredura.ts).

import { diaISO } from '@/lib/datas'
import {
  agruparVaiFaltar, assinar, avaliarEstoqueParado, avaliarVaiFaltar, avaliarVendasCanal, fmtMoeda, normalizarErro, traduzirMotivos,
  type LinhaGiro, type LinhaVendasCanal,
} from './regras'
import type { Sinal, VigiaId } from './tipos'

type Ctx = { sb: any; empresaId: string; agora: Date }

export { assinar }

const lista = (nomes: string[], max = 4) =>
  nomes.slice(0, max).join('; ') + (nomes.length > max ? ` e mais ${nomes.length - max}` : '')

// ── Integrações ─────────────────────────────────────────────────────────
// Canal recusando a MAIORIA das atualizações da fila (app suspenso, conta
// caída) e canal sem sincronizar há mais de 36h. Erro de UM anúncio (em
// revisão no ML, por exemplo) não é integração caída — por isso a regra
// pede ≥3 anúncios diferentes e ≥50% dos envios do canal.
async function integracoes({ sb, empresaId, agora }: Ctx): Promise<Sinal[]> {
  const desde = new Date(agora.getTime() - 24 * 3_600_000).toISOString()
  const { data: canais } = await sb.from('marketplace_canais')
    .select('id, nome, plataforma, access_token').eq('empresa_id', empresaId)
  const nomeCanal = new Map<string, string>((canais ?? []).map((c: any) => [c.id, c.nome]))

  const { data: linhas } = await sb.from('marketplace_fila_simulacao')
    .select('canal_id, anuncio_id, acao, detalhe')
    .eq('empresa_id', empresaId).gte('rodada_em', desde).in('acao', ['erro', 'enviado'])
    .limit(5000)
  const porCanal = new Map<string, { enviados: number; erros: Map<string, Set<string>> }>()
  for (const l of linhas ?? []) {
    const c = porCanal.get(l.canal_id) ?? { enviados: 0, erros: new Map() }
    if (l.acao === 'enviado') c.enviados++
    else {
      const motivo = normalizarErro(l.detalhe)
      const set = c.erros.get(motivo) ?? new Set<string>()
      set.add(String(l.anuncio_id ?? Math.random()))
      c.erros.set(motivo, set)
    }
    porCanal.set(l.canal_id, c)
  }

  const sinais: Sinal[] = []
  for (const [canalId, c] of porCanal) {
    const totalErros = [...c.erros.values()].reduce((s, x) => s + x.size, 0)
    for (const [motivo, anuncios] of c.erros) {
      if (anuncios.size < 3 || anuncios.size / (totalErros + c.enviados) < 0.5) continue
      const nome = nomeCanal.get(canalId) ?? 'Canal'
      sinais.push({
        vigia: 'integracoes', chave: `integracao:recusa:${canalId}:${assinar([motivo])}`, gravidade: 'urgente',
        titulo: `${nome} está recusando as atualizações de estoque e preço`,
        detalhe: `${anuncios.size} anúncio(s) recusados nas últimas 24h com o mesmo motivo: "${motivo}". Nada atualiza nesse canal até isso ser resolvido.`,
        valor: null, link: `/dashboard/marketplaces/${canalId}`,
        dados: { motivo, anuncios: anuncios.size },
      })
    }
  }

  // Canal parado: a varredura de anúncios não passa há mais de 36h.
  for (const c of canais ?? []) {
    if (!c.access_token || c.plataforma === 'loja_online') continue
    const { data: ultimo } = await sb.from('marketplace_anuncios')
      .select('sincronizado_em').eq('canal_id', c.id).not('sincronizado_em', 'is', null)
      .order('sincronizado_em', { ascending: false }).limit(1).maybeSingle()
    if (!ultimo?.sincronizado_em) continue
    const horas = (agora.getTime() - new Date(ultimo.sincronizado_em).getTime()) / 3_600_000
    if (horas < 36) continue
    sinais.push({
      vigia: 'integracoes', chave: `integracao:sem_sync:${c.id}`, gravidade: 'atencao',
      titulo: `${c.nome} está sem sincronizar há ${Math.floor(horas / 24)} dia(s)`,
      detalhe: 'Os anúncios desse canal não são lidos desde então — status, estoque e preço na tela podem estar desatualizados. Pode ser a conexão com o canal.',
      valor: null, link: `/dashboard/marketplaces/${c.id}`,
    })
  }
  return sinais
}

// ── Anúncios reprovados ou travados ─────────────────────────────────────
// Só com produto vinculado e com estoque: é venda perdida. Medido em
// 07/10/2026: 1.293 anúncios do ML "em revisão", só 101 com estoque.
const STATUS_BLOQUEADO: Record<string, string> = {
  FAILED: 'reprovado', FREEZE: 'congelado', PLATFORM_DEACTIVATED: 'desativado pela plataforma',
  BANNED: 'banido', under_review: 'em revisão', inactive: 'inativo',
}

async function anunciosBloqueados({ sb, empresaId }: Ctx): Promise<Sinal[]> {
  const { data } = await sb.from('marketplace_anuncios')
    .select('id, titulo, status_externo, canal_id, dados_brutos, marketplace_canais!inner(nome, plataforma, empresa_id), produtos!inner(nome, estoque, preco_custo)')
    .eq('marketplace_canais.empresa_id', empresaId)
    .in('status_externo', Object.keys(STATUS_BLOQUEADO))
    .gt('produtos.estoque', 0)
    .limit(2000)

  const sinais: Sinal[] = []
  const agrupado = new Map<string, any[]>()
  for (const a of data ?? []) {
    const canal = a.marketplace_canais
    // TikTok: poucos e cada um com motivo próprio — um aviso por anúncio.
    if (canal.plataforma === 'tiktok') {
      const motivos: string[] = (a.dados_brutos?.audit_failed_reasons ?? []).flatMap((m: any) => m?.reasons ?? [])
      const motivo = motivos.length ? traduzirMotivos(motivos) : null
      sinais.push({
        vigia: 'anuncios_bloqueados', chave: `anuncio:bloqueado:${a.id}:${a.status_externo}`, gravidade: 'atencao',
        titulo: `${canal.nome}: anúncio ${STATUS_BLOQUEADO[a.status_externo]} — ${a.titulo}`,
        detalhe: `${motivo ? `Motivo: ${motivo}. ` : ''}O produto tem ${Number(a.produtos.estoque)} un. em estoque e não está vendendo nesse canal.`,
        valor: Math.round(Number(a.produtos.estoque) * Number(a.produtos.preco_custo ?? 0)),
        link: `/dashboard/marketplaces/${a.canal_id}/anuncios`,
        dados: { anuncioId: a.id, motivo },
      })
      continue
    }
    const k = `${a.canal_id}|${a.status_externo}`
    agrupado.set(k, [...(agrupado.get(k) ?? []), a])
  }
  for (const [k, anuncios] of agrupado) {
    const [canalId, status] = k.split('|')
    const valor = anuncios.reduce((s, a) => s + Number(a.produtos.estoque) * Number(a.produtos.preco_custo ?? 0), 0)
    const maiores = [...anuncios].sort((x, y) =>
      Number(y.produtos.estoque) * Number(y.produtos.preco_custo ?? 0) - Number(x.produtos.estoque) * Number(x.produtos.preco_custo ?? 0))
    sinais.push({
      vigia: 'anuncios_bloqueados', chave: `anuncio:bloqueados:${canalId}:${status}`, gravidade: 'atencao',
      titulo: `${anuncios[0].marketplace_canais.nome}: ${anuncios.length} anúncio(s) ${STATUS_BLOQUEADO[status]} com estoque parado`,
      detalhe: `${fmtMoeda(valor)} em estoque desses produtos sem vender nesse canal. Os maiores: ${lista(maiores.map(a => a.titulo))}.`,
      valor: Math.round(valor), link: `/dashboard/marketplaces/${canalId}/anuncios`,
      dados: { quantidade: anuncios.length, assinatura: assinar(anuncios.map(a => a.id)) },
    })
  }
  return sinais
}

// ── Zerado ainda à venda ────────────────────────────────────────────────
// Só o que a fila JÁ tentou resolver (não está pendente): o normal é ela
// mandar o zero em minutos, e avisar disso seria ruído.
//
// E só o que a REGRA quer zerado. Medido em 07/10/2026: 16 dos 33 casos eram
// da Shp Ouro, cuja regra manda estoque mesmo com o sistema zerado — escolha
// do dono, não defeito. A última decisão da fila para o anúncio diz qual é a
// intenção (`estoque_enviaria`).
async function zeradoAVenda({ sb, empresaId }: Ctx): Promise<Sinal[]> {
  const { data } = await sb.from('marketplace_anuncios')
    .select('id, titulo, estoque_externo, produto_id, marketplace_canais!inner(nome, empresa_id), produtos!inner(estoque)')
    .eq('marketplace_canais.empresa_id', empresaId)
    .eq('status', 'ativo').eq('tem_variacao', false)
    .gt('estoque_externo', 0).lte('produtos.estoque', 0)
    .limit(500)
  const candidatos = data ?? []
  if (candidatos.length === 0) return []
  const { data: pendentes } = await sb.from('marketplace_fila')
    .select('produto_id').eq('empresa_id', empresaId).is('enviado_em', null)
    .in('produto_id', [...new Set(candidatos.map((a: any) => a.produto_id))])
  const naFila = new Set((pendentes ?? []).map((p: any) => p.produto_id))
  const foraDaFila = candidatos.filter((a: any) => !naFila.has(a.produto_id))
  if (foraDaFila.length === 0) return []

  const { data: decisoes } = await sb.from('marketplace_fila_simulacao')
    .select('anuncio_id, estoque_enviaria, rodada_em')
    .in('anuncio_id', foraDaFila.map((a: any) => a.id))
    .order('rodada_em', { ascending: false }).limit(2000)
  const intencao = new Map<string, number | null>()
  for (const d of decisoes ?? []) {
    if (!intencao.has(d.anuncio_id)) intencao.set(d.anuncio_id, d.estoque_enviaria == null ? null : Number(d.estoque_enviaria))
  }
  const presos = foraDaFila.filter((a: any) => !(Number(intencao.get(a.id) ?? 0) > 0))
  if (presos.length === 0) return []

  const porCanal = new Map<string, number>()
  for (const a of presos) porCanal.set(a.marketplace_canais.nome, (porCanal.get(a.marketplace_canais.nome) ?? 0) + 1)
  return [{
    vigia: 'zerado_a_venda', chave: 'zerado:a_venda', gravidade: 'urgente',
    titulo: `${presos.length} anúncio(s) à venda de produto com estoque zero`,
    detalhe: `Risco de vender o que não tem — a atualização não está chegando ao canal. `
      + `Por canal: ${[...porCanal].map(([c, n]) => `${c} (${n})`).join(', ')}. `
      + `Ex.: ${lista(presos.map((a: any) => `${a.titulo} (${a.estoque_externo} un. no canal)`), 3)}.`,
    valor: null, link: '/dashboard/marketplaces/fila',
    dados: { quantidade: presos.length, assinatura: assinar(presos.map((a: any) => a.id)) },
  }]
}

// ── Pedidos atrasados ───────────────────────────────────────────────────
async function pedidosAtrasados({ sb, empresaId, agora }: Ctx): Promise<Sinal[]> {
  const { data } = await sb.from('marketplace_pedidos')
    .select('id, numero_pedido, numero_interno, cliente_nome, prazo_postagem, valor_total, marketplace_canais(nome)')
    .eq('empresa_id', empresaId).in('status', ['novo', 'confirmado'])
    .lt('prazo_postagem', agora.toISOString())
    .gt('prazo_postagem', new Date(agora.getTime() - 15 * 86_400_000).toISOString())
    .order('prazo_postagem', { ascending: true }).limit(200)
  const atrasados = data ?? []
  if (atrasados.length === 0) return []
  const valor = atrasados.reduce((s: number, p: any) => s + Number(p.valor_total ?? 0), 0)
  return [{
    vigia: 'pedidos_atrasados', chave: 'pedidos:atrasados', gravidade: 'urgente',
    titulo: `${atrasados.length} pedido(s) com prazo de postagem vencido`,
    detalhe: `Atraso pesa na reputação do canal. ${lista(atrasados.map((p: any) => `${p.marketplace_canais?.nome ?? ''} ${p.numero_interno ? `PV-${String(p.numero_interno).padStart(6, '0')}` : p.numero_pedido} (${p.cliente_nome ?? 'cliente'})`))}.`,
    valor: Math.round(valor), link: '/dashboard/pedidos-ecommerce',
    dados: { quantidade: atrasados.length, assinatura: assinar(atrasados.map((p: any) => p.id)) },
  }]
}

// ── Vendas por canal ────────────────────────────────────────────────────
async function vendasCanal({ sb, empresaId, agora }: Ctx): Promise<Sinal[]> {
  const { data, error } = await sb.rpc('getulio_vendas_canais', { p_empresa: empresaId, p_agora: agora.toISOString() })
  if (error) throw new Error(error.message)
  return ((data ?? []) as LinhaVendasCanal[])
    .map(avaliarVendasCanal)
    .filter((s): s is Sinal => !!s)
    // A variação em faixas de 15 pontos: piorar de -35% para -55% avisa de
    // novo; oscilar entre -33% e -36% não.
    .map(s => ({ ...s, dados: { ...s.dados, assinatura: String(Math.round(Number(s.dados?.variacao ?? 0) * 100 / 15)) } }))
}

// ── Giro: vai faltar e dinheiro parado ──────────────────────────────────
async function lerGiro({ sb, empresaId, agora }: Ctx): Promise<LinhaGiro[]> {
  const { data, error } = await sb.rpc('getulio_giro_produtos', { p_empresa: empresaId, p_agora: agora.toISOString() })
  if (error) throw new Error(error.message)
  return (data ?? []) as LinhaGiro[]
}

// ── Estoque negativo ────────────────────────────────────────────────────
async function estoqueNegativo({ sb, empresaId }: Ctx): Promise<Sinal[]> {
  const { data } = await sb.from('produtos')
    .select('id, nome, estoque').eq('empresa_id', empresaId).eq('ativo', true).lt('estoque', 0)
    .order('estoque', { ascending: true }).limit(200)
  const negativos = data ?? []
  if (negativos.length === 0) return []
  return [{
    vigia: 'estoque_negativo', chave: 'estoque:negativo', gravidade: 'atencao',
    titulo: `${negativos.length} produto(s) com estoque negativo`,
    detalhe: `Venda sem entrada lançada ou contagem errada — e o canal recebe zero. ${lista(negativos.map((p: any) => `${p.nome} (${Number(p.estoque)})`))}.`,
    valor: null, link: '/dashboard/produtos?estoque=sem',
    // Por faixa: com centenas de produtos, a lista muda todo dia e o aviso
    // viraria diário. Avisa de novo quando a quantidade muda de faixa.
    dados: { quantidade: negativos.length, assinatura: String(Math.floor(negativos.length / 20)) },
  }]
}

// ── Financeiro ──────────────────────────────────────────────────────────
async function financeiro({ sb, empresaId, agora }: Ctx): Promise<Sinal[]> {
  const hoje = diaISO(agora)
  const em7 = diaISO(new Date(agora.getTime() + 7 * 86_400_000))
  const sinais: Sinal[] = []

  const { data: pagar } = await sb.from('contas_pagar')
    .select('id, descricao, valor, vencimento, data_vencimento, status')
    .eq('empresa_id', empresaId).in('status', ['pendente', 'vencido']).limit(1000)
  const comVenc = (pagar ?? []).map((c: any) => ({ ...c, venc: String(c.data_vencimento ?? c.vencimento ?? '') })).filter((c: any) => c.venc)
  const vencidas = comVenc.filter((c: any) => c.venc < hoje)
  const semana = comVenc.filter((c: any) => c.venc >= hoje && c.venc <= em7)
  const soma = (l: any[]) => l.reduce((s, c) => s + Number(c.valor ?? 0), 0)

  if (vencidas.length) {
    sinais.push({
      vigia: 'financeiro', chave: 'financeiro:pagar_vencidas', gravidade: 'urgente',
      titulo: `${vencidas.length} conta(s) a pagar vencida(s): ${fmtMoeda(soma(vencidas))}`,
      detalhe: `Juros e multa correndo. ${lista(vencidas.map((c: any) => `${c.descricao ?? 'conta'} (${fmtMoeda(Number(c.valor))})`))}.`,
      valor: Math.round(soma(vencidas)), link: '/dashboard/contas-pagar',
      dados: { quantidade: vencidas.length, assinatura: assinar(vencidas.map((c: any) => c.id)) },
    })
  }
  if (semana.length) {
    sinais.push({
      vigia: 'financeiro', chave: 'financeiro:pagar_semana', gravidade: 'info',
      titulo: `Contas dos próximos 7 dias: ${fmtMoeda(soma(semana))}`,
      detalhe: `${semana.length} conta(s). ${lista(semana.sort((a: any, b: any) => a.venc.localeCompare(b.venc)).map((c: any) => `${c.venc.slice(8, 10)}/${c.venc.slice(5, 7)} ${c.descricao ?? 'conta'} (${fmtMoeda(Number(c.valor))})`))}.`,
      valor: Math.round(soma(semana)), link: '/dashboard/contas-pagar',
      dados: { quantidade: semana.length, assinatura: assinar(semana.map((c: any) => c.id)) },
    })
  }

  const { data: receber } = await sb.from('contas_receber')
    .select('id, cliente_nome, valor_aberto, data_vencimento, status')
    .eq('empresa_id', empresaId).in('status', ['vencido', 'aberto', 'parcial']).lt('data_vencimento', hoje).limit(1000)
  const atrasados = (receber ?? []).filter((c: any) => Number(c.valor_aberto ?? 0) > 0)
  if (atrasados.length) {
    const total = atrasados.reduce((s: number, c: any) => s + Number(c.valor_aberto ?? 0), 0)
    sinais.push({
      vigia: 'financeiro', chave: 'financeiro:receber_vencidas', gravidade: 'atencao',
      titulo: `${fmtMoeda(total)} a receber em atraso (${atrasados.length} parcela(s))`,
      detalhe: `Clientes: ${lista([...new Set(atrasados.map((c: any) => c.cliente_nome ?? 'cliente'))] as string[])}.`,
      valor: Math.round(total), link: '/dashboard/contas-receber',
      // Por faixa de R$ 500: cada parcela nova vencida não justifica um aviso.
      dados: { quantidade: atrasados.length, assinatura: String(Math.floor(total / 500)) },
    })
  }
  return sinais
}

/**
 * Roda os vigias ligados. Um vigia que falha não derruba os outros — o erro
 * volta junto para a Central mostrar.
 */
export async function rodarVigias(
  sb: any, empresaId: string, desligados: string[], agora = new Date(),
): Promise<{ sinais: Sinal[]; erros: { vigia: VigiaId; erro: string }[]; rodados: VigiaId[] }> {
  const ctx: Ctx = { sb, empresaId, agora }
  const ligado = (v: VigiaId) => !desligados.includes(v)
  const sinais: Sinal[] = []
  const erros: { vigia: VigiaId; erro: string }[] = []
  const rodados: VigiaId[] = []

  const simples: [VigiaId, (c: Ctx) => Promise<Sinal[]>][] = [
    ['integracoes', integracoes],
    ['anuncios_bloqueados', anunciosBloqueados],
    ['zerado_a_venda', zeradoAVenda],
    ['pedidos_atrasados', pedidosAtrasados],
    ['vendas_canal', vendasCanal],
    ['estoque_negativo', estoqueNegativo],
    ['financeiro', financeiro],
  ]
  for (const [id, fn] of simples) {
    if (!ligado(id)) continue
    try { sinais.push(...await fn(ctx)); rodados.push(id) }
    catch (e: any) { erros.push({ vigia: id, erro: e?.message ?? String(e) }) }
  }

  // Os dois vigias de giro dividem a mesma leitura.
  if (ligado('vai_faltar') || ligado('estoque_parado')) {
    try {
      const giro = await lerGiro(ctx)
      if (ligado('vai_faltar')) {
        const faltando = agruparVaiFaltar(giro.map(avaliarVaiFaltar).filter((s): s is Sinal => !!s))
        if (faltando) sinais.push(faltando)
        rodados.push('vai_faltar')
      }
      if (ligado('estoque_parado')) {
        const parado = avaliarEstoqueParado(giro, agora)
        if (parado) {
          // Avisa de novo só quando o total muda de faixa (R$ 5 mil).
          parado.dados = { ...parado.dados, assinatura: String(Math.floor(Number(parado.valor ?? 0) / 5000)) }
          sinais.push(parado)
        }
        rodados.push('estoque_parado')
      }
    } catch (e: any) {
      if (ligado('vai_faltar')) erros.push({ vigia: 'vai_faltar', erro: e?.message ?? String(e) })
      if (ligado('estoque_parado')) erros.push({ vigia: 'estoque_parado', erro: e?.message ?? String(e) })
    }
  }

  return { sinais, erros, rodados }
}
