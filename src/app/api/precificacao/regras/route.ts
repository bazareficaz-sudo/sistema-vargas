import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'

// CRUD das regras de precificação. A tela também precisa saber quais
// categorias, marcas e canais existem pra montar os seletores, então o GET
// devolve tudo de uma vez.

export async function GET() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const [regrasRes, canaisRes] = await Promise.all([
    sb.from('precificacao_regra').select('*').eq('empresa_id', guarda.empresaId)
      .order('nivel').order('prioridade', { ascending: false }),
    sb.from('marketplace_canais').select('id, nome, plataforma').eq('empresa_id', guarda.empresaId).order('nome'),
  ])

  // Categorias e marcas vêm do que os produtos realmente usam (são texto
  // livre em `produtos`, não tabela de domínio) — assim o seletor nunca
  // oferece uma categoria que não existe em produto nenhum.
  const categorias = new Set<string>()
  const marcas = new Set<string>()
  const TAM = 1000
  for (let off = 0; off < 20 * TAM; off += TAM) {
    const { data } = await sb.from('produtos').select('categoria, marca')
      .eq('empresa_id', guarda.empresaId).eq('ativo', true).range(off, off + TAM - 1)
    for (const p of data ?? []) {
      if (p.categoria?.trim()) categorias.add(p.categoria.trim())
      if (p.marca?.trim()) marcas.add(p.marca.trim())
    }
    if (!data || data.length < TAM) break
  }

  return NextResponse.json({
    ok: true,
    regras: regrasRes.data ?? [],
    canais: canaisRes.data ?? [],
    categorias: [...categorias].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    marcas: [...marcas].sort((a, b) => a.localeCompare(b, 'pt-BR')),
  })
}

const NIVEIS_VALIDOS = ['produto', 'categoria', 'marca', 'canal', 'plataforma', 'empresa']
const OBJETIVOS_VALIDOS = ['margem_liquida', 'sobre_custo', 'markup', 'lucro_fixo']

function validar(regra: any): string | null {
  if (!regra?.nome?.trim()) return 'Dê um nome para a regra'
  if (!NIVEIS_VALIDOS.includes(regra.nivel)) return 'Nível inválido'
  if (!OBJETIVOS_VALIDOS.includes(regra.objetivo_tipo)) return 'Objetivo inválido'
  if (!(Number(regra.objetivo_valor) > 0)) return 'O valor do objetivo precisa ser maior que zero'
  if (['produto', 'canal'].includes(regra.nivel) && !regra.alvo_id) return 'Escolha o alvo da regra'
  if (['categoria', 'marca', 'plataforma'].includes(regra.nivel) && !regra.alvo_texto?.trim()) return 'Escolha o alvo da regra'
  return null
}

export async function POST(req: Request) {
  const { regra } = await req.json()
  const erro = validar(regra)
  if (erro) return NextResponse.json({ ok: false, erro }, { status: 400 })

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const linha = {
    empresa_id: guarda.empresaId,
    nome: regra.nome.trim(),
    nivel: regra.nivel,
    alvo_id: regra.alvo_id ?? null,
    alvo_texto: regra.alvo_texto?.trim() ?? null,
    canal_id: regra.canal_id ?? null,
    objetivo_tipo: regra.objetivo_tipo,
    objetivo_valor: Number(regra.objetivo_valor),
    margem_minima: regra.margem_minima != null && regra.margem_minima !== '' ? Number(regra.margem_minima) : null,
    // Nula é uma resposta legítima e é o padrão: significa "sem política
    // promocional declarada", e o classificador então usa o próprio piso.
    // Ver supabase-precificacao-margem-promocional.sql.
    margem_promocional_minima: regra.margem_promocional_minima != null && regra.margem_promocional_minima !== ''
      ? Number(regra.margem_promocional_minima) : null,
    arredondamento: regra.arredondamento ?? 'nenhum',
    prioridade: Number(regra.prioridade ?? 0),
    ativo: regra.ativo !== false,
    criado_por: guarda.userId,
    updated_at: new Date().toISOString(),
  }

  const resposta = regra.id
    ? await sb.from('precificacao_regra').update(linha).eq('id', regra.id).eq('empresa_id', guarda.empresaId).select('id').single()
    : await sb.from('precificacao_regra').insert(linha).select('id').single()

  if (resposta.error) return NextResponse.json({ ok: false, erro: resposta.error.message }, { status: 400 })

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: regra.id ? 'regra_preco_alterada' : 'regra_preco_criada',
    tabela: 'precificacao_regra',
    valorNovo: { nome: linha.nome, nivel: linha.nivel, objetivo: `${linha.objetivo_tipo} ${linha.objetivo_valor}` },
  })

  return NextResponse.json({ ok: true, id: resposta.data?.id })
}

export async function DELETE(req: Request) {
  const { id } = await req.json()
  if (!id) return NextResponse.json({ ok: false, erro: 'Regra não informada' }, { status: 400 })

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { error } = await sb.from('precificacao_regra').delete().eq('id', id).eq('empresa_id', guarda.empresaId)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: 'regra_preco_excluida', tabela: 'precificacao_regra', valorAnterior: { id },
  })

  return NextResponse.json({ ok: true })
}
