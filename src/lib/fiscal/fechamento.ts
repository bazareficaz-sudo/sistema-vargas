// Fechamento do contador: os XMLs das notas de VENDA e de COMPRA de um mês,
// num .zip organizado, mais uma planilha resumo.
//
// O pacote é por CNPJ — é assim que o contador escritura. E o CNPJ que vale
// é o que está DENTRO do XML (<emit><CNPJ> na venda), não a empresa em que a
// venda foi lançada: uma empresa pode vender pelo balcão e emitir a NFC-e no
// CNPJ de outra do grupo (empresa_config_fiscal.empresa_fiscal_id). Medido no
// dia em que esta tela nasceu: todas as NFC-e das vendas da Bazar Eficaz saem
// no CNPJ da Ouro e Prata. Filtrar pela empresa da venda mandaria ao contador
// da Eficaz 700 notas que não são dela, e ao da Ouro e Prata, nenhuma.
//
// O que entra:
//   Vendas/NFC-e  — vendas.nfce_xml_url (o XML vem guardado inline, data URI)
//   Vendas/NF-e   — marketplace_pedidos.nfe_emissao.xmlUrl (só produção)
//   Compras/NF-e  — nfe_entradas.xml_content (notas importadas por XML)
// Nota de homologação (tpAmb=2) nunca entra: não tem valor fiscal.

/* eslint-disable @typescript-eslint/no-explicit-any -- cliente Supabase sem tipos gerados, como no resto de lib/ */

import { buscarTudo } from '@/lib/supabase/paginar'
import type { ArquivoZip } from '@/lib/zip/zip'

export type MesCompetencia = { mes: string; inicio: string; fim: string; rotulo: string }

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "2026-09" → intervalo do mês no horário de Brasília (o mês fiscal da loja). */
export function periodoDoMes(mes: string): MesCompetencia | null {
  const m = /^(\d{4})-(\d{2})$/.exec(mes.trim())
  if (!m) return null
  const ano = Number(m[1]), num = Number(m[2])
  if (num < 1 || num > 12 || ano < 2000 || ano > 2100) return null
  const prox = num === 12 ? `${ano + 1}-01` : `${ano}-${String(num + 1).padStart(2, '0')}`
  return {
    mes: `${m[1]}-${m[2]}`,
    inicio: `${m[1]}-${m[2]}-01T00:00:00-03:00`,
    fim: `${prox}-01T00:00:00-03:00`,
    rotulo: `${MESES[num - 1]} de ${ano}`,
  }
}

/** Mês anterior ao da data informada — o que se fecha normalmente. */
export function mesAnterior(hoje: Date = new Date()): string {
  const d = new Date(hoje.getTime() - 3 * 3600_000) // Brasília
  const ano = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear()
  const mes = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth()
  return `${ano}-${String(mes).padStart(2, '0')}`
}

/** XML guardado como data URI (base64 ou texto) ou já como texto puro. null se não for XML. */
export function xmlDoCampo(valor: string | null | undefined): string | null {
  if (!valor) return null
  const v = valor.trim()
  if (v.startsWith('<')) return v
  const m = /^data:[^,]*?(;base64)?,([\s\S]*)$/.exec(v)
  if (!m) return null
  try {
    const texto = m[1] ? Buffer.from(m[2], 'base64').toString('utf8') : decodeURIComponent(m[2])
    return texto.trimStart().startsWith('<') ? texto : null
  } catch { return null }
}

export type DadosXml = {
  chave: string | null; modelo: string | null; numero: string | null; serie: string | null
  emissao: string | null; valor: number | null; cnpjEmitente: string | null; ambiente: string | null
  nomeEmitente: string | null
}

const tag = (xml: string, nome: string, dentroDe?: string): string | null => {
  const base = dentroDe ? (new RegExp(`<${dentroDe}[\\s>][\\s\\S]*?</${dentroDe}>`).exec(xml)?.[0] ?? '') : xml
  return new RegExp(`<${nome}>([^<]*)</${nome}>`).exec(base)?.[1]?.trim() ?? null
}

/** Os campos que o resumo precisa, lidos do próprio XML da nota. */
export function lerXmlNota(xml: string): DadosXml {
  const chaveId = /<infNFe[^>]*\sId="NFe(\d{44})"/.exec(xml)?.[1] ?? null
  const valor = tag(xml, 'vNF', 'ICMSTot')
  return {
    chave: tag(xml, 'chNFe') ?? chaveId,
    modelo: tag(xml, 'mod', 'ide'),
    numero: tag(xml, 'nNF', 'ide'),
    serie: tag(xml, 'serie', 'ide'),
    emissao: tag(xml, 'dhEmi', 'ide') ?? tag(xml, 'dEmi', 'ide'),
    valor: valor != null && Number.isFinite(Number(valor)) ? Number(valor) : null,
    cnpjEmitente: tag(xml, 'CNPJ', 'emit') ?? tag(xml, 'CPF', 'emit'),
    ambiente: tag(xml, 'tpAmb', 'ide'),
    nomeEmitente: tag(xml, 'xNome', 'emit'),
  }
}

