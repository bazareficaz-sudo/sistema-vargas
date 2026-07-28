import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

// Busca produto pra vínculo manual — sempre passa pelo servidor (nunca
// consulta direto do cliente) porque o lado "b" pode ser o catálogo da
// empresa PARCEIRA, e produtos não tem RLS habilitada: uma consulta direta
// do navegador bastaria pra ler qualquer empresa_id, não só o parceiro
// desta parceria. Aqui o guard confirma a posse da parceria antes de deixar
// consultar o catálogo de qualquer um dos dois lados.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: parceriaId } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: parceria } = await sb.from('empresa_parcerias').select('id, empresa_id_a, empresa_id_b, status').eq('id', parceriaId).maybeSingle()
  if (!parceria || (parceria.empresa_id_a !== guarda.empresaId && parceria.empresa_id_b !== guarda.empresaId)) {
    return NextResponse.json({ ok: false, erro: 'Parceria não encontrada' }, { status: 404 })
  }

  const url = new URL(req.url)
  const lado = url.searchParams.get('lado') === 'a' ? 'a' : 'b'
  const q = (url.searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ ok: true, resultados: [] })

  const empresaAlvo = lado === 'a' ? parceria.empresa_id_a : parceria.empresa_id_b
  const { data } = await sb.from('produtos').select('id, nome, sku, ean')
    .eq('empresa_id', empresaAlvo).eq('ativo', true)
    .or(`nome.ilike.%${q}%,sku.ilike.%${q}%,ean.ilike.%${q}%`)
    .limit(10)

  return NextResponse.json({ ok: true, resultados: data ?? [] })
}
