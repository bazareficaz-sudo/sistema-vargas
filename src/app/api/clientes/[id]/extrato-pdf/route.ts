import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { gerarExtratoClientePdfBuffer, type LinhaExtrato } from '@/lib/contas-receber/extratoPdf'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// Monta o relatório da conta do cliente e devolve o link do PDF, para a tela
// de Cobrança mandar por WhatsApp.
//
// Cada linha precisa do dia da compra e de quem vendeu, que não estão em
// contas_receber — vêm da venda de origem (contas_receber.origem_id). Conta
// lançada à mão não tem venda por trás: aí vale a data de emissão e o
// vendedor sai vazio, em vez de a linha sumir do relatório.

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clienteId } = await params
  const body = await req.json().catch(() => ({}))
  // Por padrão só o que está em aberto — é uma cobrança, não um histórico.
  const incluirPagas: boolean = body?.incluirPagas === true

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: cliente } = await sb.from('clientes')
    .select('id, nome, cpf_cnpj').eq('id', clienteId).eq('empresa_id', empresaId).maybeSingle()
  if (!cliente) return NextResponse.json({ ok: false, erro: 'Cliente não encontrado' }, { status: 404 })

  const { data: empresa } = await sb.from('empresas')
    .select('nome, cnpj, telefone, logradouro, numero, bairro, cidade, uf')
    .eq('id', empresaId).single()
  if (!empresa) return NextResponse.json({ ok: false, erro: 'Empresa não encontrada' }, { status: 400 })

  let q = sb.from('contas_receber')
    .select('id, numero_doc, origem_id, data_emissao, data_vencimento, valor_original, valor_aberto, status')
    .eq('empresa_id', empresaId).eq('cliente_id', clienteId)
    .order('data_vencimento', { ascending: true })

  q = incluirPagas
    ? q.neq('status', 'cancelado')
    : q.in('status', ['aberto', 'parcial', 'vencido'])

  const { data: contas, error } = await q
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  // Uma consulta só para todas as vendas de origem, em vez de uma por conta.
  const idsVenda = [...new Set((contas ?? []).map(c => c.origem_id).filter(Boolean))] as string[]
  const vendaPorId = new Map<string, { created_at: string; vendedor_nome: string | null; numero: number | null }>()
  if (idsVenda.length > 0) {
    const { data: vendas } = await sb.from('vendas')
      .select('id, created_at, vendedor_nome, numero').in('id', idsVenda).eq('empresa_id', empresaId)
    for (const v of vendas ?? []) vendaPorId.set(v.id, v)
  }

  const hoje = new Date().toISOString().slice(0, 10)
  // Dias corridos entre a compra e hoje, com as duas pontas em UTC para o
  // número não mudar por causa da hora em que o relatório foi gerado.
  const emDias = (data: string) => Math.max(0, Math.round(
    (Date.parse(hoje + 'T00:00:00Z') - Date.parse(data + 'T00:00:00Z')) / 86400000,
  ))

  const linhas: LinhaExtrato[] = (contas ?? []).map(c => {
    const v = c.origem_id ? vendaPorId.get(c.origem_id) : undefined
    const dataCompra = (v?.created_at ?? c.data_emissao).slice(0, 10)
    return {
      dataCompra,
      vendedor: v?.vendedor_nome ?? null,
      documento: c.numero_doc ?? (v?.numero ? `Venda #${v.numero}` : null),
      dias: emDias(dataCompra),
      valorOriginal: Number(c.valor_original ?? 0),
      valorAberto: Number(c.valor_aberto ?? 0),
    }
  })

  const emitidoEm = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const buffer = await gerarExtratoClientePdfBuffer({
    empresa,
    clienteNome: cliente.nome,
    clienteDoc: cliente.cpf_cnpj,
    linhas,
    emitidoEm,
  })

  // Reaproveita o bucket dos comprovantes de venda (privado, já configurado)
  // em vez de criar outro só pra isso. Nome com a data pra não sobrescrever
  // o relatório de ontem enquanto o link antigo ainda pode estar num chat.
  const path = `${empresaId}/extratos/${clienteId}-${hoje}.pdf`
  const { error: erroUpload } = await sb.storage.from('comprovantes-venda')
    .upload(path, buffer, { contentType: 'application/pdf', upsert: true })
  if (erroUpload) return NextResponse.json({ ok: false, erro: erroUpload.message }, { status: 500 })

  // 1 hora: tempo de sobra pra pessoa abrir no WhatsApp sem deixar um link
  // do saldo de um cliente aberto pra sempre.
  const { data: assinado, error: erroLink } = await sb.storage
    .from('comprovantes-venda').createSignedUrl(path, 3600)
  if (erroLink || !assinado?.signedUrl) {
    return NextResponse.json({ ok: false, erro: erroLink?.message ?? 'Falha ao gerar o link do relatório' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    url: assinado.signedUrl,
    resumo: {
      compras: linhas.length,
      emAberto: linhas.reduce((t, l) => t + l.valorAberto, 0),
      maisAntigaDias: linhas.reduce((m, l) => Math.max(m, l.dias), 0),
    },
  })
}
