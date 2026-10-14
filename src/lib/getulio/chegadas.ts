// BOLETIM "CHEGOU NA LOJA" — monta a partir da nota e entrega no grupo.
//
// Duas portas de entrada, um caminho só:
//   · a tela que finaliza a nota (manual ou XML) chama a rota de disparo
//     assim que termina — é o "logo após cada nota"; a remessa recebida de
//     outra empresa do grupo (transferência) dispara pela própria rota de
//     transferência, para a empresa que RECEBEU;
//   · o cron do Getúlio (a cada 15 min) procura nota recente sem boletim —
//     rede de segurança para a nota lançada por outro caminho ou para o
//     disparo que não chegou (aba fechada no meio).
// A UNIQUE de getulio_chegadas faz o resto: quem gravar primeiro envia; o
// outro vê que já existe e para.
//
// Fonte dos dados: estoque_movimentacoes da nota (é o que as duas telas de
// entrada gravam, com referencia_tipo/referencia_id da nota). Na
// transferência cada item tem a sua linha em transferencias_estoque; o que
// junta a remessa é o lote_id, e é ele que o boletim usa como referência.

import { enviarWhatsappAutomacao } from '@/lib/automacoes/whatsapp-send'
import { promocaoVigente } from '@/lib/produtos/promocao'
import {
  classificar, contarBoletim, estoqueAntesDaNota, montarAlertaSemPreco, montarTextoChegada, quantidadeDaNota,
  TIPOS_CHEGADA, type BoletimChegada, type ItemChegada, type MovNota,
} from './chegadasRegras'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = any

export type ConfigChegadas = {
  empresa_id: string
  ativo: boolean
  grupo_id: string | null
  grupo_nome: string | null
  incluir_reposicao: boolean
  avisar_sem_preco: boolean
  ativado_em: string | null
}

/** Notas de entrada — o que a tela da nota pode pedir pela rota de disparo. */
export const REFERENCIAS_NOTA = ['entrada', 'entrada_xml'] as const
/** 'transferencia' = remessa recebida de outra empresa do grupo (referência: lote_id). */
export type ReferenciaNota = typeof REFERENCIAS_NOTA[number] | 'transferencia'

const LOTE = 150
/** A nota é dada como terminada quando o último movimento dela tem esta idade (rede de segurança). */
const NOTA_TERMINADA_MS = 10 * 60_000
/** O cron não olha nota mais velha que isto — nem reenvia boletim que falhou depois disto. */
const JANELA_CRON_MS = 48 * 3_600_000
const MAX_TENTATIVAS = 3

export function configPadrao(empresaId: string): ConfigChegadas {
  return { empresa_id: empresaId, ativo: false, grupo_id: null, grupo_nome: null, incluir_reposicao: true, avisar_sem_preco: true, ativado_em: null }
}

export async function lerConfigChegadas(sb: Sb, empresaId: string): Promise<ConfigChegadas> {
  const { data } = await sb.from('getulio_chegadas_config').select('*').eq('empresa_id', empresaId).maybeSingle()
  return data ? { ...configPadrao(empresaId), ...data } : configPadrao(empresaId)
}

async function cabecalhoDaNota(sb: Sb, empresaId: string, tipo: ReferenciaNota, id: string) {
  if (tipo === 'transferencia') {
    const { data } = await sb.from('transferencias_estoque').select('empresa_id')
      .eq('lote_id', id).eq('empresa_destino_id', empresaId).limit(1).maybeSingle()
    let origem: string | null = null
    if (data?.empresa_id) {
      const { data: e } = await sb.from('empresas').select('nome, nome_fantasia, razao_social').eq('id', data.empresa_id).maybeSingle()
      origem = e?.nome_fantasia || e?.nome || e?.razao_social || null
    }
    return { rotulo: 'Transferência', fornecedor: origem ? `de ${origem}` : null }
  }
  if (tipo === 'entrada_xml') {
    const { data } = await sb.from('nfe_entradas').select('numero, serie, nome_fornecedor')
      .eq('empresa_id', empresaId).eq('id', id).maybeSingle()
    return {
      rotulo: data?.numero ? `NF ${data.numero}${data.serie ? '-' + data.serie : ''}` : null,
      fornecedor: data?.nome_fornecedor ?? null,
    }
  }
  const { data } = await sb.from('entradas').select('numero_nf, numero_entrada, fornecedor_id')
    .eq('empresa_id', empresaId).eq('id', id).maybeSingle()
  let fornecedor: string | null = null
  if (data?.fornecedor_id) {
    const { data: f } = await sb.from('fornecedores').select('nome_fantasia, razao_social').eq('id', data.fornecedor_id).maybeSingle()
    fornecedor = f?.nome_fantasia || f?.razao_social || null
  }
  return { rotulo: data?.numero_nf ? `NF ${data.numero_nf}` : data?.numero_entrada ?? null, fornecedor }
}

