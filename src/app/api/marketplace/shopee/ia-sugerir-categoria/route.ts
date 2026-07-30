import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCategoryTree, type CategoriaShopee } from '@/lib/shopee/listing'
import { perguntarJSON, MODELO_FORTE } from '@/lib/ia/claude'
import type { ShopeeChannel } from '@/lib/shopee/types'

const MAX_NIVEIS = 6

async function escolherCategoriaIA(opcoes: CategoriaShopee[], produtoNome: string, produtoMarca: string | null, produtoCategoria: string | null, caminhoAtual: string[]): Promise<number | null> {
  const lista = opcoes.map(o => `${o.category_id}: ${o.original_category_name}`).join('\n')
  const contexto = caminhoAtual.length > 0 ? `Caminho já escolhido até aqui: ${caminhoAtual.join(' › ')}.` : 'Este é o primeiro nível (categorias raiz).'
  const prompt = `Você está escolhendo a categoria da Shopee mais adequada pra um produto de loja.

Produto: "${produtoNome}"${produtoMarca ? ` — marca: ${produtoMarca}` : ''}${produtoCategoria ? ` — categoria interna da loja: ${produtoCategoria}` : ''}

${contexto}

Nomes de produto de loja vêm abreviados e sem acento ("BOCAL FLEXIVEL C/BOTAO" = bocal flexível com botão; "C/" = "com", "P/" = "para"). Interprete a abreviação antes de decidir.

Escolha, entre as opções abaixo, a categoria que melhor representa esse produto neste nível da árvore. Prefira sempre a opção mais próxima, mesmo que não seja perfeita — responder null faz o vendedor ter que navegar a árvore inteira na mão. Use {"category_id": null} só se NENHUMA opção tiver qualquer relação com o produto.

Responda SOMENTE com um JSON no formato {"category_id": <id>} usando o id de uma das opções.

Opções:
${lista}`

  try {
    // Modelo forte: escolher o ramo raiz certo entre dezenas de categorias a
    // partir de um nome abreviado é a mesma classe de tarefa em que o Haiku
    // falhou no NCM. Quando ele responde null no primeiro nível, a sugestão
    // inteira morre e o usuário fica sem categoria e sem descrição.
    const resultado = await perguntarJSON(prompt, MODELO_FORTE)
    const id = resultado?.category_id
    if (id == null) return null
    const valido = opcoes.some(o => o.category_id === Number(id))
    return valido ? Number(id) : null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const { canalId, produtoNome, produtoMarca, produtoCategoria } = await req.json()
  if (!canalId || !produtoNome) return NextResponse.json({ ok: false, erro: 'canalId/produtoNome ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: canalRow } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em')
    .eq('id', canalId).eq('empresa_id', empresaId).eq('plataforma', 'shopee').single()

  if (!canalRow) return NextResponse.json({ ok: false, erro: 'Canal Shopee não encontrado' }, { status: 404 })
  if (!canalRow.access_token) return NextResponse.json({ ok: false, erro: 'Canal não conectado — refaça a autenticação em Configurar.' }, { status: 400 })

  const canal: ShopeeChannel = {
    id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token, tokenExpiraEm: canalRow.token_expira_em,
  }

  try {
    const ctx = { sb, canal }
    const opcoesPorNivel: CategoriaShopee[][] = []
    const caminho: CategoriaShopee[] = []
    let parentCategoryId: number | undefined = undefined

    for (let nivel = 0; nivel < MAX_NIVEIS; nivel++) {
      const opcoes = await getCategoryTree(ctx, parentCategoryId)
      if (opcoes.length === 0) break

      const escolhidaId = await escolherCategoriaIA(opcoes, produtoNome, produtoMarca ?? null, produtoCategoria ?? null, caminho.map(c => c.original_category_name))
      if (escolhidaId == null) break

      const escolhida = opcoes.find(o => o.category_id === escolhidaId)!
      opcoesPorNivel.push(opcoes)
      caminho.push(escolhida)

      if (!escolhida.has_children) break
      parentCategoryId = escolhida.category_id
    }

    const resolvidoAteFolha = caminho.length > 0 && !caminho[caminho.length - 1].has_children
    return NextResponse.json({ ok: true, opcoesPorNivel, caminho, resolvidoAteFolha })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'Erro ao sugerir categoria com IA' }, { status: 400 })
  }
}
