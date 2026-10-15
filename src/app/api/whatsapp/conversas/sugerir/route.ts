import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { perguntarComConsultas } from '@/lib/ia/comConsultas'
import { registrarConsumoIA } from '@/lib/ia/gateway'
import type { Consulta } from '@/lib/ia/consultas/tipos'
import { buscarProdutoInteligente } from '@/lib/busca/produtoInteligente'
import { precoVigente, promocaoVigente } from '@/lib/produtos/promocao'
import { historicoParaPrompt, montarPromptSugestao, precosForaDoCadastro, type MensagemHistorico } from '@/lib/whatsapp/sugestao'

// Sugestão de resposta para a conversa aberta (botão "Sugerir resposta").
// Só devolve o rascunho para a tela: nada é enviado daqui. Ver
// src/lib/whatsapp/sugestao.ts para as regras.

export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MODELO = 'claude-haiku-4-5-20251001'
const FUNCIONALIDADE = 'whatsapp_sugestao'
const LIMITE_POR_HORA = 60
const r2 = (v: number) => Math.round(v * 100) / 100
const diaMes = (s: string | null | undefined) => {
  const d = s ? new Date(s) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }) : null
}

type ProdutoVisto = { id: string; nome: string; preco: number | null; precoNormal: number | null; promocaoAte: string | null; estoque: number | null; unidade: string | null }

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(supabase, user.id, 'empresa_id, nome')
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 400 })

  const { contatoId } = await request.json().catch(() => ({})) as { contatoId?: string }
  if (!contatoId || !UUID.test(contatoId)) return NextResponse.json({ error: 'Conversa inválida' }, { status: 400 })

  const umaHora = new Date(Date.now() - 3_600_000).toISOString()
  const [{ data: contato }, { data: mensagens }, { data: iaCfg }, { count: usadas }, { data: cfg }, { data: empresa }] = await Promise.all([
    supabase.from('whatsapp_conversas').select('id, nome_whatsapp, cliente_id, cliente_nome')
      .eq('empresa_id', empresaId).eq('id', contatoId).maybeSingle(),
    supabase.from('whatsapp_mensagens').select('tipo, conteudo, created_at')
      .eq('empresa_id', empresaId).eq('contato_id', contatoId)
      .order('created_at', { ascending: false }).limit(20),
    supabase.from('ia_empresa_config').select('habilitado, provedor').eq('empresa_id', empresaId).maybeSingle(),
    supabase.from('ia_consumo').select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId).eq('funcionalidade', FUNCIONALIDADE).gte('created_at', umaHora),
    supabase.from('whatsapp_config').select('horario_atendimento').eq('empresa_id', empresaId).maybeSingle(),
    supabase.from('empresas').select('nome, nome_fantasia, logradouro, numero, bairro, cidade, uf').eq('id', empresaId).maybeSingle(),
  ])

  if (!contato) return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
  // Desligada pelo administrador da IA da empresa: respeita.
  if (iaCfg && (iaCfg.habilitado === false || iaCfg.provedor === 'desativado'))
    return NextResponse.json({ error: 'A IA está desativada para esta empresa.' }, { status: 403 })
  if ((usadas ?? 0) >= LIMITE_POR_HORA)
    return NextResponse.json({ error: 'Muitas sugestões na última hora. Tente de novo daqui a pouco.' }, { status: 429 })
  const historico = ((mensagens ?? []) as MensagemHistorico[]).reverse()
  if (!historico.length) return NextResponse.json({ error: 'Ainda não há mensagens nesta conversa.' }, { status: 400 })

  // Busca de produto do jeito do balcão (mesma do Getúlio), com o preço que
  // vale HOJE (promoção só quando vigente) e só produtos ativos. Tudo o que
  // a IA viu fica guardado para conferir o preço do rascunho.
  const admin = createAdminClient()
  const vistos = new Map<string, ProdutoVisto>()
  const buscarProduto: Consulta = {
    nome: 'buscar_produto',
    descricao: 'Acha produtos do cadastro da loja pelo jeito que o cliente falou: palavras em qualquer ordem, sem acento, plural, abreviações. Devolve nome, código, preço de hoje (com a promoção, se estiver valendo) e se tem estoque. Use para CADA produto que o cliente perguntar.',
    parametros: {
      type: 'object',
      properties: { termo: { type: 'string', description: 'As palavras do cliente sobre o produto (ex.: "tinta coral branca 18 litros").' } },
      required: ['termo'],
    },
    async executar(_sb, empresa, args) {
      const termo = String(args.termo ?? '').trim().slice(0, 120)
      if (termo.length < 2) return { linhas: [], periodo: 'cadastro atual', ressalvas: ['Informe o que procurar.'] }
      const r = await buscarProdutoInteligente(admin, empresa, termo, 20)
      const candidatos = [...r.exatos.slice(0, 8), ...(r.exatos.length < 3 ? r.parecidos.slice(0, 5) : [])]
      if (!candidatos.length) return { linhas: [], periodo: 'cadastro atual', ressalvas: ['Nada encontrado no cadastro. Não invente: diga que vai verificar.'] }
      const { data } = await supabase.from('produtos')
        .select('id, nome, sku, unidade, ativo, controlar_estoque, estoque, preco_venda, preco_promocional, promocao_ativa, promocao_inicio, promocao_fim')
        .eq('empresa_id', empresa).eq('ativo', true).in('id', candidatos.map(c => c.id))
      const exatos = new Set(r.exatos.map(p => p.id))
      const agora = new Date()
      const linhas = (data ?? []).map(p => {
        const preco = precoVigente(p, agora), normal = Number(p.preco_venda ?? 0), promo = promocaoVigente(p, agora)
        const visto: ProdutoVisto = {
          id: p.id, nome: p.nome, unidade: p.unidade ?? null,
          preco: preco > 0 ? r2(preco) : null,
          precoNormal: promo && normal > preco ? r2(normal) : null,
          promocaoAte: promo ? diaMes(p.promocao_fim) : null,
          estoque: p.controlar_estoque === false ? null : Number(p.estoque ?? 0),
        }
        vistos.set(p.id, visto)
        return {
          produto: p.nome, codigo: p.sku, unidade: p.unidade,
          tipo: exatos.has(p.id) ? 'bate com o pedido' : 'parecido (confira se é o que o cliente quer)',
          preco_hoje: visto.preco ?? 'sem preço cadastrado — não cite preço',
          ...(visto.precoNormal ? { preco_normal: visto.precoNormal, promocao_valendo_ate: visto.promocaoAte ?? 'sem data de fim' } : {}),
          estoque: visto.estoque === null ? 'estoque não controlado' : visto.estoque > 0 ? 'tem disponível' : 'em falta',
          ...(visto.estoque !== null && visto.estoque > 0 ? { quantidade: visto.estoque } : {}),
        }
      })
      return { linhas, periodo: 'cadastro e estoque de agora', ressalvas: ['Use só estes preços, exatamente como estão.'] }
    },
  }

  const endereco = empresa?.logradouro
    ? [[empresa.logradouro, empresa.numero].filter(Boolean).join(', '), empresa.bairro, [empresa.cidade, empresa.uf].filter(Boolean).join(' - ')].filter(Boolean).join(', ')
    : null
  const prompt = montarPromptSugestao({
    loja: empresa?.nome_fantasia || empresa?.nome || '',
    horario: cfg?.horario_atendimento, endereco,
    nomeCliente: contato.cliente_nome || contato.nome_whatsapp,
    ehCliente: Boolean(contato.cliente_id),
    historico: historicoParaPrompt(historico),
    hoje: new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }),
  })

  const inicio = Date.now()
  const controller = new AbortController()
  const tempo = setTimeout(() => controller.abort(), 40_000)
  try {
    const r = await perguntarComConsultas({
      sb: supabase, empresaId, prompt, consultas: [buscarProduto], modelo: MODELO, maxTokens: 900, signal: controller.signal,
    })
    if (!r.ok) throw new Error(r.motivo)
    const valor = (r.valor ?? {}) as { resposta?: unknown; nota?: unknown }
    const resposta = typeof valor.resposta === 'string' ? valor.resposta.trim().slice(0, 1500) : ''
    const nota = typeof valor.nota === 'string' ? valor.nota.trim().slice(0, 300) : ''
    const produtos = [...vistos.values()]

    // Preço fora do cadastro: descarta o rascunho (nunca corrige sozinho).
    const permitidos = produtos.flatMap(p => [p.preco, p.precoNormal]).filter((v): v is number => v != null)
    const fora = resposta ? precosForaDoCadastro(resposta, permitidos) : []
    const status = !resposta ? 'erro' : fora.length ? 'descartada' : 'sucesso'
    await registrarConsumoIA(supabase, {
      empresa_id: empresaId, usuario_id: user.id, funcionalidade: FUNCIONALIDADE, provedor: 'anthropic', modelo: MODELO,
      status: status === 'sucesso' ? 'sucesso' : 'erro', tokens_entrada: r.tokensEntrada, tokens_saida: r.tokensSaida,
      latencia_ms: Date.now() - inicio, ...(status === 'descartada' ? { categoria_erro: 'preco_fora_do_cadastro' } : {}),
    })
    if (!resposta) return NextResponse.json({ error: 'A IA não conseguiu sugerir uma resposta. Tente de novo.' }, { status: 502 })
    if (fora.length) return NextResponse.json({
      error: 'A sugestão citou um preço que não está no cadastro e foi descartada. Tente de novo ou responda manualmente.',
      produtos,
    }, { status: 422 })
    return NextResponse.json({ sugestao: resposta, nota, produtos })
  } catch (e) {
    await registrarConsumoIA(supabase, {
      empresa_id: empresaId, usuario_id: user.id, funcionalidade: FUNCIONALIDADE, provedor: 'anthropic', modelo: MODELO,
      status: 'erro', latencia_ms: Date.now() - inicio, categoria_erro: e instanceof Error ? e.message.slice(0, 120) : 'erro_desconhecido',
    })
    return NextResponse.json({ error: 'A IA não respondeu agora. Tente de novo em instantes.' }, { status: 502 })
  } finally {
    clearTimeout(tempo)
  }
}
