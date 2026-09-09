import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { montarCodigoEndereco } from '@/lib/enderecamento/estoque'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data, error } = await sb.from('enderecos').select('*').eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ ok: false, erro: 'Endereço não encontrado.' }, { status: 404 })
  return NextResponse.json({ ok: true, endereco: data })
}

type CorpoEditar = {
  descricao?: string | null
  tipo?: string
  status?: string
  exclusivo?: boolean
  capacidadeMaxima?: number | null
  sequenciaPicking?: number | null
  // Niveis da hierarquia. So sao considerados se a chave vier no corpo —
  // `undefined` significa "nao mexi nisso", `null`/'' significa "apague este
  // nivel". Sao coisas diferentes e nao podem ser confundidas: o segundo
  // encurta o codigo, o primeiro nao deveria mudar nada.
  zona?: string | null; corredor?: string | null; estante?: string | null
  modulo?: string | null; nivel?: string | null; posicao?: string | null
}

const NIVEIS = ['zona', 'corredor', 'estante', 'modulo', 'nivel', 'posicao'] as const

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({})) as CorpoEditar
  const { data: atual } = await sb.from('enderecos').select('*').eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!atual) return NextResponse.json({ ok: false, erro: 'Endereço não encontrado.' }, { status: 404 })

  const campos: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.descricao !== undefined) campos.descricao = body.descricao || null
  if (body.tipo !== undefined) campos.tipo = body.tipo
  if (body.status !== undefined) campos.status = body.status
  if (body.exclusivo !== undefined) campos.exclusivo = body.exclusivo
  if (body.capacidadeMaxima !== undefined) campos.capacidade_maxima = body.capacidadeMaxima
  if (body.sequenciaPicking !== undefined) campos.sequencia_picking = body.sequenciaPicking

  // ── EDITAR O CÓDIGO ────────────────────────────────────────────────────
  //
  // Até aqui o código era imutável, e a tela dizia "(não editável)". Isso
  // não sobrevive ao depósito real: um endereço nasce "C04-LE-E05-P5" e
  // meses depois a caixa CX02 passa a existir dentro dele. Recriar o
  // endereço para renomear obrigaria a esvaziar o estoque antes (o DELETE
  // recusa endereço com saldo) e perderia o histórico — renomear não move
  // nada, `produto_enderecos.endereco_id` aponta para o id, não para o
  // texto.
  //
  // O código NÃO é digitado: continua sendo montado pela mesma função que
  // monta na criação, a partir dos níveis e da config do depósito. Ter um
  // segundo jeito de escrever código de endereço seria ter dois formatos
  // divergindo no primeiro conserto.
  const mexeuEmNivel = NIVEIS.some(n => body[n] !== undefined)
  let codigoAnterior: string | null = null

  if (mexeuEmNivel) {
    const { data: config } = await sb.from('deposito_enderecamento_config')
      .select('niveis, separador, padding_por_nivel, prefixos_por_nivel')
      .eq('deposito_id', atual.deposito_id).maybeSingle()
    const niveisAtivos = (config?.niveis as string[] | undefined) ?? ['zona', 'corredor', 'estante', 'nivel', 'posicao']
    const separador = config?.separador ?? '-'
    const padding = (config?.padding_por_nivel as Record<string, number> | undefined) ?? {}
    const prefixos = (config?.prefixos_por_nivel as Record<string, string> | undefined) ?? {}

    const valores: Record<string, string | undefined> = {}
    for (const n of NIVEIS) {
      const bruto = body[n] !== undefined ? body[n] : (atual[n] as string | null)
      const limpo = (bruto ?? '').toString().trim()
      valores[n] = limpo || undefined
      campos[n] = limpo || null
    }

    const novoLegivel = montarCodigoEndereco(niveisAtivos, valores, separador, padding, prefixos)
    if (!novoLegivel) {
      return NextResponse.json({ ok: false, erro: 'Preencha ao menos um nível de localização.' }, { status: 400 })
    }

    if (novoLegivel !== atual.codigo_legivel) {
      codigoAnterior = atual.codigo_legivel
      campos.codigo_legivel = novoLegivel

      // O CÓDIGO INTERNO SÓ ACOMPANHA SE ERA DERIVADO. Ele é o valor do QR
      // e do código de barras da etiqueta — em endereços importados
      // (importar-localizacoes) ou criados com código próprio ele foi
      // escolhido à mão, e reescrevê-lo aqui quebraria a leitura do
      // coletor sem que ninguém tivesse pedido.
      if (atual.codigo_interno === atual.codigo_legivel) {
        const { data: colisao } = await sb.from('enderecos')
          .select('id').eq('empresa_id', guarda.empresaId).eq('deposito_id', atual.deposito_id)
          .eq('codigo_interno', novoLegivel).neq('id', id).maybeSingle()
        if (colisao) {
          return NextResponse.json({ ok: false, erro: 'Já existe um endereço com este código neste depósito.' }, { status: 409 })
        }
        campos.codigo_interno = novoLegivel
        if (atual.qr_code_valor === atual.codigo_interno) campos.qr_code_valor = novoLegivel
        if (atual.codigo_barras_valor === atual.codigo_interno) campos.codigo_barras_valor = novoLegivel
      }
    }
  }

  const { data: atualizado, error } = await sb.from('enderecos').update(campos).eq('id', id).select().single()
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  // `codigoAnterior` não é enfeite: é o que permite a tela avisar que a
  // etiqueta pendurada na prateleira agora diz outra coisa.
  return NextResponse.json({ ok: true, endereco: atualizado, codigoAnterior })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: endereco } = await sb.from('enderecos').select('id').eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!endereco) return NextResponse.json({ ok: false, erro: 'Endereço não encontrado.' }, { status: 404 })

  // Nunca apaga endereço com saldo — o mesmo cuidado usado em todo o resto
  // do sistema (produtos, depósitos): soft-delete, nunca perda de rastro.
  const { data: comSaldo } = await sb.from('produto_enderecos')
    .select('id').eq('endereco_id', id).gt('quantidade', 0).limit(1)
  if (comSaldo && comSaldo.length > 0) {
    return NextResponse.json({ ok: false, erro: 'Este endereço tem estoque — esvazie antes de excluir.' }, { status: 400 })
  }

  const { error } = await sb.from('enderecos').update({ ativo: false, status: 'inativo', updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
