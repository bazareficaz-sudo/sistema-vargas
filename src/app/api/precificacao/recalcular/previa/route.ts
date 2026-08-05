import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { varrerRecalculo } from '@/lib/precificacao/recalculo'
import { produtosDaEntrada } from '@/lib/produtos/filtroEntrada'

// Prévia do recálculo: calcula tudo e não aplica nada.
//
// Existe justamente pra responder "esta alteração impactará quantos
// anúncios?" ANTES de mexer em preço de produção.

export const maxDuration = 300

export async function POST(req: Request) {
  const {
    canaisIds, apenasAtivos, busca,
    entrada, entradaDe, entradaAte,
  } = await req.json().catch(() => ({}))

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  // Entrada de mercadoria vira uma lista de produtos — mesma função que as
  // telas de Produtos e Gestão de Preços usam, cobrindo lançamento manual e
  // nota importada por XML.
  const daEntrada = await produtosDaEntrada(sb, guarda.empresaId, {
    numero: entrada, de: entradaDe, ate: entradaAte,
  })

  const { resumo, itens, truncado } = await varrerRecalculo(sb, guarda.empresaId, {
    canaisIds, apenasAtivos: apenasAtivos !== false,
    busca,
    produtoIds: daEntrada?.produtoIds ?? null,
  })

  return NextResponse.json({
    ok: true, resumo, itens, truncado,
    // A tela precisa dizer QUAIS entradas casaram: quando o número casa com
    // mais de uma, os anúncios "a mais" ficariam sem explicação.
    entradasCasadas: daEntrada?.entradasCasadas ?? [],
    produtosDaEntrada: daEntrada?.produtoIds.length ?? null,
  })
}
