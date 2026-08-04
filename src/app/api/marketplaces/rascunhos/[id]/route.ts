import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'

export const dynamic = 'force-dynamic'

// Edição do rascunho.
//
// Princípio da seção 5 do documento, e o motivo desta rota existir:
// `dados_origem` NUNCA é tocado aqui. O que o operador escreve vai para
// `dados_editados`, separado. Assim dá para comparar a qualquer momento o que
// veio de fora com o que virou conteúdo próprio — e desfazer, se precisar.

const STATUS_VALIDOS = ['capturado', 'aguardando_mapeamento', 'aguardando_revisao', 'pronto', 'publicado']
const METODOS_VALIDOS = ['sku', 'ean', 'nome', 'manual']

function texto(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const limpo = v.replace(/\s+/g, ' ').trim()
  return limpo ? limpo.slice(0, max) : null
}

/** Descrição preserva quebra de linha — só corta tamanho. */
function textoLongo(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const limpo = v.trim()
  return limpo ? limpo.slice(0, max) : null
}

const MAX_IMAGENS = 20

/** Só http(s), sem repetição, na ordem que o operador escolheu. */
function listaDeImagens(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const vistas = new Set<string>()
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== 'string') continue
    try {
      const u = new URL(item.trim())
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
      const url = u.toString()
      if (vistas.has(url)) continue
      vistas.add(url)
      out.push(url)
      if (out.length >= MAX_IMAGENS) break
    } catch { /* url inválida é descartada, não derruba o salvamento */ }
  }
  return out
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ ok: false, erro: 'Corpo inválido' }, { status: 400 })

  const { data: atual, error: erroBusca } = await sb
    .from('anuncio_rascunhos')
    .select('id, produto_id, status, dados_editados')
    .eq('id', id)
    .eq('empresa_id', guarda.empresaId)
    .maybeSingle()

  if (erroBusca) return NextResponse.json({ ok: false, erro: erroBusca.message }, { status: 500 })
  if (!atual) return NextResponse.json({ ok: false, erro: 'Rascunho não encontrado' }, { status: 404 })

  const patch: Record<string, any> = { updated_at: new Date().toISOString() }

  // ── Vínculo com o produto do ERP ─────────────────────────────────────────
  if ('produtoId' in body) {
    if (body.produtoId === null) {
      patch.produto_id = null
      patch.mapeamento_metodo = null
      patch.mapeamento_score = null
    } else {
      // Confirma que o produto é desta empresa. Sem isso, um id de outro
      // inquilino gravado à mão passaria — a FK sozinha não sabe de empresa.
      const { data: produto } = await sb.from('produtos')
        .select('id').eq('id', body.produtoId).eq('empresa_id', guarda.empresaId).maybeSingle()
      if (!produto) return NextResponse.json({ ok: false, erro: 'Produto não encontrado nesta empresa' }, { status: 400 })

      patch.produto_id = body.produtoId
      patch.mapeamento_metodo = METODOS_VALIDOS.includes(body.metodo) ? body.metodo : 'manual'
      const score = Number(body.score)
      patch.mapeamento_score = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null
    }
  }

  // ── Conteúdo trabalhado ──────────────────────────────────────────────────
  if (body.dadosEditados && typeof body.dadosEditados === 'object') {
    const d = body.dadosEditados
    const editados: Record<string, any> = { ...(atual.dados_editados ?? {}) }

    if ('titulo' in d) editados.titulo = texto(d.titulo, 300)
    if ('descricao' in d) editados.descricao = textoLongo(d.descricao, 20000)
    if ('marca' in d) editados.marca = texto(d.marca, 120)
    if ('categoria' in d) editados.categoria = texto(d.categoria, 300)
    if ('preco' in d) {
      const n = Number(d.preco)
      editados.preco = Number.isFinite(n) && n > 0 ? n : null
    }
    if ('imagens' in d) {
      const imagens = listaDeImagens(d.imagens)
      if (imagens) {
        editados.imagens = imagens
        // A capa da listagem passa a ser a primeira escolhida. Sem escolha
        // nenhuma, a capa continua sendo a da origem — e `qtd_imagens` segue
        // significando "quantas foram capturadas", que é o que a listagem diz.
        if (imagens.length > 0) patch.imagem_principal = imagens[0]
      }
    }

    editados.atualizadoEm = new Date().toISOString()
    patch.dados_editados = editados

    // O título de trabalho é o que aparece na listagem — se o operador
    // reescreveu, a lista precisa mostrar o texto novo, não o do vendedor.
    if (editados.titulo) patch.titulo = editados.titulo
  }

  if ('status' in body) {
    if (!STATUS_VALIDOS.includes(body.status)) {
      return NextResponse.json({ ok: false, erro: 'Status inválido' }, { status: 400 })
    }
    // "Publicado" é consequência de publicar de verdade, coisa que ainda não
    // existe. Deixar marcar à mão criaria um rótulo que mente.
    if (body.status === 'publicado') {
      return NextResponse.json({ ok: false, erro: 'A publicação ainda não está disponível — este status é definido pelo sistema ao publicar.' }, { status: 400 })
    }
    patch.status = body.status
  }

  if ('observacao' in body) patch.observacao = textoLongo(body.observacao, 2000)
  if ('colecao' in body) patch.colecao = texto(body.colecao, 80)
  if (body.arquivar === true) patch.arquivado_em = new Date().toISOString()

  const { error } = await sb.from('anuncio_rascunhos').update(patch).eq('id', id).eq('empresa_id', guarda.empresaId)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  // Histórico é best-effort: o dado principal já está salvo acima, e uma
  // falha de log não deve devolver erro para quem só queria salvar.
  const acao = 'produtoId' in body && patch.produto_id !== atual.produto_id
    ? 'mapeado'
    : patch.status && patch.status !== atual.status
      ? 'status_alterado'
      : 'editado'

  const { error: erroHist } = await sb.from('anuncio_rascunho_historico').insert({
    rascunho_id: id,
    empresa_id: guarda.empresaId,
    user_id: guarda.userId,
    acao,
    dados_antes: { produto_id: atual.produto_id, status: atual.status },
    dados_depois: { produto_id: patch.produto_id ?? atual.produto_id, status: patch.status ?? atual.status },
  })
  if (erroHist) console.error('Falha ao gravar histórico do rascunho:', erroHist)

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId,
    usuarioId: guarda.userId,
    acao: `rascunho_${acao}`,
    tabela: 'anuncio_rascunhos',
    valorNovo: JSON.stringify({ id, ...patch }).slice(0, 500),
  }).catch(() => {})

  return NextResponse.json({ ok: true })
}
