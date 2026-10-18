// Envia o fechamento do mês ao contador, por e-mail, com o .zip anexado.
// Usado pelo botão da tela (origem 'manual') e pelo envio automático do
// início do mês (origem 'automatico'). Todo envio — certo ou errado — fica
// em fechamento_contador_envios.

/* eslint-disable @typescript-eslint/no-explicit-any -- cliente Supabase sem tipos gerados, como no resto de lib/ */

import { enviarEmail, listaDeEmails } from '@/lib/email/enviar'
import { montarFechamento, montarZipFechamento, nomeDoZip, textoResumo, type Fechamento } from './fechamento'

export type ResultadoEnvioFechamento =
  | { ok: true; para: string[]; copia: string[]; notas: number }
  | { ok: false; erro: string }

// O Resend aceita até 40 MB por e-mail, contando o anexo em base64 (+33%).
const LIMITE_ANEXO = 28 * 1024 * 1024

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function montarEmailFechamento(f: Fechamento, contador: string | null): { assunto: string; html: string; texto: string } {
  const assunto = `Fechamento fiscal ${f.periodo.rotulo} — ${f.empresa.nome} (CNPJ ${f.empresa.cnpj})`
  const saudacao = contador ? `Olá, ${contador.split(' ')[0]}!` : 'Olá!'
  const linhas: [string, { quantidade: number; valor: number }][] = [
    ['Vendas — NFC-e', f.vendasNfce], ['Vendas — NF-e', f.vendasNfe], ['Compras — NF-e', f.compras],
  ]
  const texto = [
    saudacao, '',
    `Segue em anexo o fechamento fiscal de ${f.periodo.rotulo}: os XMLs das notas de venda e de compra e a planilha resumo.csv.`,
    '', ...textoResumo(f), '',
    'As NF-e de pedidos de marketplace emitidas fora do Sistema Vargas não estão neste pacote.',
    '', 'Enviado pelo Sistema Vargas.',
  ].join('\n')

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;max-width:560px">
<p>${esc(saudacao)}</p>
<p>Segue em anexo o fechamento fiscal de <strong>${esc(f.periodo.rotulo)}</strong> da <strong>${esc(f.empresa.nome)}</strong> (CNPJ ${esc(f.empresa.cnpj)}): os XMLs das notas de venda e de compra e a planilha <em>resumo.csv</em>.</p>
<table style="border-collapse:collapse;width:100%;margin:12px 0">
${linhas.map(([rot, t]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${rot}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${t.quantidade} notas</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${reais(t.valor)}</td></tr>`).join('\n')}
</table>
${f.pendencias.length ? `<p style="margin-bottom:4px"><strong>Pendências do mês:</strong></p><ul style="margin-top:0">${f.pendencias.map(p => `<li>${esc(p.tipo)}: ${p.quantidade}. ${esc(p.detalhe)}</li>`).join('')}</ul>` : ''}
<p style="color:#6b7280;font-size:12px">As NF-e de pedidos de marketplace emitidas fora do Sistema Vargas não estão neste pacote.</p>
<p style="color:#6b7280;font-size:12px">Enviado pelo Sistema Vargas.</p>
</div>`
  return { assunto, html, texto }
}

export async function enviarFechamento(sb: any, empresaId: string, mes: string, opcoes: {
  origem: 'manual' | 'automatico'
  enviadoPor?: string | null
  empresasPermitidas?: string[]
  /** E-mail de quem pediu (manual): recebe cópia junto com a cópia configurada. */
  copiaExtra?: string | null
}): Promise<ResultadoEnvioFechamento> {
  const { data: emp } = await sb.from('empresas').select('contador, email_contador').eq('id', empresaId).maybeSingle()
  const para = listaDeEmails(emp?.email_contador)
  const { data: cfg } = await sb.from('fechamento_contador_config').select('copia_para').eq('empresa_id', empresaId).maybeSingle()
  const copia = listaDeEmails([cfg?.copia_para, opcoes.copiaExtra].filter(Boolean).join(';')).filter(e => !para.includes(e))

  const registrar = async (r: { status: 'enviado' | 'erro'; erro?: string; notas?: number; tamanho?: number; id?: string | null }) => {
    const { error } = await sb.from('fechamento_contador_envios').insert({
      empresa_id: empresaId, mes, para: para.join(', ') || '(sem e-mail)', copia: copia.join(', ') || null,
      origem: opcoes.origem, status: r.status, erro: r.erro ?? null, notas: r.notas ?? null,
      tamanho_bytes: r.tamanho ?? null, provedor_id: r.id ?? null, enviado_por: opcoes.enviadoPor ?? null,
    })
    if (error) console.error('[fechamento] envio não registrado:', error.message)
  }

  if (para.length === 0) {
    const erro = 'O e-mail do contador não está cadastrado (Gestão › Empresas).'
    await registrar({ status: 'erro', erro })
    return { ok: false, erro }
  }

  let f: Fechamento
  try {
    f = await montarFechamento(sb, empresaId, mes, { comXml: true, empresasPermitidas: opcoes.empresasPermitidas })
  } catch (e) {
    const erro = `Não foi possível montar o fechamento: ${(e as Error).message}`
    await registrar({ status: 'erro', erro })
    return { ok: false, erro }
  }

  const notas = f.vendasNfce.quantidade + f.vendasNfe.quantidade + f.compras.quantidade
  if (notas === 0) {
    const erro = `Nenhuma nota com XML em ${f.periodo.rotulo} — nada foi enviado.`
    await registrar({ status: 'erro', erro, notas: 0 })
    return { ok: false, erro }
  }

  const zip = montarZipFechamento(f)
  if (zip.length > LIMITE_ANEXO) {
    const erro = `O pacote ficou com ${(zip.length / 1048576).toFixed(1)} MB, acima do limite do e-mail. Baixe pela tela e envie em partes.`
    await registrar({ status: 'erro', erro, notas, tamanho: zip.length })
    return { ok: false, erro }
  }

  const { assunto, html, texto } = montarEmailFechamento(f, emp?.contador ?? null)
  const r = await enviarEmail({
    para, copia, responderPara: copia[0] ?? null, assunto, html, texto,
    anexos: [{ nome: nomeDoZip(f, { vendas: true, compras: true }), conteudo: zip }],
  })
  if (!r.ok) {
    await registrar({ status: 'erro', erro: r.erro, notas, tamanho: zip.length })
    return { ok: false, erro: r.erro }
  }
  await registrar({ status: 'enviado', notas, tamanho: zip.length, id: r.id })
  return { ok: true, para, copia, notas }
}

/** Dia do mês e mês corrente em Brasília. */
export function hojeEmBrasilia(agora: Date = new Date()): { dia: number; mes: string } {
  const d = new Date(agora.getTime() - 3 * 3600_000)
  return { dia: d.getUTCDate(), mes: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
}

/**
 * O automático deve mandar agora? A partir do dia configurado, uma vez por
 * mês: não manda se o mês já foi enviado (por qualquer caminho) e, se a
 * tentativa automática falhou, tenta de novo só no dia seguinte.
 */
export function deveEnviarAutomatico(p: {
  diaHoje: number; diaEnvio: number
  envios: { status: string; origem: string; created_at: string }[]
  hojeISO: string
}): boolean {
  if (p.diaHoje < p.diaEnvio) return false
  if (p.envios.some(e => e.status === 'enviado')) return false
  const tentouHoje = p.envios.some(e => e.origem === 'automatico' && e.created_at.slice(0, 10) === p.hojeISO)
  return !tentouHoje
}
