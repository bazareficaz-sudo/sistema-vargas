import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import type { TaxaDegrau } from '@/lib/financeiro/taxas'

// O cadastro de formas de pagamento, com a escada de taxas.
//
// Leitura para qualquer sessão da empresa; escrita só para quem administra
// configurações — é taxa, e taxa errada desarruma a margem de toda venda.

const LIQUIDACOES = ['imediata', 'adquirente', 'fiado']

const CAMPOS_FORMA =
  'id, codigo, nome, icone, tecla, ordem, ativo, liquidacao, ' +
  'caixa_destino_id, adquirente_caixa_id, aceita_parcelamento, parcelas_max'

export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  if (!profile?.empresa_id) {
    return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 403 })
  }

  const [{ data: formas }, { data: taxas }, { data: contas }] = await Promise.all([
    sb.from('forma_pagamento').select(CAMPOS_FORMA)
      .eq('empresa_id', profile.empresa_id).order('ordem'),
    // Todas as vigências, não só a atual: a tela mostra o histórico, que é o
    // que explica por que a venda de setembro foi medida com outra taxa.
    sb.from('forma_pagamento_taxa')
      .select('id, forma_id, parcelas_min, taxa_pct, prazo_dias, vigente_de, observacao')
      .order('vigente_de', { ascending: false }).order('parcelas_min'),
    // Os caixas que podem receber: conta de banco e maquininha. PDV e
    // tesouraria ficam fora porque não são destino de forma de pagamento —
    // dinheiro entra no caixa do terminal que vendeu, e isso é `null`.
    sb.from('caixa').select('id, nome, tipo')
      .eq('empresa_id', profile.empresa_id).eq('ativo', true)
      .in('tipo', ['banco', 'adquirente']).order('nome'),
  ])

  // `any` aqui porque este projeto não gera os tipos do banco: sem eles o
  // cliente devolve um tipo que não dá nem para espalhar com `...`, e a
  // alternativa seria repetir a forma da linha à mão — uma segunda definição
  // do schema, que diverge na primeira coluna nova.
  const porForma = new Map<string, TaxaDegrau[]>()
  for (const t of (taxas ?? []) as any[]) {
    const lista = porForma.get(t.forma_id) ?? []
    lista.push({
      parcelas_min: t.parcelas_min,
      taxa_pct: Number(t.taxa_pct),
      prazo_dias: t.prazo_dias,
      vigente_de: t.vigente_de,
    })
    porForma.set(t.forma_id, lista)
  }

  return NextResponse.json({
    ok: true,
    formas: ((formas ?? []) as any[]).map(f => ({ ...f, taxas: porForma.get(f.id) ?? [] })),
    contas: contas ?? [],
  })
}

