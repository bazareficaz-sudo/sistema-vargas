import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { varrerRecalculo } from '@/lib/precificacao/recalculo'
import { cruzarCompetitividade, diagnosticar, type AchadoCompetitivo } from '@/lib/precificacao/analise'
import { buscarCompetitividade } from '@/lib/precificacao/competitividade'
import { criarResolvedor, COLUNAS_ANUNCIO, COLUNAS_PRODUTO } from '@/lib/precificacao/contexto'
import { avaliarPreco, precificarPorObjetivo } from '@/lib/precificacao/cenarios'
import { buscarRegras, resolverRegra } from '@/lib/precificacao/regras'
import { refreshAccessTokenIfNeeded } from '@/lib/mercadolivre/client'
import { perguntarJSON, MODELO_FORTE } from '@/lib/ia/claude'

// Análise da precificação: diagnósticos + competitividade + explicação em
// linguagem simples.
//
// A ordem importa. Primeiro os números saem do cálculo determinístico sobre
// os dados reais. Só depois a IA recebe esses números prontos e escreve o
// texto. Ela nunca calcula nada — se falhar, os achados continuam certos.

export const maxDuration = 300

// Consultar a sugestão de preço do ML é uma chamada por anúncio. Limito para
// a análise não virar uma varredura de meia hora — os de maior impacto vêm
// primeiro, que são os que interessam.
const MAX_COMPETITIVIDADE = 40

