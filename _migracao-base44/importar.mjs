import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const COMMIT = process.argv.includes('--commit')

const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// ─── Helpers de parsing ──────────────────────────────────────────────────

function parseCsv(texto) {
  const linhas = texto.split(/\r?\n/).filter(l => l.trim().length > 0)
  const cabecalho = linhas[0].split(';').map(h => h.trim())
  return linhas.slice(1).map(linha => {
    const campos = linha.split(';')
    const obj = {}
    cabecalho.forEach((h, i) => { obj[h] = (campos[i] ?? '').trim() })
    return obj
  })
}

function numeroBR(s) {
  if (!s) return 0
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0
}

// "24/07/2026" ou "24/07/2026, 19:28:45" -> ISO
function dataBR(s) {
  if (!s) return null
  const [dataParte, horaParte] = s.split(',').map(p => p.trim())
  const [d, m, a] = dataParte.split('/')
  if (!d || !m || !a) return null
  const hora = horaParte || '00:00:00'
  return `${a}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${hora}`
}
function dataBRSomenteData(s) {
  const iso = dataBR(s)
  return iso ? iso.slice(0, 10) : null
}

function normNome(s) {
  return (s ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
}
function normTelefone(s) {
  return (s ?? '').replace(/\D/g, '').replace(/^55(\d{10,11})$/, '$1') // remove DDI 55 se presente
}

// ─── Carrega os 3 CSVs ───────────────────────────────────────────────────

const clientesCsv = parseCsv(fs.readFileSync(path.join(__dirname, 'clientes_2026-07-25.csv'), 'utf8'))
const vendasCsv = parseCsv(fs.readFileSync(path.join(__dirname, 'vendas_carteira_2026-07-26.csv'), 'utf8'))
const contasCsv = parseCsv(fs.readFileSync(path.join(__dirname, 'contas_receber_carteira_2026-07-26.csv'), 'utf8'))

console.log(`Lidos: ${clientesCsv.length} clientes, ${vendasCsv.length} vendas, ${contasCsv.length} contas a receber (do Base44)\n`)

// ─── 1. Dedup interno de clientes (linhas idênticas nome+telefone) ──────

const clientesDedup = []
const vistoExato = new Set()
for (const c of clientesCsv) {
  const chave = `${normNome(c['Nome'])}|${normTelefone(c['Telefone'])}`
  if (vistoExato.has(chave)) continue
  vistoExato.add(chave)
  clientesDedup.push(c)
}
console.log(`Após remover duplicatas exatas (nome+telefone idênticos): ${clientesDedup.length} clientes únicos\n`)

// Flags de ambiguidade — mesmo nome com telefones diferentes / mesmo telefone com nomes diferentes
const porNome = new Map()
const porTelefone = new Map()
for (const c of clientesDedup) {
  const n = normNome(c['Nome']); const t = normTelefone(c['Telefone'])
  if (!porNome.has(n)) porNome.set(n, [])
  porNome.get(n).push(c)
  if (t) {
    if (!porTelefone.has(t)) porTelefone.set(t, [])
    porTelefone.get(t).push(c)
  }
}
const nomesComTelefonesDiferentes = [...porNome.entries()].filter(([n, rows]) => new Set(rows.map(r => normTelefone(r['Telefone']))).size > 1)
const telefonesComNomesDiferentes = [...porTelefone.entries()].filter(([t, rows]) => new Set(rows.map(r => normNome(r['Nome']))).size > 1)

// ─── 2. Casa contra clientes já existentes no nosso banco ───────────────

const { data: empresaRow } = await sb.from('clientes').select('empresa_id').limit(1).maybeSingle()
const empresaId = empresaRow?.empresa_id
if (!empresaId) { console.error('Não consegui identificar empresa_id (nenhum cliente existente no banco pra referência).'); process.exit(1) }
console.log(`empresa_id: ${empresaId}\n`)

const { data: clientesExistentes } = await sb.from('clientes').select('id, nome, telefone').eq('empresa_id', empresaId)
const existentesPorNome = new Map(clientesExistentes.map(c => [normNome(c.nome), c]))
const existentesPorTelefone = new Map(clientesExistentes.filter(c => c.telefone).map(c => [normTelefone(c.telefone), c]))

// resolve(nomeOriginal) -> { tipo: 'existente'|'novo', id?, dbRow?, base44Row? }
const resolucaoClientes = new Map() // chave: normNome(nome do base44) -> resolução

for (const c of clientesDedup) {
  const nome = normNome(c['Nome'])
  const tel = normTelefone(c['Telefone'])
  let match = existentesPorNome.get(nome)
  if (!match && tel) match = existentesPorTelefone.get(tel)
  resolucaoClientes.set(nome, match
    ? { tipo: 'existente', dbRow: match, base44Row: c }
    : { tipo: 'novo', base44Row: c })
}

// ─── 2b. Decisões manuais confirmadas com o usuário sobre nome/telefone ambíguos ──
// "RL" e "RODOLFO SANDA" (mesmo telefone) → mesma pessoa, nome canônico "RODOLFO SANDA".
// Ambos são clientes NOVOS (nenhum dos dois bateu com cliente já existente) — faz a
// chave "RL" apontar pra mesma resolução (novo) de "RODOLFO SANDA", pra virar 1 só.
if (resolucaoClientes.has('RODOLFO SANDA') && resolucaoClientes.has('RL')) {
  resolucaoClientes.set('RL', resolucaoClientes.get('RODOLFO SANDA'))
}
// "TIO RICO (TIO DO MAURICIO)" e "TIO HENRIQUE (TIO RICO)" (mesmo telefone) → mesma
// pessoa. Os dois já existem como cadastros SEPARADOS no banco — não mexe nos
// cadastros existentes, só direciona o que for importado do Base44 pra um só
// (o mais descritivo), pra não espalhar o histórico migrado entre os dois.
if (resolucaoClientes.has('TIO RICO (TIO DO MAURICIO)') && resolucaoClientes.has('TIO HENRIQUE (TIO RICO)')) {
  resolucaoClientes.set('TIO HENRIQUE (TIO RICO)', resolucaoClientes.get('TIO RICO (TIO DO MAURICIO)'))
}
// "LUIZ FERNANDO" (2 telefones no Base44) → mesma pessoa; já cai naturalmente no
// único "LUIZ FERNANDO" existente no banco (nome bate exato pros dois), sem precisar
// de ajuste manual aqui.

const novosClientes = [...new Set([...resolucaoClientes.values()])].filter(r => r.tipo === 'novo')
const existentesMatch = [...new Set([...resolucaoClientes.values()])].filter(r => r.tipo === 'existente')

// ─── 3. Fuzzy-match auxiliar pra nomes de vendas/contas que não batem 100% ──
// (ex: "DANIEL BORRACHA" nas vendas vs "DANIEL BORRACHA **" nos clientes)
function resolverClientePorNomeAproximado(nomeOriginal) {
  const n = normNome(nomeOriginal)
  if (resolucaoClientes.has(n)) return { chave: n, exato: true }
  // tenta por prefixo (nome de venda é prefixo do nome de cliente cadastrado, ou vice-versa)
  for (const chave of resolucaoClientes.keys()) {
    if (chave.startsWith(n) || n.startsWith(chave)) return { chave, exato: false }
  }
  return null
}

// ─── 4. Processa vendas ──────────────────────────────────────────────────

const STATUS_VENDA = { concluida: 'concluida', finalizada: 'concluida', cancelada: 'cancelada' }

const vendasProcessadas = []
const vendasSemCliente = []
for (const v of vendasCsv) {
  const resolucao = resolverClientePorNomeAproximado(v['Cliente'])
  if (!resolucao) { vendasSemCliente.push(v); continue }
  vendasProcessadas.push({
    numeroOriginal: v['Número'],
    clienteChave: resolucao.chave,
    clienteNomeOriginal: v['Cliente'],
    fuzzy: !resolucao.exato,
    data: dataBR(v['Data']),
    status: STATUS_VENDA[v['Status']] ?? 'concluida',
    subtotal: numeroBR(v['Subtotal']),
    desconto: numeroBR(v['Desconto']),
    total: numeroBR(v['Total']),
    valor_pago: numeroBR(v['Valor Recebido']),
    troco: numeroBR(v['Troco']),
    forma_pagamento: 'carteira',
    operador_nome: v['Vendedor'] || null,
    observacao: `Migrado do Base44 — Venda #${v['Número']}${v['Observação'] ? ' — ' + v['Observação'] : ''}`,
  })
}
const vendasPorNumero = new Map(vendasProcessadas.map(v => [v.numeroOriginal, v]))

// ─── 5. Processa contas a receber ────────────────────────────────────────

const contasProcessadas = []
const contasSemCliente = []
const contasSemVendaRef = []
for (const cr of contasCsv) {
  const resolucao = resolverClientePorNomeAproximado(cr['Cliente'])
  if (!resolucao) { contasSemCliente.push(cr); continue }

  const valorRecebido = numeroBR(cr['Valor Recebido'])
  const saldoRestante = numeroBR(cr['Saldo Restante'])
  const valorOriginal = valorRecebido + saldoRestante // fórmula consistente (ver análise) em vez da coluna "Valor Original" da fonte, que fica zerada na maioria das linhas
  const vencimento = dataBRSomenteData(cr['Vencimento'])
  const hoje = new Date().toISOString().slice(0, 10)

  let status = 'aberto'
  if (saldoRestante <= 0) status = 'recebido'
  else if (valorRecebido > 0) status = 'parcial'
  else if (vencimento && vencimento < hoje) status = 'vencido'

  const referenciaVenda = /^Venda #(\d+)$/.exec(cr['Descrição'] ?? '')
  const numeroVendaRef = referenciaVenda?.[1] ?? null
  if (cr['Descrição']?.startsWith('Venda #') && !vendasPorNumero.has(numeroVendaRef)) {
    contasSemVendaRef.push(cr)
  }

  contasProcessadas.push({
    clienteChave: resolucao.chave,
    clienteNomeOriginal: cr['Cliente'],
    fuzzy: !resolucao.exato,
    numeroVendaRef,
    descricaoOriginal: cr['Descrição'],
    data_emissao: dataBRSomenteData(cr['Criado em']) ?? hoje,
    data_vencimento: vencimento ?? hoje,
    valor_original: valorOriginal,
    valor_recebido: valorRecebido,
    status,
    forma_prevista: cr['Forma Recebimento'] || null,
    observacao: `Migrado do Base44${cr['Observação'] ? ' — ' + cr['Observação'] : ''}`,
    numero_doc: cr['Descrição'] || null,
  })
}

// ─── RELATÓRIO (dry-run) ──────────────────────────────────────────────────

console.log('═══════════════════════════════════════════')
console.log('RELATÓRIO DA SIMULAÇÃO (nada foi gravado)')
console.log('═══════════════════════════════════════════\n')

console.log(`CLIENTES`)
console.log(`  Já existem no sistema (não serão duplicados): ${existentesMatch.length}`)
for (const r of existentesMatch) console.log(`    - "${r.base44Row['Nome']}" → já cadastrado como "${r.dbRow.nome}" (id ${r.dbRow.id})`)
console.log(`  Novos a criar: ${novosClientes.length}`)
for (const r of novosClientes) console.log(`    - "${r.base44Row['Nome']}" (tel: ${r.base44Row['Telefone'] || '—'})`)

if (nomesComTelefonesDiferentes.length) {
  console.log(`\n  ⚠ ATENÇÃO — mesmo nome, telefones diferentes (podem ser pessoas diferentes, revisar):`)
  for (const [n, rows] of nomesComTelefonesDiferentes) console.log(`    - "${n}": ${rows.map(r => r['Telefone'] || '(sem telefone)').join(' / ')}`)
}
if (telefonesComNomesDiferentes.length) {
  console.log(`\n  ⚠ ATENÇÃO — mesmo telefone, nomes diferentes (podem ser a mesma pessoa cadastrada errado, revisar):`)
  for (const [t, rows] of telefonesComNomesDiferentes) console.log(`    - "${t}": ${rows.map(r => r['Nome']).join(' / ')}`)
}

console.log(`\nVENDAS`)
console.log(`  A criar: ${vendasProcessadas.length}`)
const vendasFuzzy = vendasProcessadas.filter(v => v.fuzzy)
if (vendasFuzzy.length) {
  console.log(`  ⚠ Casadas por aproximação de nome (confirmar se é o cliente certo):`)
  for (const v of vendasFuzzy) console.log(`    - Venda #${v.numeroOriginal}: "${v.clienteNomeOriginal}" → cliente "${v.clienteChave}"`)
}
if (vendasSemCliente.length) {
  console.log(`  ✗ SEM cliente resolvido (não serão importadas):`)
  for (const v of vendasSemCliente) console.log(`    - Venda #${v['Número']}: "${v['Cliente']}"`)
}

console.log(`\nCONTAS A RECEBER`)
console.log(`  A criar: ${contasProcessadas.length}`)
const contasFuzzy = contasProcessadas.filter(c => c.fuzzy)
if (contasFuzzy.length) {
  console.log(`  ⚠ Casadas por aproximação de nome:`)
  for (const c of contasFuzzy) console.log(`    - "${c.clienteNomeOriginal}" → cliente "${c.clienteChave}" (${c.descricaoOriginal || 'sem descrição'}, R$ ${c.valor_original.toFixed(2)})`)
}
if (contasSemCliente.length) {
  console.log(`  ✗ SEM cliente resolvido (não serão importadas):`)
  for (const c of contasSemCliente) console.log(`    - "${c['Cliente']}" (${c['Descrição'] || 'sem descrição'})`)
}
if (contasSemVendaRef.length) {
  console.log(`  ⚠ Referenciam uma venda que não foi encontrada no export de vendas (serão importadas sem vínculo direto com a venda, só com o cliente):`)
  for (const c of contasSemVendaRef) console.log(`    - "${c['Cliente']}" — ${c['Descrição']} — R$ ${numeroBR(c['Valor Recebido']) + numeroBR(c['Saldo Restante'])}`)
}
const totalReceber = contasProcessadas.reduce((s, c) => s + (c.valor_original - c.valor_recebido), 0)
console.log(`\n  Total em aberto a importar: R$ ${totalReceber.toFixed(2)}`)

console.log(`\n═══════════════════════════════════════════`)
if (!COMMIT) {
  console.log('Simulação apenas — nenhum dado foi gravado.')
  console.log('Pra gravar de verdade, rode: node importar.mjs --commit')
}

if (COMMIT) {

// ─── GRAVAÇÃO REAL (só roda com --commit) ─────────────────────────────────
console.log('\nGravando de verdade...\n')

const idsClientePorChave = new Map()
for (const r of existentesMatch) idsClientePorChave.set(r.base44Row ? normNome(r.base44Row['Nome']) : null, r.dbRow.id)
// garante que a chave usada em resolucaoClientes bate (normNome do nome do base44)
for (const [chave, r] of resolucaoClientes) if (r.tipo === 'existente') idsClientePorChave.set(chave, r.dbRow.id)

for (const r of novosClientes) {
  const c = r.base44Row
  const { data, error } = await sb.from('clientes').insert({
    empresa_id: empresaId,
    nome: c['Nome'],
    cpf_cnpj: c['CPF/CNPJ'] || null,
    telefone: c['Telefone'] || null,
    whatsapp: c['WhatsApp'] || null,
    cep: c['CEP'] || null,
    logradouro: c['Logradouro'] || null,
    numero: c['Número'] || null,
    complemento: c['Complemento'] || null,
    bairro: c['Bairro'] || null,
    cidade: c['Cidade'] || null,
    estado: c['Estado'] || null,
    permite_carteira: c['Permite Carteira'] === 'Sim',
    permite_fiado: c['Permite Carteira'] === 'Sim',
    limite_credito: numeroBR(c['Limite Crédito']),
    saldo_devedor: numeroBR(c['Saldo Devedor']),
    status_credito: c['Status Crédito'] || 'liberado',
    observacoes_financeiras: [c['Observação Crédito'], c['Observação']].filter(Boolean).join(' — ') || null,
    ativo: c['Ativo'] !== 'Não',
  }).select('id').single()
  if (error) { console.error(`✗ Erro ao criar cliente "${c['Nome']}": ${error.message}`); continue }
  // Cobre também chaves alternativas fundidas nesta mesma resolução (ex: "RL" -> mesmo objeto que "RODOLFO SANDA")
  for (const [chave, r2] of resolucaoClientes) if (r2 === r) idsClientePorChave.set(chave, data.id)
  console.log(`✓ Cliente criado: ${c['Nome']}`)
}

const idsVendaPorNumero = new Map()
for (const v of vendasProcessadas) {
  const clienteId = idsClientePorChave.get(v.clienteChave)
  const { data, error } = await sb.from('vendas').insert({
    empresa_id: empresaId,
    cliente_id: clienteId ?? null,
    cliente_nome: v.clienteNomeOriginal,
    status: v.status,
    subtotal: v.subtotal,
    desconto_total: v.desconto,
    total: v.total,
    valor_pago: v.valor_pago,
    valor_recebido: v.valor_pago,
    troco: v.troco,
    forma_pagamento: v.forma_pagamento,
    operador_nome: v.operador_nome,
    observacao: v.observacao,
    itens: [],
    created_at: v.data,
    updated_at: v.data,
  }).select('id').single()
  if (error) { console.error(`✗ Erro ao criar venda #${v.numeroOriginal}: ${error.message}`); continue }
  idsVendaPorNumero.set(v.numeroOriginal, data.id)
  await sb.from('venda_itens').insert({
    venda_id: data.id,
    produto_nome: 'Venda migrada do Base44 (sem detalhe de itens)',
    quantidade: 1,
    preco_unitario: v.total,
    desconto: 0,
    total: v.total,
    tipo: 'venda',
  })
  console.log(`✓ Venda #${v.numeroOriginal} criada`)
}

for (const c of contasProcessadas) {
  const clienteId = idsClientePorChave.get(c.clienteChave)
  const vendaId = c.numeroVendaRef ? idsVendaPorNumero.get(c.numeroVendaRef) ?? null : null
  const { error } = await sb.from('contas_receber').insert({
    empresa_id: empresaId,
    cliente_id: clienteId ?? null,
    cliente_nome: c.clienteNomeOriginal,
    origem: 'carteira',
    origem_id: vendaId,
    numero_doc: c.numero_doc,
    data_emissao: c.data_emissao,
    data_vencimento: c.data_vencimento,
    valor_original: c.valor_original,
    valor_recebido: c.valor_recebido,
    status: c.status,
    forma_prevista: c.forma_prevista,
    observacao: c.observacao,
  })
  if (error) { console.error(`✗ Erro ao criar conta a receber de "${c.clienteNomeOriginal}": ${error.message}`); continue }
  console.log(`✓ Conta a receber criada: ${c.clienteNomeOriginal} — R$ ${c.valor_original.toFixed(2)}`)
}

console.log('\nImportação concluída.')
}