/** Alterar a forma: nome, destino do dinheiro, parcelamento. */
export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}))
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  if (typeof body.id !== 'string' || !body.id) {
    return NextResponse.json({ ok: false, erro: 'Forma não informada.' }, { status: 400 })
  }

  const nome = String(body.nome ?? '').trim()
  if (!nome) return NextResponse.json({ ok: false, erro: 'O nome não pode ficar vazio.' }, { status: 400 })

  const liquidacao = LIQUIDACOES.includes(body.liquidacao) ? body.liquidacao : 'imediata'
  const adquirente = typeof body.adquirente_caixa_id === 'string' && body.adquirente_caixa_id
    ? body.adquirente_caixa_id : null
  const destino = typeof body.caixa_destino_id === 'string' && body.caixa_destino_id
    ? body.caixa_destino_id : null

  // A RECUSA QUE IMPORTA. O banco também barra, por CHECK; a mensagem é que
  // muda. "violates check constraint" não diz a ninguém o que fazer.
  if (liquidacao === 'adquirente' && !adquirente) {
    return NextResponse.json({
      ok: false,
      erro: 'Forma que passa na maquininha precisa dizer em qual adquirente. Sem isso a venda no cartão não tem onde ser lançada.',
    }, { status: 400 })
  }

  const parcela = !!body.aceita_parcelamento
  const pmax = parcela ? Math.max(1, Math.min(36, Math.floor(Number(body.parcelas_max) || 1))) : 1

  const { error } = await sb.from('forma_pagamento').update({
    nome,
    ativo: !!body.ativo,
    liquidacao,
    caixa_destino_id: liquidacao === 'adquirente' ? null : destino,
    adquirente_caixa_id: liquidacao === 'adquirente' ? adquirente : null,
    aceita_parcelamento: parcela,
    parcelas_max: pmax,
    updated_at: new Date().toISOString(),
  }).eq('id', body.id).eq('empresa_id', guarda.empresaId)

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/**
 * Cadastrar uma vigência: a escada COMPLETA da forma, a partir de uma data.
 *
 * Escada completa e não degrau solto porque `taxa_vigente_v1` resolve a
 * vigência primeiro e só depois procura o degrau: um degrau cadastrado numa
 * data nova esconderia todos os outros da data anterior.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const formaId = typeof body.forma_id === 'string' ? body.forma_id : ''
  const vigenteDe = typeof body.vigente_de === 'string' ? body.vigente_de : ''

  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigenteDe)) {
    return NextResponse.json({ ok: false, erro: 'Informe a data em que esta tabela passa a valer.' }, { status: 400 })
  }

  // Só formas da empresa da sessão. Sem esta conferência, um id de outra
  // empresa passaria — a policy do banco barraria, mas com erro opaco.
  const { data: forma } = await sb.from('forma_pagamento')
    .select('id, nome, aceita_parcelamento, parcelas_max')
    .eq('id', formaId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!forma) return NextResponse.json({ ok: false, erro: 'Forma não encontrada.' }, { status: 404 })

  const degraus = Array.isArray(body.degraus) ? body.degraus : []
  const limpos: { parcelas_min: number; taxa_pct: number; prazo_dias: number | null }[] = []
  const vistos = new Set<number>()

  for (const d of degraus) {
    const n = Math.floor(Number(d?.parcelas_min))
    const taxa = Number(d?.taxa_pct)
    if (!Number.isFinite(n) || n < 1) {
      return NextResponse.json({ ok: false, erro: 'Degrau de parcela inválido.' }, { status: 400 })
    }
    if (!Number.isFinite(taxa) || taxa < 0 || taxa > 100) {
      return NextResponse.json({ ok: false, erro: `Taxa inválida em ${n}x. Use um valor entre 0 e 100.` }, { status: 400 })
    }
    if (vistos.has(n)) {
      return NextResponse.json({ ok: false, erro: `O degrau de ${n}x aparece duas vezes.` }, { status: 400 })
    }
    vistos.add(n)

    // Prazo vazio fica NULO, e não zero. Zero diz "cai no mesmo dia", e a
    // conciliação cobraria hoje o que só cai em trinta dias.
    const prazoCru = d?.prazo_dias
    const prazo = prazoCru === null || prazoCru === undefined || prazoCru === ''
      ? null
      : Math.floor(Number(prazoCru))
    if (prazo !== null && (!Number.isFinite(prazo) || prazo < 0)) {
      return NextResponse.json({ ok: false, erro: `Prazo inválido em ${n}x.` }, { status: 400 })
    }

    limpos.push({ parcelas_min: n, taxa_pct: taxa, prazo_dias: prazo })
  }

  // A RECUSA QUE PROTEGE A MARGEM. Sem o degrau de 1x, `taxa_vigente_v1` não
  // acha linha nenhuma para uma venda à vista e devolve vazio — a margem na
  // tela sobe, e ninguém descobre por quê.
  if (!vistos.has(1)) {
    return NextResponse.json({
      ok: false,
      erro: 'A tabela precisa ter a taxa de 1x. É ela que vale para a venda à vista.',
    }, { status: 400 })
  }

  const { error } = await sb.from('forma_pagamento_taxa').insert(
    limpos.map(d => ({
      forma_id: forma.id,
      parcelas_min: d.parcelas_min,
      taxa_pct: d.taxa_pct,
      prazo_dias: d.prazo_dias,
      vigente_de: vigenteDe,
      observacao: typeof body.observacao === 'string' && body.observacao.trim()
        ? body.observacao.trim() : null,
    })),
  )

  if (error) {
    // A trava de unicidade é (forma, degrau, vigência). Bater nela quer dizer
    // que já existe tabela nessa data para esta forma.
    if (error.code === '23505' || /duplicate key|unico/i.test(error.message)) {
      return NextResponse.json({
        ok: false,
        erro: `Já existe uma tabela de ${forma.nome} valendo a partir de ${vigenteDe}. Edite a que está lá, ou escolha outra data.`,
      }, { status: 409 })
    }
    return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, degraus: limpos.length })
}