export type LinhaResumo = {
  grupo: 'Venda NFC-e' | 'Venda NF-e' | 'Compra NF-e'
  numero: string; serie: string; chave: string; emissao: string; valor: number
  contraparte: string; origem: string
}

export type Pendencia = { tipo: string; quantidade: number; detalhe: string; exemplos?: string[] }

export type Fechamento = {
  empresa: { id: string; nome: string; cnpj: string }
  periodo: MesCompetencia
  vendasNfce: { quantidade: number; valor: number }
  vendasNfe: { quantidade: number; valor: number }
  compras: { quantidade: number; valor: number }
  pendencias: Pendencia[]
  linhas: LinhaResumo[]
  arquivos: ArquivoZip[]
}

const soDigitos = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '')
const dataBr = (iso: string | null) => {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}
const nomeArquivo = (chave: string | null, reserva: string) => `${chave && chave.length === 44 ? chave : reserva}-nfe.xml`

/** Planilha do resumo: ";" e vírgula decimal, com BOM — abre certo no Excel em português. */
export function montarCsv(linhas: LinhaResumo[]): string {
  const esc = (s: string) => /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  const cab = ['Tipo', 'Número', 'Série', 'Emissão', 'Valor', 'Chave de acesso', 'Cliente/Fornecedor', 'Origem']
  const corpo = linhas.map(l => [
    l.grupo, l.numero, l.serie, dataBr(l.emissao), l.valor.toFixed(2).replace('.', ','),
    // Chave entre aspas com "=" para o Excel não virar 3,32E+43.
    l.chave ? `="${l.chave}"` : '', l.contraparte, l.origem,
  ].map(c => esc(String(c))).join(';'))
  return '﻿' + [cab.join(';'), ...corpo].join('\r\n') + '\r\n'
}

export type Partes = { vendas: boolean; compras: boolean }

/**
 * Monta o fechamento. `sb` precisa enxergar as empresas do grupo (a rota
 * passa o cliente de serviço DEPOIS de validar o acesso do usuário à empresa).
 * `comXml=false` monta só o resumo, sem guardar os XMLs na memória.
 */