const COLS_MOV = 'produto_id, deposito_id, tipo, quantidade, estoque_anterior, estoque_novo, created_at'

async function movimentosDaChegada(sb: Sb, empresaId: string, tipo: ReferenciaNota, id: string): Promise<any[]> {
  if (tipo !== 'transferencia') {
    const { data } = await sb.from('estoque_movimentacoes').select(COLS_MOV)
      .eq('empresa_id', empresaId).eq('referencia_tipo', tipo).eq('referencia_id', id)
      .in('tipo', ['entrada_compra', 'entrada_nfe', 'ajuste_entrada', 'ajuste_saida'])
      .limit(5000)
    return data ?? []
  }
  // Remessa: os itens do lote que vieram de OUTRA empresa para esta. Entre
  // depósitos da mesma empresa nada chegou na loja — só mudou de lugar.
  const { data: linhas } = await sb.from('transferencias_estoque').select('id, empresa_id')
    .eq('lote_id', id).eq('empresa_destino_id', empresaId).limit(5000)
  const ids = (linhas ?? []).filter((l: any) => l.empresa_id !== empresaId).map((l: any) => l.id as string)
  const out: any[] = []
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data } = await sb.from('estoque_movimentacoes').select(COLS_MOV)
      .eq('empresa_id', empresaId).eq('referencia_tipo', 'transferencia').eq('tipo', 'transferencia_entrada')
      .in('referencia_id', ids.slice(i, i + LOTE))
    out.push(...(data ?? []))
  }
  return out
}

