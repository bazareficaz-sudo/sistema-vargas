import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

// Traz para o cadastro as fotos que o produto JÁ TEM nos próprios anúncios.
// Medido em 08/10/2026: 110 produtos sem foto no cadastro tinham foto no
// anúncio (as correntes do ML, por exemplo) — a imagem existia, só nunca
// tinha sido copiada. É seguro em lote: a foto é daquele produto.
// Sem `ids`, faz em todos os elegíveis. Só toca produto SEM nenhuma foto.
export async function POST(req: Request) {
  const { ids } = await req.json().catch(() => ({})) as { ids?: string[] }
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'editar_produtos')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const lista = Array.isArray(ids) ? ids.filter(x => typeof x === 'string').slice(0, 2000) : null
  const { data, error } = await sb.rpc('copiar_fotos_dos_anuncios', { p_empresa: guarda.empresaId, p_ids: lista })
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  const r = Array.isArray(data) ? data[0] : data
  return NextResponse.json({ ok: true, produtos: Number(r?.produtos ?? 0), fotos: Number(r?.fotos ?? 0) })
}
