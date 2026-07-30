import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calcularPeriodo, TIPO_LABEL, deltaMovimento, type PeriodoPreset } from '@/lib/estoque/periodo'

function escapar(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`
}

// Reaplica os mesmos filtros da tela de Movimentação de Estoque e devolve
// um CSV com TODAS as linhas que batem (não só a página atual) — pagina em
// blocos de 1000 pelo mesmo motivo da listagem de Anúncios: o projeto
// Supabase tem "Max Rows" do PostgREST em 1000, um .limit() único maior
// fica travado silenciosamente nesse teto.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 400 })

  const sp = req.nextUrl.searchParams
  const modo = sp.get('modo') || 'periodo'
  const produtoId = sp.get('produto') || ''
  const depositoId = sp.get('deposito') || ''
  const tipos = (sp.get('tipos') || '').split(',').filter(Boolean)
  const periodo = (sp.get('periodo') || '30d') as PeriodoPreset
  const de = sp.get('de') || ''
  const ate = sp.get('ate') || ''

  const { inicio, fim } = calcularPeriodo(periodo, de, ate)

  const TAMANHO_PAGINA = 1000
  const linhas: any[] = []
  for (let offset = 0; offset < 20 * TAMANHO_PAGINA; offset += TAMANHO_PAGINA) {
    let q = supabase.from('estoque_movimentacoes').select('*')
      .eq('empresa_id', empresaId)
      .gte('created_at', inicio).lte('created_at', fim)
      .order('created_at', { ascending: modo === 'produto' })
      .range(offset, offset + TAMANHO_PAGINA - 1)
    if (modo === 'produto' && produtoId) q = q.eq('produto_id', produtoId)
    if (depositoId) q = q.eq('deposito_id', depositoId)
    if (tipos.length > 0) q = q.in('tipo', tipos)
    const { data } = await q
    linhas.push(...(data ?? []))
    if (!data || data.length < TAMANHO_PAGINA) break
  }

  const { data: depositos } = await supabase.from('depositos').select('id, nome').eq('empresa_id', empresaId)
  const depositosMap = new Map((depositos ?? []).map(d => [d.id, d.nome]))

  const cabecalho = ['Data/Hora', 'Produto', 'Tipo', 'Depósito', 'Documento/Motivo', 'Entrada', 'Saída', 'Saldo após', 'Usuário', 'Observação']
  const corpo = linhas.map(m => {
    const delta = deltaMovimento(m)
    return [
      new Date(m.created_at).toLocaleString('pt-BR'),
      m.produto_nome,
      TIPO_LABEL[m.tipo] ?? m.tipo,
      depositosMap.get(m.deposito_id) ?? '',
      m.motivo ?? '',
      delta > 0 ? delta : '',
      delta < 0 ? Math.abs(delta) : '',
      m.estoque_novo ?? '',
      m.usuario ?? '',
      m.observacao ?? '',
    ].map(escapar).join(';')
  })

  // BOM (﻿) + separador ; — abre certo no Excel em pt-BR (que usa ,
  // como separador decimal, então usa ; como separador de coluna).
  const BOM = String.fromCharCode(0xFEFF)
  const csv = BOM + [cabecalho.map(escapar).join(';'), ...corpo].join('\r\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="movimentacoes-estoque-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
