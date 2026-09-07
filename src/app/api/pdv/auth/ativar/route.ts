import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashDoCodigo, hashDoSegredo, segredoBemFormado, MAX_TENTATIVAS_CODIGO, assinarToken } from '@/lib/pdv/terminalToken'
import { decidirAtivacao } from '@/lib/pdv/decidirAtivacao'
import { segredoDeAssinatura } from '@/lib/pdv/segredo'

// ATIVAÇÃO DE UM TERMINAL PDV.
//
// É a única rota do sistema que atende um cliente sem identidade nenhuma —
// o terminal ainda não existe para o servidor. Por isso ela roda com a chave
// de serviço, e por isso tudo que decide está em `decidirAtivacao`, testado
// fora daqui.
//
// A EMPRESA VEM DO CÓDIGO, nunca do corpo da requisição. O PDV pode mandar
// o `empresa_id` que quiser: ele é ignorado. O código foi emitido pelo painel
// por um usuário autenticado, já vinculado a uma empresa — é dali que a
// autorização deriva.
//
// O SEGREDO É GERADO PELO TERMINAL — ver a justificativa em
// `terminalToken.ts`: é o que torna a ativação idempotente quando a resposta
// se perde no caminho.
//
// Ele chega em claro (dentro do TLS) e o servidor grava só o HASH. É a
// diferença entre uma senha e um crachá: se o terminal mandasse o hash
// pronto, o valor guardado no banco seria exatamente o valor que autentica,
// e quem lesse a linha passaria a poder se fazer passar pelo terminal. Do
// jeito que está, um vazamento do banco não devolve credencial nenhuma.

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const codigo = String(body?.codigo ?? '')
  const secret = String(body?.secret ?? '')
  const versao = body?.versao_pdv ? String(body.versao_pdv).slice(0, 40) : null
  // Telemetria, não autorização. Hostname e sistema operacional são
  // spoofáveis; entram para o painel poder dizer "este terminal é o do
  // balcão", e para nada além disso.
  const dispositivo = body?.dispositivo && typeof body.dispositivo === 'object'
    ? { ...body.dispositivo, terminal_id_legado: body?.terminal_id_legado ?? null }
    : null

  if (!codigo.trim()) {
    return NextResponse.json({ ok: false, erro: 'Informe o código de ativação.' }, { status: 400 })
  }
  if (!segredoBemFormado(secret)) {
    return NextResponse.json({ ok: false, erro: 'Credencial do terminal mal formada.' }, { status: 400 })
  }

  const secretHash = hashDoSegredo(secret)

  const sb = createAdminClient()
  const codigoHash = hashDoCodigo(codigo)

  const { data: ativacao } = await sb
    .from('pdv_ativacoes')
    .select('id, empresa_id, terminal_id, codigo_hash, expira_em, usado_em, usado_por_hash, tentativas')
    .eq('codigo_hash', codigoHash)
    .maybeSingle()

  const { data: terminal } = ativacao
    ? await sb.from('pdv_terminais').select('id, empresa_id, status').eq('id', ativacao.terminal_id).maybeSingle()
    : { data: null }

  const decisao = decidirAtivacao({
    ativacao, terminal,
    secretHashApresentado: secretHash,
    agora: new Date(),
    maxTentativas: MAX_TENTATIVAS_CODIGO,
  })

  if (decisao.acao === 'recusar') {
    if (decisao.contarTentativa && ativacao) {
      await sb.from('pdv_ativacoes')
        .update({ tentativas: (ativacao.tentativas ?? 0) + 1 })
        .eq('id', ativacao.id)
    }
    return NextResponse.json({ ok: false, erro: decisao.erro }, { status: 401 })
  }

  const agora = new Date().toISOString()

  if (decisao.acao === 'ativar') {
    await sb.from('pdv_terminais').update({
      secret_hash: secretHash,
      status: 'ativo',
      ativado_em: agora,
      versao_pdv: versao,
      dispositivo,
      terminal_id_legado: body?.terminal_id_legado ? String(body.terminal_id_legado).slice(0, 60) : null,
      updated_at: agora,
    }).eq('id', ativacao!.terminal_id)

    await sb.from('pdv_ativacoes').update({
      usado_em: agora, usado_por_hash: secretHash,
    }).eq('id', ativacao!.id)
  }

  // Empresa e tenant SEMPRE relidos do banco, mesmo no caminho idempotente.
  const { data: empresa } = await sb
    .from('empresas').select('id, nome, tenant_id, ativo').eq('id', ativacao!.empresa_id).maybeSingle()

  const token = assinarToken({
    sub: ativacao!.terminal_id,
    terminal_id: ativacao!.terminal_id,
    empresa_id: ativacao!.empresa_id,
    tenant_id: empresa?.tenant_id ?? null,
    tipo: 'pdv_terminal',
  }, segredoDeAssinatura())

  const { data: term } = await sb
    .from('pdv_terminais').select('nome').eq('id', ativacao!.terminal_id).maybeSingle()

  return NextResponse.json({
    ok: true,
    ja_ativado: decisao.acao === 'ja_ativado',
    terminal: { id: ativacao!.terminal_id, nome: term?.nome ?? null },
    empresa: { id: ativacao!.empresa_id, nome: empresa?.nome ?? null },
    token,
  })
}
