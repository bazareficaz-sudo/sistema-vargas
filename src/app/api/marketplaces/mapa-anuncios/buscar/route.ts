import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

// Mesmo algoritmo de pontuação já usado em NovaEntradaClient.tsx (busca
// ampla por qualquer palavra digitada, ranqueia por quantas batem) — só
// que rodando no servidor, já que esta é uma rota de API, não um client
// component.
function normalizar(s: string) {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export async function GET(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()
  const palavras = q.split(/\s+/).map(p => p.replace(/[,()%]/g, '')).filter(p => p.length >= 2)
  if (palavras.length === 0) return NextResponse.json({ ok: true, resultados: [] })

  const condicoes = palavras.flatMap(p => [`nome.ilike.%${p}%`, `sku.ilike.%${p}%`, `ean.ilike.%${p}%`, `codigo_fornecedor.ilike.%${p}%`]).join(',')
  const { data } = await sb.from('produtos')
    .select('id, nome, sku, ean, tipo, foto_url, codigo_fornecedor')
    .eq('empresa_id', guarda.empresaId)
    .eq('ativo', true)
    .or(condicoes)
    .limit(300)

  const palavrasNorm = palavras.map(normalizar)
  const pontuados = (data ?? [])
    .map(p => {
      const campos = normalizar(p.nome) + ' ' + normalizar(p.sku ?? '') + ' ' + normalizar(p.ean ?? '') + ' ' + normalizar(p.codigo_fornecedor ?? '')
      const acertos = palavrasNorm.filter(pw => campos.includes(pw)).length
      const comecaComPrimeira = normalizar(p.nome).startsWith(palavrasNorm[0]) ? 1 : 0
      return { produto: p, acertos, comecaComPrimeira }
    })
    .filter(x => x.acertos > 0)
    .sort((a, b) => (b.acertos - a.acertos) || (b.comecaComPrimeira - a.comecaComPrimeira))
    .slice(0, 20)
    .map(x => x.produto)

  return NextResponse.json({ ok: true, resultados: pontuados })
}
