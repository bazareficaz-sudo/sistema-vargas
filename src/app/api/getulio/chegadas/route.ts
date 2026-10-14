import { NextResponse } from 'next/server'
import { guardaGetulio } from '@/lib/getulio/acesso'
import { lerConfigChegadas, reenviarChegada } from '@/lib/getulio/chegadas'
import { ehIdDeGrupo } from '@/lib/getulio/chegadasRegras'
import { enviarWhatsappAutomacao } from '@/lib/automacoes/whatsapp-send'

// Configuração do boletim "Chegou na loja" e os últimos boletins — Central
// da Betina (quem administra a empresa).

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente Supabase sem tipos gerados, como no resto do projeto
async function ultimos(sb: any, empresaId: string) {
  const { data } = await sb.from('getulio_chegadas')
    .select('id, rotulo, fornecedor, novidades, voltaram, repostos, sem_preco, status, texto, erro, enviado_em, created_at')
    .eq('empresa_id', empresaId).order('created_at', { ascending: false }).limit(15)
  return data ?? []
}

export async function GET() {
  const { sb, guarda } = await guardaGetulio()
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })
  const [config, boletins] = await Promise.all([lerConfigChegadas(sb, guarda.empresaId), ultimos(sb, guarda.empresaId)])
  return NextResponse.json({ ok: true, config, boletins })
}

export async function POST(req: Request) {
  const { sb, guarda } = await guardaGetulio()
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })
  const body = await req.json().catch(() => ({}))
  const atual = await lerConfigChegadas(sb, guarda.empresaId)

  if (body.acao === 'teste') {
    if (!atual.grupo_id) return NextResponse.json({ ok: false, erro: 'Escolha e salve o grupo primeiro' }, { status: 400 })
    const r = await enviarWhatsappAutomacao(sb, guarda.empresaId, atual.grupo_id,
      '✅ *Betina por aqui!*\nA partir de agora, toda mercadoria que chegar na loja — novidades e o que voltou ao estoque — aparece neste grupo logo depois que a nota é lançada.',
      { tipo: 'getulio_chegada_teste', referencia_tipo: 'getulio_chegada' })
    return NextResponse.json(r.ok ? { ok: true } : { ok: false, erro: r.erro ?? 'Falha no envio' })
  }

  if (body.acao === 'reenviar') {
    const r = await reenviarChegada(sb, atual, String(body.id ?? ''))
    return NextResponse.json({ ok: r.ok, erro: r.erro, boletins: await ultimos(sb, guarda.empresaId) })
  }

  const grupoId = String(body.grupo_id ?? '').trim() || null
  if (grupoId && !ehIdDeGrupo(grupoId)) {
    return NextResponse.json({ ok: false, erro: 'Isso não parece um ID de grupo (termina em "-group"). Use "Buscar grupos".' }, { status: 400 })
  }
  const ativo = !!body.ativo
  const { error } = await sb.from('getulio_chegadas_config').upsert({
    empresa_id: guarda.empresaId,
    ativo,
    grupo_id: grupoId,
    grupo_nome: grupoId ? String(body.grupo_nome ?? '').trim().slice(0, 80) || null : null,
    incluir_reposicao: body.incluir_reposicao !== false,
    avisar_sem_preco: body.avisar_sem_preco !== false,
    // Marca a hora em que LIGOU: nota anterior a isso nunca vira boletim.
    ativado_em: ativo ? (atual.ativo && atual.ativado_em ? atual.ativado_em : new Date().toISOString()) : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'empresa_id' })
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, config: await lerConfigChegadas(sb, guarda.empresaId) })
}