export async function montarFechamento(sb: any, empresaId: string, mes: string, opcoes: {
  partes?: Partes; comXml?: boolean
  /** Empresas que o usuário acessa — as vendas só são procuradas nelas. */
  empresasPermitidas?: string[]
} = {}): Promise<Fechamento> {
  const periodo = periodoDoMes(mes)
  if (!periodo) throw new Error('Mês inválido — use AAAA-MM')
  const partes = opcoes.partes ?? { vendas: true, compras: true }
  const comXml = opcoes.comXml !== false

  const { data: emp, error: erroEmp } = await sb.from('empresas')
    .select('id, nome_fantasia, razao_social, cnpj').eq('id', empresaId).maybeSingle()
  if (erroEmp || !emp) throw new Error('Empresa não encontrada')
  const cnpj = soDigitos(emp.cnpj)
  const empresa = { id: emp.id, nome: emp.nome_fantasia ?? emp.razao_social ?? '', cnpj }

  const linhas: LinhaResumo[] = []
  const arquivos: ArquivoZip[] = []
  const pendencias: Pendencia[] = []
  const vendasNfce = { quantidade: 0, valor: 0 }
  const vendasNfe = { quantidade: 0, valor: 0 }
  const compras = { quantidade: 0, valor: 0 }

  if (partes.vendas) {
    // Empresas cujas NFC-e podem sair neste CNPJ: ela mesma e as que a
    // apontam como emitente. O CNPJ do XML decide no fim.
    const { data: cfg } = await sb.from('empresa_config_fiscal')
      .select('empresa_id').eq('empresa_fiscal_id', empresaId)
    const permitidas = opcoes.empresasPermitidas ? new Set([empresaId, ...opcoes.empresasPermitidas]) : null
    const empresasVenda = Array.from(new Set([empresaId, ...((cfg ?? []) as any[]).map(c => c.empresa_id)]))
      .filter(id => !permitidas || permitidas.has(id))

    const vendas = await buscarTudo<any>((de, ate) => sb.from('vendas')
      .select('id, empresa_id, numero, total, cliente_nome, created_at, nfce_xml_url, nfce_chave, nfce_numero, nfce_serie')
      .in('empresa_id', empresasVenda).eq('nfce_status', 'autorizada')
      .gte('created_at', periodo.inicio).lt('created_at', periodo.fim)
      .order('id').range(de, ate), { tamanhoPagina: 200, rotulo: 'fechamento/nfce' })

    let semXml = 0, homolog = 0
    const semXmlEx: string[] = []
    for (const v of vendas) {
      const xml = xmlDoCampo(v.nfce_xml_url)
      if (!xml) {
        // Sem XML guardado não dá para saber o CNPJ: só conta se a venda é
        // desta empresa, para não alarmar sobre nota de outro CNPJ.
        if (v.empresa_id === empresaId) { semXml++; if (semXmlEx.length < 5) semXmlEx.push(`venda #${v.numero ?? v.id.slice(0, 8)}`) }
        continue
      }
      const d = lerXmlNota(xml)
      if (soDigitos(d.cnpjEmitente) !== cnpj) continue
      if (d.ambiente === '2') { homolog++; continue }
      const valor = d.valor ?? Number(v.total ?? 0)
      vendasNfce.quantidade++; vendasNfce.valor += valor
      const chave = d.chave ?? v.nfce_chave ?? null
      linhas.push({
        grupo: 'Venda NFC-e', numero: d.numero ?? String(v.nfce_numero ?? ''), serie: d.serie ?? String(v.nfce_serie ?? ''),
        chave: chave ?? '', emissao: d.emissao ?? v.created_at, valor,
        contraparte: v.cliente_nome ?? 'Consumidor', origem: `Venda #${v.numero ?? v.id.slice(0, 8)}`,
      })
      if (comXml) arquivos.push({ nome: `Vendas/NFC-e/${nomeArquivo(chave, `nfce-${d.numero ?? v.id}`)}`, conteudo: xml, data: d.emissao ? new Date(d.emissao) : undefined })
    }
    if (semXml > 0) pendencias.push({ tipo: 'NFC-e sem XML guardado', quantidade: semXml, detalhe: 'Autorizadas, mas o XML não ficou salvo no sistema. Baixe pelo painel do emissor.', exemplos: semXmlEx })
    if (homolog > 0) pendencias.push({ tipo: 'NFC-e de homologação (teste)', quantidade: homolog, detalhe: 'Emitidas em ambiente de teste, sem valor fiscal — ficaram fora do pacote.' })

    // Venda sem nota válida: o contador precisa saber que existiu movimento
    // sem documento, e a loja precisa reemitir.
    const { count: semNota } = await sb.from('vendas').select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId).in('nfce_status', ['erro', 'rejeitada'])
      .gte('created_at', periodo.inicio).lt('created_at', periodo.fim)
    if ((semNota ?? 0) > 0) pendencias.push({ tipo: 'Vendas com NFC-e rejeitada ou com erro', quantidade: semNota ?? 0, detalhe: 'Vendas do mês sem nota autorizada. Reemita pelo PDV ou pela tela de Vendas antes de enviar.' })

    // NF-e emitida pelo sistema nos pedidos de marketplace.
    // Só o XML e o ambiente do JSON da emissão — ele guarda também o PDF da
    // DANFE, que não interessa aqui e dobraria o tráfego. O pedido é anterior
    // à nota: pedido criado até 40 dias antes do mês ainda pode ter a nota
    // emitida dentro dele.
    const pedidos = await buscarTudo<any>((de, ate) => sb.from('marketplace_pedidos')
      .select('id, cliente_nome, valor_total, xml:nfe_emissao->>xmlUrl, ambiente:nfe_emissao->>ambiente')
      .in('empresa_id', empresasVenda).eq('nfe_status', 'autorizada')
      .gte('created_at', new Date(new Date(periodo.inicio).getTime() - 40 * 86400_000).toISOString())
      .lt('created_at', periodo.fim)
      .order('id').range(de, ate), { tamanhoPagina: 100, rotulo: 'fechamento/nfe-pedidos' })
    let homologNfe = 0
    for (const p of pedidos) {
      if (p.ambiente && p.ambiente !== 'producao') { homologNfe++; continue }
      const xml = xmlDoCampo(p.xml)
      if (!xml) continue
      const d = lerXmlNota(xml)
      if (soDigitos(d.cnpjEmitente) !== cnpj) continue
      if (d.ambiente === '2') { homologNfe++; continue }
      // Competência pela data de emissão da nota, não do pedido.
      const emissao = d.emissao ? new Date(d.emissao).getTime() : NaN
      if (!(emissao >= new Date(periodo.inicio).getTime() && emissao < new Date(periodo.fim).getTime())) continue
      const valor = d.valor ?? Number(p.valor_total ?? 0)
      vendasNfe.quantidade++; vendasNfe.valor += valor
      linhas.push({
        grupo: 'Venda NF-e', numero: d.numero ?? '', serie: d.serie ?? '', chave: d.chave ?? '',
        emissao: d.emissao, valor, contraparte: p.cliente_nome ?? '', origem: 'Pedido de marketplace',
      } as LinhaResumo)
      if (comXml) arquivos.push({ nome: `Vendas/NF-e/${nomeArquivo(d.chave, `nfe-${d.numero ?? p.id}`)}`, conteudo: xml, data: new Date(emissao) })
    }
    if (homologNfe > 0) pendencias.push({ tipo: 'NF-e de homologação (teste)', quantidade: homologNfe, detalhe: 'Notas de teste dos pedidos de marketplace — ficaram fora do pacote.' })
  }

  if (partes.compras) {
    const [ini, fim] = [periodo.inicio.slice(0, 10), periodo.fim.slice(0, 10)]
    const notas = await buscarTudo<any>((de, ate) => sb.from('nfe_entradas')
      .select('id, numero, serie, chave_acesso, data_emissao, valor_total, nome_fornecedor, status, xml_content')
      .eq('empresa_id', empresaId).gte('data_emissao', ini).lt('data_emissao', fim)
      .order('id').range(de, ate), { tamanhoPagina: 100, rotulo: 'fechamento/compras' })

    let semXml = 0, naoLancadas = 0
    const semXmlEx: string[] = [], naoLancEx: string[] = []
    for (const n of notas) {
      if (n.status === 'cancelada' || n.status === 'ignorada') continue
      const xml = xmlDoCampo(n.xml_content)
      const rotulo = `NF ${n.numero ?? '—'} · ${n.nome_fornecedor ?? ''}`.trim()
      if (!xml) { semXml++; if (semXmlEx.length < 5) semXmlEx.push(rotulo); continue }
      if (n.status !== 'finalizada') { naoLancadas++; if (naoLancEx.length < 5) naoLancEx.push(rotulo) }
      const d = lerXmlNota(xml)
      const valor = d.valor ?? Number(n.valor_total ?? 0)
      compras.quantidade++; compras.valor += valor
      const chave = d.chave ?? n.chave_acesso ?? null
      linhas.push({
        grupo: 'Compra NF-e', numero: d.numero ?? String(n.numero ?? ''), serie: d.serie ?? String(n.serie ?? ''),
        chave: chave ?? '', emissao: d.emissao ?? n.data_emissao, valor,
        contraparte: d.nomeEmitente ?? n.nome_fornecedor ?? '', origem: n.status === 'finalizada' ? 'Lançada no estoque' : 'Ainda não lançada',
      })
      if (comXml) arquivos.push({ nome: `Compras/NF-e/${nomeArquivo(chave, `compra-${n.numero ?? n.id}`)}`, conteudo: xml, data: d.emissao ? new Date(d.emissao) : undefined })
    }
    if (semXml > 0) pendencias.push({ tipo: 'Notas de compra sem XML', quantidade: semXml, detalhe: 'Encontradas na SEFAZ, mas o XML completo ainda não foi baixado. Abra em Entradas XML e baixe o XML.', exemplos: semXmlEx })
    if (naoLancadas > 0) pendencias.push({ tipo: 'Compras ainda não lançadas no estoque', quantidade: naoLancadas, detalhe: 'O XML vai no pacote, mas a entrada não foi finalizada no sistema.', exemplos: naoLancEx })

    const { count: manuais } = await sb.from('entradas').select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId).eq('status', 'confirmada').gte('data_emissao', ini).lt('data_emissao', fim)
    if ((manuais ?? 0) > 0) pendencias.push({ tipo: 'Entradas manuais (sem XML)', quantidade: manuais ?? 0, detalhe: 'Lançadas à mão: o sistema não tem o XML delas. Se tiverem nota, peça o XML ao fornecedor ou importe pela SEFAZ.' })
  }

  const ordem = { 'Venda NFC-e': 0, 'Venda NF-e': 1, 'Compra NF-e': 2 }
  linhas.sort((a, b) => ordem[a.grupo] - ordem[b.grupo] || String(a.emissao).localeCompare(String(b.emissao)))
  vendasNfce.valor = Math.round(vendasNfce.valor * 100) / 100
  vendasNfe.valor = Math.round(vendasNfe.valor * 100) / 100
  compras.valor = Math.round(compras.valor * 100) / 100

  return { empresa, periodo, vendasNfce, vendasNfe, compras, pendencias, linhas, arquivos }
}

/** Nome do .zip: Fechamento_2026-09_43103402000124.zip */
export function nomeDoZip(f: Pick<Fechamento, 'empresa' | 'periodo'>, partes: Partes): string {
  const sufixo = partes.vendas && partes.compras ? '' : partes.vendas ? '_vendas' : '_compras'
  return `Fechamento_${f.periodo.mes}_${f.empresa.cnpj || 'empresa'}${sufixo}.zip`
}