/** Monta o boletim de uma nota (ou remessa). `null` quando não chegou mercadoria. */
export async function montarBoletim(sb: Sb, empresaId: string, tipo: ReferenciaNota, id: string, agora = new Date()): Promise<BoletimChegada | null> {
  const movs = await movimentosDaChegada(sb, empresaId, tipo, id)
  const porProduto = new Map<string, (MovNota & { deposito_id: string | null })[]>()
  for (const m of (movs ?? []) as any[]) {
    if (!m.produto_id) continue
    porProduto.set(m.produto_id, [...(porProduto.get(m.produto_id) ?? []), m])
  }
  // Só produto que teve ENTRADA nesta nota (o ajuste sozinho é o "zerar antes").
  const ids = [...porProduto.entries()].filter(([, ms]) => quantidadeDaNota(ms) > 0).map(([pid]) => pid)
  if (ids.length === 0) return null
  const inicioNota = [...(movs ?? [])].map((m: any) => m.created_at as string).sort()[0]

  const produtos = new Map<string, any>()
  const comEntradaAntes = new Set<string>()
  const local = new Map<string, string>()
  const faltasPor = new Map<string, { total: number; clientes: number }>()
  // Faltas que esta nota mexeu: o trigger da entrada marca chegou_em (com
  // cliente) ou resolve (sem cliente) no mesmo instante — dá folga de 2 min.
  const desdeFaltas = new Date(new Date(inicioNota).getTime() - 2 * 60_000).toISOString()

  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = ids.slice(i, i + LOTE)
    const [{ data: ps }, { data: antes }, { data: enderecos }, { data: faltas }] = await Promise.all([
      sb.from('produtos')
        .select('id, nome, sku, unidade, estoque, preco_venda, preco_promocional, promocao_ativa, promocao_inicio, promocao_fim, created_at, tipo, ativo')
        .in('id', lote),
      sb.from('estoque_movimentacoes').select('produto_id')
        .eq('empresa_id', empresaId).in('produto_id', lote)
        .in('tipo', TIPOS_CHEGADA)
        .lt('created_at', inicioNota).limit(5000),
      sb.from('produto_estoque').select('produto_id, deposito_id, localizacao')
        .eq('empresa_id', empresaId).in('produto_id', lote).not('localizacao', 'is', null),
      sb.from('faltas').select('produto_id, status, cliente_nome, cliente_telefone, chegou_em, resolvido_em, resolvido_por')
        .eq('empresa_id', empresaId).in('produto_id', lote)
        .or(`chegou_em.gte.${desdeFaltas},resolvido_em.gte.${desdeFaltas}`),
    ])
    for (const p of ps ?? []) produtos.set(p.id, p)
    for (const a of antes ?? []) comEntradaAntes.add(a.produto_id)
    for (const e of (enderecos ?? []) as any[]) {
      const depNota = porProduto.get(e.produto_id)?.find(m => m.deposito_id)?.deposito_id
      // O endereço do depósito em que a nota entrou; sem ele, qualquer um.
      if (String(e.localizacao).trim() && (!local.has(e.produto_id) || e.deposito_id === depNota)) {
        local.set(e.produto_id, String(e.localizacao).trim())
      }
    }
    for (const f of (faltas ?? []) as any[]) {
      const atendidaPelaNota = f.status === 'recebido' || /^Automático — (entrada|produto voltou)/.test(String(f.resolvido_por ?? ''))
      if (!atendidaPelaNota) continue
      const atual = faltasPor.get(f.produto_id) ?? { total: 0, clientes: 0 }
      atual.total++
      if (f.status === 'recebido' && (String(f.cliente_nome ?? '').trim() || String(f.cliente_telefone ?? '').replace(/\D/g, '').length >= 8)) atual.clientes++
      faltasPor.set(f.produto_id, atual)
    }
  }

  const itens: ItemChegada[] = []
  for (const pid of ids) {
    const p = produtos.get(pid)
    // Kit não entra por nota; produto desativado não é para vender.
    if (!p || p.tipo === 'kit' || p.ativo === false) continue
    const ms = porProduto.get(pid)!
    const faltas = faltasPor.get(pid) ?? { total: 0, clientes: 0 }
    const preco = Number(p.preco_venda ?? 0)
    itens.push({
      produtoId: pid,
      nome: String(p.nome ?? '').trim(),
      sku: p.sku ?? null,
      quantidade: quantidadeDaNota(ms),
      estoque: Number(p.estoque ?? 0),
      unidade: String(p.unidade || 'UN'),
      preco,
      promo: promocaoVigente(p, agora) ? Number(p.preco_promocional) : null,
      localizacao: local.get(pid) ?? null,
      classe: classificar({ antes: estoqueAntesDaNota(ms), teveEntradaAntes: comEntradaAntes.has(pid), criadoEm: p.created_at, faltas: faltas.total, agora }),
      faltas: faltas.total,
      clientesEsperando: faltas.clientes,
      semPreco: !(preco > 0),
    })
  }
  itens.sort((a, b) => b.clientesEsperando - a.clientesEsperando || a.nome.localeCompare(b.nome, 'pt-BR'))

  return { ...(await cabecalhoDaNota(sb, empresaId, tipo, id)), itens }
}

async function avisarDonoSemPreco(sb: Sb, empresaId: string, texto: string, boletimId: string) {
  const { data: cfg } = await sb.from('getulio_config').select('destinatarios').eq('empresa_id', empresaId).maybeSingle()
  let numeros: string[] = ((cfg?.destinatarios ?? []) as { numero?: string }[]).map(d => String(d.numero ?? '')).filter(n => n.length >= 10)
  if (numeros.length === 0) {
    const { data: wpp } = await sb.from('whatsapp_config').select('numero_gestor').eq('empresa_id', empresaId).maybeSingle()
    if (wpp?.numero_gestor) numeros = [String(wpp.numero_gestor)]
  }
  for (const n of numeros) {
    await enviarWhatsappAutomacao(sb, empresaId, n, texto, { tipo: 'getulio_chegada_sem_preco', referencia_tipo: 'getulio_chegada', referencia_id: boletimId })
  }
}

