import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

export const dynamic = 'force-dynamic'

// Assistente de implantação: formaliza o campo produto_estoque.localizacao
// (texto livre, já em uso informal) em endereços de verdade. Opt-in e
// supervisionado — GET só mostra o preview, POST só executa o que o gestor
// confirmou explicitamente. Nunca migração automática silenciosa: texto
// livre historicamente inconsistente ("Prateleira 3" vs "prateleira3")
// precisa de revisão humana antes de virar hierarquia estruturada.

export async function GET(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { searchParams } = new URL(req.url)
  const depositoId = searchParams.get('depositoId')
  if (!depositoId) return NextResponse.json({ ok: false, erro: 'Escolha o depósito.' }, { status: 400 })

  const { data: linhas } = await sb.from('produto_estoque')
    .select('localizacao, quantidade').eq('deposito_id', depositoId).eq('empresa_id', guarda.empresaId)
    .not('localizacao', 'is', null).gt('quantidade', 0)

  const porValor = new Map<string, { valor: string; produtos: number; unidades: number }>()
  for (const l of linhas ?? []) {
    const valor = String(l.localizacao ?? '').trim()
    if (!valor) continue
    const atual = porValor.get(valor) ?? { valor, produtos: 0, unidades: 0 }
    atual.produtos += 1
    atual.unidades += Number(l.quantidade ?? 0)
    porValor.set(valor, atual)
  }

  return NextResponse.json({ ok: true, valores: [...porValor.values()].sort((a, b) => b.produtos - a.produtos) })
}

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({})) as { depositoId?: string; valores?: string[] }
  const { depositoId, valores } = body
  if (!depositoId || !Array.isArray(valores) || valores.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Escolha o depósito e ao menos um valor.' }, { status: 400 })
  }

  const { data: deposito } = await sb.from('depositos').select('id').eq('id', depositoId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!deposito) return NextResponse.json({ ok: false, erro: 'Depósito inválido.' }, { status: 400 })

  let enderecosCriados = 0, produtosEnderecados = 0

  for (const valorBruto of valores) {
    const valor = valorBruto.trim()
    if (!valor) continue
    const codigo = valor.toUpperCase()

    let { data: endereco } = await sb.from('enderecos')
      .select('id').eq('empresa_id', guarda.empresaId).eq('deposito_id', depositoId).eq('codigo_interno', codigo).maybeSingle()
    if (!endereco) {
      const { data: novo, error } = await sb.from('enderecos').insert({
        empresa_id: guarda.empresaId, deposito_id: depositoId,
        codigo_interno: codigo, codigo_legivel: valor, descricao: 'Importado da localização de texto livre.',
        tipo: 'ARMAZENAGEM', qr_code_valor: codigo, codigo_barras_valor: codigo, criado_por: guarda.userId,
      }).select('id').single()
      if (error || !novo) continue
      endereco = novo
      enderecosCriados++
    }

    const { data: linhas } = await sb.from('produto_estoque')
      .select('produto_id, quantidade').eq('deposito_id', depositoId).eq('localizacao', valorBruto).gt('quantidade', 0)

    for (const l of linhas ?? []) {
      const { data: jaExiste } = await sb.from('produto_enderecos')
        .select('id').eq('endereco_id', endereco.id).eq('produto_id', l.produto_id).maybeSingle()
      if (jaExiste) continue
      const { error } = await sb.from('produto_enderecos').insert({
        empresa_id: guarda.empresaId, deposito_id: depositoId, endereco_id: endereco.id, produto_id: l.produto_id,
        quantidade: l.quantidade,
      })
      if (!error) produtosEnderecados++
    }
  }

  return NextResponse.json({ ok: true, enderecosCriados, produtosEnderecados })
}
