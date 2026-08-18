import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { montarCodigoEndereco } from '@/lib/enderecamento/estoque'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Gera dezenas/centenas de endereços de uma vez a partir de faixas por
// nível — ex: corredores 01 a 05, estantes 01 a 10, níveis 01 a 05 vira o
// produto cartesiano de tudo. Endereços cujo código já existe são pulados
// (idempotente — rodar de novo não duplica).

type Faixa = { de: string; ate: string } | { valores: string[] }

type Corpo = {
  depositoId?: string
  tipo?: string
  faixas?: Partial<Record<'zona' | 'corredor' | 'estante' | 'modulo' | 'nivel' | 'posicao', Faixa>>
}

const LIMITE_COMBINACOES = 5000

function ehNumerica(s: string) { return /^\d+$/.test(s) }

function expandirFaixa(f: Faixa): string[] {
  if ('valores' in f) return f.valores.filter(Boolean)
  const { de, ate } = f
  if (ehNumerica(de) && ehNumerica(ate)) {
    const largura = Math.max(de.length, ate.length)
    const ini = parseInt(de, 10), fim = parseInt(ate, 10)
    const passo = fim >= ini ? 1 : -1
    const out: string[] = []
    for (let i = ini; passo > 0 ? i <= fim : i >= fim; i += passo) out.push(String(i).padStart(largura, '0'))
    return out
  }
  // Faixa de letras (A até E)
  if (de.length === 1 && ate.length === 1) {
    const ini = de.toUpperCase().charCodeAt(0), fim = ate.toUpperCase().charCodeAt(0)
    const passo = fim >= ini ? 1 : -1
    const out: string[] = []
    for (let i = ini; passo > 0 ? i <= fim : i >= fim; i += passo) out.push(String.fromCharCode(i))
    return out
  }
  return [de]
}

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({})) as Corpo
  const { depositoId, faixas } = body
  if (!depositoId) return NextResponse.json({ ok: false, erro: 'Escolha o depósito.' }, { status: 400 })
  if (!faixas || Object.keys(faixas).length === 0) return NextResponse.json({ ok: false, erro: 'Informe ao menos uma faixa.' }, { status: 400 })

  const { data: deposito } = await sb.from('depositos').select('id').eq('id', depositoId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!deposito) return NextResponse.json({ ok: false, erro: 'Depósito inválido.' }, { status: 400 })

  const { data: config } = await sb.from('deposito_enderecamento_config')
    .select('niveis, separador, padding_por_nivel').eq('deposito_id', depositoId).maybeSingle()
  const niveis = (config?.niveis as string[] | undefined) ?? ['zona', 'corredor', 'estante', 'nivel', 'posicao']
  const separador = config?.separador ?? '-'
  const padding = (config?.padding_por_nivel as Record<string, number> | undefined) ?? {}

  const niveisComFaixa = (Object.keys(faixas) as (keyof typeof faixas)[]).filter(n => faixas[n])
  const expandidas = niveisComFaixa.map(n => ({ nivel: n, valores: expandirFaixa(faixas[n]!) }))

  const totalCombinacoes = expandidas.reduce((acc, e) => acc * e.valores.length, 1)
  if (totalCombinacoes > LIMITE_COMBINACOES) {
    return NextResponse.json({ ok: false, erro: `Isso geraria ${totalCombinacoes} endereços — o limite por lote é ${LIMITE_COMBINACOES}. Reduza as faixas.` }, { status: 400 })
  }

  // Produto cartesiano das faixas informadas.
  let combinacoes: Record<string, string>[] = [{}]
  for (const { nivel, valores } of expandidas) {
    const novo: Record<string, string>[] = []
    for (const combo of combinacoes) for (const v of valores) novo.push({ ...combo, [nivel]: v })
    combinacoes = novo
  }

  const { data: existentes } = await sb.from('enderecos').select('codigo_interno').eq('empresa_id', guarda.empresaId).eq('deposito_id', depositoId)
  const codigosExistentes = new Set((existentes ?? []).map((e: any) => e.codigo_interno))

  const paraCriar = combinacoes
    .map(combo => ({ combo, codigo: montarCodigoEndereco(niveis, combo, separador, padding) }))
    .filter(x => x.codigo && !codigosExistentes.has(x.codigo))

  if (paraCriar.length === 0) {
    return NextResponse.json({ ok: true, criados: 0, jaExistiam: combinacoes.length, total: combinacoes.length })
  }

  const linhas = paraCriar.map(({ combo, codigo }) => ({
    empresa_id: guarda.empresaId, deposito_id: depositoId,
    codigo_interno: codigo, codigo_legivel: codigo,
    zona: combo.zona || null, corredor: combo.corredor || null, estante: combo.estante || null,
    modulo: combo.modulo || null, nivel: combo.nivel || null, posicao: combo.posicao || null,
    tipo: body.tipo || 'ARMAZENAGEM', qr_code_valor: codigo, codigo_barras_valor: codigo,
    criado_por: guarda.userId,
  }))

  const { error } = await sb.from('enderecos').insert(linhas)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  return NextResponse.json({
    ok: true, criados: linhas.length, jaExistiam: combinacoes.length - linhas.length, total: combinacoes.length,
  })
}