export type ResultadoChegada = { ok: boolean; status: string; jaExistia?: boolean; erro?: string; boletimId?: string }

/**
 * Monta, grava e entrega o boletim de uma nota. Idempotente: a segunda
 * chamada para a mesma nota não faz nada.
 */
export async function processarChegada(sb: Sb, cfg: ConfigChegadas, tipo: ReferenciaNota, id: string): Promise<ResultadoChegada> {
  if (!cfg.ativo) return { ok: false, status: 'desligado' }

  // Reserva a nota ANTES de montar e enviar: é a reserva que impede a tela e
  // o cron de mandarem o mesmo boletim duas vezes.
  const { data: reserva, error: erroReserva } = await sb.from('getulio_chegadas')
    .insert({ empresa_id: cfg.empresa_id, referencia_tipo: tipo, referencia_id: id, status: 'enviando' })
    .select('id').single()
  if (erroReserva) {
    if (erroReserva.code === '23505') return { ok: true, status: 'ja_existia', jaExistia: true }
    return { ok: false, status: 'erro', erro: erroReserva.message }
  }
  const boletimId = reserva.id as string

  try {
    const boletim = await montarBoletim(sb, cfg.empresa_id, tipo, id)
    if (!boletim || boletim.itens.length === 0) {
      await sb.from('getulio_chegadas').update({ status: 'sem_novidade' }).eq('id', boletimId)
      return { ok: true, status: 'sem_novidade', boletimId }
    }
    const texto = montarTextoChegada(boletim, { incluirReposicao: cfg.incluir_reposicao })
    const base = {
      rotulo: boletim.rotulo, fornecedor: boletim.fornecedor, itens: boletim.itens, texto,
      ...contarBoletim(boletim),
    }

    if (cfg.avisar_sem_preco) {
      const alerta = montarAlertaSemPreco(boletim)
      if (alerta) await avisarDonoSemPreco(sb, cfg.empresa_id, alerta, boletimId)
    }

    if (!texto) {
      await sb.from('getulio_chegadas').update({ ...base, status: 'sem_novidade' }).eq('id', boletimId)
      return { ok: true, status: 'sem_novidade', boletimId }
    }
    if (!cfg.grupo_id) {
      await sb.from('getulio_chegadas').update({ ...base, status: 'sem_grupo' }).eq('id', boletimId)
      return { ok: true, status: 'sem_grupo', boletimId }
    }
    return await entregar(sb, cfg, boletimId, texto, base, 0)
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    await sb.from('getulio_chegadas').update({ status: 'erro', erro, tentativas: 1 }).eq('id', boletimId)
    return { ok: false, status: 'erro', erro, boletimId }
  }
}

async function entregar(sb: Sb, cfg: ConfigChegadas, boletimId: string, texto: string, extra: Record<string, unknown>, tentativasAntes: number): Promise<ResultadoChegada> {
  const r = await enviarWhatsappAutomacao(sb, cfg.empresa_id, cfg.grupo_id!, texto, {
    tipo: 'getulio_chegada', referencia_tipo: 'getulio_chegada', referencia_id: boletimId,
  })
  await sb.from('getulio_chegadas').update({
    ...extra,
    status: r.ok ? 'enviado' : 'erro',
    erro: r.ok ? null : r.erro ?? 'Falha no envio',
    tentativas: tentativasAntes + 1,
    enviado_em: r.ok ? new Date().toISOString() : null,
  }).eq('id', boletimId)
  return r.ok ? { ok: true, status: 'enviado', boletimId } : { ok: false, status: 'erro', erro: r.erro, boletimId }
}

/** Reenvia um boletim já montado (botão na Central e nova tentativa do cron). */
export async function reenviarChegada(sb: Sb, cfg: ConfigChegadas, boletimId: string): Promise<ResultadoChegada> {
  if (!cfg.grupo_id) return { ok: false, status: 'sem_grupo', erro: 'Escolha o grupo dos vendedores primeiro' }
  const { data: b } = await sb.from('getulio_chegadas').select('id, texto, tentativas')
    .eq('empresa_id', cfg.empresa_id).eq('id', boletimId).maybeSingle()
  if (!b?.texto) return { ok: false, status: 'sem_texto', erro: 'Este boletim não tem mensagem para enviar' }
  return entregar(sb, cfg, b.id, b.texto, {}, Number(b.tentativas ?? 0))
}

