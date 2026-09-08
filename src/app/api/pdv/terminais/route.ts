import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'
import {
  gerarCodigoAtivacao, hashDoCodigo, prefixoDoCodigo, CODIGO_VALIDADE_MINUTOS,
} from '@/lib/pdv/terminalToken'
import { segredoConfigurado } from '@/lib/pdv/segredo'
import { saudeDoTerminal, rotuloDePresenca } from '@/lib/pdv/saudeTerminal'
import { situacaoDaVersao, quemFicariaDeFora } from '@/lib/pdv/versaoMinima'

// Administração dos terminais, pelo painel. Ao contrário das rotas de
// ativação e de token, esta atende um usuário autenticado — então usa o
// cliente de sessão e passa por `exigirPermissao`.

export async function GET() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_terminais_pdv')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data } = await sb
    .from('pdv_terminais')
    .select('id, nome, status, versao_pdv, terminal_id_legado, metodo_ultima_auth, usar_rotas_novas, ativado_em, ultima_autenticacao_em, ultima_atividade_em, ultimo_heartbeat_em, revogado_em, motivo_revogacao, created_at')
    .eq('empresa_id', guarda.empresaId)
    .order('created_at', { ascending: false })

  // Telemetria REAL: as linhas que a rota protegida de fato gravou. Nada aqui
  // é estimado, e nada conta o caminho legado — o legado nao passa por esta
  // tabela, e a Fase 0.6A ja mostrou o preco de fingir que passa.
  const { data: operacoes } = await sb
    .from('pdv_operacoes')
    .select('id, terminal_id, operacao, status, erro, versao_pdv, criado_em, concluido_em')
    .eq('empresa_id', guarda.empresaId)
    .order('criado_em', { ascending: false })
    .limit(50)

  // Piso de versao: NULO = sem minimo, e nada e recusado por causa dele nesta
  // fase. Serve para a tela poder responder "se o corte fosse hoje, quem
  // ficaria de fora?" — pergunta que o caso PDV-002 tornou obrigatoria.
  const { data: cfg } = await sb
    .from('empresa_config_pdv').select('versao_minima_pdv')
    .eq('empresa_id', guarda.empresaId).maybeSingle()
  const versaoMinima = cfg?.versao_minima_pdv ?? null

  const agora = new Date()
  const terminais = (data ?? []).map(t => {
    const saude = saudeDoTerminal(t, agora)
    return {
      ...t,
      saude: {
        ...saude,
        rotulo: rotuloDePresenca(saude),
        versao_situacao: situacaoDaVersao(t.versao_pdv, versaoMinima),
      },
    }
  })

  return NextResponse.json({
    ok: true,
    terminais,
    operacoes: operacoes ?? [],
    versao_minima_pdv: versaoMinima,
    // Simulacao, nao acao: ninguem e bloqueado por isto hoje.
    ficariam_de_fora: quemFicariaDeFora(data ?? [], versaoMinima),
    // Booleano, nunca o segredo. Existe para a tela avisar ANTES de alguem
    // gerar um codigo e descobrir no balcao que o servidor nao assina token.
    segredo_configurado: segredoConfigurado(),
  })
}

/** Liga ou desliga a rota nova para um terminal. O rollout e um de cada vez. */
export async function PATCH(req: Request) {
  const { terminal_id, usar_rotas_novas } = await req.json().catch(() => ({}))
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_terminais_pdv')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  if (!terminal_id || typeof usar_rotas_novas !== 'boolean') {
    return NextResponse.json({ ok: false, erro: 'Informe o terminal e o novo estado.' }, { status: 400 })
  }

  // O filtro por empresa e o que impede um administrador de uma empresa de
  // ligar a rota nova no terminal de outra. A permissao diz o que ele pode
  // fazer; o `eq` diz onde.
  const { data, error } = await sb.from('pdv_terminais')
    .update({ usar_rotas_novas, updated_at: new Date().toISOString() })
    .eq('id', terminal_id).eq('empresa_id', guarda.empresaId)
    .select('id, nome, usar_rotas_novas').maybeSingle()

  if (error || !data) {
    return NextResponse.json({ ok: false, erro: error?.message ?? 'Terminal nao encontrado' }, { status: 404 })
  }

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: usar_rotas_novas ? 'pdv_terminal_rota_nova_ligada' : 'pdv_terminal_rota_nova_desligada',
    tabela: 'pdv_terminais', campo: 'usar_rotas_novas',
    valorNovo: { terminal_id: data.id, nome: data.nome, usar_rotas_novas },
  })

  return NextResponse.json({ ok: true, terminal: data })
}

/** Autoriza um terminal novo e devolve o código de ativação UMA vez. */
export async function POST(req: Request) {
  const { nome } = await req.json().catch(() => ({}))
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_terminais_pdv')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  if (!String(nome ?? '').trim()) {
    return NextResponse.json({ ok: false, erro: 'Dê um nome ao terminal — é assim que você vai reconhecê-lo depois.' }, { status: 400 })
  }

  const { data: terminal, error } = await sb.from('pdv_terminais').insert({
    empresa_id: guarda.empresaId,
    nome: String(nome).trim().slice(0, 80),
    status: 'aguardando_ativacao',
    created_by: guarda.userId,
  }).select('id, nome').single()
  if (error || !terminal) {
    return NextResponse.json({ ok: false, erro: error?.message ?? 'Falha ao criar o terminal' }, { status: 500 })
  }

  // O código existe em claro só nesta resposta. O banco guarda o hash e o
  // prefixo — se a pessoa fechar a tela sem anotar, gera outro.
  const codigo = gerarCodigoAtivacao()
  const { error: erroCodigo } = await sb.from('pdv_ativacoes').insert({
    empresa_id: guarda.empresaId,
    terminal_id: terminal.id,
    codigo_hash: hashDoCodigo(codigo),
    codigo_prefixo: prefixoDoCodigo(codigo),
    expira_em: new Date(Date.now() + CODIGO_VALIDADE_MINUTOS * 60_000).toISOString(),
    created_by: guarda.userId,
  })
  if (erroCodigo) return NextResponse.json({ ok: false, erro: erroCodigo.message }, { status: 500 })

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: 'pdv_terminal_autorizado', tabela: 'pdv_terminais', campo: 'status',
    valorNovo: { terminal_id: terminal.id, nome: terminal.nome, prefixo: prefixoDoCodigo(codigo) },
  })

  return NextResponse.json({
    ok: true,
    terminal,
    codigo,
    expira_em_minutos: CODIGO_VALIDADE_MINUTOS,
  })
}
