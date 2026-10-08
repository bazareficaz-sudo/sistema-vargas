import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'

// Grava o que o operador conferiu na tela de Prontidão: peso, medidas,
// descrição e marca. Só os campos enviados mudam — campo ausente fica como
// está, e nunca se apaga um valor que já existia mandando vazio.
const MAX_ITENS = 200

function numero(v: unknown, max: number): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return undefined
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n * 1000) / 1000 : undefined
}

export async function POST(req: Request) {
  const { itens } = await req.json().catch(() => ({})) as { itens?: any[] }
  if (!Array.isArray(itens) || itens.length === 0) return NextResponse.json({ ok: false, erro: 'Nada para salvar' }, { status: 400 })

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'editar_produtos')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  let salvos = 0
  const falhas: { id: string; erro: string }[] = []
  for (const item of itens.slice(0, MAX_ITENS)) {
    if (typeof item?.id !== 'string') continue
    const campos: Record<string, unknown> = {}
    const peso = numero(item.peso_kg, 150)
    const c = numero(item.comprimento_cm, 300), l = numero(item.largura_cm, 300), a = numero(item.altura_cm, 300)
    if (peso !== undefined) campos.peso_kg = peso
    if (c !== undefined) campos.comprimento_cm = c
    if (l !== undefined) campos.largura_cm = l
    if (a !== undefined) campos.altura_cm = a
    if (typeof item.descricao_marketplace === 'string' && item.descricao_marketplace.trim()) {
      campos.descricao_marketplace = item.descricao_marketplace.trim().slice(0, 4000)
    }
    if (typeof item.marca === 'string' && item.marca.trim()) campos.marca = item.marca.trim().slice(0, 80)
    if (Object.keys(campos).length === 0) continue

    const { error } = await sb.from('produtos')
      .update({ ...campos, updated_at: new Date().toISOString() })
      .eq('id', item.id).eq('empresa_id', guarda.empresaId)
    if (error) falhas.push({ id: item.id, erro: error.message })
    else salvos++
  }

  if (salvos > 0) {
    await registrarAuditoria(sb, {
      empresaId: guarda.empresaId, usuarioId: guarda.userId,
      acao: 'prontidao_cadastro', tabela: 'produtos', valorNovo: { salvos },
    })
  }
  return NextResponse.json({ ok: falhas.length === 0, salvos, falhas })
}