export async function POST(req: Request) {
  const { canaisIds, comIA, comCompetitividade } = await req.json().catch(() => ({}))

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  // Um relógio só para a análise inteira: a varredura e o cruzamento de
  // competitividade precisam concordar sobre o que está vigente agora.
  const agora = new Date()
  const { resumo, itens } = await varrerRecalculo(sb, guarda.empresaId, { canaisIds, apenasAtivos: true, agora })
  const achados = diagnosticar({ resumo, itens })

  // ── Competitividade (só Mercado Livre — a Shopee não expõe isso) ──
  const competitivos: AchadoCompetitivo[] = []
  let competitividadeIndisponivel: string | null = null

  if (comCompetitividade) {
    const { data: canaisML } = await sb.from('marketplace_canais')
      .select('id, nome, plataforma, empresa_id, seller_id, access_token, refresh_token, token_expira_em')
      .eq('empresa_id', guarda.empresaId).eq('plataforma', 'mercadolivre')

    if (!canaisML?.length) {
      competitividadeIndisponivel = 'Nenhum canal do Mercado Livre conectado. A Shopee não publica comparação de preço com concorrentes.'
    } else {
      const regras = await buscarRegras(sb, guarda.empresaId)
      const tokenPorCanal = new Map<string, string>()
      // A economia sai do MESMO resolvedor da varredura. Antes esta parte
      // remontava a configuração por conta própria e chamava o motor sem a
      // comissão nem o frete reais do ML — então a "margem se adotar o preço
      // sugerido" não era comparável com a margem da linha logo acima dela.
      const resolvedor = criarResolvedor(sb, guarda.empresaId, agora)
      for (const c of canaisML) {
        try {
          const atualizado = await refreshAccessTokenIfNeeded(sb, {
            id: c.id, empresaId: c.empresa_id, sellerId: c.seller_id,
            accessToken: c.access_token, refreshToken: c.refresh_token, tokenExpiraEm: c.token_expira_em,
          })
          tokenPorCanal.set(c.id, atualizado.accessToken)
        } catch { /* canal sem conexão fica de fora, os outros seguem */ }
      }

      const idsCanaisML = new Set(canaisML.map(c => c.id))
      // Anúncios do ML entre os já calculados, dos de maior impacto pra baixo.
      const candidatos = itens.filter(i => idsCanaisML.has(i.canalId)).slice(0, MAX_COMPETITIVIDADE)

      const { data: anunciosRows } = candidatos.length > 0
        ? await sb.from('marketplace_anuncios').select(`${COLUNAS_ANUNCIO}, produtos(${COLUNAS_PRODUTO})`)
            .in('id', candidatos.map(c => c.anuncioId)).eq('empresa_id', guarda.empresaId)
        : { data: [] as any[] }
      const porId = new Map((anunciosRows ?? []).map((a: any) => [a.id, a]))
      const canalPorId = new Map(canaisML.map((c: any) => [c.id, c]))

      for (const item of candidatos) {
        const linha = porId.get(item.anuncioId)
        const token = tokenPorCanal.get(item.canalId)
        if (!linha?.id_externo || !token) continue

        const comp = await buscarCompetitividade(token, String(linha.id_externo))
        if (!comp?.temBenchmark || comp.precoSugerido == null) continue

        const p: any = linha.produtos
        const canalDoItem = canalPorId.get(item.canalId)
        if (!canalDoItem) continue
        const ctx = await resolvedor.contexto({ canal: canalDoItem, produto: p, anuncio: linha })

        // Qual seria a margem se adotássemos o preço sugerido pelo ML?
        const noSugerido = avaliarPreco(ctx.economia, comp.precoSugerido, 'sugerido pelo ML')

        // E até onde dá pra baixar sem furar a margem mínima da regra?
        const resolucao = resolverRegra(regras, { id: linha.produto_id, categoria: p?.categoria ?? null, marca: p?.marca ?? null }, { id: item.canalId, plataforma: 'mercadolivre' })
        const piso = resolucao.vencedora?.margemMinima
        const precoMinimoViavel = piso != null
          ? precificarPorObjetivo(ctx.economia, { tipo: 'margem_liquida', valor: piso }).resultado.preco
          : null

        const achado = cruzarCompetitividade(comp, {
          anuncioId: item.anuncioId, titulo: item.titulo || item.produtoNome, canalNome: item.canalNome,
          margemNoSugerido: Number(noSugerido.resultado.margemLiquida.toFixed(1)),
          precoMinimoViavel,
        })
        if (achado) competitivos.push(achado)
      }

      if (competitivos.length === 0 && candidatos.length > 0) {
        competitividadeIndisponivel = `O Mercado Livre não tem comparação de preço para nenhum dos ${candidatos.length} anúncios analisados. Isso é comum em item sem concorrente direto no catálogo.`
      }
    }
  }

  // ── Redação em linguagem simples (opcional) ──
  let resumoIA: string | null = null
  let erroIA: string | null = null

  if (comIA && achados.length > 0) {
    try {
      const dados = {
        totalAnunciosVarridos: resumo.totalAnuncios,
        calculados: resumo.calculados,
        achados: achados.map(a => ({ titulo: a.titulo, detalhe: a.detalhe, severidade: a.severidade })),
        competitividade: competitivos.slice(0, 8).map(c => ({
          anuncio: c.titulo, precoAtual: c.precoAtual, sugeridoPeloML: c.precoSugerido,
          situacao: c.statusRotulo, margemSeAdotar: c.margemNoSugerido, cabeNaMargemMinima: c.sugestaoCabe,
        })),
      }
      const r = await perguntarJSON(
        `Você está explicando a situação de preços de uma loja brasileira para o dono, que não é técnico.

DADOS JÁ CALCULADOS (não recalcule nada, não invente número nenhum — use exatamente estes):
${JSON.stringify(dados, null, 2)}

Escreva um resumo curto em português do Brasil, no máximo 5 frases, dizendo o que mais importa e o que fazer primeiro.
Fale como um sócio que olhou os números, não como relatório. Sem jargão. Sem saudação. Sem repetir todos os números — cite só os que mudam a decisão.
Se houver prejuízo, comece por ele.

Responda em JSON: {"resumo": "..."}`,
        MODELO_FORTE,
      )
      resumoIA = typeof r?.resumo === 'string' ? r.resumo : null
    } catch (e: any) {
      erroIA = e?.message ?? 'A IA não respondeu'
    }
  }

  return NextResponse.json({
    ok: true, resumo, achados, competitivos, competitividadeIndisponivel, resumoIA, erroIA,
    limiteCompetitividade: MAX_COMPETITIVIDADE,
  })
}