/**
 * Rede de segurança do cron: notas recentes ainda sem boletim (e já
 * terminadas), e boletins que falharam e ainda têm tentativa.
 */
export async function processarPendentes(sb: Sb, cfg: ConfigChegadas, agora = new Date()) {
  if (!cfg.ativo || !cfg.ativado_em) return { processados: 0, reenviados: 0 }
  const desde = new Date(Math.max(new Date(cfg.ativado_em).getTime(), agora.getTime() - JANELA_CRON_MS)).toISOString()

  const { data: movs } = await sb.from('estoque_movimentacoes')
    .select('referencia_tipo, referencia_id, created_at')
    .eq('empresa_id', cfg.empresa_id).in('tipo', ['entrada_compra', 'entrada_nfe'])
    .in('referencia_tipo', [...REFERENCIAS_NOTA]).not('referencia_id', 'is', null)
    .gte('created_at', desde).limit(5000)
  const ultimo = new Map<string, { tipo: ReferenciaNota; id: string; em: string }>()
  for (const m of (movs ?? []) as any[]) {
    const chave = `${m.referencia_tipo}:${m.referencia_id}`
    const atual = ultimo.get(chave)
    if (!atual || m.created_at > atual.em) ultimo.set(chave, { tipo: m.referencia_tipo, id: m.referencia_id, em: m.created_at })
  }
  const prontas = [...ultimo.values()].filter(n => agora.getTime() - new Date(n.em).getTime() >= NOTA_TERMINADA_MS)

  let processados = 0
  if (prontas.length > 0) {
    const { data: feitos } = await sb.from('getulio_chegadas').select('referencia_tipo, referencia_id')
      .eq('empresa_id', cfg.empresa_id).in('referencia_id', prontas.map(n => n.id))
    const ja = new Set((feitos ?? []).map((f: any) => `${f.referencia_tipo}:${f.referencia_id}`))
    for (const n of prontas) {
      if (ja.has(`${n.tipo}:${n.id}`)) continue
      await processarChegada(sb, cfg, n.tipo, n.id)
      processados++
    }
  }

  // Remessas recebidas de outra empresa do grupo. A rota de transferência
  // já dispara na hora; aqui é a rede de segurança.
  const { data: transfs } = await sb.from('transferencias_estoque')
    .select('lote_id, empresa_id, created_at')
    .eq('empresa_destino_id', cfg.empresa_id).not('lote_id', 'is', null)
    .gte('created_at', desde).limit(5000)
  const lotes = new Map<string, string>()
  for (const t of (transfs ?? []) as any[]) {
    if (t.empresa_id === cfg.empresa_id) continue
    if (!lotes.has(t.lote_id) || t.created_at > lotes.get(t.lote_id)!) lotes.set(t.lote_id, t.created_at)
  }
  const lotesProntos = [...lotes.entries()]
    .filter(([, em]) => agora.getTime() - new Date(em).getTime() >= NOTA_TERMINADA_MS).map(([lote]) => lote)
  if (lotesProntos.length > 0) {
    const { data: feitos } = await sb.from('getulio_chegadas').select('referencia_id')
      .eq('empresa_id', cfg.empresa_id).eq('referencia_tipo', 'transferencia').in('referencia_id', lotesProntos)
    const ja = new Set((feitos ?? []).map((f: any) => f.referencia_id))
    for (const lote of lotesProntos) {
      if (ja.has(lote)) continue
      await processarChegada(sb, cfg, 'transferencia', lote)
      processados++
    }
  }

  let reenviados = 0
  if (cfg.grupo_id) {
    const { data: falhos } = await sb.from('getulio_chegadas').select('id')
      .eq('empresa_id', cfg.empresa_id).eq('status', 'erro').lt('tentativas', MAX_TENTATIVAS)
      .not('texto', 'is', null).gte('created_at', desde).limit(10)
    for (const f of falhos ?? []) {
      await reenviarChegada(sb, cfg, f.id)
      reenviados++
    }
  }
  return { processados, reenviados }
}
