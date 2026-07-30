import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sugerirCategoria } from '@/lib/mercadolivre/listing'
import { perguntarJSON, MODELO_FORTE } from '@/lib/ia/claude'
import type { MLChannel } from '@/lib/mercadolivre/types'

export async function POST(req: Request) {
  const { canalId, titulo, produtoCategoria } = await req.json()
  if (!canalId || !titulo) return NextResponse.json({ ok: false, erro: 'canalId/titulo ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: canalRow } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em')
    .eq('id', canalId).eq('empresa_id', empresaId).eq('plataforma', 'mercadolivre').single()

  if (!canalRow) return NextResponse.json({ ok: false, erro: 'Canal Mercado Livre não encontrado' }, { status: 404 })
  if (!canalRow.access_token) return NextResponse.json({ ok: false, erro: 'Canal não conectado — refaça a autenticação em Configurar.' }, { status: 400 })

  const canal: MLChannel = {
    id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token, tokenExpiraEm: canalRow.token_expira_em,
  }

  try {
    let sugestao = await sugerirCategoria({ sb, canal }, titulo)
    let via: 'termo_original' | 'termo_reescrito' = 'termo_original'

    // A ferramenta do Mercado Livre é literal: com o nome abreviado e sem
    // acento que vem do cadastro ("BOCAL FLEXIVEL C/BOTAO") ela devolve
    // vazio, e o operador ficava sem categoria e sem o botão de IA, que só
    // aparece depois que a categoria resolve. Medido contra a API real:
    // esse mesmo produto escrito por extenso ("Bocal Flexível Com Botão
    // para Lâmpada") devolve MLB270531 "Porta Lâmpadas".
    // Então, só quando a busca literal falha, a IA reescreve o termo e a
    // busca oficial roda de novo — quem decide a categoria continua sendo
    // o Mercado Livre, a IA só traduz o nome interno pra linguagem de busca.
    if (!sugestao) {
      const termos = await termosDeBusca(titulo, produtoCategoria ?? null)
      for (const termo of termos) {
        sugestao = await sugerirCategoria({ sb, canal }, termo)
        if (sugestao) { via = 'termo_reescrito'; break }
      }
    }

    return NextResponse.json({ ok: true, sugestao, via })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'Erro ao sugerir categoria' }, { status: 400 })
  }
}

// Reescreve o nome do produto em até 3 termos de busca, do mais específico
// pro mais genérico — se o específico não achar categoria, o genérico acha.
async function termosDeBusca(nome: string, produtoCategoria: string | null): Promise<string[]> {
  try {
    const resultado = await perguntarJSON(
      `Nome de cadastro interno de uma loja de bazar/ferragens, abreviado e sem acento: "${nome}"
${produtoCategoria ? `Categoria interna da loja: "${produtoCategoria}"` : 'Categoria interna: não informada'}

Reescreva em até 3 termos de busca para achar a categoria certa no Mercado Livre.

Regras:
- Escreva por extenso e acentuado ("C/" vira "com", "P/" vira "para", "CX" vira "caixa").
- CADA termo precisa deixar claro PARA QUE SERVE o produto, usando a categoria interna como pista. Termo ambíguo leva a categoria errada: medido contra a API real, "bocal flexível com botão" caiu em "Para Trompetes"; com a pista de que é acessório hidráulico, caiu em "Bocais", que é o certo.
- Do mais específico pro mais genérico.
- Sem marca, código de modelo ou medida.

Responda SOMENTE com JSON: {"termos": ["...", "...", "..."]}`,
      MODELO_FORTE,
    )
    const termos = Array.isArray(resultado?.termos) ? resultado.termos : []
    return termos.filter((t: unknown) => typeof t === 'string' && t.trim()).slice(0, 3).map((t: string) => t.trim())
  } catch {
    return []
  }
}
