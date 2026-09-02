import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perguntarJSONComGateway } from '@/lib/ia/gateway'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import {
  limitesDoContexto, montarCapacidades,
  type ContextoAnuncios,
} from '@/lib/marketplace/contextoPergunta'

// PERGUNTE AO VARGAS — ANÚNCIOS E MARKETPLACES.
//
// O CONTEXTO É MONTADO AQUI, não recebido do navegador.
//
// A rota do dashboard recebe os indicadores prontos do cliente. Funciona,
// mas significa que a resposta descreve o que o navegador disse, não o que o
// banco tem. Aqui a tela manda só o canal e a pergunta — os números saem da
// consulta, e são os mesmos para qualquer um que pergunte.
//
// Também é mais barato de manter: quando uma contagem mudar de definição,
// muda num lugar, e não em cada tela que resolva chamar a rota.

export const maxDuration = 30

type Resultado = {
  resposta: string
  evidencias: string[]
  sugestoes: string[]
  modo: 'ia' | 'automatico'
}

function validarResultado(valor: unknown): Omit<Resultado, 'modo'> | null {
  if (typeof valor !== 'object' || valor === null) return null
  const v = valor as Record<string, unknown>
  if (typeof v.resposta !== 'string' || !v.resposta.trim()) return null
  const lista = (x: unknown) => Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string').slice(0, 6) : []
  return {
    resposta: v.resposta.slice(0, 2000),
    evidencias: lista(v.evidencias),
    sugestoes: lista(v.sugestoes),
  }
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const body = await req.json().catch(() => null) as { pergunta?: string; canalId?: string } | null
  const pergunta = String(body?.pergunta ?? '').trim().slice(0, 300)
  const canalId = String(body?.canalId ?? '').trim()
  if (pergunta.length < 3) {
    return NextResponse.json({ ok: false, erro: 'Escreva uma pergunta um pouco mais detalhada.' }, { status: 400 })
  }

  const perfil = await perfilDaSessao(supabase, user.id, 'empresa_id')
  const empresaId = perfil?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa ativa não encontrada.' }, { status: 400 })

  const { data: canal } = await supabase
    .from('marketplace_canais')
    .select('id, nome, plataforma, access_token')
    .eq('empresa_id', empresaId).eq('id', canalId).maybeSingle()
  if (!canal) return NextResponse.json({ ok: false, erro: 'Canal não encontrado.' }, { status: 404 })

  // Contagens. Colunas escalares e nada de `dados_brutos` — a listagem desta
  // tela já paga caro por esse blob (ver o comentário em anuncios/page.tsx) e
  // uma pergunta não pode custar mais que a tela inteira.
  const { data: linhas } = await supabase
    .from('marketplace_anuncios')
    .select('status, produto_id, preco_venda, erro_msg, sincronizado_em')
    .eq('empresa_id', empresaId).eq('canal_id', canal.id)

  const anunciosRows = linhas ?? []
  const sincronizacoes = anunciosRows.map(a => a.sincronizado_em).filter(Boolean) as string[]
  sincronizacoes.sort()

  const anuncios = {
    total: anunciosRows.length,
    ativos: anunciosRows.filter(a => a.status === 'ativo').length,
    pausados: anunciosRows.filter(a => a.status === 'pausado').length,
    comErro: anunciosRows.filter(a => a.erro_msg).length,
    semProdutoVinculado: anunciosRows.filter(a => !a.produto_id).length,
    semPreco: anunciosRows.filter(a => !Number(a.preco_venda)).length,
  }

  const [{ data: cfg }, { data: promocoes }] = await Promise.all([
    supabase.from('precificacao_config')
      .select('comissao_modo, frete_modo, frete_ml_importar')
      .eq('canal_id', canal.id).maybeSingle(),
    supabase.from('marketplace_promocoes')
      .select('id, status, sincronizado_em, marketplace_promocao_itens(id, status)')
      .eq('empresa_id', empresaId).eq('canal_id', canal.id).neq('status', 'encerrada'),
  ])

  const itens = (promocoes ?? []).flatMap(p =>
    (p.marketplace_promocao_itens ?? []) as { status?: string | null }[])
  const sincCampanhas = (promocoes ?? [])
    .map(p => p.sincronizado_em).filter(Boolean).sort() as string[]

  // A comissão do ML só é medida quando o modo é `api_ml` E o canal tem
  // credencial: sem token o motor cai na tabela, e a resposta seria a de um
  // palpite com cara de medição.
  const temCredencial = !!canal.access_token
  const comissaoMedida = cfg?.comissao_modo === 'api_ml' && temCredencial
  const freteMedido = !!cfg?.frete_ml_importar && temCredencial

  const contexto: ContextoAnuncios = {
    canal: { nome: canal.nome, plataforma: canal.plataforma },
    sincronizacao: {
      maisRecente: sincronizacoes[sincronizacoes.length - 1] ?? null,
      maisAntiga: sincronizacoes[0] ?? null,
      nuncaSincronizados: anunciosRows.length - sincronizacoes.length,
    },
    anuncios,
    economia: {
      comissao: !cfg ? 'nao_configurada' : comissaoMedida ? 'medida_na_api' : 'tabela_configurada',
      frete: !cfg ? 'nao_configurado' : freteMedido ? 'medido_na_api' : 'modo_configurado',
      ressalva: !cfg
        ? 'Este canal não tem configuração de taxas. Nenhuma conta de margem é confiável.'
        : (!comissaoMedida || !freteMedido)
          ? 'Parte da economia deste canal vem de valores configurados à mão, não medidos na API.'
          : null,
    },
    campanhas: {
      total: (promocoes ?? []).length,
      itensParticipando: itens.filter(i => i.status === 'participando').length,
      itensConvite: itens.filter(i => i.status === 'convite' || i.status === 'desconhecido').length,
      sincronizadoEm: sincCampanhas[sincCampanhas.length - 1] ?? null,
    },
    capacidades: montarCapacidades(canal.plataforma, temCredencial),
    naoRespondivel: [],
  }
  contexto.naoRespondivel = limitesDoContexto(contexto)

  const prompt = `Você é o analista de marketplaces do Sistema Vargas, um ERP brasileiro.
Responda à pergunta do lojista usando SOMENTE o JSON fornecido. Seja direto, em português brasileiro, no máximo 130 palavras.

REGRAS — cada uma corrige um erro que esta ferramenta já cometeu:
1. NÃO invente anúncios, produtos, valores ou nomes que não estejam no JSON.
2. O campo "naoRespondivel" lista o que este contexto NÃO alcança. Se a pergunta cair ali, diga que não tem o dado e qual tela responde — nunca ofereça um número próximo no lugar.
3. Se "economia.ressalva" não for null, qualquer frase sobre lucro ou margem precisa dizer que a base não foi medida. Não afirme lucratividade sobre número suposto.
4. Capacidade com estado "nao_verificado" significa que NINGUÉM CONFERIU — não significa que a plataforma não faz. Nunca troque um pelo outro.
5. Datas de sincronização dizem de quando são os dados. Se forem antigas ou nulas, diga isso antes de descrever o presente.

Pergunta: ${JSON.stringify(pergunta)}
Dados: ${JSON.stringify(contexto)}

Responda SOMENTE neste JSON:
{"resposta":"análise objetiva","evidencias":["número e significado"],"sugestoes":["próxima investigação segura"]}`

  const automatica = (): Resultado => ({
    modo: 'automatico',
    resposta: `${anuncios.total} anúncio(s) em ${canal.nome}: ${anuncios.ativos} ativo(s), `
      + `${anuncios.pausados} pausado(s), ${anuncios.comErro} com erro. `
      + `${anuncios.semProdutoVinculado} sem produto do catálogo vinculado`
      + `${anuncios.semProdutoVinculado > 0 ? ' — para esses não há custo, e portanto não há margem calculável' : ''}.`
      + (contexto.economia.ressalva ? ` ${contexto.economia.ressalva}` : ''),
    evidencias: [
      `Anúncios: ${anuncios.total} (${anuncios.ativos} ativos)`,
      `Sem produto vinculado: ${anuncios.semProdutoVinculado}`,
      `Comissão: ${contexto.economia.comissao} · Frete: ${contexto.economia.frete}`,
      contexto.sincronizacao.maisRecente
        ? `Sincronização mais recente: ${new Date(contexto.sincronizacao.maisRecente).toLocaleString('pt-BR')}`
        : 'Nenhum anúncio sincronizado ainda',
    ],
    sugestoes: ['Ver anúncios sem produto vinculado', 'Recalcular preços deste canal', 'Conferir campanhas ativas'],
  })

  try {
    const execucao = await perguntarJSONComGateway({
      supabase, empresaId, usuarioId: user.id,
      funcionalidade: 'marketplaces',
      prompt,
    })
    if (!execucao.ok) {
      if (!execucao.fallbackAutomatico) {
        return NextResponse.json({ ok: false, erro: 'A IA está indisponível ou atingiu o limite desta empresa.' }, { status: 503 })
      }
      return NextResponse.json({ ok: true, resultado: automatica() })
    }
    const resultado = validarResultado(execucao.valor)
    if (!resultado) throw new Error('Resposta da IA fora do formato esperado')
    return NextResponse.json({ ok: true, resultado: { ...resultado, modo: 'ia' } satisfies Resultado })
  } catch {
    return NextResponse.json({ ok: true, resultado: automatica() })
  }
}
