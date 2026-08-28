import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  gerarComprovantesVendaPdfBuffer, CONFIG_IMPRESSAO_PADRAO,
  type ComprovanteVenda, type ConfigImpressao,
} from '@/lib/vendas/comprovantePdf'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { buscarTudo } from '@/lib/supabase/paginar'

// Comprovantes de VÁRIAS vendas num PDF só, uma venda por página.
//
// A rota irmã (`[id]/comprovante-pdf`) devolve uma venda e GRAVA o PDF no
// storage, porque o envio por WhatsApp precisa de uma URL pública. Aqui o
// destino é a impressora do balcão: o PDF volta no corpo da resposta e vira
// blob no navegador, sem deixar arquivo de lote acumulando no bucket.
export const maxDuration = 120

// Teto por impressão. Não é limite de negócio: é o que cabe no tempo da função
// sem estourar. Passar disso avisa na tela, em vez de expirar sem explicação.
const LIMITE = 100

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { ids?: unknown } | null
  const ids = Array.isArray(body?.ids) ? body!.ids.filter((v): v is string => typeof v === 'string') : []
  if (ids.length === 0) return NextResponse.json({ ok: false, erro: 'Nenhuma venda informada' }, { status: 400 })
  if (ids.length > LIMITE) {
    return NextResponse.json({ ok: false, erro: `Máximo de ${LIMITE} vendas por impressão. Selecione menos e repita.` }, { status: 400 })
  }

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  // O filtro por empresa vale tanto quanto o `in`: id de venda de outra
  // empresa simplesmente não volta, e a página dela não é montada.
  const { data: vendas } = await sb.from('vendas').select('*').in('id', ids).eq('empresa_id', empresaId)
  if (!vendas || vendas.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nenhuma das vendas selecionadas foi encontrada' }, { status: 404 })
  }

  const vendaIds = vendas.map(v => v.id)

  // Cem vendas passam de 1.000 itens sem esforço, e o PostgREST corta em 1.000
  // sem avisar — comprovante sairia com item faltando. Daí a paginação.
  const itens = await buscarTudo<any>(
    (de, ate) => sb.from('venda_itens').select('*').in('venda_id', vendaIds).order('id').range(de, ate),
    { rotulo: 'venda_itens do lote de comprovantes' },
  )
  const itensPorVenda = new Map<string, any[]>()
  for (const it of itens) {
    const lista = itensPorVenda.get(it.venda_id)
    if (lista) lista.push(it); else itensPorVenda.set(it.venda_id, [it])
  }

  const clienteIds = [...new Set(vendas.map(v => v.cliente_id).filter(Boolean))] as string[]
  const clientesPorId = new Map<string, { nome: string; cpf_cnpj: string | null; telefone: string | null }>()
  if (clienteIds.length > 0) {
    const { data: clientes } = await sb.from('clientes').select('id, nome, cpf_cnpj, telefone').in('id', clienteIds)
    for (const c of clientes ?? []) clientesPorId.set(c.id, { nome: c.nome, cpf_cnpj: c.cpf_cnpj, telefone: c.telefone })
  }

  const { data: empresa } = await sb.from('empresas')
    .select('nome, cnpj, telefone, logradouro, numero, bairro, cidade, uf')
    .eq('id', empresaId).single()
  if (!empresa) return NextResponse.json({ ok: false, erro: 'Empresa não encontrada' }, { status: 400 })

  const { data: cfgImpressao } = await sb.from('empresa_config_impressao')
    .select('formato, mensagem_rodape, mostrar_sku').eq('empresa_id', empresaId).maybeSingle()
  const config: ConfigImpressao = {
    formato: (cfgImpressao?.formato as ConfigImpressao['formato']) ?? CONFIG_IMPRESSAO_PADRAO.formato,
    mensagem_rodape: cfgImpressao?.mensagem_rodape ?? null,
    mostrar_sku: cfgImpressao?.mostrar_sku ?? CONFIG_IMPRESSAO_PADRAO.mostrar_sku,
  }

  // Na ordem em que a tela mandou — o `in` do PostgREST não promete ordem, e
  // conferir o maço impresso contra a lista da tela exige que batam.
  const porId = new Map(vendas.map(v => [v.id, v]))
  const comprovantes: ComprovanteVenda[] = ids
    .map(id => porId.get(id))
    .filter(Boolean)
    .map(venda => ({
      empresa,
      cliente: venda.cliente_id ? (clientesPorId.get(venda.cliente_id) ?? null) : null,
      venda,
      itens: itensPorVenda.get(venda.id) ?? [],
      config,
    }))

  const buffer = await gerarComprovantesVendaPdfBuffer(comprovantes)

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="comprovantes.pdf"',
      'X-Comprovantes': String(comprovantes.length),
      'Cache-Control': 'no-store',
    },
  })
}
