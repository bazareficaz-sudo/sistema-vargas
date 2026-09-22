// Os caixas de PDV — a gaveta física de cada terminal.
//
// IDENTIDADE É `terminal_id`, NUNCA O NOME. Nomes de terminal mudam ("Balcão
// 02" vira "Caixa 2") e não são únicos por construção. Se o nome fosse a
// identidade, renomear um terminal criaria um segundo caixa para a mesma
// gaveta, e o saldo daquela gaveta passaria a estar partido entre dois
// lugares — nenhum dos dois certo.
//
// O banco garante isso em `idx_caixa_pdv_um_por_terminal`, único sobre
// (empresa_id, terminal_id) para tipo='pdv'. O índice NÃO filtra por
// `ativo`: se filtrasse, desativar um caixa liberaria criar outro para o
// mesmo terminal e partiria o histórico.
//
// NÃO CRIAMOS CAIXA PARA TODO TERMINAL QUE EXISTE. Há 6 terminais ativos e
// nenhum deles precisa de caixa até que alguém faça uma sangria dali.
// Criar os 6 de uma vez encheria a tela de gavetas que ninguém usa, e cada
// uma passaria a exigir conferência na Fase 3. A criação é sob demanda, no
// momento em que o caixa é escolhido para uma operação.

import type { LinhaCaixa } from '@/lib/caixa/tesourariaServidor'

export type CaixaPdv = LinhaCaixa & { terminal_id: string | null }

export type TerminalComCaixa = {
  terminal_id: string
  terminal_nome: string
  /** Null enquanto ninguém operou esta gaveta — o caixa nasce na primeira vez. */
  caixa_id: string | null
  caixa_nome: string | null
  ativo: boolean
  // Fase 3: o turno. Null quando a gaveta está fechada (ou nem existe).
  sessao_id: string | null
  sessao_aberta_em: string | null
  sessao_fundo_inicial: number | null
  /** Quanto deveria haver na gaveta agora — soma do ledger, nunca coluna. */
  saldo_esperado: number | null
}

/**
 * O que a tela de sangria oferece como origem: os terminais ativos da
 * empresa, com o caixa de cada um quando já existe.
 *
 * Lista terminal, não caixa, de propósito — o operador pensa "a gaveta do
 * Balcão 02", não "o caixa #7". O caixa é detalhe de implementação até o
 * momento em que passa a ter saldo.
 */
export async function listarCaixasPdv(sb: any, empresaId: string): Promise<TerminalComCaixa[]> {
  const { data: terminais } = await sb.from('pdv_terminais')
    .select('id, nome, status')
    .eq('empresa_id', empresaId).eq('status', 'ativo')
    .order('nome')

  const { data: caixas } = await sb.from('caixa')
    .select('id, nome, terminal_id, ativo')
    .eq('empresa_id', empresaId).eq('tipo', 'pdv')

  const porTerminal = new Map<string, { id: string; nome: string; ativo: boolean }>()
  for (const c of caixas ?? []) {
    if (c.terminal_id) porTerminal.set(c.terminal_id, { id: c.id, nome: c.nome, ativo: c.ativo })
  }

  // As sessões abertas. O índice único garante no máximo uma por caixa, o
  // que é o que torna este Map seguro.
  const { data: sessoes } = await sb.from('caixa_sessao')
    .select('id, caixa_id, aberta_em, fundo_inicial')
    .eq('empresa_id', empresaId).eq('status', 'aberta')

  const porCaixa = new Map<string, { id: string; aberta_em: string; fundo_inicial: number }>()
  for (const s of sessoes ?? []) {
    porCaixa.set(s.caixa_id, { id: s.id, aberta_em: s.aberta_em, fundo_inicial: Number(s.fundo_inicial) })
  }

  // O esperado de cada gaveta aberta, pela MESMA função que a RPC de
  // fechamento usa — a tela não pode mostrar um número diferente do que vai
  // valer na hora de conferir.
  const saldos = new Map<string, number>()
  for (const [caixaId] of porCaixa) {
    const { data } = await sb.rpc('saldo_caixa_v1', { p_caixa: caixaId })
    saldos.set(caixaId, Number(data ?? 0))
  }

  return (terminais ?? []).map((t: { id: string; nome: string }) => {
    const c = porTerminal.get(t.id)
    const s = c ? porCaixa.get(c.id) : undefined
    return {
      terminal_id: t.id,
      terminal_nome: t.nome,
      caixa_id: c?.id ?? null,
      caixa_nome: c?.nome ?? null,
      ativo: c ? c.ativo : true,
      sessao_id: s?.id ?? null,
      sessao_aberta_em: s?.aberta_em ?? null,
      sessao_fundo_inicial: s?.fundo_inicial ?? null,
      saldo_esperado: c && s ? (saldos.get(c.id) ?? 0) : null,
    }
  })
}

/**
 * Devolve o caixa daquele terminal, criando na primeira vez.
 *
 * O `empresa_id` vem do contexto validado, NUNCA do cliente. O terminal é
 * conferido contra a mesma empresa antes de qualquer escrita: sem isso, um
 * terminal de outra empresa viraria um caixa desta, e a transferência
 * seguinte cruzaria CNPJ com os dois caixas parecendo locais.
 *
 * Não retroage saldo: a gaveta começa em zero e o que houver nela
 * fisicamente entra por suprimento ou ajuste — nunca por um número
 * inventado a partir de vendas antigas.
 */
export async function buscarOuCriarCaixaPdv(
  sb: any,
  empresaId: string,
  terminalId: string,
  userId: string,
): Promise<{ ok: true; caixa: CaixaPdv } | { ok: false; erro: string }> {
  const { data: terminal } = await sb.from('pdv_terminais')
    .select('id, nome, empresa_id, status')
    .eq('id', terminalId).maybeSingle()

  if (!terminal || terminal.empresa_id !== empresaId) {
    // Mesma resposta para "não existe" e "é de outra empresa": quem tentou
    // forçar um terminal alheio não descobre que ele existe.
    return { ok: false, erro: 'Terminal não encontrado nesta empresa.' }
  }
  if (terminal.status !== 'ativo') {
    return { ok: false, erro: 'Terminal revogado não movimenta caixa.' }
  }

  const { data: existente } = await sb.from('caixa')
    .select('*').eq('empresa_id', empresaId).eq('tipo', 'pdv')
    .eq('terminal_id', terminalId).maybeSingle()
  if (existente) return { ok: true, caixa: existente }

  const { data: criado, error } = await sb.from('caixa').insert({
    empresa_id: empresaId, tipo: 'pdv', terminal_id: terminalId,
    nome: `Caixa ${terminal.nome}`, created_by: userId,
  }).select('*').single()
  if (!error) return { ok: true, caixa: criado }

  // Duas requisições na primeira operação daquela gaveta: a segunda esbarra
  // no índice único. A linha já existe — não é erro.
  const { data: corrida } = await sb.from('caixa')
    .select('*').eq('empresa_id', empresaId).eq('tipo', 'pdv')
    .eq('terminal_id', terminalId).maybeSingle()
  if (corrida) return { ok: true, caixa: corrida }

  return { ok: false, erro: error.message }
}
