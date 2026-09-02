import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { perguntarComConsultas } from '@/lib/ia/comConsultas'
import { registrarConsumoIA } from '@/lib/ia/gateway'
import { periodoDosIndicadores } from '@/lib/dashboard/periodo'
import {
  agenteUtilizavel, consultasDoAgente, montarInstrucoes,
  type AgenteCatalogo, type AgenteContratado,
} from '@/lib/ia/agentes'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// CONVERSAR COM UM AGENTE CONTRATADO.
//
// A diferenca entre esta rota e a do dashboard e o RECORTE: o dashboard
// oferece o catalogo inteiro; aqui o agente alcanca so as consultas que o
// dono da plataforma marcou para ele. Um agente de estoque que consegue ler
// contas a pagar nao e um agente de estoque.

type Resultado = { resposta: string; evidencias: string[]; sugestoes: string[] }

function validar(valor: unknown): Resultado | null {
  if (typeof valor !== 'object' || valor === null) return null
  const v = valor as Record<string, unknown>
  if (typeof v.resposta !== 'string' || !v.resposta.trim()) return null
  const lista = (x: unknown) => Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string').slice(0, 6) : []
  return { resposta: v.resposta.slice(0, 2000), evidencias: lista(v.evidencias), sugestoes: lista(v.sugestoes) }
}

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const perfil = await perfilDaSessao(sb, user.id, 'empresa_id')
  const empresaId = perfil?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as { agenteId?: string; pergunta?: string }
  const pergunta = String(body.pergunta ?? '').trim().slice(0, 300)
  const agenteId = String(body.agenteId ?? '').trim()
  if (pergunta.length < 3) {
    return NextResponse.json({ ok: false, erro: 'Escreva uma pergunta um pouco mais detalhada.' }, { status: 400 })
  }

  const { data: contrato } = await sb.from('empresa_agentes')
    .select('id, agente_id, status, instrucoes, teste_ate, ia_agentes(*)')
    .eq('empresa_id', empresaId).eq('agente_id', agenteId).maybeSingle()

  if (!contrato) {
    return NextResponse.json({ ok: false, erro: 'Este agente não está contratado.' }, { status: 403 })
  }

  // A CARENCIA E CONFERIDA A CADA PERGUNTA, no servidor.
  //
  // Nao basta a tela esconder o campo quando o teste vence: quem tem o
  // endereco da rota continuaria perguntando de graca. O prazo vale onde a
  // conta e gasta.
  const uso = agenteUtilizavel(contrato as unknown as AgenteContratado)
  if (!uso.pode) {
    return NextResponse.json({ ok: false, erro: uso.motivo, expirado: true }, { status: 402 })
  }

  const agente = (contrato as unknown as { ia_agentes: AgenteCatalogo }).ia_agentes
  if (!agente?.ativo) {
    return NextResponse.json({ ok: false, erro: 'Este agente está indisponível no momento.' }, { status: 503 })
  }

  const consultas = consultasDoAgente(agente)
  if (consultas.length === 0) {
    return NextResponse.json({
      ok: false,
      erro: `${agente.nome} está sem consultas configuradas e não consegue ler dado nenhum. Avise o suporte.`,
    }, { status: 503 })
  }

  const periodo = periodoDosIndicadores(new Date())
  const prompt = `${montarInstrucoes(agente, contrato as unknown as AgenteContratado)}

Responda em português brasileiro, no máximo 130 palavras.

VOCÊ CONSULTA O BANCO pelas ferramentas oferecidas. Elas são as únicas que você alcança — se a pergunta pedir dado de outra área, diga que não é sua área e sugira o agente certo, em vez de responder por aproximação.

REGRAS que corrigem erros reais desta ferramenta:
1. NÃO invente produtos, clientes, valores ou nomes que não estejam nos resultados.
2. Datas relativas ("ontem", "semana passada") você converte para AAAA-MM-DD usando "periodo.hoje" antes de chamar a ferramenta.
3. Todo resultado traz o período que cobre e as ressalvas — repita-os. Nunca descreva o presente sem dizer de quando é o dado.
4. Lista vazia NÃO é "está tudo bem": leia a ressalva, que costuma dizer se a regra sequer existe.

Periodo: ${JSON.stringify(periodo)}
Pergunta: ${JSON.stringify(pergunta)}

Responda SOMENTE neste JSON:
{"resposta":"análise objetiva","evidencias":["número e significado"],"sugestoes":["próxima investigação segura"]}`

  try {
    const execucao = await perguntarComConsultas({
      sb, empresaId, prompt, consultas,
      modelo: 'claude-haiku-4-5-20251001', maxTokens: 1200,
    })
    if (!execucao.ok) {
      return NextResponse.json({ ok: false, erro: 'O agente está indisponível agora. Tente de novo em instantes.' }, { status: 503 })
    }
    const resultado = validar(execucao.valor)
    if (!resultado) throw new Error('resposta fora do formato')

    // TELEMETRIA COM `agente_id`: e o que vai permitir descobrir que um
    // agente nao e usado antes de o cliente descobrir que paga por ele.
    await registrarConsumoIA(sb, {
      empresa_id: empresaId, usuario_id: user.id,
      funcionalidade: 'agente', agente_id: agenteId,
      provedor: 'anthropic', modelo: 'claude-haiku-4-5-20251001', status: 'sucesso',
      tokens_entrada: execucao.tokensEntrada, tokens_saida: execucao.tokensSaida,
    })

    return NextResponse.json({
      ok: true,
      resultado,
      // O aviso de teste viaja junto: o gestor precisa ver o prazo encurtando
      // enquanto usa, e nao descobrir no dia em que parar de funcionar.
      emTeste: uso.emTeste,
      diasRestantes: uso.diasRestantes ?? null,
    })
  } catch {
    return NextResponse.json({ ok: false, erro: 'Não foi possível consultar agora.' }, { status: 503 })
  }
}
